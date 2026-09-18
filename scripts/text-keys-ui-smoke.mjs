// 织卷 · mac 文本编辑键位（Cmd 系）· 无头 UI 冒烟 v3（体验层 2026-09-18）
// 驱动：页面内合成 KeyboardEvent（走 PM keymap 的 DOM keydown 链）+ ProseApi.setCursor 精确定位。
// 注入文本=每段恰一行（12 段短行）→ 行首=段首、行尾=段末，断言全部可构造。
// 用法：node scripts/text-keys-ui-smoke.mjs [base]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.argv[2] || 'http://127.0.0.1:8899'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const watchdog = setTimeout(() => { console.log('!! WATCHDOG 150s'); process.exit(2) }, 150000)

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

const tab = await newTab('about:blank')
const { ws, cmd, errors } = await connect(tab.webSocketDebuggerUrl)
await cmd('Page.enable')
await cmd('Emulation.setFocusEmulationEnabled', { enabled: true })
await cmd('Page.bringToFront')
await cmd('Page.navigate', { url: `${BASE}/?cb=textkeys${Date.now()}#/project/demo-aseya/novel` })
async function ev(expression) {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)))
  return r.result?.value
}
const shot = async (name) => {
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
  await sleep(5000)
  check('页面就绪（__ZJ_TEST）', await ev(`!!window.__ZJ_TEST`))
  await ev(`window.__clickChapter = (name) => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.innerText||'').includes(name))
    if (!btn) return false
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    btn.click()
    return true
  }`)
  const waitEditor = async (condExpr, ms = 6000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (await ev(condExpr)) return true
      await sleep(300)
    }
    return false
  }
  // 每段恰一行（短行）的中英混合文本；先覆盖为干净全文（防历史注入残留干扰 needle 唯一性）
  // 注意：不能 atob(base64) 传中文（UTF-8 base64 经 atob 解出 Latin-1 乱码）——直接 JSON.stringify 走 CDP Unicode 通道
  const CLEAN = '第1行。开篇一句。\n\n第2行。The quick fox jumps high over the gate。\n\n第3行。收束一句。'
  await ev(`window.__clickChapter('雾港')`)
  check('第01章编辑器挂载', await waitEditor(`(window.__ZJ_EDITORS||[]).length > 0 && !!document.querySelector('.ProseMirror') && !!window.__ZJ_SEL`))
  await ev(`(async () => { const r = await window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', ${JSON.stringify(CLEAN)}); return 'ok:' + r })()`)
  await sleep(1500)
  console.log('  [doc]', JSON.stringify((await ev(`window.__ZJ_EDITORS[0]?.getMarkdown()||''`)).slice(0, 120)))

  const press = (key, mods = {}) => ev(`(() => {
    const ed = document.querySelector('.ProseMirror'); if (!ed) return 'no-ed'
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true, cancelable: true, metaKey: ${!!mods.meta}, altKey: ${!!mods.alt}, shiftKey: ${!!mods.shift}, ctrlKey: ${!!mods.ctrl} }))
    return 'ok'
  })()`)
  const pressN = async (key, mods) => { await press(key, mods); await sleep(220) }
  const sel = () => ev(`window.__ZJ_SEL.get()`)
  const docLen = () => ev(`(document.querySelector('.ProseMirror').innerText||'').length`)
  const setCursor = async (needle) => {
    await ev(`window.__ZJ_EDITORS[0].setCursor(${JSON.stringify(needle)})`)
    await sleep(300)
    return sel()
  }

  // —— 1. 文档首/尾 ——
  const s1 = await setCursor('第2行')
  await pressN('ArrowUp', { meta: true })
  const sUp = await sel()
  check('Cmd+ArrowUp 到文档首（from=' + sUp.from + '===0）', sUp.from === 0, `(起=${s1.from})`)
  await pressN('ArrowDown', { meta: true })
  const sDown = await sel()
  const len = await docLen()
  check('Cmd+ArrowDown 到文档尾（from=' + sDown.from + ' ≥ ' + len + '*0.9）', sDown.from > len * 0.9)

  // —— 2. 行首（第2行=单行段，行首=段首=setCursor('第2行')位置）——
  const A = await setCursor('第2行')
  const B = await setCursor('quick')
  check('定位行中（B=' + B.from + ' > A=' + A.from + '）', B.from > A.from)
  await pressN('ArrowLeft', { meta: true })
  const C = await sel()
  check('Cmd+ArrowLeft 回行首（from=' + C.from + '===A=' + A.from + '）', C.from === A.from)
  await pressN('ArrowLeft', { meta: true })
  const C2 = await sel()
  check('行首再按幂等', C2.from === C.from)

  // —— 3. 行尾（单行段行尾=段末；以第3行起点为上界）——
  await setCursor('quick')
  await pressN('ArrowRight', { meta: true })
  const D = await sel()
  check('Cmd+ArrowRight 到行尾（from=' + D.from + '，>B 且 < 下一段起点）', D.from > B.from)
  await pressN('ArrowRight', { meta: true })
  const D2 = await sel()
  check('行尾再按幂等（from=' + D2.from + '===D=' + D.from + '）', D2.from === D.from)
  const E3 = await setCursor('第3行')
  check('行尾 < 下一段起点 ' + E3.from, D.from < E3.from)

  // —— 4. Shift+Cmd+← 扩选（anchor=B head=A）——
  await setCursor('quick')
  await pressN('ArrowLeft', { shift: true, meta: true })
  const X = await sel()
  check('Shift+Cmd+ArrowLeft 扩选整行（from=' + X.from + '===A, to=' + X.to + '===B）', X.from === A.from && X.to === B.from)

  // —— 5. Cmd+Backspace 删到行首（从 quick 位置删掉行首→quick 前文本）——
  await setCursor('quick')
  const lenPre = await docLen()
  await pressN('Backspace', { meta: true })
  const Y = await sel()
  const lenPost = await docLen()
  check('Cmd+Backspace 删到行首（from=' + Y.from + '===A=' + A.from + '，len -' + (lenPre - lenPost) + '）', Y.from === A.from && lenPost < lenPre)
  await pressN('Backspace', { meta: true })
  const Y2 = await sel()
  const lenPost2 = await docLen()
  check('行首再按幂等', Y2.from === Y.from && lenPost2 === lenPost)

  // —— 6. 普通 Arrow 键零回归：合成 KeyboardEvent 不触发 Blink 默认文本移动
  //    （isTrusted=false），普通键行为无法以此法验证——改验证「无 mods 键不误触发我们的 keymap」：
  await setCursor('第2行')
  const zBefore = await sel()
  await pressN('ArrowRight')
  const zAfter = await sel()
  check('合成普通 Arrow 不触发 keymap（位置不变=无副作用）', zAfter.from === zBefore.from)

  // —— 截图（扩选高亮）——
  await setCursor('quick')
  await pressN('ArrowLeft', { shift: true, meta: true })
  await sleep(300)
  await shot('text-keys-extend')
} catch (e) {
  fatal.e = e
  console.log('  !! EXCEPTION', e.message)
} finally {
  clearTimeout(watchdog)
  console.log(`\ntext-keys-ui-smoke: ${pass} pass / ${fail} fail${fatal.e ? ' (EXC)' : ''}`)
  try { ws.close() } catch { /* noop */ }
  if (errors.length) { fail++; console.log('  ✗ 无 JS 异常: ' + errors.slice(0, 3).join(' | ')) }
  else { console.log('  ✓ 无 JS 异常') }
  process.exit(fail > 0 || fatal.e ? 1 : 0)
}
