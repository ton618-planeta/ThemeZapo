// Builder adapted from RenTakamori.
import { proto } from 'zapo-js'
import { ProtoWriter } from './themeWriter.js'
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
