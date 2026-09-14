// 织卷无头冒烟 · 正文滚动条走查（Apple HIG Scroll Views；2026-09-15 体验层）
// 用法：node scripts/scrollbar-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123 && 本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 正文滚动容器 scrollbarWidth=thin（Chromium 标准属性，全站 tokens.css 全局 * 规则）；
//         ② scrollbarColor=主题发丝色/透明（两主题各断）；
//         ③ 滚动条不占布局（offsetWidth-clientWidth=0，overlay 形态，HIG「不遮挡内容」）；
//         ④ 全站所有可滚动容器同口径（配色一致）；
//         ⑤ 无 JS 异常；⑥ 截图存档。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((res) => {
    ws.onopen = async () => {
      await cmd('Runtime.enable')
      res({
        cmd, errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
    }
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 25000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

// 等编辑器就绪
await evalUntil(page, `(() => { const p = document.querySelector('.ProseMirror'); return p && p.textContent.length > 20 })()`, (x) => x, 25000, '编辑器就绪')

// 找到正文滚动容器（ProseMirror 往上找 overflow-y=auto/scroll 的祖先）
const ED_PROBE = `(() => {
  const pm = document.querySelector('.ProseMirror')
  if (!pm) return null
  let s = pm
  while (s && s !== document.body) {
    const o = getComputedStyle(s).overflowY
    if (o === 'auto' || o === 'scroll') break
    s = s.parentElement
  }
  if (!s || s === document.body) return { err: 'no scroll container' }
  const cs = getComputedStyle(s)
  return {
    sw: cs.scrollbarWidth, sc: cs.scrollbarColor, oy: cs.overflowY,
    gutter: cs.scrollbarGutter,
    barGap: s.offsetWidth - s.clientWidth,
    clientH: s.clientHeight, scrollH: s.scrollHeight,
    dark: document.documentElement.classList.contains('dark')
  }
})()`
const v = await evalUntil(page, ED_PROBE, (x) => x !== null, 20000, '滚动容器')
console.log('EDITOR:', JSON.stringify(v))

ok('正文滚动容器 scrollbar-width=thin（Chromium 标准属性细滚动条）', v.sw === 'thin', v.sw)
ok('滚动容器 overflow-y=auto', v.oy === 'auto', v.oy)
ok('滚动条不占布局（overlay 形态，HIG 不遮挡内容）', v.barGap === 0, 'gap=' + v.barGap)
ok('paper 主题 thumb=发丝色/track 透明', v.sc === 'rgba(50, 46, 39, 0.22) rgba(0, 0, 0, 0)', v.sc)
ok('paper 主题 dark=false', v.dark === false, String(v.dark))

// 注入长文档确认滚动生效（scrollHeight >> clientHeight）
const b64 = Buffer.from(Array.from({ length: 200 }, (_, i) => `第${i + 1}段：这里是一段足够长的正文内容，用于撑满视口触发纵向滚动。织卷的写作纸面。`).join('\n\n')).toString('base64')
await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; if (!eds.length) return 'NO'; eds[0].setContent(atob('${b64}')); return 'OK' })()`)
await sleep(800)
const v2 = await evalUntil(page, ED_PROBE, (x) => x !== null && x.scrollH > x.clientH * 3, 20000, '长文滚动')
ok('长文注入后滚动生效（scrollHeight >> clientHeight）', v2.scrollH > v2.clientH * 3, v2.scrollH + '/' + v2.clientH)
ok('滚动后仍不占布局', v2.barGap === 0, 'gap=' + v2.barGap)

// 全站一致性：所有可滚动元素 scrollbarWidth/color 与正文同口径
const all = await page.eval(`(() => {
  const out = []
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.clientHeight > 40) {
      out.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 50), sw: cs.scrollbarWidth, sc: cs.scrollbarColor })
    }
  }
  return out.slice(0, 30)
})()`)
console.log('SCROLLABLES:', JSON.stringify(all, null, 1))
const badOnes = all.filter((x) => x.sw !== 'thin' || x.sc !== 'rgba(50, 46, 39, 0.22) rgba(0, 0, 0, 0)')
ok('全站可滚动容器同口径（thin + 发丝色 + 透明轨道）', badOnes.length === 0, '异常=' + badOnes.length)

// dark 主题
await page.eval(`document.documentElement.classList.add('dark')`)
await sleep(400)
const vd = await evalUntil(page, ED_PROBE, (x) => x !== null, 20000, 'dark 滚动容器')
ok('dark 主题 thumb=发丝色(浅)/track 透明', vd.sc === 'rgba(233, 230, 223, 0.24) rgba(0, 0, 0, 0)', vd.sc)
ok('dark 主题仍 thin 且不占布局', vd.sw === 'thin' && vd.barGap === 0, vd.sw + '/' + vd.barGap)
await page.eval(`document.documentElement.classList.remove('dark')`)

// 截图（编辑区长文 + 右下角，行为附证）
import os from 'node:os'
const { writeFileSync, mkdirSync } = await import('node:fs')
mkdirSync(os.homedir() + '/Pictures/zhijuan', { recursive: true })
for (const mode of ['light', 'dark']) {
  if (mode === 'dark') await page.eval(`document.documentElement.classList.add('dark')`)
  await sleep(300)
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  writeFileSync(os.homedir() + '/Pictures/zhijuan/scrollbar-' + mode + '.png', Buffer.from(shot.data, 'base64'))
  if (mode === 'dark') await page.eval(`document.documentElement.classList.remove('dark')`)
}
console.log('SCREENSHOTS: ~/Pictures/zhijuan/scrollbar-light.png / scrollbar-dark.png')

if (page.errors.length) { console.log('JS ERRORS:', page.errors.slice(0, 5)); fails++ }
console.log(fails === 0 ? 'ALL PASS' : ('FAILS: ' + fails))
await page.close()
process.exit(fails === 0 ? 0 : 1)
