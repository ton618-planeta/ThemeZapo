# ThemeZapo — Helper & Builder

[Documentação completa em português](README.md)

Single-file helper for an **existing Zapo bot**: [`dist/group-theme.js`](dist/group-theme.js). No standalone bot, QR, login, account storage, or database. Use your application's existing WhatsApp connection.

Requires Node.js 22.12+, ESM, `zapo-js@1.12.0`, `sharp@0.35.5`. System FFmpeg is needed for video frames only.

```js
import { createGroupThemePlugin, createThemeCommand, setThemeGroup, buildChatThemePayload } from './group-theme.js'

// Append createGroupThemePlugin() to your existing WaClient plugins array.
const handleTheme = createThemeCommand(client, { owners: [] })
client.on('message', event => { void handleTheme(event).catch(console.error) })

await setThemeGroup(client, groupJid, { theme: 'pink', bubble: 'royal-blue' })
const bytes = buildChatThemePayload({ colorSchemeId: 'Royal-Blue' })
```

## Commands

- `/theme`, `/tema`, `/thema`, `/temagrupo`, `/settema`, `/wallpaper`.
- `/theme help` or `/tema ajuda`: help. Bot responses are primarily Portuguese; command aliases support PT/EN.
- `/theme list`: 49 preset aliases.
- `/theme blue` or `/theme #FF2400`: solid color.
- `/theme preset pink`: full theme preset.
- `/theme bubble emerald`: bubble only.
- `/theme preset pink bubble royal-blue`: preset and different bubble.
- Send/reply to a photo, GIF or video with `/theme image bubble pink --dim=0.5`.
- `/theme https://example.com/wallpaper.jpg`: public URL.
- `/theme clear`, `/thema reset`, `/tema limpar`: reset.

Group admins/creator or configured bot owners may invoke the command. If group info changes are restricted, the bot must also be an admin. Owner bypass cannot override server restrictions. Direct API calls check bot restrictions; your dispatcher must authorize the human caller.

## API and builders

`setThemeGroup(client, groupJid, content)` supports a command string, Buffer/Uint8Array, or an object with one of `theme`, `color`, `wallpaper`, `reset`, optionally `bubble`. `wallpaper` accepts local files, HTTP(S) URLs, URL objects, buffers and streams in JavaScript. Chat commands only accept public URLs or attached/quoted media. `dimLevel` ranges from 0 to 1 for wallpaper. See the Portuguese guide for all examples.

`sendChatTheme` accepts detailed theme fields. `buildChatThemePayload(theme, timestamp?, messageContextInfo?)` produces protobuf bytes without connecting or sending. It supports clear, color scheme, light/dark solid colors and doodles, default wallpaper, stock/custom/animated wallpaper metadata. Builders do not upload media; custom-image bytes must first be uploaded through the sending API.

10 MiB input limit, 20 MP photos/GIF, 1920px JPEG output. GIF/video uses a **static first frame**, not a newly animated wallpaper. Public IPv4 downloads are pinned, bounded and checked across redirects. Private destinations are rejected. Two-step preset/bubble updates wait for ACK and stop on uncertainty without retry. The first step may already be applied. Delivery does not guarantee every device displays the theme.

The SDK's internal sender-key publisher is version-specific. Test before changing SDK version. No node_modules patches.

```sh
npm ci
npm test
npm run build
```

MIT. Credits: Rei Ayanami / Chrysalis (Zapo integration), RenTakamori (reference helper), NL (initial protocol example), vinikjkkj (zapo-js). Independent project, not affiliated with WhatsApp.
