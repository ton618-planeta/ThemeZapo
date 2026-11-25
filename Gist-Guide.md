# ThemeZapo — Zapo helper / builder

Single-file helper / helper em arquivo único: `group-theme.js`.

Copy it into your existing ESM Zapo bot. Requires `zapo-js@1.12.0`, `sharp@0.35.5`; FFmpeg for video frames. No QR/login/database code. Use the connection your bot already has.

```js
import { createGroupThemePlugin, createThemeCommand, setThemeGroup, buildChatThemePayload } from './group-theme.js'

// Add createGroupThemePlugin() to the plugins of your existing WaClient.
const handleTheme = createThemeCommand(client, { owners: [] })
client.on('message', event => { void handleTheme(event).catch(console.error) })

await setThemeGroup(client, groupJid, { theme: 'pink', bubble: 'royal-blue' })
const bytes = buildChatThemePayload({ colorSchemeId: 'Royal-Blue' })
```

Comandos: `/tema`, `/theme`, `/thema`. `/tema lista`, `/theme preset pink`, `/tema bubble emerald`, `/tema azul`, `/theme clear`. Photo/GIF/video reply with `/theme image`; static first frame, maximum 10 MiB. Group admins/creator and configured owner only. In restricted groups, the bot must also be an admin.

[GitHub, documentation, source and tests](https://github.com/ton618-planeta/ThemeZapo) · [Português](https://github.com/ton618-planeta/ThemeZapo/blob/main/README.md) · [English](https://github.com/ton618-planeta/ThemeZapo/blob/main/README.en.md)

MIT. Rei Ayanami / Chrysalis (Zapo integration), RenTakamori (reference helper), NL (initial protocol example). No real WhatsApp sends in automated tests; server ACK does not guarantee theme display on all clients.
