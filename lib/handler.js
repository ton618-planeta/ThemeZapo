import { themeCatalogText } from './utils/themeCatalog.js'
import { downloadWallpaper, normalizeWallpaper } from './utils/wallpaper.js'
import { normalizeGroupUserJid } from './utils/groupParticipants.js'
import { isThemeGroupJid, groupThemeAllowed, parseGroupTheme, prepareThemeImage, reserveGroupTheme } from './utils/groupTheme.js'

export function unwrap(message = {}) {
  for (let i = 0; i < 12; i++) {
    const next = message?.ephemeralMessage?.message || message?.viewOnceMessage?.message || message?.viewOnceMessageV2?.message || message?.documentWithCaptionMessage?.message
    if (!next) break
    message = next
  }
  return message || {}
}

export function createThemeCommand(client, { owners = [], prepareImage = normalizeWallpaper, download = downloadWallpaper } = {}) {
  const ownerIds = new Set(owners.map(id => normalizeGroupUserJid(id)).filter(Boolean))
  const seen = new Map()
  return async event => {
    if (event.offline || !event.key?.id || !event.key.remoteJid) return
    const message = unwrap(event.message)
    const text = message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.videoMessage?.caption || ''
    const match = /^\/(tema|temagrupo|theme|thema|settema|wallpaper)(?:\s+([\s\S]*))?$/iu.exec(text.trim())
    if (!match) return
    const to = event.key.remoteJid, command = match[1].toLowerCase(), args = (match[2] || '').trim()
    const now = Date.now(), eventId = `${to}:${event.key.id}`
    for (const [id, until] of seen) if (until <= now) seen.delete(id)
    if (seen.has(eventId)) return
    seen.set(eventId, now + 120000)
    const reply = text => client.message.send(to, text, { quote: event })
    const usage = '🎨 *TEMA · ZAPO*\n\n/tema #FF2400 — cor\n/tema limpar — remover tema\n/tema ajuda — ajuda\n/theme #FF2400 — color\n/theme clear — remove theme\n/theme help — help\nEnvie ou responda a uma foto com /tema para usar como papel de parede.\n\nTema: somente admins, criador do grupo e dono configurado. É compartilhado com o grupo; não aceita @pessoa. Foto/GIF/vídeo até 10 MiB; primeiro quadro estático. Fotos até 20 MP.\n/tema lista | /theme list\n/tema preset pink bubble royal-blue\n/tema azul | /theme blue | /thema reset\n/tema imagem bubble emerald --dim=0.5\n/tema https://example.com/wallpaper.jpg A exibição depende do WhatsApp de cada participante.'
    if (!isThemeGroupJid(to)) return reply('❌ /tema funciona somente em grupos.')
    let reservation
    try {
      const credentials = client.getCredentials()
      const ids = [event.key.participant, event.key.participantAlt, ...(event.key.fromMe ? [credentials?.meJid, credentials?.meLid] : [])].map(id => normalizeGroupUserJid(id)).filter(Boolean)
      const metadata = await client.group.queryGroupMetadata(to)
      if (!ids.some(id => ownerIds.has(id)) && !groupThemeAllowed(metadata, ids)) return reply('❌ Somente administradores, criador do grupo e dono podem mudar o tema.')
      if (metadata.restrict && !groupThemeAllowed({ ...metadata, owner: null, ownerJid: null, creator: null }, [credentials?.meJid, credentials?.meLid].filter(Boolean))) return reply('❌ Este grupo restringe alterações de informações. Promova o bot a administrador para mudar o tema.')
      let input = args, dimLevel
      const dim = /\s+--(?:dim|escurecer)=([\d.]+)$/iu.exec(input)
      if (dim) {
        dimLevel = Number(dim[1]); input = input.slice(0, dim.index).trim()
        if (!Number.isFinite(dimLevel) || dimLevel < 0 || dimLevel > 1) return reply('Use --dim=0 até --dim=1 / Use --dim=0 to --dim=1.')
      }
      let setting = parseGroupTheme(input)
      if (!setting || setting.kind === 'help') return reply(usage)
      if (setting.kind === 'list') return reply(themeCatalogText())
      if (dimLevel != null && setting.kind !== 'image') return reply('--dim só funciona com wallpaper de mídia / --dim requires media wallpaper.')
      reservation = reserveGroupTheme(to, event.key.id)
      if (reservation.duplicate) return
      if (reservation.busy) return reply('⏳ Já existe uma alteração em andamento neste grupo.')
      if (setting.kind === 'image') {
        const context = Object.values(message).find(node => node?.contextInfo)?.contextInfo
        const quoted = unwrap(context?.quotedMessage)
        const hasMedia = value => value.imageMessage || value.videoMessage
        const source = hasMedia(message) ? message : hasMedia(quoted) ? quoted : null
        if (!setting.url && !source) return reply(usage)
        const bytes = setting.url ? await download(setting.url) : await client.message.downloadBytes(source, { maxBytes: 10 * 1024 * 1024 })
        setting = { ...setting, image: await prepareImage(Buffer.from(bytes), { video: Boolean(source?.videoMessage) }), ...(dimLevel != null ? { dimLevel } : {}) }

      }
      await client.groupTheme.set(to, setting)
      return reply('✅ Alteração de tema enviada ao grupo.')
    } catch (error) {
      if (error?.message === 'THEME_FFMPEG_MISSING') return reply('❌ Instale FFmpeg no PATH para usar vídeos / Install FFmpeg on PATH for videos.')
      if (error?.code === 'THEME_SEND_UNCERTAIN') return reply('⚠️ Alteração sem confirmação. Confira o grupo antes de tentar novamente; não houve reenvio automático.')
      if (error?.code === 'THEME_REJECTED') return reply('❌ O WhatsApp recusou a alteração. Não houve reenvio automático.')
      return reply('❌ Não consegui conferir a permissão ou alterar o tema. Confira a conexão e use uma cor válida ou foto JPEG/PNG/WebP estática de até 10 MiB.')
    } finally { reservation?.release?.() }
  }
}
