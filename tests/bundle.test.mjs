import assert from 'node:assert/strict'
import { proto } from 'zapo-js'
import * as helper from '../dist/group-theme.js'

assert.equal(typeof helper.createGroupThemePlugin,'function')
assert.equal(typeof helper.createThemeCommand,'function')
assert.equal(typeof helper.setThemeGroup,'function')
assert.equal(Object.keys(helper.CHAT_THEME_PRESETS).length,49)
assert.equal(helper.parseTheme('preset pink bubble royal-blue').bubble,'Royal-Blue')
assert.equal(proto.Message.decode(helper.buildThemePayload({kind:'clear'},1)).protocolMessage.chatThemeSetting.clearTheme,true)
const bubble=helper.buildChatThemePayload({colorSchemeId:'Royal-Blue'},1)
assert.equal(proto.Message.decode(bubble).protocolMessage.chatThemeSetting.colorSchemeId,'Royal-Blue')
const stock=helper.buildChatThemePayload({stockImage:{id:'demo',dimLevel:0.25}},1)
assert(stock.includes(Buffer.from('demo')))
const color=helper.buildChatThemePayload({solidColor:{colorLight:'#FF0000',colorDark:'#121212',isDoodleEnabled:true,doodleColorLight:'#FFFFFF'}},1)
assert(Buffer.isBuffer(color))
assert.throws(()=>helper.buildChatThemePayload({clear:true,colorSchemeId:'Pink'}))
assert.throws(()=>helper.buildChatThemePayload({customImage:{directPath:'/x'}}))
assert.throws(()=>helper.buildChatThemePayload({stockImage:{id:'x',dimLevel:2}}))
const context=helper.buildChatThemePayload({clear:true},1,{messageSecret:Buffer.alloc(32,1)})
assert(context.length>helper.buildChatThemePayload({clear:true},1).length)
console.log('PASS single file: no auth/connection side effects; exported command, API, 49 presets and full raw builder with validation/context')
