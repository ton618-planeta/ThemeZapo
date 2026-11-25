import assert from 'node:assert/strict'
import { createDecipheriv, createHash, createHmac, hkdfSync } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { proto, unpadPkcs7 } from 'zapo-js'
import { isThemeGroupJid, groupThemeAllowed, parseGroupTheme, prepareThemeImage, encodeGroupTheme, encryptThemeImage, reserveGroupTheme } from '../lib/utils/groupTheme.js'
import { createGroupThemePlugin } from '../lib/services/groupThemePlugin.js'

const group = '120363001@g.us'
const legacyGroup = '123456789-1234567890@g.us'
for (const jid of [group, legacyGroup]) assert(isThemeGroupJid(jid))
for (const jid of ['123@s.whatsapp.net','123@lid','123@newsletter','abc@g.us','123-@g.us','123-456-789@g.us',null,{}]) assert(!isThemeGroupJid(jid))
const metadata = { owner: '111@s.whatsapp.net', participants: [
  { jid: '100@lid', phoneNumber: '111', role: 'creator' },
  { jid: '200@lid', phoneNumber: '222', role: 'admin' },
  { jid: '300@lid', phoneNumber: '333', role: 'member' }
] }
for (const id of ['111@s.whatsapp.net', '100@lid', '200:2@lid', '222@s.whatsapp.net']) assert(groupThemeAllowed(metadata, [id]))
for (const id of ['300@lid', '333@s.whatsapp.net', '200@s.whatsapp.net', '999@lid']) assert(!groupThemeAllowed(metadata, [id]))
assert(!groupThemeAllowed({participants:[{jid:'200@lid',role:'admin'},{jid:'200@lid',role:'member'}]}, ['200@lid']))
assert.deepEqual(parseGroupTheme('#ff0000'), { kind: 'color', color: 'FF0000' })
assert.equal(parseGroupTheme(' LIMPAR ').kind, 'clear')
assert.equal(parseGroupTheme('').kind, 'image')
assert.equal(parseGroupTheme('FF00ZZ'), null)
assert.equal(Buffer.from(encodeGroupTheme({kind:'color',color:'FF0000'},1)).toString('hex'), '62131022f2010e08015a0a0d0000ffff150000ffff')
const saved = encodeGroupTheme({kind:'clear'},1)
assert.equal(proto.Message.decode(saved).protocolMessage.chatThemeSetting.clearTheme, true)
encodeGroupTheme({kind:'color',color:'ABCDEF'},2)
assert.equal(Buffer.from(saved).toString('hex'), '62091022f2010408011001', 'writer arena cannot corrupt prior payloads')
const input = await sharp({create:{width:2000,height:1000,channels:3,background:'#cc2244'}}).png().toBuffer()
const photo = await prepareThemeImage(input)
const meta = await sharp(photo).metadata()
assert.equal(meta.format,'jpeg'); assert.equal(meta.width,1920); assert.equal(meta.height,960)
await assert.rejects(prepareThemeImage(Buffer.alloc(10*1024*1024+1)), /LIMIT/)
await assert.rejects(prepareThemeImage(Buffer.from('invalid image')))
const encrypted = encryptThemeImage(photo, Buffer.alloc(32,7))
const keys = Buffer.from(hkdfSync('sha256',Buffer.alloc(32,7),Buffer.alloc(32),'WhatsApp Chat Wallpaper Keys',112))
const ciphertext = encrypted.body.subarray(0,-10), mac = encrypted.body.subarray(-10)
assert.deepEqual(mac,createHmac('sha256',keys.subarray(48,80)).update(keys.subarray(0,16)).update(ciphertext).digest().subarray(0,10))
const decipher = createDecipheriv('aes-256-cbc',keys.subarray(16,48),keys.subarray(0,16))
assert.deepEqual(Buffer.concat([decipher.update(ciphertext),decipher.final()]),photo)
assert.deepEqual(encrypted.fileEncSha256,createHash('sha256').update(encrypted.body).digest())
assert.deepEqual(encrypted.fileSha256,createHash('sha256').update(photo).digest())
const upload = {...encrypted,directPath:'/v/wallpaper.enc'}
const decoded = proto.Message.decode(encodeGroupTheme({kind:'image',upload},1)).protocolMessage.chatThemeSetting.customImage
assert.equal(decoded.directPath,upload.directPath); assert.deepEqual(Buffer.from(decoded.mediaKey),encrypted.mediaKey)
let calls = 0, uploads = 0, lastEnvelope
const plugin = createGroupThemePlugin()
const ctx = { deps: {
  messageDispatch: { async publishGroupSenderKeyMessage(to,envelope,retry) {
    calls++; assert.equal(to,group); assert.equal(retry.retried,true); assert.equal(retry.forceRefreshParticipants,true)
    assert.equal(envelope.type,'media'); assert.equal(envelope.mediatype,'chat_theme'); assert.equal(envelope.sendOptions.maxAttempts,1)
    assert.equal(proto.Message.decode(unpadPkcs7(envelope.plaintext)).protocolMessage.type,34)
    lastEnvelope = envelope
    return {id:envelope.sendOptions.id,ack:{}}
  } },
  mediaTransfer: { async uploadStream(request) {
    uploads++; assert(request.url.startsWith('https://mmg.whatsapp.net/mms/chat-wallpaper-image/'))
    assert.equal(request.method,'POST'); assert.equal(request.timeoutMs,30000)
    assert(Buffer.isBuffer(request.body)); assert(!request.body.equals(photo))
    return {ok:true,body:Readable.from([JSON.stringify({direct_path:'/v/wallpaper.enc'})])}
  } }
}, queryWithContext: async (label,node,timeout) => {
  assert.equal(node.content[0].tag,'media_conn'); assert.equal(timeout,30000)
  return {tag:'iq',attrs:{type:'result'},content:[{tag:'media_conn',attrs:{auth:'fixture-private',ttl:'3600'},content:[{tag:'host',attrs:{hostname:'mmg.whatsapp.net'}}]}]}
} }
const service = plugin.setup(ctx)
await service.set(group,{kind:'color',color:'FF0000'}); assert.equal(uploads,0)
await service.set(group,{kind:'clear'}); assert.equal(uploads,0)
await service.set(group,{kind:'image',image:photo}); assert.equal(uploads,1)
assert.equal(calls,3)
ctx.deps.messageDispatch.publishGroupSenderKeyMessage = async () => {calls++;throw Error('ack timeout fixture-private')}
await assert.rejects(service.set(group,{kind:'clear'}),error=>error.code==='THEME_SEND_UNCERTAIN'&&!error.message.includes('fixture-private'))
assert.equal(calls,4,'no retry after uncertain send')
ctx.deps.messageDispatch.publishGroupSenderKeyMessage = async () => ({ack:{error:403}})
await assert.rejects(service.set(group,{kind:'clear'}),error=>error.code==='THEME_REJECTED')
ctx.deps.messageDispatch.publishGroupSenderKeyMessage = async () => ({id:'missing-ack'})
await assert.rejects(service.set(group,{kind:'clear'}),error=>error.code==='THEME_SEND_UNCERTAIN')
ctx.deps.mediaTransfer.uploadStream = async () => ({ok:false,body:Readable.from([])})
await assert.rejects(service.set(group,{kind:'image',image:photo}),/THEME_UPLOAD_FAILED/)
ctx.deps.mediaTransfer.uploadStream = async () => ({ok:true,body:Readable.from([Buffer.alloc(256*1024+1)])})
await assert.rejects(service.set(group,{kind:'image',image:photo}),/THEME_UPLOAD_LIMIT/)
await assert.rejects(service.set('123@s.whatsapp.net',{kind:'clear'}),/GROUP_ONLY/)

// Exercise the installed SDK's actual group publisher, including sender-key
// distribution. Only cryptography/network boundaries are replaced by fixtures.
const require = createRequire(import.meta.url)
const {WaMessageDispatchCoordinator} = require(path.join(path.dirname(require.resolve('zapo-js')),'client/coordinators/WaMessageDispatchCoordinator.js'))
for (const [mode, targetGroup] of [['pn',group],['lid',group],['pn',legacyGroup],['lid',legacyGroup]]) {
  let published=0, distributed=0, seenSender
  const peer = mode==='lid'?'400:2@lid':'444:2@s.whatsapp.net'
  const addr = {user:mode==='lid'?'400':'444',device:2,server:mode==='lid'?'lid':'s.whatsapp.net'}
  const sdk = new WaMessageDispatchCoordinator({
    logger:{trace(){},debug(){},warn(){}},getCurrentCredentials:()=>({meJid:'555:1@s.whatsapp.net',meLid:'500:1@lid'}),
    groupMetadataCache:{refreshParticipantUsers:async()=>[peer]},
    senderKeyManager:{prepareGroupEncryption:async(g,sender,bytes)=>{
      seenSender=sender; assert.equal(proto.Message.decode(unpadPkcs7(bytes)).protocolMessage.type,34)
      return {distributionMessage:{groupId:g,axolotlSenderKeyDistributionMessage:Buffer.from([1,2])},ciphertext:{ciphertext:Buffer.from([3,4])},keyId:77}
    },filterParticipantsNeedingDistribution:async(g,k,addresses)=>addresses,markSenderKeyDistributed:async(g,k,addresses)=>{distributed=addresses.length}},
    fanoutResolver:{resolveGroupParticipantDeviceJids:async()=>[peer]},
    sessionResolver:{ensureSessionsBatch:async()=>[{jid:peer,address:addr}]},
    signalProtocol:{encryptMessagesBatch:async requests=>{assert.equal(requests.length,1);return [{type:'msg',ciphertext:Buffer.from([8,9])}]}},
    retryTracker:{track:async(_,send)=>send()},
    messageClient:{publishNode:async(node,options)=>{
      published++; assert.equal(node.attrs.to,targetGroup); assert.equal(node.attrs.type,'media'); assert.equal(node.attrs.addressing_mode,mode)
      const enc=node.content.find(child=>child.tag==='enc'); assert.equal(enc.attrs.type,'skmsg');assert.equal(enc.attrs.mediatype,'chat_theme')
      assert(node.content.some(child=>child.tag==='participants'));assert.equal(options.maxAttempts,1)
      return {id:options.id,ack:{phash:'mismatch-fixture'}}
    }}
  })
  const actual = plugin.setup({deps:{messageDispatch:sdk}})
  await actual.set(targetGroup,{kind:'clear'})
  assert.equal(published,1,'phash mismatch cannot replay theme');assert.equal(distributed,1)
  assert.equal(seenSender.user,mode==='lid'?'500':'555')
}

console.log('PASS theme: protocol, crypto, images, PN/LID, legacy groups, SDK fanout, upload limits and uncertain send without retry')
