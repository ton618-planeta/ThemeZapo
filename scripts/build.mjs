import { readFile, mkdir, writeFile } from 'node:fs/promises'
const files = ['lib/utils/themeWriter.js','lib/utils/themeCatalog.js','lib/utils/groupParticipants.js','lib/utils/rawThemeBuilder.js','lib/utils/groupTheme.js','lib/utils/wallpaper.js','lib/services/groupThemePlugin.js','lib/theme.js','lib/handler.js']
const imports = new Set(), chunks = []
for (const file of files) {
  let source = await readFile(new URL('../' + file, import.meta.url), 'utf8')
  source = source.replace(/^import .* from ['"](.+)['"]\r?\n/gm, (line, path) => {
    if (!path.startsWith('.') && line.trim() !== "import { randomBytes } from 'node:crypto'") imports.add(line.trim())
    return ''
  }).replace(/^export \{.*\} from .*\r?\n/gm, '').replace(/^export \{ COLOR_PRESETS, CHAT_THEME_PRESETS, CHAT_BUBBLE_PRESETS, resolveThemeScheme \}\r?\n/gm, '')
  chunks.push('// Source: ' + file + '\n' + source)
}
await mkdir(new URL('../dist/', import.meta.url), { recursive: true })
await writeFile(new URL('../dist/group-theme.js', import.meta.url), '// ThemeZapo · MIT · Rei Ayanami\n// Catalog, builder and helper concepts adapted from RenTakamori.\n// Original protocol example: NL. No QR, login or account storage.\n' + [...imports].join('\n') + '\n\n' + chunks.join('\n'))
console.log('Built dist/group-theme.js')
