// 织卷无头冒烟 · 其余编辑页（人物/世界观/素材/大纲文档区）窄窗体检防回归
// 用法：node scripts/docsection-narrow-ui-smoke.mjs
// 前置：npm run build；out/renderer 由 http.server(8123/8899) 服务；本机无头 Chrome CDP 127.0.0.1:9224
// 走查结论（2026-09-17 20:15 轮）：窗口系统 minWidth=1000 → 四页主区实测 504–536px 全 ≥360 保护值，
// 零横向溢出、工具栏 1000/900 全量平铺（More 只在 800 假设域出现=收纳正常）→ 无需接入 DocSection 级折叠。
// 本冒烟锁定该基线：① 1000 档：主区 ≥360 + 无溢出 + 无「更多格式」 ② 800 假设域：无溢出 + More 收纳出现
// ③ 全程无 JS 异常。防回归：若将来有人加宽侧栏/改布局把主区压破 360，本冒烟立即红。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = process.env.HOME + '/Pictures/zhijuan'

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
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch { /* 重试 */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}
async function setSize(page, w, h) {
  await page.cmd('Emulation.clearDeviceMetricsOverride')
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
}
async function shot(page, name) {
  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (s?.data) {
    const fs = await import('node:fs')
    fs.mkdirSync(OUT, { recursive: true })
    const hh = String(new Date().getHours()).padStart(2, '0')
    const mm = String(new Date().getMinutes()).padStart(2, '0')
    const p = `${OUT}/${name}-${hh}${mm}.png`
    fs.writeFileSync(p, Buffer.from(s.data, 'base64'))
    console.log('SCREENSHOT:', p)
  }
}

// 布局快照
const snapExpr = `(() => {
  const pm = document.querySelector('.ProseMirror')
  const main = document.querySelector('main')
  const doc = document.documentElement
  const more = [...document.querySelectorAll('button')].some((b) => (b.title || '') === '更多格式')
  const h11 = [...document.querySelectorAll('div')].find((d) => d.className && d.className.includes('h-11') && d.className.includes('border-b'))
  return {
    winW: window.innerWidth,
    mainW: main ? Math.round(main.getBoundingClientRect().width) : null,
    pmW: pm ? Math.round(pm.getBoundingClientRect().width) : null,
    hasPm: !!pm,
    overflowX: doc.scrollWidth > doc.clientWidth + 1,
    more,
    h11H: h11 ? Math.round(h11.getBoundingClientRect().height) : null
  }
})()`

const ROUTES = [
  { key: 'characters', url: '#/project/demo-aseya/characters', pick: true },
  { key: 'worldview', url: '#/project/demo-aseya/worldview', pick: true },
  { key: 'outline', url: '#/project/demo-aseya/outline', pick: false },
  { key: 'library-editor', url: '#/project/demo-aseya/library?doc=' + encodeURIComponent('素材库/桥段/追忆型开头.md'), pick: false }
]

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

for (const route of ROUTES) {
  for (const W of [1000, 800]) {
    const tab = await openTab('about:blank')
    const page = await attach(tab.webSocketDebuggerUrl)
    // 先 resize 后交互（避免交互后 resize 挂死无头浏览器）
    await setSize(page, W, 700)
    await page.cmd('Page.navigate', { url: BASE + '/?cb=' + Date.now() + route.url })
    // 等布局就绪：人物/世界观需点第一个文档按钮打开编辑器
    await evalUntil(page, snapExpr, (x) => x && x.mainW !== null && x.winW === W, 20000, route.key + ' ' + W + ' 布局')
    if (route.pick) {
      await page.eval(`(() => { const btns=[...document.querySelectorAll('aside button')]; const b=btns.find((x)=>(x.textContent||'').trim().length>0 && !(x.title||'')); if (b) b.click(); return !!b })()`)
      await evalUntil(page, snapExpr, (x) => x && x.hasPm === true, 15000, route.key + ' 选文档')
    } else {
      await evalUntil(page, snapExpr, (x) => x && x.hasPm === true, 15000, route.key + ' 编辑器挂载')
    }
    await sleep(800)
    const s = await page.eval(snapExpr)
    console.log('SNAP', route.key, W + ':', JSON.stringify(s))
    if (W === 1000) {
      ok(`${route.key} @1000：主编辑区宽 ≥ 360`, s.mainW >= 360, String(s.mainW))
      ok(`${route.key} @1000：无横向溢出`, s.overflowX === false)
      ok(`${route.key} @1000：工具栏全量平铺（无「更多格式」）`, s.more === false)
      if (s.h11H !== null) ok(`${route.key} @1000：文档头单行（h-11 44px）`, s.h11H === 44, String(s.h11H))
      if (route.key === 'characters') await shot(page, 'docsection-char')
      if (route.key === 'outline') await shot(page, 'docsection-outline')
      if (route.key === 'library-editor') await shot(page, 'docsection-libedit')
    } else {
      // 800 = 系统 minWidth(1000) 之外的假设域：只验「优雅收窄」无溢出 + More 收纳
      ok(`${route.key} @800：无横向溢出（flex 优雅收窄）`, s.overflowX === false)
      ok(`${route.key} @800：工具栏 More 收纳出现`, s.more === true)
      if (s.h11H !== null) ok(`${route.key} @800：文档头仍单行`, s.h11H === 44, String(s.h11H))
    }
    console.log('ERRORS:', route.key, W, page.errors.length ? page.errors.slice(0, 3) : 'none')
    ok(`${route.key} @${W}：无 JS 异常`, page.errors.length === 0, String(page.errors.slice(0, 2)))
    page.close()
  }
}

console.log(fails === 0 ? 'ALL PASS' : `FAIL: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
