import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'

// Exercise the same repository subpath used by GitHub Pages, with no backend.
const root = resolve('dist')
const port = Number(process.env.PORT || 4175)
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' }
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (pathname === '/') { res.writeHead(302, { Location: '/lume/' }); res.end(); return }
    if (!pathname.startsWith('/lume/')) { res.writeHead(404); res.end(); return }
    const path = resolve(root, pathname.slice('/lume/'.length) || 'index.html')
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); res.end(); return }
    const bytes = await readFile(path)
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(bytes)
  } catch { res.writeHead(404); res.end('Not found') }
}).listen(port, '127.0.0.1', () => console.log(`Lume production preview: http://127.0.0.1:${port}/lume/`))
