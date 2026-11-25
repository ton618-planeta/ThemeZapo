// ThemeZapo · MIT · Rei Ayanami
// Catalog, builder and helper concepts adapted from RenTakamori.
// Original protocol example: NL. No QR, login or account storage.
import { proto } from 'zapo-js'
import { createCipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { lookup } from 'node:dns/promises'
import { createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList } from 'node:net'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { writeRandomPadMax16 } from 'zapo-js'
import { parseMediaConnResponse } from 'zapo-js/media'

// Source: lib/utils/themeWriter.js
// Adapted from RenTakamori.
export class ProtoWriter {
	constructor(parent = null) {
		this.parent = parent;
		this.chunks = [];
	}
	static create() {
		return new ProtoWriter();
	}
	_push(buffer) {
		this.chunks.push(Buffer.from(buffer));
		return this;
	}
	_varint(value) {
		let n = BigInt.asUintN(64, BigInt(value));
		const bytes = [];
		while (n > 127n) {
			bytes.push(Number(n & 127n) | 128);
			n >>= 7n;
		}
		bytes.push(Number(n));
		return Buffer.from(bytes);
	}
	uint32(value) {
		return this._push(this._varint(value >>> 0));
	}
	int32(value) {
		return this._push(this._varint(Math.trunc(value)));
	}
	int64(value) {
		return this._push(this._varint(typeof value === 'bigint' ? value : Math.trunc(value)));
	}
	bool(value) {
		return this.uint32(value ? 1 : 0);
	}
	fixed32(value) {
		const buffer = Buffer.alloc(4);
		buffer.writeUInt32LE(value >>> 0);
		return this._push(buffer);
	}
	float(value) {
		const buffer = Buffer.alloc(4);
		buffer.writeFloatLE(value);
		return this._push(buffer);
	}
	bytes(value) {
		const buffer = Buffer.from(value);
		return this._push(this._varint(buffer.length))._push(buffer);
	}
	string(value) {
		return this.bytes(Buffer.from(String(value), 'utf8'));
	}
	fork() {
		return new ProtoWriter(this);
	}
	ldelim() {
		if (!this.parent) throw new Error('Writer has no parent');
		return this.parent.bytes(this.finish());
	}
	finish() {
		return Buffer.concat(this.chunks);
	}
}

// Source: lib/utils/themeCatalog.js
// Catalog adapted from RenTakamori.
const THEME_FAMILIES = {
	default: 'Default',
	'whatsapp-green': 'WhatsApp-Green',
	'pearl-indigo': 'Pearl-Indigo',
	'tyrian-purple': 'Tyrian-Purple',
	'sunset-orange': 'Sunset-Orange',
	'merino-teal': 'Merino-Teal',
	'royal-blue': 'Royal-Blue',
	'dark-cerulean': 'Dark-Cerulean',
	'charcoal-green': 'Charcoal-Green',
	'persian-plum': 'Persian-Plum',
	'dune-mono': 'Dune-Mono',
	'default-blue': 'Default-Blue',
	'default-mono': 'Default-Mono',
	'sky-blue': 'Sky-Blue',
	brown: 'Brown',
	cream: 'Cream',
	emerald: 'Emerald',
	lemon: 'Lemon',
	lime: 'Lime',
	pink: 'Pink',
	red: 'Red',
	'sunrise-orange': 'Sunrise-Orange',
	'warm-yellow': 'Warm-Yellow',
};
const schemes = { ...THEME_FAMILIES };
for (const [alias, id] of Object.entries(THEME_FAMILIES)) {
	if (alias !== 'default') schemes[`${alias}-tonal`] = `${id}@Tonal`;
	if (['default-blue', 'default-mono', 'sky-blue', 'pearl-indigo'].includes(alias)) schemes[`${alias}-minimal`] = `${id}@Minimal`;
}
export const CHAT_THEME_PRESETS = Object.freeze(schemes);
export const CHAT_BUBBLE_PRESETS = CHAT_THEME_PRESETS;

export const COLOR_PRESETS = Object.freeze({
  pink:'FF69B4', rosa:'FF69B4', blue:'1E90FF', azul:'1E90FF', biru:'1E90FF',
  purple:'9B59B6', roxo:'9B59B6', ungu:'9B59B6', black:'121212', preto:'121212', hitam:'121212',
  green:'2ECC71', verde:'2ECC71', hijau:'2ECC71', red:'E74C3C', vermelho:'E74C3C', merah:'E74C3C',
  yellow:'F1C40F', amarelo:'F1C40F', kuning:'F1C40F', orange:'E67E22', laranja:'E67E22', oren:'E67E22',
  white:'F5F6FA', branco:'F5F6FA', putih:'F5F6FA'
})
export function resolveThemeScheme(value) {
  const alias = String(value || '').trim().toLowerCase().replace(/[\s_@]+/gu, '-')
  if (Object.hasOwn(CHAT_THEME_PRESETS, alias)) return CHAT_THEME_PRESETS[alias]
  throw Error('Preset desconhecido. Use /tema lista ou /theme list.')
}
export function themeCatalogText() {
  return '🎨 *49 PRESETS / PRESETS*\n' + Object.keys(CHAT_THEME_PRESETS).join(' · ')
    + '\n\n/tema preset pink\n/tema bubble royal-blue\n/tema preset pink bubble emerald\n/tema azul\n/theme blue\n/thema reset'
}

// Source: lib/utils/groupParticipants.js
// PN e LID são espaços de identidade distintos. Só a metadata do participante
// pode associá-los; números iguais em domínios diferentes não provam identidade.
export function normalizeGroupUserJid(value, defaultDomain = null) {
  let jid = String(value || '').trim()
  if (defaultDomain && /^\d+$/u.test(jid)) jid = `${jid}@${defaultDomain}`
  const match = /^(\d+)(?::\d+)?@(lid|s\.whatsapp\.net)$/u.exec(jid)
  return match ? `${match[1]}@${match[2]}` : null
}

export function groupParticipantIds(participant) {
  return [...new Set([
    normalizeGroupUserJid(participant?.jid),
    normalizeGroupUserJid(participant?.id),
    normalizeGroupUserJid(participant?.lid, 'lid'),
    normalizeGroupUserJid(participant?.lidJid, 'lid'),
    normalizeGroupUserJid(participant?.phoneJid, 's.whatsapp.net'),
    normalizeGroupUserJid(participant?.phoneNumber, 's.whatsapp.net'),
    // Zapo pode devolver o PN com estes nomes, dependendo da versão do
    // metadata. Eles representam o mesmo participante e são necessários para
    // reconhecer o bot promovido quando a mensagem chega por LID.
    normalizeGroupUserJid(participant?.pn, 's.whatsapp.net'),
    normalizeGroupUserJid(participant?.phone, 's.whatsapp.net')
  ].filter(Boolean))]
}

export function findGroupParticipant(metadata, target) {
  const id = normalizeGroupUserJid(target)
  if (!id || !Array.isArray(metadata?.participants)) return null
  const matches = metadata.participants.filter(member => groupParticipantIds(member).includes(id))
  // Metadata ambígua não pode decidir uma remoção/promoção pelo primeiro match.
  return matches.length === 1 ? matches[0] : null
}

export function groupParticipantRole(participant) {
  if (!participant) return 'unknown'
  const role = String(
    participant.role
    || participant.type
    || participant.admin
    || participant.privilege
    || participant.rank
    || ''
  ).trim().toLowerCase().replace(/[-\s]/gu, '_')
  if (participant.isSuperAdmin === true || participant.isSuperAdmin === 1 || ['superadmin', 'super_admin', 'owner', 'creator'].includes(role)) return 'superadmin'
  if (participant.isAdmin === true || participant.isAdmin === 1 || role === 'admin') return 'admin'
  return 'member'
}

// Source: lib/utils/rawThemeBuilder.js
// Builder adapted from RenTakamori.
export class ThemeError extends Error { constructor(code,message) { super(message); this.name='ThemeError'; this.code=code } }
const CHAT_THEME_PROTOCOL_TYPE=34
function themeObject(value, name) {
	if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) throw new ThemeError('INPUT', `${name} harus berupa objek.`);
	return value;
}

function themeBoolean(value, fallback = false) {
	if (value == null) return fallback;
	if (typeof value !== 'boolean') throw new ThemeError('INPUT', 'Pengaturan boolean tema tidak valid.');
	return value;
}

function themeArgb(value, fallback) {
	if (value == null) return fallback;
	if (typeof value === 'number' && Number.isInteger(value) && value >= -0x80000000 && value <= 0xffffffff) return value >>> 0;
	if (typeof value !== 'string' || !/^#?(?:[\da-f]{6}|[\da-f]{8})$/i.test(value)) throw new ThemeError('INPUT', 'Warna harus berupa hex 6/8 digit atau angka ARGB 32 bit.');
	const hex = value.replace('#', '');
	return (hex.length === 6 ? 0xff000000 | Number.parseInt(hex, 16) : Number.parseInt(hex, 16)) >>> 0;
}

function themeDim(value, fallback = 0) {
	if (value == null) return fallback;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new ThemeError('INPUT', 'dimLevel wallpaper harus antara 0 dan 1.');
	return value;
}

function themeMediaBytes(value) {
	const bytes = typeof value === 'string' ? Buffer.from(value, 'base64') : value;
	if (!(bytes instanceof Uint8Array) || bytes.length !== 32 || (typeof value === 'string' && bytes.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')))
		throw new ThemeError('UPLOAD', 'Data wallpaper tidak lengkap: kunci dan hash harus 32 byte atau Base64 yang valid.');
	return Buffer.from(bytes);
}

function normalizeChatTheme(theme, allowImage = false, omitDefaults = false) {
	themeObject(theme, 'Tema');
	const setting = { clearTheme: themeBoolean(theme.clear) };
	if (theme.colorSchemeId != null) {
		if (typeof theme.colorSchemeId !== 'string' || !theme.colorSchemeId.trim()) throw new ThemeError('INPUT', 'colorSchemeId tema tidak valid.');
		setting.colorSchemeId = theme.colorSchemeId;
	}
	const variants = ['solidColor', 'stockImage', 'defaultWallpaper', 'customImage', 'animatedWallpaper'].filter((key) => theme[key] != null && theme[key] !== false);
	if (variants.length > 1 || (setting.clearTheme && (variants.length || setting.colorSchemeId))) throw new ThemeError('INPUT', 'Pilih satu wallpaper atau reset tema dalam satu pengiriman.');
	if (!setting.clearTheme && !variants.length && !setting.colorSchemeId) throw new ThemeError('INPUT', 'Pengaturan tema kosong. Pilih warna, wallpaper, atau clear: true.');
	const kind = variants[0];
	if (kind === 'solidColor') {
		const color = themeObject(theme.solidColor, 'solidColor');
		setting.solidColor = {
			backgroundLightArgb: themeArgb(color.colorLight ?? color.color, 0xffffffff),
			backgroundDarkArgb: themeArgb(color.colorDark ?? color.color, 0xff000000),
			isDoodleEnabled: themeBoolean(color.isDoodleEnabled),
		};
		if (color.doodleColorLight != null) setting.solidColor.doodleLightArgb = themeArgb(color.doodleColorLight);
		if (color.doodleColorDark != null) setting.solidColor.doodleDarkArgb = themeArgb(color.doodleColorDark);
	} else if (kind === 'defaultWallpaper') {
		const value = theme.defaultWallpaper === true ? { isDoodleEnabled: true } : themeObject(theme.defaultWallpaper, 'defaultWallpaper');
		setting.defaultWallpaper = { isDoodleEnabled: themeBoolean(value.isDoodleEnabled) };
	} else if (kind === 'stockImage' || kind === 'animatedWallpaper') {
		const value = theme[kind];
		const options = typeof value === 'string' ? {} : themeObject(value, kind);
		const field = kind === 'stockImage' ? 'stockImageId' : 'animatedWallpaperId';
		const id = options.id ?? options[field] ?? value;
		if (typeof id !== 'string' || !id.trim()) throw new ThemeError('INPUT', 'ID wallpaper tidak valid.');
		setting[kind] = { [field]: id, dimLevel: themeDim(options.dimLevel ?? (options.opacity == null ? undefined : options.opacity / 100), kind === 'stockImage' ? 1 : 0) };
	} else if (kind === 'customImage') {
		const image = themeObject(theme.customImage, 'customImage');
		const dimLevel = themeDim(image.dimLevel);
		if (image.image != null) {
			if (image.directPath || image.mediaKey) throw new ThemeError('INPUT', 'Pilih gambar baru atau data wallpaper yang sudah diupload.');
			if (!allowImage) throw new ThemeError('UPLOAD', 'Gambar perlu diupload melalui sendChatTheme terlebih dahulu.');
			setting.customImage = { image: image.image, dimLevel };
		} else {
			if (typeof image.directPath !== 'string' || !/^\/\S+$/.test(image.directPath)) throw new ThemeError('UPLOAD', 'Data wallpaper tidak lengkap: directPath tidak valid.');
			setting.customImage = {
				directPath: image.directPath,
				mediaKey: themeMediaBytes(image.mediaKey),
				fileEncSha256: themeMediaBytes(image.fileEncSha256),
				fileSha256: themeMediaBytes(image.fileSha256),
				dimLevel,
			};
		}
	}
	// Omit unspecified optional fields instead of emitting CTM defaults.
	if (omitDefaults) {
		if (theme.clear == null) delete setting.clearTheme;
		if (setting.defaultWallpaper && theme.defaultWallpaper?.isDoodleEnabled == null && theme.defaultWallpaper !== true) delete setting.defaultWallpaper.isDoodleEnabled;
		if (setting.solidColor && theme.solidColor.isDoodleEnabled == null) delete setting.solidColor.isDoodleEnabled;
		if (setting.customImage && theme.customImage.dimLevel == null) delete setting.customImage.dimLevel;
	}
	return setting;
}

function themeMessageContext(value = {}) {
	const input = themeObject(value, 'messageContextInfo');
	const secret = input.messageSecret ?? randomBytes(32);
	if (!(secret instanceof Uint8Array) || secret.length !== 32) throw new ThemeError('INPUT', 'messageSecret tema harus 32 byte.');
	const context = { messageSecret: Buffer.from(secret) };
	// Sharing context describes the chat's existing setting. Never invent it from
	// a captured message or change it merely because a wallpaper is being sent.
	if (input.limitSharingV2 != null) {
		const sharing = themeObject(input.limitSharingV2, 'limitSharingV2');
		const result = {};
		for (const key of ['sharingLimited', 'initiatedByMe']) if (sharing[key] != null) result[key] = themeBoolean(sharing[key]);
		if (sharing.trigger != null) {
			const trigger = typeof sharing.trigger === 'string' ? proto.LimitSharing.TriggerType[sharing.trigger] : sharing.trigger;
			if (!Number.isInteger(trigger) || trigger < 0 || trigger > 3) throw new ThemeError('INPUT', 'Trigger limitSharingV2 tidak valid.');
			result.trigger = trigger;
		}
		if (sharing.limitSharingSettingTimestamp != null) {
			const value = sharing.limitSharingSettingTimestamp;
			if (!['number', 'string', 'bigint'].includes(typeof value) || (typeof value === 'string' && !/^\d+$/.test(value))) throw new ThemeError('INPUT', 'Timestamp limitSharingV2 tidak valid.');
			const time = Number(value);
			if (!Number.isSafeInteger(time) || time < 0) throw new ThemeError('INPUT', 'Timestamp limitSharingV2 tidak valid.');
			result.limitSharingSettingTimestamp = time;
		}
		context.limitSharingV2 = result;
	}
	return context;
}

function encodeChatTheme(setting, timestamp, messageContextInfo) {
	if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new ThemeError('INPUT', 'Timestamp tema tidak valid.');
	const data = ProtoWriter.create().uint32(8).int64(timestamp);
	if (setting.clearTheme != null) data.uint32(16).bool(setting.clearTheme);
	if (setting.colorSchemeId != null) data.uint32(26).string(setting.colorSchemeId);
	if (setting.defaultWallpaper) {
		const nested = data.uint32(82).fork();
		if (setting.defaultWallpaper.isDoodleEnabled != null) nested.uint32(8).bool(setting.defaultWallpaper.isDoodleEnabled);
		nested.ldelim();
	}
	if (setting.solidColor) {
		const color = setting.solidColor;
		const nested = data.uint32(90).fork().uint32(13).fixed32(color.backgroundLightArgb).uint32(21).fixed32(color.backgroundDarkArgb);
		if (color.isDoodleEnabled != null) nested.uint32(24).bool(color.isDoodleEnabled);
		if (color.doodleLightArgb != null) nested.uint32(37).fixed32(color.doodleLightArgb);
		if (color.doodleDarkArgb != null) nested.uint32(45).fixed32(color.doodleDarkArgb);
		nested.ldelim();
	}
	if (setting.stockImage) data.uint32(98).fork().uint32(10).string(setting.stockImage.stockImageId).uint32(21).float(setting.stockImage.dimLevel).ldelim();
	if (setting.customImage) {
		const image = setting.customImage;
		const nested = data.uint32(106).fork().uint32(10).string(image.directPath).uint32(18).bytes(image.mediaKey).uint32(26).bytes(image.fileEncSha256).uint32(34).bytes(image.fileSha256);
		if (image.dimLevel != null) nested.uint32(45).float(image.dimLevel);
		nested.ldelim();
	}
	if (setting.animatedWallpaper) data.uint32(114).fork().uint32(10).string(setting.animatedWallpaper.animatedWallpaperId).uint32(21).float(setting.animatedWallpaper.dimLevel).ldelim();
	// Message.protocolMessage (field 12), type (field 2), theme setting (field 30).
	const message = ProtoWriter.create().uint32(98).fork().uint32(16).int32(CHAT_THEME_PROTOCOL_TYPE).uint32(242).bytes(data.finish()).ldelim();
	// Encode only this known nested type with Zapo. Re-encoding the complete
	// Message would discard the unknown chatThemeSetting field in this version.
	if (messageContextInfo) message.uint32(282).bytes(proto.MessageContextInfo.encode(messageContextInfo).finish());
	return message.finish();
}

/** CTM-style theme settings encoded independently of Baileys' bundled WAProto. */
export function buildChatThemePayload(theme, timestamp = Date.now(), messageContextInfo) {
	return encodeChatTheme(normalizeChatTheme(theme), timestamp, messageContextInfo === undefined ? undefined : themeMessageContext(messageContextInfo));
}

// Source: lib/utils/groupTheme.js

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

// Source: lib/utils/wallpaper.js

export const MAX_WALLPAPER_BYTES = 10 * 1024 * 1024
// Local files and streams are available to JavaScript callers, never chat args.
export async function readWallpaperSource(source, download = downloadWallpaper) {
  if (source && !(source instanceof Uint8Array) && !(source instanceof URL) && typeof source === 'object') source = source.url ?? source.stream ?? source
  if (source instanceof URL) source = source.protocol === 'file:' ? fileURLToPath(source) : source.href
  if (typeof source === 'string') {
    if (/^https?:\/\//iu.test(source)) return download(source)
    source = createReadStream(source, { highWaterMark: 65536 })
  }
  if (source instanceof Uint8Array) {
    if (!source.length || source.length > MAX_WALLPAPER_BYTES) throw Error('THEME_IMAGE_LIMIT')
    return Buffer.from(source)
  }
  if (!source?.[Symbol.asyncIterator]) throw Error('THEME_IMAGE_INVALID')
  let size = 0; const chunks = []
  try {
    for await (const chunk of source) {
      size += chunk.length
      if (size > MAX_WALLPAPER_BYTES) throw Error('THEME_IMAGE_LIMIT')
      chunks.push(Buffer.from(chunk))
    }
    if (!size) throw Error('THEME_IMAGE_INVALID')
    return Buffer.concat(chunks)
  } finally { source.destroy?.() }
}
const blocked = new BlockList()
for (const [ip, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(ip,bits)

export async function publicWallpaperAddress(url, resolver = lookup) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw Error('THEME_URL_INVALID')
  // Resolve IPv4 only and pin the checked address to prevent DNS rebinding.
  const addresses = await resolver(url.hostname, { family: 4, all: true })
  if (!addresses.length || addresses.some(row => row.family !== 4 || blocked.check(row.address))) throw Error('THEME_URL_PRIVATE')
  return addresses[0].address
}

export async function downloadWallpaper(value, redirects = 0) {
  const url = new URL(value), address = await publicWallpaperAddress(url)
  return new Promise((resolve, reject) => {
    let size = 0
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      lookup: (_host, options, done) => done(null, options?.all ? [{ address, family: 4 }] : address, 4),
      headers: { accept: 'image/*,video/*', 'accept-encoding': 'identity' }
    }, response => {
      if ([301,302,303,307,308].includes(response.statusCode)) {
        response.resume()
        if (redirects >= 3 || !response.headers.location) return reject(Error('THEME_URL_REDIRECT'))
        resolve(downloadWallpaper(new URL(response.headers.location, url).href, redirects + 1)); return
      }
      if (response.statusCode !== 200 || Number(response.headers['content-length']) > MAX_WALLPAPER_BYTES) { response.destroy(); reject(Error('THEME_DOWNLOAD_FAILED')); return }
      const chunks = []
      response.on('data', chunk => {
        size += chunk.length
        if (size > MAX_WALLPAPER_BYTES) { req.destroy(Error('THEME_IMAGE_LIMIT')); return }
        chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => resolve(Buffer.concat(chunks)))
    })
    const timer = setTimeout(() => req.destroy(Error('THEME_DOWNLOAD_TIMEOUT')), 30000)
    req.on('close', () => clearTimeout(timer)); req.on('error', reject); req.end()
  })
}

export async function normalizeWallpaper(bytes, { video = false, ffmpeg = 'ffmpeg' } = {}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_WALLPAPER_BYTES) throw Error('THEME_IMAGE_LIMIT')
  if (!video) {
    try {
      const image = sharp(bytes, { page: 0, pages: 1, limitInputPixels: 20_000_000 })
      const meta = await image.metadata()
      if (!['jpeg','png','webp','gif'].includes(meta.format)) throw Error('format')
      return await image.rotate().flatten({ background: '#ffffff' }).resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
    } catch {
      // Only recognized video signatures may reach FFmpeg, not arbitrary files.
      video = bytes.toString('ascii',4,8) === 'ftyp' || bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))
      if (!video) throw Error('THEME_IMAGE_INVALID')
    }
  }
  const videoSignature = bytes.toString('ascii',4,8) === 'ftyp' || bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) || bytes.toString('ascii',0,3) === 'GIF' || (bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'AVI ')
  if (!videoSignature) throw Error('THEME_VIDEO_INVALID')
  const directory = await mkdtemp(join(tmpdir(), 'zapo-wallpaper-'))
  try {
    const input = join(directory, 'input')
    await writeFile(input, bytes, { mode: 0o600 })
    const frame = await new Promise((resolve, reject) => {
      const child = spawn(ffmpeg, ['-hide_banner','-loglevel','error','-nostdin','-max_alloc','67108864','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,avi,gif','-threads','1','-i',input,'-an','-sn','-dn','-map_metadata','-1','-vf','scale=1920:1920:force_original_aspect_ratio=decrease','-frames:v','1','-threads','1','-c:v','mjpeg','-f','image2pipe','pipe:1'], { shell: false, stdio: ['ignore','pipe','pipe'] })
      let size = 0, failed = false; const chunks = []
      const timer = setTimeout(() => { failed = true; child.kill('SIGKILL') }, 30000)
      child.stdout.on('data', chunk => { size += chunk.length; if (size > MAX_WALLPAPER_BYTES) { failed = true; child.kill('SIGKILL') } else chunks.push(chunk) })
      child.stderr.resume()
      child.on('error', () => { clearTimeout(timer); reject(Error('THEME_FFMPEG_MISSING')) })
      child.on('close', code => { clearTimeout(timer); if (code || failed || !size) reject(Error('THEME_VIDEO_FAILED')); else resolve(Buffer.concat(chunks)) })
    })
    return await prepareThemeImage(frame)
  } finally { await rm(directory, { recursive: true, force: true }) }
}

// Source: lib/services/groupThemePlugin.js

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

// Source: lib/theme.js
// Public Zapo integration. Catalog / API concepts: RenTakamori.
export const getChatThemeExamples = () => ({ themes: CHAT_THEME_PRESETS, bubbles: CHAT_BUBBLE_PRESETS })
export { parseGroupTheme as parseTheme }
// Pure builder: custom image settings must contain already-uploaded metadata.
export function buildThemePayload(setting, timestamp = Date.now()) {
  return encodeGroupTheme(setting, timestamp)
}

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

// Source: lib/handler.js

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
