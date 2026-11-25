import assert from 'node:assert/strict'
import { createThemeCommand } from '../lib/handler.js'

const sent = [], changes = [], downloads = []
let metadataCalls = 0, failMetadata = false, uncertain = false, sequence = 0, restricted = false, botAdmin = false
const client = {
  message: { send: async (_to, text) => sent.push(text), downloadBytes: async (source, options) => { downloads.push([source, options]); return Buffer.from('photo') } },
  group: { queryGroupMetadata: async () => {
    metadataCalls++
    if (failMetadata) throw Error('offline')
    return { restrict: restricted, owner: '10@lid', participants: [{ jid: '20@lid', phoneNumber: '200', role: 'admin' }, { jid: '30@lid', role: 'member' }, {jid:'999@s.whatsapp.net',role:botAdmin?'admin':'member'}] }
  } },
  groupTheme: { set: async (to, setting) => { changes.push([to, setting]); if (uncertain) throw Object.assign(Error('timeout'), { code: 'THEME_SEND_UNCERTAIN' }) } },
  getCredentials: () => ({ meJid: '999@s.whatsapp.net' })
}
const handle = createThemeCommand(client, { owners: ['999@s.whatsapp.net'], prepareImage: async bytes => bytes })
const event = (text, sender = '20@lid', extra = {}) => ({ key: { id: `test-${sequence++}`, remoteJid: '123456-123456@g.us', participant: sender }, message: { conversation: text }, ...extra })
await handle(event('/tema #FF2400', '30@lid')); assert.equal(changes.length, 0)
await handle(event('/tema #FF2400')); assert.equal(changes.at(-1)[1].color, 'FF2400')
await handle(event('/tema limpar', '10@lid')); assert.equal(changes.at(-1)[1].kind, 'clear')
const count = changes.length
await handle(event('/tema @200 #FF2400')); assert.equal(changes.length, count)
await handle(event('/tema limpar', '20@s.whatsapp.net')); assert.equal(changes.length, count, 'PN cannot be guessed from LID')
await handle(event('/tema', '20@lid', { message: { imageMessage: { caption: '/tema' } } })); assert.equal(changes.at(-1)[1].kind, 'image'); assert.equal(downloads.at(-1)[1].maxBytes, 10 * 1024 * 1024)
await handle(event('/tema', '20@lid', { message: { extendedTextMessage: { text: '/tema', contextInfo: { quotedMessage: { imageMessage: {} } } } } })); assert.equal(downloads.length, 2)
const repeat = event('/tema limpar'); await handle(repeat); const once = changes.length; await handle(repeat); assert.equal(changes.length, once)
await handle(event('/tema limpar', '20@lid', { offline: true })); assert.equal(changes.length, once)
const pv = event('/tema limpar'); pv.key.remoteJid = '20@lid'; await handle(pv); assert.match(sent.at(-1), /somente em grupos/)
failMetadata = false
const beforeOwner = metadataCalls
await handle(event('/tema limpar', '999@s.whatsapp.net')); assert.equal(metadataCalls, beforeOwner + 1); assert.equal(changes.length, once + 1)
failMetadata = true
await handle(event('/tema limpar')); assert.equal(changes.length, once + 1)
failMetadata = false; uncertain = true
await handle(event('/tema limpar')); assert.match(sent.at(-1), /sem confirmação/); assert.equal(changes.length, once + 2, 'uncertain send is never retried')
console.log('PASS handler: admin/creator/owner, deny member and guessed identity, current/quoted photos, offline, dedup, private chat, metadata failure, uncertain send and help')

uncertain = false
await handle(event('/theme #ABCDEF')); assert.equal(changes.at(-1)[1].color, 'ABCDEF')
await handle(event('/theme clear')); assert.equal(changes.at(-1)[1].kind, 'clear')
const beforeHelp = changes.length
for (const text of ['/theme help', '/tema ajuda']) { await handle(event(text)); assert.match(sent.at(-1), /TEMA · ZAPO/) }
assert.equal(changes.length, beforeHelp)
console.log('PASS Portuguese and English command aliases, clear and help without mutation')

uncertain = false; restricted = true
const beforeRestricted = changes.length
await handle(event('/thema blue', '999@s.whatsapp.net')); assert.equal(changes.length, beforeRestricted); assert.match(sent.at(-1), /Promova o bot/)
botAdmin = true
await handle(event('/thema blue', '999@s.whatsapp.net')); assert.equal(changes.at(-1)[1].color, '1E90FF')
await handle(event('/tema lista')); assert.match(sent.at(-1), /49 PRESETS/)
await handle(event('/tema preset pink bubble royal-blue')); assert.equal(changes.at(-1)[1].bubble, 'Royal-Blue')
await handle(event('/tema imagem bubble emerald --dim=0.5', '20@lid', {message:{imageMessage:{caption:'/tema imagem bubble emerald --dim=0.5'}}})); assert.equal(changes.at(-1)[1].dimLevel,0.5); assert.equal(changes.at(-1)[1].bubble,'Emerald')
console.log('PASS restricted group requires bot admin even for owner; thema, catalog, combinations and image dim')
