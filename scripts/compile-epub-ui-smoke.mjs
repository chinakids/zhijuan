// 首页作品编译 v1.2（EPUB 导出）· UI 冒烟（无头 Chrome CDP 9224 + devShim）
// 场景：首页卡片「更多操作」→「导出作品（EPUB）」→ devShim compileExportEpub 返回 ok+path+chapters
//       → toast「已导出 EPUB 作品」（含 _成品.epub 路径）出现；全程零 JS 异常。
// 前置：npm run build 已跑；serve-renderer（8123）在跑；Chrome CDP 127.0.0.1:9224 已启动。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8123'
const ID = 'epub' + Date.now()

const tab = await (await fetch(CDP + '/json/new?' + encodeURIComponent(BASE + '/?cb=' + ID), { method: 'PUT' })).json()
const ws = new WebSocket(tab.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.text ?? 'exception')
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push('console.error')
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT: ${method}`)) }, 10000)
    pending.set(id, (m) => { clearTimeout(to); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function evalJs(expression) {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 500))
  return r.result?.value
}
await new Promise((r) => (ws.onopen = r))
await cmd('Page.enable')
await cmd('Runtime.enable')
await cmd('Page.navigate', { url: BASE + '/?cb=' + ID + '#/' })
await sleep(2800)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (cond ? '' : ' | ' + extra))
  if (!cond) bad++
}

// [0] 首页渲染、出现演示项目（devShim 首个项目卡「余烬的灯」）
let ready = false
for (let i = 0; i < 20; i++) {
  ready = await evalJs(`document.body.innerText.includes('余烬的灯')`)
  if (ready) break
  await sleep(500)
}
check('首页项目卡已渲染（余烬的灯）', ready)

// [1] 打开「更多操作」菜单（Radix Trigger 在 pointerdown 打开，合成 click 不触发）
const opened = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button[aria-label="更多操作"]')]
  if (!btns.length) return 'no-btn'
  btns[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  return 'ok:' + btns.length
})()`)
check('点击更多操作按钮', String(opened).startsWith('ok:'), String(opened))
await sleep(600)

// [1.5] 展开「导出作品」子菜单（Radix Sub 由 pointermove 进入 trigger 打开；trigger 带 aria-haspopup=menu）
const subOpened = await evalJs(`(() => {
  const t = [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.innerText.includes('导出作品') && x.getAttribute('aria-haspopup') === 'menu')
  if (!t) return 'no-sub'
  for (const type of ['pointermove', 'pointerenter', 'mouseover']) t.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'mouse' }))
  return 'ok'
})()`)
check('展开导出作品子菜单', subOpened === 'ok', String(subOpened))
await sleep(500)

// [2] 子菜单同时出现三项：合并 Markdown（既有）/Word（既有）/EPUB（新增）
const mdItem = await evalJs(`[...document.querySelectorAll('[role="menuitem"], button')].some((x) => x.innerText.includes('导出作品（合并 Markdown）'))`)
const docxItem = await evalJs(`[...document.querySelectorAll('[role="menuitem"], button')].some((x) => x.innerText.includes('导出作品（Word）'))`)
const epubItem = await evalJs(`[...document.querySelectorAll('[role="menuitem"], button')].some((x) => x.innerText.includes('导出作品（EPUB）'))`)
check('菜单含「导出作品（合并 Markdown）」', mdItem === true)
check('菜单含「导出作品（Word）」', docxItem === true)
check('菜单含「导出作品（EPUB）」', epubItem === true)

// [3] 点击 EPUB 项 → devShim 返回 ok+path+chapters → toast「已导出 EPUB 作品」出现
const clicked = await evalJs(`(() => {
  const items = [...document.querySelectorAll('[role="menuitem"], button')]
  const b = items.find((x) => x.innerText.includes('导出作品（EPUB）'))
  if (!b) return 'no-item'
  b.click()
  return 'ok'
})()`)
check('点击导出作品（EPUB）项', clicked === 'ok', String(clicked))

let toastShown = ''
for (let i = 0; i < 20; i++) {
  toastShown = await evalJs(`[...document.querySelectorAll('[role="status"]')].map((x) => x.innerText).join('|')`)
  if (toastShown.includes('已导出 EPUB 作品')) break
  await sleep(500)
}
check('成功 toast「已导出 EPUB 作品」出现（含 _成品.epub 路径）', toastShown.includes('已导出 EPUB 作品') && toastShown.includes('_成品.epub'), toastShown)

await sleep(600)
check('全程零 JS 异常', errors.length === 0, String(errors.slice(0, 3)))

await fetch(CDP + '/json/close/' + tab.id)
ws.close()
console.log(bad === 0 ? 'SMOKE ALL PASS' : 'SMOKE FAIL ' + bad)
process.exit(bad === 0 ? 0 : 1)
