// Public Zapo integration. Catalog / API concepts: RenTakamori.
import { parseGroupTheme, groupThemeAllowed, isThemeGroupJid, encodeGroupTheme } from './utils/groupTheme.js'
import { COLOR_PRESETS, CHAT_THEME_PRESETS, CHAT_BUBBLE_PRESETS, resolveThemeScheme } from './utils/themeCatalog.js'
import { downloadWallpaper, normalizeWallpaper, readWallpaperSource } from './utils/wallpaper.js'
export { createGroupThemePlugin } from './services/groupThemePlugin.js'
export { COLOR_PRESETS, CHAT_THEME_PRESETS, CHAT_BUBBLE_PRESETS, resolveThemeScheme }
export const getChatThemeExamples = () => ({ themes: CHAT_THEME_PRESETS, bubbles: CHAT_BUBBLE_PRESETS })
export { parseGroupTheme as parseTheme }
// Pure builder: custom image settings must contain already-uploaded metadata.
export function buildThemePayload(setting, timestamp = Date.now()) {
  return encodeGroupTheme(setting, timestamp)
}
export { buildChatThemePayload, ThemeError } from './utils/rawThemeBuilder.js'

export async function setThemeGroup(client, group, content, { ffmpeg = 'ffmpeg', download = downloadWallpaper, normalize = normalizeWallpaper } = {}) {
  if (!isThemeGroupJid(group)) throw Error('THEME_GROUP_ONLY')
  let setting
  if (typeof content === 'string') setting = parseGroupTheme(content)
  else if (Buffer.isBuffer(content) || content instanceof Uint8Array) setting = { kind: 'image', source: content }
  else if (content && typeof content === 'object') {
    const sources = ['theme','color','wallpaper','stockImage','animatedWallpaper'].filter(key => content[key] != null)
    if (sources.length > 1 || (content.reset && (sources.length || content.bubble || content.colorSchemeId))) throw Error('THEME_SETTING_INVALID')
    if (content.bubble && content.colorSchemeId) throw Error('THEME_SETTING_INVALID')
    if (content.reset === true) setting = { kind: 'clear' }
    else if (content.theme != null) setting = { kind: 'preset', scheme: resolveThemeScheme(content.theme) }
    else if (content.color != null) {
      setting = parseGroupTheme(String(content.color))
      if (setting?.kind !== 'color') throw Error('THEME_COLOR_INVALID')
    } else if (content.wallpaper != null) setting = { kind: 'image', source: content.wallpaper }
    else if (content.stockImage || content.animatedWallpaper) {
      if (content.stockImage && content.animatedWallpaper) throw Error('THEME_SETTING_INVALID')
      setting = { kind: content.stockImage ? 'stock' : 'animated', wallpaperId: content.stockImage || content.animatedWallpaper }
    } else if (content.bubble || content.colorSchemeId) setting = { kind: 'bubble' }
    if (setting && (content.bubble || content.colorSchemeId)) setting.bubble = resolveThemeScheme(content.bubble || content.colorSchemeId)
    if (content.dimLevel != null) {
      if (!['image','stock','animated'].includes(setting?.kind) || !Number.isFinite(content.dimLevel) || content.dimLevel < 0 || content.dimLevel > 1) throw Error('THEME_DIM_INVALID')
      setting.dimLevel = content.dimLevel
    }
  }
  if (!setting || ['help','list'].includes(setting.kind)) throw Error('THEME_SETTING_INVALID')
  // Direct API checks bot restrictions; caller authorization belongs to the host command.
  const metadata = await client.group.queryGroupMetadata(group)
  const me = client.getCredentials()
  if (metadata.restrict && !groupThemeAllowed(metadata, [me?.meJid, me?.meLid].filter(Boolean))) throw Error('THEME_BOT_ADMIN_REQUIRED')
  if (setting.kind === 'image') {
    const source = await readWallpaperSource(setting.source ?? setting.url, download)
    setting = { ...setting, image: await normalize(source, { ffmpeg }) }
  }
  return client.groupTheme.set(group, setting)
}

export const setThemGroup = setThemeGroup
export const setTgemGroup = setThemeGroup

export async function sendChatTheme(client, group, theme, { timestamp, messageContextInfo, ffmpeg = 'ffmpeg' } = {}) {
  if (!isThemeGroupJid(group)) throw Error('THEME_GROUP_ONLY')
  const metadata = await client.group.queryGroupMetadata(group), me = client.getCredentials()
  if (metadata.restrict && !groupThemeAllowed(metadata, [me?.meJid, me?.meLid].filter(Boolean))) throw Error('THEME_BOT_ADMIN_REQUIRED')
  let setting = { kind: 'raw', raw: theme, timestamp, messageContextInfo }
  if (theme?.customImage?.image != null) {
    if (theme.customImage.directPath || theme.customImage.mediaKey) throw Error('THEME_SETTING_INVALID')
    const bytes = await readWallpaperSource(theme.customImage.image)
    setting = { ...setting, kind: 'image', image: await normalizeWallpaper(bytes, { ffmpeg }), dimLevel: theme.customImage.dimLevel }
  }
  return client.groupTheme.set(group, setting)
}
