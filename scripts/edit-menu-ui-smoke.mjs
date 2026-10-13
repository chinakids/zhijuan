// 织卷无头冒烟 · 输入面文本编辑右键菜单（HIG Context menus「Support context menus consistently throughout your app」）
// 用法：node scripts/edit-menu-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 输入框右键出编辑菜单（剪切/复制/粘贴/全选四项）；② 无选区→剪切/复制置灰、全选可用；
//         ③ 剪贴板空→粘贴置灰、有内容→可用；④ 全选真选全文；⑤ 复制真写系统剪贴板；
//         ⑥ 粘贴真插入文本（React 受控同步）；⑦ 剪切真删文本；⑧ 空输入→全选置灰；
//         ⑨ Prose 编辑器内右键不弹本菜单（归编辑器菜单）；⑩ 零 JS 异常。
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

async function grantClipboard() {
  try {
    const v = await (await fetch(CDP + '/json/version')).json()
    const ws = new WebSocket(v.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.onopen = () => res()
      ws.onerror = () => rej(new Error('browser ws error'))
    })
    ws.send(JSON.stringify({ id: 1, method: 'Browser.grantPermissions', params: { origin: BASE, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] } }))
    await sleep(600)
    ws.onmessage = null
  } catch (e) {
    console.log('grantClipboard WARN:', String(e).slice(0, 120))
  }
}

async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}

async function focusPage(page, tab) {
  try { await fetch(CDP + '/json/activate/' + tab.id) } catch {}
  try { await page.cmd('Page.bringToFront').catch(() => {}) } catch {}
  try { await page.eval('window.focus(); true') } catch {}
}

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

// —— 工具：trusted 鼠标点击/右键（CDP 输入事件带 user activation）——
async function mouse(page, x, y, button = 'left', clickCount = 1) {
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount })
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount })
  await sleep(120)
}

const MENU = '[data-testid="input-edit-menu"]'
const itemState = (label) =>
  `(() => { const it = [...document.querySelectorAll('${MENU} [role="menuitem"]')].find(el => el.textContent.trim() === '${label}'); if (!it) return 'MISSING'; return it.getAttribute('aria-disabled') === 'true' ? 'disabled' : 'enabled' })()`

await grantClipboard()
await sleep(400)

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
await page.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
await page.cmd('Runtime.enable')
await focusPage(page, tab)

// 就绪 & 找到输入框
await evalUntil(page, `(() => { const ta = document.querySelector('textarea[placeholder="让 agent 做什么…"]'); return ta ? true : false })()`, (v) => v === true, 25000, 'Agent 输入框就绪')
console.log('PASS | 页面就绪（devShim Agent 输入框存在）')

const setValue = async (v) => {
  await page.eval(`(() => {
    const ta = document.querySelector('textarea[placeholder="让 agent 做什么…"]')
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    set.call(ta, ${JSON.stringify(v)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return ta.value
  })()`)
  await sleep(250)
}
const rightClickTA = async () => {
  const b = await page.eval(`(() => { const r = document.querySelector('textarea[placeholder="让 agent 做什么…"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), x2: Math.round(r.x + r.width / 2 + 6) } })()`)
  await mouse(page, b.x, b.y, 'right')
  return b
}

// ① 初始点击（激活+聚焦，给剪贴板激活权限）
await mouse(page, 1000, 745, 'left')

// ② 设值 + 清空剪贴板（写 '' 需要激活；本步在 trusted 点击后）
await setValue('甲乙丙丁')
await page.eval(`navigator.clipboard.writeText('').catch(() => {})`)
await sleep(300)

// ③ 无选区右键 → 菜单出现 + 位置
const pos = await rightClickTA()
await evalUntil(page, `!!document.querySelector('${MENU}')`, (v) => v === true, 8000, '菜单出现')
ok('菜单出现（无选区右键）', true)
const menuBox = await page.eval(`(() => { const r = document.querySelector('${MENU}').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })()`)
ok('菜单位置贴近右键点', Math.abs(menuBox.x - pos.x) < 40 && menuBox.y <= pos.y + 10 && menuBox.y >= pos.y - 160 && menuBox.y + menuBox.h <= 802, JSON.stringify({ menu: menuBox, pos }))
ok('菜单四项且无分组', (await page.eval(`document.querySelectorAll('${MENU} [role="menuitem"]').length`)) === 4)
ok('菜单项带图标（与 Prose 编辑菜单一致）', (await page.eval(`(() => { const items = [...document.querySelectorAll('${MENU} [role="menuitem"]')]; return items.every(it => !!it.querySelector('svg')) })()`)) === true)
ok('无选区 → 剪切置灰', (await page.eval(itemState('剪切'))) === 'disabled')
ok('无选区 → 复制置灰', (await page.eval(itemState('复制'))) === 'disabled')
// ④ 剪贴板空 → 粘贴置灰（异步读剪贴板）
await evalUntil(page, itemState('粘贴'), (v) => v === 'disabled', 8000, '粘贴置灰（剪贴板空）')
ok('剪贴板空 → 粘贴置灰', true)
ok('有内容 → 全选可用', (await page.eval(itemState('全选'))) === 'enabled')

// ⑤ 全选
const clickItem = async (label) => {
  const c = await page.eval(`(() => { const it = [...document.querySelectorAll('${MENU} [role="menuitem"]')].find(el => el.textContent.trim() === '${label}'); if (!it) return null; const r = it.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`)
  if (!c) throw new Error('item not found: ' + label)
  await mouse(page, c.x, c.y, 'left')
}
await clickItem('全选')
await sleep(300)
ok('全选真选全文', (await page.eval(`(() => { const ta = document.querySelector('textarea[placeholder="让 agent 做什么…"]'); return ta.selectionStart === 0 && ta.selectionEnd === ta.value.length })()`)) === true)
ok('菜单已关闭', (await page.eval(`!!document.querySelector('${MENU}')`)) === false)

// ⑥ 有选区右键 → 剪切/复制可用 → 复制真写剪贴板
await rightClickTA()
await evalUntil(page, `!!document.querySelector('${MENU}')`, (v) => v === true, 8000, '菜单再次出现')
ok('有选区 → 剪切可用', (await page.eval(itemState('剪切'))) === 'enabled')
ok('有选区 → 复制可用', (await page.eval(itemState('复制'))) === 'enabled')
await clickItem('复制')
await sleep(400)
const copied = await page.eval(`navigator.clipboard.readText().catch(e => 'ERR:' + e.message)`)
ok('复制真写入剪贴板', copied === '甲乙丙丁', 'got=' + JSON.stringify(copied))

// ⑦ 粘贴：写有内容 → 可用 → 真插入（当前选区=全选，粘贴应替换全文）
await page.eval(`navigator.clipboard.writeText('⟩粘贴内容XYZ⟨').catch(() => {})`)
await sleep(300)
await rightClickTA()
await evalUntil(page, `!!document.querySelector('${MENU}')`, (v) => v === true, 8000, '菜单第三次出现')
ok('剪贴板有内容 → 粘贴可用', (await page.eval(itemState('粘贴'))) === 'enabled')
await clickItem('粘贴')
await sleep(400)
const pasted = await page.eval(`document.querySelector('textarea[placeholder="让 agent 做什么…"]')?.value ?? ''`)
ok('粘贴真插入文本', pasted === '⟩粘贴内容XYZ⟨', 'got=' + JSON.stringify(pasted))

// ⑧ 剪切：全选→剪切→清空
await page.eval(`document.querySelector('textarea[placeholder="让 agent 做什么…"]').select()`)
await sleep(200)
await rightClickTA()
await evalUntil(page, `!!document.querySelector('${MENU}')`, (v) => v === true, 8000, '菜单第四次出现')
await clickItem('剪切')
await sleep(400)
const cutted = await page.eval(`document.querySelector('textarea[placeholder="让 agent 做什么…"]')?.value ?? ''`)
ok('剪切真删文本', cutted === '', 'got=' + JSON.stringify(cutted))

// ⑨ 空输入 → 全选置灰
await setValue('')
await rightClickTA()
await evalUntil(page, `!!document.querySelector('${MENU}')`, (v) => v === true, 8000, '菜单第五次出现')
ok('空输入 → 全选置灰', (await page.eval(itemState('全选'))) === 'disabled')
// Esc 关闭
await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(300)
ok('Esc 关闭菜单', (await page.eval(`!!document.querySelector('${MENU}')`)) === false)

// ⑩ 右键非文本域 → 不弹本菜单（侧栏章节区域）
await mouse(page, 300, 300, 'right')
await sleep(500)
ok('右键侧栏空白不弹本菜单', (await page.eval(`!!document.querySelector('${MENU}')`)) === false)

// ⑪ Prose 编辑器内右键 → 不弹本菜单（需先选中章节挂载编辑器）
await page.eval(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('第1章') && b.textContent.includes('雾港第一幕')); if (btn) btn.click(); return !!btn })()`)
await sleep(900)
await evalUntil(page, `!!document.querySelector('.ProseMirror')`, (v) => v === true, 15000, '编辑器挂载')
const pm = await page.eval(`(() => { const r = document.querySelector('.ProseMirror').getBoundingClientRect(); return { x: Math.round(r.x + 60), y: Math.round(r.y + 40) } })()`)
await mouse(page, pm.x, pm.y, 'right')
await sleep(500)
ok('Prose 内右键不弹输入菜单', (await page.eval(`!!document.querySelector('${MENU}')`)) === false)

// ⑫ 零 JS 异常
ok('零 JS 异常', page.errors.length === 0, page.errors.slice(0, 3).join(' ;; '))

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES')
wsCleanup(page, tab)

function wsCleanup(page, tab) {
  page.close()
  fetch(CDP + '/json/close/' + tab.id).catch(() => {})
}
process.exit(fails === 0 ? 0 : 1)
