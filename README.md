# ThemeZapo — Group Theme Helper & Builder

[English](README.en.md)

Helper open source para **bot Zapo existente**. Um arquivo para copiar/importar: [`dist/group-theme.js`](dist/group-theme.js). Não cria bot, QR, login, sessão ou banco. Reutiliza a conexão do seu aplicativo.

## Requisitos

- JavaScript ESM, Node.js 22.12+.
- `zapo-js` **1.12.0** e `sharp` **0.35.5** no seu bot.
- FFmpeg no PATH apenas para vídeos; GIF usa o primeiro quadro via Sharp.
- A conta WhatsApp do seu bot já deve estar conectada.

```sh
npm install zapo-js@1.12.0 sharp@0.35.5
```

## Instalar no seu Zapo

Copie `dist/group-theme.js` para seu bot. No trecho em que seu projeto já configura o `WaClient`, adicione o plugin **junto dos plugins existentes**:

```js
import { createGroupThemePlugin, createThemeCommand } from './group-theme.js'

// Acrescente na configuração existente do WaClient:
// plugins: [...pluginsExistentes, createGroupThemePlugin()]

// Use o client que seu bot já criou. Não é outro login.
const tema = createThemeCommand(client, { owners: [] })
client.on('message', event => {
  void tema(event).catch(() => console.error('Falha ao responder /tema'))
})
```

Em `owners`, informe JIDs completos do dono se quiser bypass da permissão do usuário. Vazio permite admins/criador. Não associe PN e LID pelos dígitos: o helper usa os aliases reais da mensagem e a metadata atual. Se o grupo restringe alterações de informações, **o bot também precisa ser admin**, inclusive quando o comando vem do dono.

## Comandos PT/EN

Aliases: `/tema`, `/theme`, `/thema`, `/temagrupo`, `/settema`, `/wallpaper`.

| Uso | Exemplo |
| --- | --- |
| Ajuda | `/tema ajuda`, `/theme help` |
| Catálogo com 49 presets | `/tema lista`, `/theme list` |
| Cor por nome | `/tema azul`, `/theme blue` |
| Cor hexadecimal | `/tema #FF2400` |
| Preset completo | `/tema preset pink` |
| Preset tonal/minimal | `/theme preset royal-blue-tonal`, `/theme preset default-blue-minimal` |
| Somente balões | `/tema bubble emerald`, `/tema balão pink` |
| Preset + outro balão | `/tema preset pink bubble royal-blue` |
| Cor + balão | `/tema #121212 bubble pink-tonal` |
| Foto/GIF/vídeo enviado ou citado | `/tema imagem`, `/theme image`, ou `/tema` na legenda |
| Mídia + balão + escurecimento | `/tema imagem bubble emerald --dim=0.5` |
| Wallpaper por URL | `/tema https://example.com/wallpaper.jpg` |
| URL + balão | `/theme https://example.com/wallpaper.jpg bubble pink` |
| Remover tema | `/tema limpar`, `/theme clear`, `/thema reset` |

`pink` escolhe cor sólida; `preset pink` escolhe o preset WhatsApp. `bubble pink` altera só balões, mesmo citando mídia. Para usar a mídia também, escreva `imagem bubble pink`. Sem argumento e sem mídia, mostra ajuda. Não altera tema de um usuário específico.

Cores: rosa/pink, azul/blue, roxo/purple, preto/black, verde/green, vermelho/red, amarelo/yellow, laranja/orange, branco/white. Mantém os nomes indonésios do exemplo. Reset também aceita `default`/`hapus`; lista aceita `examples`/`exemplos`.

## API para integrar a outro dispatcher

```js
import { setThemeGroup, sendChatTheme, getChatThemeExamples } from './group-theme.js'

await setThemeGroup(client, groupJid, { theme: 'pink' })
await setThemeGroup(client, groupJid, { theme: 'pink', bubble: 'royal-blue' })
await setThemeGroup(client, groupJid, { color: '#121212', bubble: 'pink-tonal' })
await setThemeGroup(client, groupJid, { wallpaper: imageBuffer, dimLevel: 0.5 })
await setThemeGroup(client, groupJid, { reset: true })
const catalogo = getChatThemeExamples()

// API detalhada: cores clara/escura, doodles e demais campos.
await sendChatTheme(client, groupJid, {
  solidColor: { colorLight: '#FF69B4', colorDark: '#121212', isDoodleEnabled: true }
})
```

`setThemeGroup` aceita string de comando, Buffer/Uint8Array ou objeto. O objeto aceita `theme`, `color`, `wallpaper` ou `reset`; combine um deles com `bubble`. `colorSchemeId` é alternativa a `bubble` e valida o catálogo. `dimLevel` de 0 a 1 só para mídia/variantes de wallpaper. Aliases de função: `setThemGroup` e `setTgemGroup`.

`wallpaper` na API pode ser Buffer/Uint8Array, caminho local, URL HTTP(S), objeto URL (incluindo file:), `{ url }`, `{ stream }` ou stream assíncrono. Caminhos/streams são exclusivos da API JavaScript; comandos de chat recebem mídia ou URL HTTP(S). Downloads têm limite de 10 MiB, timeout e verificação de endereço público em cada redirecionamento; IPv4 é fixado por requisição. Destinos privados, credenciais na URL e portas fora de 80/443 são recusados. Nenhuma foto vai para uma API de imagens externa.

**Autorização da API:** `setThemeGroup`/`sendChatTheme` verificam a restrição do grupo e o papel do bot. Seu dispatcher deve verificar a permissão do usuário; `createThemeCommand` já faz essa verificação. `client.groupTheme.set` é o transporte de baixo nível, sem ACL do usuário.

## Builder puro — sem conexão nem envio

```js
import { buildChatThemePayload, buildThemePayload, parseTheme } from './group-theme.js'

const bytes = buildChatThemePayload({
  colorSchemeId: 'Royal-Blue',
  solidColor: { colorLight: '#FF0000', colorDark: '#121212', isDoodleEnabled: false }
})
const reset = buildThemePayload({ kind: 'clear' })
const parsed = parseTheme('preset pink bubble emerald')
```

`buildChatThemePayload(theme, timestamp?, messageContextInfo?)` retorna Buffer protobuf. Aceita `clear`, `colorSchemeId`, e uma variante: `solidColor`, `defaultWallpaper`, `stockImage`, `customImage` ou `animatedWallpaper`, com validação de cores ARGB/hex, dimLevel, hash/chave e contexto. `customImage` no builder exige `directPath`, `mediaKey`, `fileEncSha256` e `fileSha256` de um upload já feito. Para uma imagem nova, use `setThemeGroup` ou `sendChatTheme` com `customImage: { image: imageBuffer }`.

IDs de imagens de catálogo/animatedWallpaper são passados pela API; não inventamos IDs nem prometemos disponibilidade. A lista de 49 presets vem da referência enviada e pode variar conforme o cliente WhatsApp. O builder usa writer próprio para preservar campos diferentes do schema do SDK; não faça decode/encode da mensagem completa antes de enviar.

## Limites e entrega

- Mídia até 10 MiB; fotos/GIF até 20 MP. Vídeos viram o primeiro quadro estático com FFmpeg limitado a 30s. **Não é wallpaper animado criado a partir do vídeo.**
- Imagem enviada em JPEG de até 1920 px. Criptografia usa `WhatsApp Chat Wallpaper Keys`; upload ao CDN do WhatsApp.
- Uma alteração por grupo no transporte. Deduplicação de eventos de comando por 120s, em memória.
- Preset + balão diferente exige duas atualizações, cada uma aguardando ACK. Falha/ACK incerto interrompe a sequência; o primeiro passo pode já estar aplicado. Sem retry/replay automático.
- Confirmação do servidor não prova exibição em todos os aparelhos. Requer suporte do WhatsApp e permissões efetivas da conta.
- Plugin adaptado ao publisher interno do `zapo-js` 1.12.0; novas versões precisam de validação. Nenhum arquivo de node_modules é modificado.

## Desenvolvimento

```sh
npm ci
npm test
npm run build
```

O build gera o arquivo único. Testes usam fixtures/SDK real com rede simulada e conversão local; não pareiam contas nem mudam temas reais. Não há `npm start`: este projeto é um helper.

## Créditos

MIT. Rei Ayanami / Chrysalis (integração Zapo). **RenTakamori**, autor do helper de referência; **NL**, exemplo inicial do protocolo. O catálogo/builder foram adaptados da referência fornecida pelo usuário. [zapo-js](https://github.com/vinikjkkj/zapo), de vinikjkkj, tem licença própria MIT. Projeto independente, sem afiliação ao WhatsApp.
