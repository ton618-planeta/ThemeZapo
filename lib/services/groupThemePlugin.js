import { randomBytes } from 'node:crypto'
import { writeRandomPadMax16 } from 'zapo-js'
import { parseMediaConnResponse } from 'zapo-js/media'
import { isThemeGroupJid, encodeGroupTheme, encryptThemeImage, parseGroupTheme } from '../utils/groupTheme.js'
import { buildChatThemePayload } from '../utils/rawThemeBuilder.js'

async function readUploadJson(body) {
  if (!body) throw Error('THEME_UPLOAD_EMPTY')
  const chunks = []; let size = 0
  const timer = setTimeout(() => body.destroy?.(Error('THEME_UPLOAD_TIMEOUT')), 30000)
  timer.unref?.()
  try {
    for await (const chunk of body) {
      size += chunk.length
      if (size > 256 * 1024) { body.destroy?.(); throw Error('THEME_UPLOAD_LIMIT') }
      chunks.push(Buffer.from(chunk))
    }
  } finally { clearTimeout(timer) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function createGroupThemePlugin() {
  return {
    id: 'zapo-group-theme', exposeAs: 'groupTheme',
    setup(ctx) {
      const active = new Set()
      async function publish(group, setting) {
          if (!isThemeGroupJid(group)) throw Error('THEME_GROUP_ONLY')
          const dispatch = ctx.deps.messageDispatch
          // Isolated adapter to the installed SDK's standard sender-key/fanout
          // publisher. No SDK files or global encryption/media mappings patched.
          if (typeof dispatch?.publishGroupSenderKeyMessage !== 'function') throw Error('THEME_SDK_UNSUPPORTED')
          let prepared = setting
          if (setting.kind === 'image') {
            if (setting.raw) buildChatThemePayload({ ...setting.raw, customImage: { directPath: '/validate', mediaKey: Buffer.alloc(32), fileSha256: Buffer.alloc(32), fileEncSha256: Buffer.alloc(32), dimLevel: setting.dimLevel } })
            const encrypted = encryptThemeImage(setting.image)
            const iq = await ctx.queryWithContext('group-theme.media', {
              tag: 'iq', attrs: { to: 's.whatsapp.net', type: 'set', xmlns: 'w:m' }, content: [{ tag: 'media_conn', attrs: {} }]
            }, 30000)
            const conn = parseMediaConnResponse(iq, Date.now())
            const host = (conn.hosts.find(item => !item.isFallback) || conn.hosts[0]).hostname
            if (!/^(?:[a-z\d-]+\.)+whatsapp\.net$/iu.test(host)) throw Error('THEME_UPLOAD_HOST')
            const token = encrypted.fileEncSha256.toString('base64url')
            const url = `https://${host}/mms/chat-wallpaper-image/${token}?auth=${encodeURIComponent(conn.auth)}&token=${token}`
            const response = await ctx.deps.mediaTransfer.uploadStream({ url, method: 'POST', body: encrypted.body,
              contentLength: encrypted.body.length, contentType: 'application/octet-stream', timeoutMs: 30000 })
            if (!response.ok) { response.body?.destroy?.(); throw Error('THEME_UPLOAD_FAILED') }
            const result = await readUploadJson(response.body)
            const directPath = result.direct_path || result.directPath
            prepared = { ...setting, upload: { ...encrypted, directPath } }
          }
          const rawTheme = prepared.raw ? { ...prepared.raw, ...(prepared.upload ? { customImage: { ...prepared.upload, ...(prepared.dimLevel != null ? {dimLevel:prepared.dimLevel} : {}) } } : {}) } : null
          const payload = rawTheme ? buildChatThemePayload(rawTheme, prepared.timestamp ?? Date.now(), prepared.messageContextInfo) : encodeGroupTheme(prepared)
          const plaintext = await writeRandomPadMax16(payload)
          const envelope = { message: { protocolMessage: { type: 34 } }, plaintext, type: 'media', mediatype: 'chat_theme',
            sendOptions: { id: '3EB0' + randomBytes(12).toString('hex').toUpperCase(), maxAttempts: 1, ackTimeoutMs: 30000 } }
          let result
          try {
            // retried:true prevents the SDK's automatic phash/addressing replay.
            result = await dispatch.publishGroupSenderKeyMessage(group, envelope, { retried: true, forceRefreshParticipants: true })
          } catch {
            throw Object.assign(Error('THEME_SEND_UNCERTAIN'), { code: 'THEME_SEND_UNCERTAIN' })
          }
          if (!result?.ack) throw Object.assign(Error('THEME_SEND_UNCERTAIN'), { code: 'THEME_SEND_UNCERTAIN' })
          if (result.ack.error) throw Object.assign(Error('THEME_REJECTED'), { code: 'THEME_REJECTED' })
          return result
      }
      async function set(group, setting) {
        if (!isThemeGroupJid(group)) throw Error('THEME_GROUP_ONLY')
        if (active.has(group)) throw Error('THEME_BUSY')
        if (typeof setting === 'string') setting = parseGroupTheme(setting)
        if (!setting || !['color','clear','preset','bubble','image','stock','animated','raw'].includes(setting.kind) || (setting.kind === 'clear' && setting.bubble)) throw Error('THEME_SETTING_INVALID')
        active.add(group)
        try {
          if (setting.kind === 'preset' && setting.bubble && setting.scheme !== setting.bubble) {
            await publish(group, { ...setting, bubble: undefined })
            // Stop the sequence if either acknowledgement fails; never retry.
            return await publish(group, { kind: 'bubble', bubble: setting.bubble })
          }
          return await publish(group, setting.kind === 'preset' ? { ...setting, bubble: undefined } : setting)
        } finally { active.delete(group) }
      }
      return { set, setThemeGroup: set }

    }
  }
}
