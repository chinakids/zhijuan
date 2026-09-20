// 体验层 2026-09-20 23:15 轮 · 时间线页 HIG 整页走查收口冒烟：
// A.「打开正文」携带 ?ch= 章定位（点击直达对应章，不再空选）
// B. 筛选 chips ARIA tabs 键盘（roving tabindex + ←/→/Home/End 移动即选中）
// 用法：node scripts/timeline-nav-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；无头 Chrome CDP 127.0.0.1:9224
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.env.HOME + '/Pictures/zhijuan'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cb = Date.now()
let fails = 0
function ok(name, cond, detail = '') {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + String(detail).slice(0, 160) : ''))
  if (!cond) fails++
}

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
    } catch { /* retry */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}
async function shot(page, name) {
  mkdirSync(OUT, { recursive: true })
  const hh = String(new Date().getHours()).padStart(2, '0')
  const mm = String(new Date().getMinutes()).padStart(2, '0')
  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const p = OUT + '/' + name + '-' + hh + mm + '.png'
  writeFileSync(p, Buffer.from(s.data, 'base64'))
  console.log('SCREENSHOT:', p)
}

// ---------- ① 打开正文 ?ch= 章定位 ----------
const tab1 = await openTab(BASE + '/#/project/demo-multiline/timeline?cb=' + cb)
const p1 = await attach(tab1.webSocketDebuggerUrl)
await evalUntil(p1, "document.body.innerText.includes('按线分组')", (v) => v === true, 20000, '多线时间线加载')

const linkInfo = await p1.eval(`(() => {
  const lis = [...document.querySelectorAll('ol li')]
  const a = lis[1].querySelector('a')
  return { href: a.getAttribute('href'), label: a.textContent.trim(), sliceChapter: lis[1].querySelector('p.mt-0\\\\.5')?.textContent.trim() ?? null }
})()`)
ok('链接携带 ?ch= 章定位', /novel\?ch=/.test(linkInfo.href), linkInfo.href)
ok('链接编码对应切片章节文件名', linkInfo.href.includes(encodeURIComponent('第03章_灯塔.md')), linkInfo.href)
ok('链接文本仍为「打开正文」', linkInfo.label === '打开正文', linkInfo.label)

// 点击 → Novel 页选中该章
await p1.eval(`(() => { [...document.querySelectorAll('ol li')][1].querySelector('a').click(); return true })()`)
await evalUntil(p1, "location.hash.includes('/novel')", (v) => v === true, 15000, '跳转 novel')
await evalUntil(
  p1,
  "[...document.querySelectorAll('.zj-md, .ProseMirror')].map((e)=>e.innerText).join(' ') || ''",
  (v) => v.includes('灯塔'),
  20000,
  'ch 定位打开对应章'
)
const novelSel = await p1.eval(`(() => {
  const selBtn = [...document.querySelectorAll('button')].find((b) => b.className.includes('bg-accent-soft'))
  const emptyHint = document.body.innerText.includes('选择左侧')
  return { selText: selBtn ? selBtn.textContent.trim().slice(0, 30) : null, emptyHint, hash: location.hash }
})()`)
ok('点击后 Novel 选中被点的章（非空选）', !!novelSel.selText && !novelSel.emptyHint && novelSel.selText.includes('灯塔'), JSON.stringify(novelSel))
ok('?ch= 参数消费后清空（无残留）', novelSel.hash === '#/project/demo-multiline/novel', novelSel.hash)
await shot(p1, 'timeline-open-chapter')

// 回时间线页（同页导航，缓存破坏参数）→ ② 筛选 chips 键盘
await p1.cmd('Page.navigate', { url: BASE + '/?cb=' + (cb + 5) + '#/project/demo-multiline/timeline' })
await evalUntil(p1, "document.querySelectorAll('[role=tab]').length > 0", (v) => v === true, 20000, '时间线重载')

// ---------- ② 筛选 chips 键盘（roving tabindex + 箭头） ----------
// 注意：setFilter 是 React 异步状态——派发与读取必须分 eval（先 dispatch，sleep 后读），否则读到上一帧旧值。
const readKb = async () =>
  await p1.eval(`(() => ({
    active: document.activeElement && document.activeElement.getAttribute('data-line'),
    selAfter: [...document.querySelectorAll('[role=tab]')].find((t) => t.getAttribute('aria-selected') === 'true')?.getAttribute('data-line') ?? null,
    heads: [...document.querySelectorAll('[data-testid=timeline-line-head]')].map((h) => h.textContent.trim())
  }))()`)
const pressKey = (key) =>
  p1.eval(`(() => {
    const sel = [...document.querySelectorAll('[role=tab]')].find((t) => t.getAttribute('aria-selected') === 'true')
    if (!sel) return false
    sel.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true, cancelable: true }))
    return true
  })()`)

const kb0 = await p1.eval(`(() => {
  const tabs = [...document.querySelectorAll('[role=tab]')]
  return tabs.map((t) => ({ line: t.getAttribute('data-line'), ti: t.getAttribute('tabindex'), sel: t.getAttribute('aria-selected') }))
})()`)
ok('roving tabindex：仅「全部」tabIndex=0', kb0[0].ti === '0' && kb0.slice(1).every((x) => x.ti === '-1'), JSON.stringify(kb0))

await pressKey('ArrowRight')
await sleep(250)
let kbs = await readKb()
ok('ArrowRight：焦点移到「主线」并选中', kbs.active === '主线' && kbs.selAfter === '主线', JSON.stringify(kbs))

await pressKey('ArrowRight')
await sleep(250)
kbs = await readKb()
ok('ArrowRight 再按：焦点移到「过去线」并选中', kbs.active === '过去线' && kbs.selAfter === '过去线', JSON.stringify(kbs))

await pressKey('ArrowRight')
await sleep(250)
kbs = await readKb()
ok('ArrowRight 循环回「全部」', kbs.active === '__all__' && kbs.selAfter === '__all__', JSON.stringify(kbs))

await pressKey('ArrowLeft')
await sleep(250)
kbs = await readKb()
ok('ArrowLeft 反向移动到「过去线」', kbs.active === '过去线' && kbs.selAfter === '过去线', JSON.stringify(kbs))

await pressKey('Home')
await sleep(250)
kbs = await readKb()
ok('Home 回「全部」', kbs.active === '__all__' && kbs.selAfter === '__all__', JSON.stringify(kbs))

await pressKey('End')
await sleep(250)
kbs = await readKb()
ok('End 到「过去线」并过滤生效', kbs.active === '过去线' && kbs.selAfter === '过去线' && kbs.heads.length === 1 && kbs.heads[0] === '过去线', JSON.stringify(kbs))

// 其他键不拦截（如 Escape/字母）
const kb7 = await p1.eval(`(() => {
  const sel = [...document.querySelectorAll('[role=tab]')].find((t) => t.getAttribute('aria-selected') === 'true')
  sel.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', bubbles: true, cancelable: true }))
  return document.activeElement === sel
})()`)
ok('无关键不改变选中', kb7 === true)

// ---------- ③ 回归：aria-selected / 组头 / 徽标 仍在 ----------
const reg = await p1.eval(`(() => ({
  tabCount: document.querySelectorAll('[role=tab]').length,
  badgeCount: [...document.querySelectorAll('section span')].filter((s) => s.textContent === '主线' || s.textContent === '过去线').length,
  sectionCount: document.querySelectorAll('section[aria-label^="时间线："]').length
}))()`)
ok('筛选 chips 数量 3（全部+两线）', reg.tabCount === 3, reg.tabCount)
ok('过滤态仅 1 组、切片卡在列（含徽标）', reg.sectionCount === 1 && reg.badgeCount >= 1, JSON.stringify(reg))
ok('零 JS 异常（双通道）', p1.errors.length === 0, JSON.stringify(p1.errors?.slice(0, 3)))

await shot(p1, 'timeline-kbd-filter')
p1.close()
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL`)
process.exit(fails === 0 ? 0 : 1)
