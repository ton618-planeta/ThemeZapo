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
