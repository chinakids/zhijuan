// 无头验收静态服务器：SPA fallback + ThreadingHTTPServer 等价实现（node 原生）。
// 用法：node scripts/serve-renderer.mjs [port]   （默认 8123，配 GZIP 无需）
// 坑：python3 -m http.server 对子路由 404，且非线程化并发会因 TIME_WAIT 静默退出——因此用 node 自带 http。
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number(process.argv[2] || 8123)
const root = fileURLToPath(new URL('../out/renderer/', import.meta.url)).replace(/\/$/, '')
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.json': 'application/json', '.map': 'application/json', '.ico': 'image/x-icon'
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  const safe = normalize(join(root, urlPath))
  if (safe !== root && !safe.startsWith(root + sep)) {
    res.writeHead(403).end()
    return
  }
  try {
    const data = await readFile(safe)
    res.writeHead(200, { 'Content-Type': MIME[extname(safe)] || 'application/octet-stream' })
    res.end(data)
  } catch {
    try {
      const data = await readFile(join(root, 'index.html'))
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(data)
    } catch {
      res.writeHead(404).end()
    }
  }
})

server.listen(port, () => console.log('renderer server on http://localhost:' + port + ' (root=' + root + ')'))
