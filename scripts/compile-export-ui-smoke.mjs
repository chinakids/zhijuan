// 首页作品编译（合并导出）·UI 冒烟（无头 Chrome CDP 9224 + devShim）
// 场景：首页卡片「更多操作」→「导出作品（合并 Markdown）」→ devShim compileExport 返回 ok+path+chapters → toast「已导出作品」出现。
// 前置：npm run build 已跑；serve-renderer（8123）在跑；Chrome CDP 127.0.0.1:9224 已启动。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8123'
const ID = 'comp' + Date.now()

const tab = await (await fetch(CDP + '/json/new?' + encodeURIComponent(BASE + '/?cb=' + ID), { method: 'PUT' })).json()
const ws = new WebSocket(tab.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
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

// [2] 菜单出现「导出作品（合并 Markdown）」项
const itemShown = await evalJs(`(() => {
  const items = [...document.querySelectorAll('[role="menuitem"], button')]
  return items.some((x) => x.innerText.includes('导出作品（合并 Markdown）'))
})()`)
check('菜单含「导出作品（合并 Markdown）」', itemShown === true)

// [3] 点击 → devShim 返回 ok+path+chapters → toast「已导出作品」出现
const clicked = await evalJs(`(() => {
  const items = [...document.querySelectorAll('[role="menuitem"], button')]
  const b = items.find((x) => x.innerText.includes('导出作品（合并 Markdown）'))
  if (!b) return 'no-item'
  b.click()
  return 'ok'
})()`)
check('点击导出作品项', clicked === 'ok', String(clicked))

let toastShown = ''
for (let i = 0; i < 20; i++) {
  toastShown = await evalJs(`(() => {
    const t = [...document.querySelectorAll('[role="status"]')].map((x) => x.innerText).join('|')
    return t
  })()`)
  if (toastShown.includes('已导出作品')) break
  await sleep(500)
}
check('成功 toast「已导出作品」出现（含成品路径）', toastShown.includes('已导出作品') && toastShown.includes('_成品.md'), toastShown)

await fetch(CDP + '/json/close/' + tab.id)
ws.close()
console.log(bad === 0 ? 'SMOKE ALL PASS' : 'SMOKE FAIL ' + bad)
process.exit(bad === 0 ? 0 : 1)
