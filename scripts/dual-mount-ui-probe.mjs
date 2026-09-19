// 织卷无头验证 · dev 模式双编辑器挂载探针（体验层 2026-09-19 11:15 轮，F-20260917-11「编辑区双『开始写作…』」）
// 用途：StrictMode 双 effect 会让 Milkdown Editor.make().create() 的旧异步结果未被销毁，同一宿主 DOM 挂出两个
//       .ProseMirror（双占位/双正文）——该 bug 仅在 React dev build（StrictMode 生效）可复现，production 不会触发，
//       故本探针自起 vite dev server（root=src/renderer）驱动验证；期望=各页面 .ProseMirror 峰值 ≤1、零 JS 异常。
// 用法: node scripts/dual-mount-ui-probe.mjs   （自动写/删临时 vite.config.mjs，跑完即清）
import { writeFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'

const CONFIG = `import { resolve } from 'path'\nimport { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nimport tailwindcss from '@tailwindcss/vite'\n\nexport default defineConfig({\n  root: resolve('/Users/USER/Desktop/织卷/src/renderer'),\n  plugins: [react(), tailwindcss()],\n  server: { port: 5210, strictPort: true, host: '127.0.0.1' }\n})\n`
writeFileSync('/Users/USER/Desktop/织卷/vite.config.mjs', CONFIG)
const dev = spawn('npx', ['vite'], { cwd: '/Users/USER/Desktop/织卷', stdio: 'ignore', detached: false })

const CDP = 'http://127.0.0.1:9224'
const SPA = 'http://127.0.0.1:5210'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fail = 0
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++ }

// 等 dev server 就绪
let up = false
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(`${SPA}/?cb=1`); if (r.ok) { up = true; break } } catch {}
  await sleep(500)
}
if (!up) { console.log('FAIL dev server 未起'); dev.kill(); rmSync('/Users/USER/Desktop/织卷/vite.config.mjs'); process.exit(1) }

const r = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })
const target = await r.json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const errors = []
let maxPM = 0
let maxEmpty = 0
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  else if (m.method === 'Runtime.exceptionThrown') errors.push('exc: ' + (m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || '?'))
  else if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push('console: ' + (m.params?.args?.map((a) => a.value ?? a.description ?? '?').join(' ') || ''))
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
await new Promise((r) => (ws.onopen = r))
await cmd('Runtime.enable')
await cmd('Page.enable')
const ev = async (expr) => {
  const x = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (x.exceptionDetails) return 'EX: ' + JSON.stringify(x.exceptionDetails?.exception?.description || x.exceptionDetails.text).slice(0, 200)
  return x.result?.value
}
const sample = async (tag) => {
  const v = await ev(`(() => { const pms = Array.from(document.querySelectorAll('.ProseMirror')); return { c: pms.length, e: pms.filter((p) => p.classList.contains('zj-empty')).length } })()`)
  if (v.c > maxPM) maxPM = v.c
  if (v.e > maxEmpty) maxEmpty = v.e
  return v
}

console.log('== Novel（点第1章）==')
await cmd('Page.navigate', { url: `${SPA}/?cb=${Date.now()}#/project/demo-aseya/novel` })
for (let i = 0; i < 8; i++) { await sleep(800); await sample('novel-初始') }
await ev(`(() => { const b = Array.from(document.querySelectorAll('aside button')).find((x) => (x.innerText || '').includes('第1章')); if (b) { b.click(); return true } return false })()`)
for (let i = 0; i < 8; i++) { await sleep(400); await sample('novel-第1章') }
for (const t of ['第2章', '第3章', '第5章', '第4章', '第1章']) {
  await ev(`(() => { const b = Array.from(document.querySelectorAll('aside button')).find((x) => (x.innerText || '').includes('${t}')); if (b) b.click(); return !!b })()`)
  await sample('novel-切' + t); await sleep(90); await sample('novel-切' + t + '2')
}
await sleep(1500)
await sample('novel-final')

console.log('== Characters（初始+点沈藏）==')
await cmd('Page.navigate', { url: `${SPA}/?cb=${Date.now()}#/project/demo-aseya/characters` })
for (let i = 0; i < 8; i++) { await sleep(800); await sample('chars-初始') }
await ev(`(() => { const b = Array.from(document.querySelectorAll('aside button')).find((x) => (x.innerText || '').includes('沈藏')); if (b) { b.click(); return true } return false })()`)
for (let i = 0; i < 6; i++) { await sleep(400); await sample('chars-沈藏') }

console.log('== Worldview / Outline ==')
await cmd('Page.navigate', { url: `${SPA}/?cb=${Date.now()}#/project/demo-aseya/worldview` })
for (let i = 0; i < 6; i++) { await sleep(800); await sample('world-初始') }
await cmd('Page.navigate', { url: `${SPA}/?cb=${Date.now()}#/project/demo-aseya/outline` })
for (let i = 0; i < 6; i++) { await sleep(800); await sample('outline-初始') }

ok(maxPM <= 1, `全页面 .ProseMirror 峰值 ≤1 (${maxPM})`)
ok(maxEmpty <= 1, `全页面 zj-empty 峰值 ≤1 (${maxEmpty})`)
ok(errors.length === 0, `全程零 JS 异常 (${errors.length})`)
console.log(fail === 0 ? '== ALL PASS ==' : `== FAIL=${fail} ==`)
ws.close()
dev.kill()
rmSync('/Users/USER/Desktop/织卷/vite.config.mjs')
process.exit(fail === 0 ? 0 : 1)
