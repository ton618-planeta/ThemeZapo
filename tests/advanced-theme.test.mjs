import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'
import { proto, unpadPkcs7 } from 'zapo-js'
import { CHAT_THEME_PRESETS, resolveThemeScheme } from '../lib/utils/themeCatalog.js'
import { parseGroupTheme, encodeGroupTheme, encryptThemeImage } from '../lib/utils/groupTheme.js'
import { createGroupThemePlugin, setThemeGroup } from '../lib/theme.js'
import { normalizeWallpaper, publicWallpaperAddress, readWallpaperSource } from '../lib/utils/wallpaper.js'

assert.equal(Object.keys(CHAT_THEME_PRESETS).length,49)
for (const [name, scheme] of Object.entries(CHAT_THEME_PRESETS)) {
  assert.equal(resolveThemeScheme(name),scheme)
  assert.equal(resolveThemeScheme(scheme),scheme)
  const setting = proto.Message.decode(encodeGroupTheme({kind:'preset',scheme},1)).protocolMessage.chatThemeSetting
  assert.equal(setting.colorSchemeId,scheme); assert(setting.defaultWallpaper)
}
for (const alias of ['limpar','clear','reset','default','hapus']) assert.equal(parseGroupTheme(alias).kind,'clear')
for (const alias of ['list','lista','examples','exemplos']) assert.equal(parseGroupTheme(alias).kind,'list')
for (const alias of ['azul','blue','biru']) assert.equal(parseGroupTheme(alias).color,'1E90FF')
assert.equal(parseGroupTheme('pink').kind,'color'); assert.equal(parseGroupTheme('preset pink').kind,'preset')
assert.equal(parseGroupTheme('pink bubble emerald').bubble,'Emerald')
assert.equal(parseGroupTheme('clear bubble emerald'),null)
assert.throws(()=>parseGroupTheme('bubble invented'))
const group='12345-12345@g.us', changes=[]
let failAt=0, hold, release
const plugin=createGroupThemePlugin().setup({deps:{messageDispatch:{publishGroupSenderKeyMessage:async(_group,envelope)=>{
  const decoded=proto.Message.decode(unpadPkcs7(envelope.plaintext)).protocolMessage.chatThemeSetting
  changes.push(decoded)
  if (hold) await hold
  if (failAt===changes.length) throw Error('timeout')
  return {ack:{}}
}}}})
await plugin.set(group,parseGroupTheme('preset pink bubble royal-blue'))
assert.equal(changes.length,2);assert.equal(changes[0].colorSchemeId,'Pink');assert(changes[0].defaultWallpaper)
assert.equal(changes[1].colorSchemeId,'Royal-Blue');assert(!changes[1].defaultWallpaper)
await plugin.set(group,parseGroupTheme('preset pink bubble pink'));assert.equal(changes.length,3)
failAt=4
await assert.rejects(plugin.set(group,parseGroupTheme('preset pink bubble emerald')),e=>e.code==='THEME_SEND_UNCERTAIN');assert.equal(changes.length,4)
failAt=0;hold=new Promise(resolve=>release=resolve)
const pending=plugin.set(group,{kind:'clear'})
await assert.rejects(plugin.set(group,{kind:'clear'}),/THEME_BUSY/);release();await pending;hold=null
const jpeg=await sharp({create:{width:32,height:24,channels:3,background:'#e74c3c'}}).jpeg().toBuffer()
const upload={...encryptThemeImage(jpeg),directPath:'/fixture.enc'}
const image=proto.Message.decode(encodeGroupTheme({kind:'image',upload,bubble:'Emerald',dimLevel:0.5})).protocolMessage.chatThemeSetting
assert.equal(image.colorSchemeId,'Emerald');assert.equal(image.customImage.dimLevel,0.5)
assert.throws(()=>encodeGroupTheme({kind:'image',upload,dimLevel:2}),/DIM_INVALID/)
// The upstream reference uses stock/animated variant fields that differ from
// this SDK schema. Inspect the raw protobuf wire independently.
function fields(bytes) {
  let offset=0; const out={}
  const integer=()=>{let n=0,shift=0,b;do{b=bytes[offset++];n+=(b&127)*2**shift;shift+=7}while(b&128);return n}
  while(offset<bytes.length){const tag=integer(),id=tag>>>3,wire=tag&7
    if(wire===0)out[id]=integer()
    else if(wire===2){const size=integer();out[id]=bytes.subarray(offset,offset+size);offset+=size}
    else if(wire===5){out[id]=bytes.subarray(offset,offset+4);offset+=4}
    else throw Error('Unexpected wire type')
  }return out
}
for(const [kind,field] of [['stock',12],['animated',14]]) {
  const raw=fields(fields(fields(encodeGroupTheme({kind,wallpaperId:'example-id',dimLevel:0.25},1))[12])[30])
  const variant=fields(raw[field]);assert.equal(variant[1].toString(),'example-id');assert.equal(variant[2].readFloatLE(),0.25)
}
for (const address of ['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.1','100.64.1.2']) {
  await assert.rejects(publicWallpaperAddress(new URL('https://example.com'),async()=>[{address,family:4}]),/PRIVATE/)
}
assert.equal(await publicWallpaperAddress(new URL('https://example.com'),async()=>[{address:'8.8.8.8',family:4}]),'8.8.8.8')
await assert.rejects(publicWallpaperAddress(new URL('http://user:password@example.com')),/INVALID/)
await assert.rejects(readWallpaperSource(Readable.from([Buffer.alloc(10*1024*1024+1)])),/LIMIT/)
assert.deepEqual(await readWallpaperSource(Readable.from([jpeg])),jpeg)
assert.equal((await sharp(await normalizeWallpaper(jpeg)).metadata()).format,'jpeg')
const gif=await sharp(jpeg).gif().toBuffer()
assert.equal((await sharp(await normalizeWallpaper(gif)).metadata()).format,'jpeg')
await assert.rejects(normalizeWallpaper(Buffer.from('invalid')),/INVALID/)
const sent=[],api={group:{queryGroupMetadata:async()=>({restrict:false})},getCredentials:()=>({}),groupTheme:{set:async(g,setting)=>sent.push(setting)}}
await setThemeGroup(api,group,{theme:'pink',bubble:'royal-blue'});assert.equal(sent.at(-1).scheme,'Pink')
await setThemeGroup(api,group,{wallpaper:jpeg,dimLevel:0.5});assert.equal(sent.at(-1).dimLevel,0.5)
await assert.rejects(setThemeGroup(api,group,{color:'red',wallpaper:jpeg}),/SETTING_INVALID/)
api.group.queryGroupMetadata=async()=>({restrict:true,participants:[]})
await assert.rejects(setThemeGroup(api,group,{reset:true}),/BOT_ADMIN_REQUIRED/)
const directory=await mkdtemp(join(tmpdir(),'theme-test-'))
try {
  const video=join(directory,'fixture.mp4')
  // Optional system tool: real conversion is tested when available, never a WA send.
  let available=true;try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'})}catch{available=false}
  if(available){
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=32x24:d=0.2','-c:v','mpeg4',video])
    const frame=await normalizeWallpaper(await readFile(video),{video:true})
    assert.equal((await sharp(frame).metadata()).format,'jpeg')
  }
  const path=join(directory,'photo.jpg');await writeFile(path,jpeg);assert.deepEqual(await readWallpaperSource(path),jpeg)
} finally { await rm(directory,{recursive:true,force:true}) }
console.log('PASS advanced theme: 49 schemes, PT/EN colors, two-step ACK/stop/lock, dim, stock/animated IDs, source limits, private URL rejection, static GIF/video and direct API')
