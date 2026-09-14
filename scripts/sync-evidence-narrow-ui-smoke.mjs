// 织卷无头冒烟 · 切片同步浮条：证据小字×守卫并存 窄窗单行化（创作层 2026-09-15 00:45 候选 2）
// 用法：node scripts/sync-evidence-narrow-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 宽窗 1600：证据全文可见（无截断、明文字 1 行） ② 窄窗 1000/900（章节列折叠）：浮条单行、
//         不越编辑器左界/右锚点（right-24 不变）、守卫「拦截 N 条 · 查看」完整在浮条内
//         ③ 证据 span 带 title=全文（hover 可达，pointer-events:auto） ④ 全程无 JS 异常 ⑤ 截图
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = process.env.HOME + '/Pictures/zhijuan'
const FULL = '✓ 无设定变化 · 已比对 切片「雾港夜」、人档 5、1 人未建档'

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
    ws.onopen = () =>
      res({
        cmd, errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const clickBtn = (text) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => (b.innerText || '').includes(${JSON.stringify(text)}))
  if (!el) return false
  el.click()
  return true
})()`
async function setSize(page, w, h) {
  await page.cmd('Emulation.clearDeviceMetricsOverride')
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await sleep(700)
}
async function shot(page, name) {
  const r = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (!r?.data) return null
  const fs = await import('node:fs')
  fs.mkdirSync(OUT, { recursive: true })
  const hh = String(new Date().getHours()).padStart(2, '0')
  const mm = String(new Date().getMinutes()).padStart(2, '0')
  const p = `${OUT}/${name}-${hh}${mm}.png`
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'))
  return p
}

// 浮条布局快照（证据 span／守卫按钮／浮条与编辑器边界关系）
const snapExpr = `(() => {
  const pill = [...document.querySelectorAll('div')].find((d) =>
    (d.className || '').includes('rounded-full') && (d.innerText || '').includes('无设定变化'))
  if (!pill) return { pill: null }
  const pr = pill.getBoundingClientRect()
  const span = [...pill.querySelectorAll('span')].find((s) => (s.title || '').includes('已比对'))
  const sr = span ? span.getBoundingClientRect() : null
  const btn = [...pill.querySelectorAll('button')].find((b) => (b.innerText || '').includes('查看'))
  const br = btn ? btn.getBoundingClientRect() : null
  const parent = pill.parentElement
  const er = parent ? parent.getBoundingClientRect() : null
  return {
    winW: window.innerWidth,
    toggle: !!document.querySelector('[data-testid="chapter-toggle"]'),
    pill: pr ? { x: Math.round(pr.x), r: Math.round(pr.right), w: Math.round(pr.width), h: Math.round(pr.height) } : null,
    editor: er ? { x: Math.round(er.x), r: Math.round(er.right), w: Math.round(er.width) } : null,
    span: sr && span ? {
      w: Math.round(sr.width), h: Math.round(sr.height),
      oneLine: sr.height <= 20,
      truncated: span.scrollWidth > span.clientWidth + 1,
      title: span.title,
      pe: getComputedStyle(span).pointerEvents
    } : null,
    btn: br ? { x: Math.round(br.x), r: Math.round(br.right), w: Math.round(br.width) } : null,
    fullVisible: (span && span.innerText) || ''
  }
})()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-slice=雾港夜&zj-guard=3#/project/demo-aseya/novel')
const page = await attach(tab.webSocketDebuggerUrl)
let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

let fatal = null
try {
  await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入')
  await setSize(page, 1600, 800)
  await page.eval(clickBtn('第1章 · 雾港'))
  await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
  await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('冒烟追加：雾更浓了。', false)`)
  await evalUntil(page, bodyHas('未保存'), Boolean, 10000, '文档变脏')
  await page.eval(clickBtn('保存'))
  await evalUntil(page, bodyHas('拦截 3 条'), Boolean, 20000, '守卫浮条出现')

  // ① 宽窗 1600：证据全文可见（未截断、单行）
  let s = await evalUntil(page, snapExpr, (x) => x && x.pill && x.span, 10000, '浮条快照（1600）')
  console.log('W1600:', JSON.stringify({ w: s.winW, pill: s.pill, span: s.span, full: s.fullVisible.slice(0, 20) }))
  ok('① 宽窗 1600：浮条单行（span 高 ≤20）', s.span.oneLine, JSON.stringify(s.span.h))
  ok('① 宽窗 1600：证据全文未截断（scrollWidth==clientWidth）', !s.span.truncated, `${s.span.w}`)
  ok('① 宽窗 1600：证据全文与 title 一致', s.span.title === FULL && s.fullVisible === FULL)
  ok('① 宽窗 1600：守卫按钮完整在浮条内', s.btn && s.btn.r <= s.pill.r + 1, JSON.stringify(s.btn))
  ok('① 宽窗 1600：浮条右锚点 right-24（=编辑器右缘-96±4）', Math.abs(s.pill.r - (s.editor.r - 96)) <= 4, `${s.pill.r} vs ${s.editor.r - 96}`)

  // ② 窄窗 1000：章节列折叠 + 浮条单行、不越左界、守卫在浮条内
  await setSize(page, 1000, 700)
  s = await evalUntil(page, snapExpr, (x) => x && x.toggle === true && x.pill && x.span, 10000, '窄窗折叠快照')
  console.log('N1000:', JSON.stringify({ w: s.winW, pill: s.pill, editor: s.editor, span: s.span }))
  ok('② 窄窗 1000：章节列已折叠（入口条出现）', s.toggle === true)
  ok('② 窄窗 1000：浮条单行', s.span.oneLine, JSON.stringify(s.span.h))
  ok('② 窄窗 1000：浮条不越编辑器左界', s.pill.x >= s.editor.x - 1, `${s.pill.x} vs ${s.editor.x}`)
  ok('② 窄窗 1000：守卫按钮完整在浮条内', s.btn && s.btn.r <= s.pill.r + 1, JSON.stringify(s.btn))
  ok('② 窄窗 1000：证据 title=全文（hover 可达）', s.span.title === FULL, s.span.title.slice(0, 30) + '…')
  ok('② 窄窗 1000：证据 span 可接收鼠标（pointer-events:auto）', s.span.pe === 'auto', s.span.pe)

  // 截图：窄窗折叠态（证据×守卫并存）
  const p1 = await shot(page, 'evidence-guard-narrow')
  console.log('SCREENSHOT:', p1)

  // ③ 窄窗 900（最小保护档）：依旧单行、守卫在浮条内
  await setSize(page, 900, 700)
  s = await evalUntil(page, snapExpr, (x) => x && x.toggle === true && x.pill && x.span, 10000, '900 快照')
  console.log('N900:', JSON.stringify({ w: s.winW, pill: s.pill, editor: s.editor, span: s.span }))
  ok('③ 窄窗 900：浮条单行且不越左界', s.span.oneLine && s.pill.x >= s.editor.x - 1, `${s.pill.x}/${s.editor.x}`)
  ok('③ 窄窗 900：守卫按钮完整在浮条内', s.btn && s.btn.r <= s.pill.r + 1, JSON.stringify(s.btn))

  // ④ 等浮条自然清（6s）后重触发同步，回 1280 默认三栏复核（单行、按钮在）
  await evalUntil(page, `!document.body.innerText.includes('拦截 3 条')`, (v) => v === true, 15000, '浮条清除')
  await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('冒烟追加：雾再浓一层。', false)`)
  await evalUntil(page, bodyHas('未保存'), Boolean, 10000, '文档再变脏')
  await page.eval(clickBtn('保存'))
  await evalUntil(page, bodyHas('拦截 3 条'), Boolean, 20000, '守卫浮条再现')
  await setSize(page, 1280, 800)
  s = await evalUntil(page, snapExpr, (x) => x && x.pill && x.span, 10000, '1280 快照')
  ok('④ 回 1280：浮条单行、守卫按钮在浮条内', s.span.oneLine && s.btn && s.btn.r <= s.pill.r + 1, JSON.stringify({ h: s.span.h, b: s.btn }))

  ok('⑤ 全程无 JS 异常', page.errors.length === 0, String(page.errors.slice(0, 2)))
  console.log(fails === 0 ? '\nALL PASS' : `\nFAIL: ${fails}`)
} catch (e) {
  fatal = e
  console.error('FATAL: ' + (e && e.message ? e.message : String(e)))
} finally {
  page.close()
  process.exit(fatal || fails > 0 ? 1 : 0)
}
