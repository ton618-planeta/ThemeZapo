import { COLOR_PRESETS, resolveThemeScheme } from './themeCatalog.js'
import { ProtoWriter } from './themeWriter.js'
import { createCipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { findGroupParticipant, groupParticipantRole, normalizeGroupUserJid } from './groupParticipants.js'

const createWriter = () => ProtoWriter.create()
export function isThemeGroupJid(jid) {
  // Older WhatsApp groups use creator-number + creation timestamp.
  return typeof jid === 'string' && /^\d+(?:-\d+)?@g\.us$/u.test(jid)
}
export function groupThemeAllowed(metadata, ids) {
  const owner = normalizeGroupUserJid(metadata?.owner || metadata?.ownerJid || metadata?.creator)
  return ids.some(id => {
    const normalized = normalizeGroupUserJid(id)
    return normalized && (normalized === owner || ['admin', 'superadmin'].includes(groupParticipantRole(findGroupParticipant(metadata, id))))
  })
}

export function parseGroupTheme(text = '') {
  const value = text.trim(), lower = value.toLowerCase()
  const combo = /^(?:(.*?)\s+)?(?:bubble|bubel|balao|balão)\s+(.+)$/iu.exec(value)
  if (combo) {
    const bubble = resolveThemeScheme(combo[2])
    if (!combo[1]) return { kind: 'bubble', bubble }
    const setting = parseGroupTheme(combo[1])
    if (!setting || ['clear','help','list','bubble'].includes(setting.kind) || setting.bubble) return null
    return { ...setting, bubble }
  }
  if (/^(limpar|clear|reset|default|hapus)$/iu.test(value)) return { kind: 'clear' }
  if (/^(lista|list|daftar|example|examples|exemplos|contoh)$/iu.test(value)) return { kind: 'list' }
  if (/^(ajuda|help|menu|bantuan|\?)$/iu.test(value)) return { kind: 'help' }
  const preset = /^(?:preset|theme|tema)\s+(.+)$/iu.exec(value)
  if (preset) return { kind: 'preset', scheme: resolveThemeScheme(preset[1]) }
  if (Object.hasOwn(COLOR_PRESETS, lower)) return { kind: 'color', color: COLOR_PRESETS[lower] }
  if (/^#?[a-f\d]{6}$/iu.test(value)) return { kind: 'color', color: value.replace('#', '').toUpperCase() }
  if (/^https?:\/\/\S+$/iu.test(value)) return { kind: 'image', url: value }
  if (!value || /^(foto|photo|image|imagem|gambar|wallpaper)$/iu.test(value)) return { kind: 'image' }
  try { return { kind: 'preset', scheme: resolveThemeScheme(value) } } catch { return null }
}

export async function prepareThemeImage(bytes) {
  if (!bytes?.length || bytes.length > 10 * 1024 * 1024) throw Error('THEME_IMAGE_LIMIT')
  const image = sharp(bytes, { animated: false, page: 0, pages: 1, limitInputPixels: 20_000_000 })
  const meta = await image.metadata()
  if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) > 1) throw Error('THEME_IMAGE_FORMAT')
  return image.rotate().flatten({ background: '#ffffff' }).resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
}

// Wire format supplied by NL in the user's reference. Keep these fields raw:
// zapo-js 1.12 declares solidColor strings, whereas this variant uses fixed32.
export function encodeGroupTheme(setting, now = Date.now()) {
  const t = createWriter().uint32(8).int64(now)
  if (setting.bubble) t.uint32(26).string(resolveThemeScheme(setting.bubble))
  if (setting.kind === 'preset') {
    t.uint32(26).string(resolveThemeScheme(setting.scheme)).uint32(82).fork().ldelim()
  } else if (setting.kind === 'bubble' && setting.bubble) {
    // Only a color scheme: retain existing wallpaper.
  } else if (['stock','animated'].includes(setting.kind)) {
    if (typeof setting.wallpaperId !== 'string' || !setting.wallpaperId.trim() || setting.wallpaperId.length > 256) throw Error('THEME_ID_INVALID')
    const dim = setting.dimLevel ?? (setting.kind === 'stock' ? 1 : 0)
    if (!Number.isFinite(dim) || dim < 0 || dim > 1) throw Error('THEME_DIM_INVALID')
    t.uint32(setting.kind === 'stock' ? 98 : 114).fork().uint32(10).string(setting.wallpaperId).uint32(21).float(dim).ldelim()
  } else if (setting.kind === 'clear') t.uint32(16).bool(true)
  else if (setting.kind === 'color' && /^[a-f\d]{6}$/iu.test(setting.color)) {
    const color = (0xff000000 | parseInt(setting.color, 16)) >>> 0
    t.uint32(90).fork().uint32(13).fixed32(color).uint32(21).fixed32(color).ldelim()
  } else if (setting.kind === 'image' && setting.upload?.directPath?.startsWith('/')) {
    const u = setting.upload
    for (const key of ['mediaKey', 'fileEncSha256', 'fileSha256']) if (u[key]?.length !== 32) throw Error('THEME_UPLOAD_INVALID')
    const nested = t.uint32(106).fork().uint32(10).string(u.directPath).uint32(18).bytes(u.mediaKey)
      .uint32(26).bytes(u.fileEncSha256).uint32(34).bytes(u.fileSha256)
    if (setting.dimLevel != null) {
      if (!Number.isFinite(setting.dimLevel) || setting.dimLevel < 0 || setting.dimLevel > 1) throw Error('THEME_DIM_INVALID')
      nested.uint32(45).float(setting.dimLevel)
    }
    nested.ldelim()
  } else throw Error('THEME_SETTING_INVALID')
  // The SDK reuses its writer arena; finish/copy before requesting another one.
  const themeBytes = Buffer.from(t.finish())
  return Buffer.from(createWriter().uint32(98).fork().uint32(16).int32(34).uint32(242).bytes(themeBytes).ldelim().finish())
}

export function encryptThemeImage(bytes, mediaKey = randomBytes(32)) {
  if (mediaKey.length !== 32) throw Error('THEME_KEY_INVALID')
  const keys = Buffer.from(hkdfSync('sha256', mediaKey, Buffer.alloc(32), 'WhatsApp Chat Wallpaper Keys', 112))
  const iv = keys.subarray(0, 16), cipher = createCipheriv('aes-256-cbc', keys.subarray(16, 48), iv)
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()])
  const mac = createHmac('sha256', keys.subarray(48, 80)).update(iv).update(encrypted).digest().subarray(0, 10)
  const body = Buffer.concat([encrypted, mac])
  return { body, mediaKey, fileSha256: createHash('sha256').update(bytes).digest(), fileEncSha256: createHash('sha256').update(body).digest() }
}

const recent = new Map(), active = new Set()
export function reserveGroupTheme(group, eventId, now = Date.now()) {
  for (const [key, expires] of recent) if (expires <= now) recent.delete(key)
  const key = eventId ? `${group}:${eventId}` : null
  if (key && recent.has(key)) return { duplicate: true }
  if (active.has(group)) return { busy: true }
  active.add(group)
  if (key) recent.set(key, now + 120000)
  return { release: () => active.delete(group) }
}
