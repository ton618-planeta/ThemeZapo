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
import sharp from 'sharp'
import { prepareThemeImage } from './groupTheme.js'

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
