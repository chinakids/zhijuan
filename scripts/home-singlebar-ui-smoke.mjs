// 织卷无头冒烟 · 首页单一顶栏（体验层 2026-09-14 顶栏合并）
// 验收：① WindowChrome 题名槽显示「项目库」且全页仅一处品牌行；
//       ② Home 原 header（「织」LOGO/「小说创作工作台」）已移除；
//       ③ 「导入目录」「新建项目」上移至内容区工具条（与搜索框同一行，窄窗不换行）；
//       ④ 卡片时间戳只显示日期（YYYY/M/D，无秒）；
//       ⑤ 1200×800 与 1000×700 两档截图落 ~/Pictures/zhijuan/。
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const SPA = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8899'

// 新建 tab（/json/new 必须用 PUT）
const r = await fetch(`${CDP}/json/new?${encodeURIComponent(`${SPA}/#/?cb=${Date.now()}`)}`, { method: 'PUT' })
const target = await r.json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
await new Promise((res) => (ws.onopen = res))
await cmd('Page.enable')

async function evalUntil(expr, pred, timeout = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true })
    const v = r.result?.value
    if (pred ? pred(v) : v) return v
    await sleep(600)
  }
  throw new Error('timeout: ' + expr)
}
async function evalJs(expr) {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true })
  if (r.exceptionDetails) throw new Error('eval ex: ' + JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
async function shot(name, w, h) {
  await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false })
  await sleep(400)
  const s = await cmd('Page.captureScreenshot', { format: 'png' })
  const dir = process.env.HOME + '/Pictures/zhijuan'
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/${name}.png`, Buffer.from(s.data, 'base64'))
  console.log('SHOT', `${dir}/${name}.png`)
}

let fails = 0
const ok = (m) => console.log('ok  -', m)
const bad = (m, extra) => {
  fails++
  console.log('BAD -', m, extra ?? '')
}

// —— 等 Home 渲染 ——
await evalUntil(`document.body.innerText.includes('项目库')`, Boolean)
await sleep(800)

// ① WindowChrome 题名「项目库」+ 品牌仅一份
const chrome = await evalJs(`(() => {
  const el = document.querySelector('.window-chrome')
  return el ? { text: el.innerText, h1s: [...document.querySelectorAll('h1')].map(x => x.innerText) } : null
})()`)
if (chrome && chrome.text.includes('项目库')) ok('① WindowChrome 题名槽显示「项目库」')
else bad('① 题名槽「项目库」', JSON.stringify(chrome))
if (chrome && !chrome.h1s.some((t) => t.includes('织卷'))) ok('② 无 h1「织卷」品牌题头（Home header 已移除）')
else bad('② h1 含「织卷」', JSON.stringify(chrome?.h1s))
const wcBrand = await evalJs(`document.querySelectorAll('.window-chrome').length`)
if (wcBrand === 1) ok('① 顶栏单一条（window-chrome 仅 1 个）')
else bad('① window-chrome 数量', wcBrand)

// ② 「小说创作工作台」不再出现在首页
const slog = await evalJs(`document.body.innerText.includes('小说创作工作台')`)
if (!slog) ok('② 首页无「小说创作工作台」副标题（原 header 已整体移除）')
else bad('② 仍有副标题')

// ③ 按钮与搜索框同排（工具条）
const row = await evalJs(`(() => {
  const inp = document.querySelector('[data-testid="home-search"]')
  const imp = document.querySelector('[data-testid="home-import-dir"]')
  const np = document.querySelector('[data-testid="home-new-project"]')
  if (!inp || !imp || !np) return { missing: true, inp: !!inp, imp: !!imp, np: !!np }
  const a = inp.getBoundingClientRect(), b = imp.getBoundingClientRect(), c = np.getBoundingClientRect()
  const overlap = (x, y) => y.top < x.bottom && y.bottom > x.top
  return { sameRow: overlap(a, b) && overlap(a, c), tops: [a.top | 0, b.top | 0, c.top | 0], right: np.right, win: innerWidth }
})()`)
if (row.missing) bad('③ 工具条按钮缺失', JSON.stringify(row))
else if (row.sameRow) ok(`③ 导入/新建与搜索框同行（tops=${row.tops.join('/')}，窗口宽 ${row.win}）`)
else bad('③ 按钮未与搜索框同行', JSON.stringify(row))

// ④ 卡片时间戳只留日期（无秒）
const homeText = await evalJs(`document.body.innerText`)
const cardLine = (homeText ?? '').split('\n').find((l) => l.includes('最近：'))
if (cardLine && /·\s*\d{4}\/\d{1,2}\/\d{1,2}$/.test(cardLine)) ok('④ 卡片时间戳仅日期：' + cardLine.trim())
else bad('④ 时间戳格式异常：' + (cardLine ?? '（无「最近：」行）'))

// ⑤ 截图两档
await shot('home-singlebar-1150', 1200, 800)
await shot('home-narrow-1150', 1000, 700)
console.log(fails === 0 ? 'ALL PASS' : `FAILS=${fails}`)
ws.close()
process.exit(fails === 0 ? 0 : 1)
