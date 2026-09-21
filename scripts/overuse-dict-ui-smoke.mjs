// 织卷无头冒烟 · 设置页「自定义用词词表」UI（体验层 2026-09-21 轮；智能层数据链 c5242ed 移交接线）
// 覆盖：① 外观与数据区出现词表卡 + 空态；② 添加（按钮+Enter）即时写盘 settings.overuseDict；③ 重复添加提示不重复入表；
//       ④ Enter 提交带 IME 组合守卫（composition 态不误加）；⑤ 删除词条；⑥ 导入 .txt（合并+去重+清洗，devShim 样例行含脏行）；
//       ⑦ 导出 .txt；⑧ 清空回空态；⑨ 零 JS 异常（双通道）。
// 用法：node scripts/overuse-dict-ui-smoke.mjs [base]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.argv[2] || 'http://127.0.0.1:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const watchdog = setTimeout(() => { console.log('!! WATCHDOG 240s'); process.exit(2) }, 240000)

async function newTab(url) {
  const r = await fetch(CDP + '/json/new?url=' + encodeURIComponent(url), { method: 'PUT' })
  if (!r.ok) throw new Error('newTab ' + r.status)
  return r.json()
}
function connect(wsUrl) {
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
  return new Promise((res, rej) => { ws.onerror = rej; ws.onopen = async () => { await cmd('Runtime.enable'); res({ ws, cmd, errors }) } })
}

let pass = 0
let fail = 0
const fatal = { e: null }
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓', name, extra) }
  else { fail++; console.log('  ✗', name, extra) }
}

async function setup(query, hash) {
  const tab = await newTab('about:blank')
  const { ws, cmd, errors } = await connect(tab.webSocketDebuggerUrl)
  await cmd('Page.enable')
  await cmd('Page.bringToFront')
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
  await cmd('Page.navigate', { url: `${BASE}/?cb=ovdict${Date.now()}${query ? `&${query}` : ''}${hash ?? ''}` })
  return { ws, cmd, errors }
}
async function ev(cmd, expression) {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)))
  return r.result?.value
}
async function evUntil(cmd, expression, pred, timeout = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = await ev(cmd, expression)
    if (pred ? pred(v) : v) return v
    await sleep(500)
  }
  throw new Error('timeout: ' + expression)
}
async function clickText(cmd, text) {
  const p = await ev(cmd, `(() => {
    const els = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim().includes(${JSON.stringify(text)}))
    const el = els[0]
    if (!el) return null
    const rr = el.getBoundingClientRect()
    return { x: rr.x + rr.width / 2, y: rr.y + rr.height / 2 }
  })()`)
  if (!p) throw new Error('clickText not found: ' + text)
  await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
  await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 })
}
const typeInto = (cmd, sel, v) => ev(cmd, `(() => {
  const i = document.querySelector(${JSON.stringify(sel)}); if (!i) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(i, ${JSON.stringify(v)})
  i.dispatchEvent(new Event('input', { bubbles: true }))
  i.focus()
  return true
})()`)
const pressEnter = (cmd) =>
  cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 })
const listOf = (cmd) => ev(cmd, `(() => {
  const h = [...document.querySelectorAll('h3')].find((x) => x.textContent === '自定义用词词表')
  if (!h) return null
  const card = h.parentElement
  return [...card.querySelectorAll('li span')].map((s) => s.textContent)
})()`)
const msgOf = (cmd) => ev(cmd, `document.querySelector('[role="status"]')?.textContent ?? ''`)
const settingsDict = (cmd) => ev(cmd, `window.zhijuan.getSettings().then(s => s.overuseDict ?? null)`)
const shot = async (cmd, name) => {
  try {
    const { data } = await cmd('Page.captureScreenshot', { format: 'png' })
    const d = new Date()
    const hhmm = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0')
    const f = path.join(os.homedir(), 'Pictures', 'zhijuan', `${name}-${hhmm}.png`)
    fs.writeFileSync(f, Buffer.from(data, 'base64'))
    console.log('  截图 →', f)
  } catch (e) { console.log('  截图失败', e.message) }
}

try {
  console.log('== Tab A：自定义用词词表 =设置页=')
  const A = await setup('', '#/settings')
  const { cmd: ca, errors: ea } = A
  await evUntil(ca, `document.body.innerText.includes('保存设置')`, Boolean, 40000)
  await sleep(800)
  await clickText(ca, '外观与数据')
  await evUntil(ca, `document.body.innerText.includes('自定义用词词表')`, Boolean)
  await sleep(400)

  // ① 卡片与空态
  check('词表卡出现（h3 自定义用词词表）', (await ev(ca, `[...document.querySelectorAll('h3')].some((h) => h.textContent === '自定义用词词表')`)) === true)
  check('空态文案「还没有自定义短语」', (await ev(ca, `document.body.innerText.includes('还没有自定义短语')`)) === true)
  const expDisabled = await ev(ca, `([...document.querySelectorAll('button')].find((b) => b.textContent.includes('导出 .txt')) ?? { disabled: 'missing' }).disabled`)
  check('导出按钮空表时禁用', expDisabled === true, String(expDisabled))

  // ② 逐条添加（按钮）
  await typeInto(ca, 'input[placeholder="输入短语，如：整个人"]', '整个人')
  await sleep(200)
  await clickText(ca, '添加')
  await evUntil(ca, `window.zhijuan.getSettings().then(s => (s.overuseDict ?? []).includes('整个人'))`, Boolean)
  check('添加后即时写盘 overuseDict=[整个人]', JSON.stringify(await settingsDict(ca)) === JSON.stringify(['整个人']))
  check('列表渲染词条「整个人」', JSON.stringify(await listOf(ca)) === JSON.stringify(['整个人']))

  // ③ 重复添加：提示不重复入表
  await typeInto(ca, 'input[placeholder="输入短语，如：整个人"]', '整个人')
  await sleep(200)
  await clickText(ca, '添加')
  await sleep(400)
  check('重复添加提示「已在词表中」', (await msgOf(ca)).includes('已在词表中'))
  check('重复添加未重复入表', JSON.stringify(await listOf(ca)) === JSON.stringify(['整个人']))

  // ④ Enter 提交（正常态）
  await typeInto(ca, 'input[placeholder="输入短语，如：整个人"]', '缓缓地')
  await sleep(200)
  await pressEnter(ca)
  await evUntil(ca, `window.zhijuan.getSettings().then(s => (s.overuseDict ?? []).includes('缓缓地'))`, Boolean)
  check('Enter 提交新增「缓缓地」', JSON.stringify(await listOf(ca)) === JSON.stringify(['整个人', '缓缓地']))

  // ⑤ IME 组合态 Enter 不误加（composition 中 Enter=确认候选）
  await typeInto(ca, 'input[placeholder="输入短语，如：整个人"]', '')
  await ev(ca, `(() => { const i = document.querySelector('input[placeholder="输入短语，如：整个人"]'); i.focus(); return true })()`)
  await sleep(300)
  await ca('Input.imeSetComposition', { text: '情不自禁', selectionStart: 4, selectionEnd: 4 })
  await sleep(500)
  await pressEnter(ca)
  await sleep(600)
  check('IME 组合态 Enter 不添加', JSON.stringify(await listOf(ca)) === JSON.stringify(['整个人', '缓缓地']))
  await ca('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
  await sleep(300)

  // ⑥ 删除词条
  await ev(ca, `document.querySelector('button[aria-label="删除词条 缓缓地"]')?.click()`)
  await evUntil(ca, `window.zhijuan.getSettings().then(s => (s.overuseDict ?? []).length === 1)`, Boolean)
  check('删除后仅剩「整个人」', JSON.stringify(await listOf(ca)) === JSON.stringify(['整个人']))

  // ⑦ 导入 .txt（devShim 样例行含脏行/重复 → 合并+去重+清洗）
  await clickText(ca, '导入 .txt')
  await evUntil(ca, `document.querySelector('[role="status"]')?.textContent?.includes('已导入')`, Boolean)
  check('导入后列表=整个人/生死之交/定格（合并去重清洗）', JSON.stringify(await listOf(ca)) === JSON.stringify(['整个人', '生死之交', '定格']))
  check('导入后写盘口径一致', JSON.stringify(await settingsDict(ca)) === JSON.stringify(['整个人', '生死之交', '定格']))
  await shot(ca, 'overuse-dict-list')

  // ⑧ 导出 .txt
  await clickText(ca, '导出 .txt')
  await evUntil(ca, `document.querySelector('[role="status"]')?.textContent?.includes('已导出')`, Boolean)
  check('导出提示含条数与路径', (await msgOf(ca)).includes('已导出 3 条') && (await msgOf(ca)).includes('/tmp/用词词表.txt'))

  // ⑨ 清空
  await ev(ca, `document.querySelector('button[aria-label="清空词表"]')?.click()`)
  await evUntil(ca, `window.zhijuan.getSettings().then(s => (s.overuseDict ?? []).length === 0)`, Boolean)
  check('清空回空态文案', (await ev(ca, `document.body.innerText.includes('还没有自定义短语')`)) === true)
  await shot(ca, 'overuse-dict-empty')
  check('Tab A 零 JS 异常', ea.length === 0, ea.slice(0, 3).join(' | '))
  A.ws.close()
} catch (e) {
  fatal.e = e
  console.log('FATAL', e.message)
}
clearTimeout(watchdog)
console.log(`\nRESULT pass=${pass} fail=${fail}`)
if (fatal.e || fail > 0) process.exit(1)
process.exit(0)
