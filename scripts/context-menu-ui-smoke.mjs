// 织卷无头冒烟 · 正文右键菜单 + 划词浮层（Apple HIG Context menus 第一批）
// 用法：node scripts/context-menu-ui-smoke.mjs
// 前置：npm run build；python3 -m http.server 8123 --directory out/renderer；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 划词浮层含「复制」「添加到对话」且复制真写入剪贴板；
//         ② 正文右键菜单出现：有选区=剪切/复制/粘贴/全选/添加到对话（2组），无选区=仅粘贴/全选；
//         ③ 剪切真删文本且剪贴板=选中；④ 全选真选全文；⑤ 添加到对话真进 agent 引用条；
//         ⑥ 钻进菜单无 JS 异常 + 两主题截图存档。
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
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
  // 剪贴板读写在无头 Chrome 需要浏览器级权限（browser 端点不支持 Runtime 域，用裸连接）
  try {
    const v = await (await fetch(CDP + '/json/version')).json()
    const ws = new WebSocket(v.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.onopen = () => res()
      ws.onerror = (e) => rej(new Error('browser ws error'))
    })
    ws.send(JSON.stringify({ id: 1, method: 'Browser.grantPermissions', params: { origin: 'http://localhost:8123', permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] } }))
    await sleep(600)
    console.log('GRANT sent')
    // 保持连接由 GC 断开，与成功对照（scripts/_clip.tmp.mjs）完全一致
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

// —— 注入样例文档（含独特子串用于断言）——
const MD_SAMPLE = `# 雾港

　潮声从窗缝里渗进来，像雾港灯塔在夜里呼吸。

## 夜班

陈默在机舱值夜，海浪反复撞向防波堤。远处有灯。

- 雾气漫过甲板
- 缆绳在风里作响

> 值夜的人不能睡，这是规矩。`
const b64 = Buffer.from(MD_SAMPLE).toString('base64')

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

async function focusPage(page, tab) {
  // 无头多 tab 时页面可能非前台，剪贴板读要求 target 已激活（/json/activate 才是真激活，Page.bringToFront 在 headless 是 no-op）
  try { await fetch(CDP + '/json/activate/' + tab.id) } catch { try { await page.cmd('Page.enable').catch(() => {}) } catch {} }
  try { await page.cmd('Page.bringToFront').catch(() => {}) } catch {}
  try { await page.eval('window.focus(); true') } catch {}
}

await grantClipboard()
await sleep(500)

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

// 等编辑器就绪
await evalUntil(page, `(() => { const e = document.querySelector('.ProseMirror'); return e && e.textContent.length > 20 })()`, (v) => v === true, 25000, '编辑器就绪')
const inj = await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; if (!eds.length) return 'NO_EDITOR'; eds[0].setContent(new TextDecoder().decode(Uint8Array.from(atob('${b64}'), (c) => c.charCodeAt(0)))); return 'OK' })()`)
await sleep(900)

// —— A. 划词浮层：选中「雾港灯塔」→ 浮层出现（含 复制/添加到对话）——
const SEL = '雾港灯塔'
const selExpr = (needle) => `(() => {
  const pm = document.querySelector('.ProseMirror')
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) {
    const i = n.nodeValue.indexOf('${needle}')
    if (i >= 0) {
      const r = document.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + '${needle}'.length)
      const s = window.getSelection()
      s.removeAllRanges()
      s.addRange(r)
      return s.toString()
    }
  }
  return null
})()`
const selRes = await page.eval(selExpr(SEL))
ok('选中独特文本', selRes === SEL, String(selRes))
await evalUntil(page, `!!document.querySelector('.zj-sel-bubble')`, (v) => v === true, 10000, '浮层出现')
const bubbleBtns = await page.eval(`[...document.querySelectorAll('.zj-sel-bubble button')].map((b) => b.textContent.trim())`)
ok('浮层含「复制」「添加到对话」', bubbleBtns.includes('复制') && bubbleBtns.includes('添加到对话'), JSON.stringify(bubbleBtns))

// —— A1. 浮层「复制」→ 剪贴板真读到选中文字 ——
console.log('CLIP DEBUG:', JSON.stringify(await page.eval(`(async () => {
  let st = 'n/a'
  try { st = (await navigator.permissions.query({ name: 'clipboard-read' })).state } catch (e) { st = 'ERR:' + e.message }
  return { state: st, focus: document.hasFocus(), secure: window.isSecureContext }
})()`)))
await page.eval(`[...document.querySelectorAll('.zj-sel-bubble button')].find((b) => b.textContent.includes('复制')).click()`)
await sleep(400)
await focusPage(page, tab)
const clip1 = await page.eval(`navigator.clipboard.readText().catch((e) => 'ERR:' + e.message)`)
ok('浮层复制写入剪贴板', clip1 === SEL, String(clip1).slice(0, 60))

// —— A2. 浮层「添加到对话」→ agent 引用条出现选中文字 ——
await page.eval(selExpr(SEL))
await evalUntil(page, `!!document.querySelector('.zj-sel-bubble')`, (v) => v === true, 8000, '浮层再现')
await page.eval(`[...document.querySelectorAll('.zj-sel-bubble button')].find((b) => b.textContent.includes('添加到对话')).click()`)
const quoteShown = await evalUntil(
  page,
  `(() => { const s = [...document.querySelectorAll('span')].find((x) => (x.className || '').includes('line-clamp-2')); return s ? s.textContent : null })()`,
  (v) => v === SEL,
  8000,
  'agent 引用条显示选中文字'
)
ok('浮层添加到对话进引用条', quoteShown === SEL, String(quoteShown))

// —— B. 右键菜单（有选区）：CDP 真实右键（点选中文本中心，保证选区不被清除） ——
const selRect = await page.eval(`(() => {
  const pm = document.querySelector('.ProseMirror')
  const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let n
  while ((n = w.nextNode())) {
    const i = n.nodeValue.indexOf('${SEL}')
    if (i >= 0) {
      const r = document.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + '${SEL}'.length)
      const b = r.getBoundingClientRect()
      return { x: b.left + 2, y: b.top + b.height / 2 }
    }
  }
  return null
})()`)
const rx = selRect.x
const ry = selRect.y
console.log('SEL RECT:', JSON.stringify(selRect))
await page.eval(selExpr(SEL)) // 保持选中
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry })
await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button: 'right', buttons: 2, clickCount: 1 })
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button: 'right', buttons: 0, clickCount: 1 })
await sleep(800)
const items = await evalUntil(
  page,
  `(() => { const m = document.querySelector('[role="menu"]'); return m ? [...m.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent.trim()) : null })()`,
  (v) => Array.isArray(v) && v.length > 0,
  8000,
  '右键菜单出现'
)
console.log('MENU ITEMS (有选区):', JSON.stringify(items))
ok('菜单含 剪切/复制/粘贴/全选/添加到对话', ['剪切', '复制', '粘贴', '全选', '添加到对话'].every((t) => items.includes(t)), JSON.stringify(items))
// 截图 light（菜单打开状态）
const shot1 = await page.cmd('Page.captureScreenshot', { format: 'png' })
const { writeFileSync } = await import('node:fs')
writeFileSync('/tmp/contextmenu-light.png', Buffer.from(shot1.data, 'base64'))

// —— B1. 右键「剪切」→ 正文少了选中文字、剪贴板=选中 ——
await page.eval(`[...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.trim() === '剪切').click()`)
await sleep(500)
await focusPage(page, tab)
const afterCut = await page.eval(`(() => { const pm = document.querySelector('.ProseMirror'); return { has: pm.textContent.includes('${SEL}'), len: pm.textContent.length } })()`)
const clip2 = await page.eval(`navigator.clipboard.readText().catch((e) => 'ERR:' + e.message)`)
ok('剪切后正文不再含选中文字', afterCut.has === false, JSON.stringify(afterCut))
ok('剪切写入剪贴板', clip2 === SEL, String(clip2).slice(0, 60))

// —— B2. 右键「全选」→ 选中全文 ——
await page.eval(selExpr('夜班')) // 恢复一个选中，再开右键
await sleep(300)
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry })
await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button: 'right', buttons: 2, clickCount: 1 })
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button: 'right', buttons: 0, clickCount: 1 })
await evalUntil(page, `!!document.querySelector('[role="menu"]')`, (v) => v === true, 8000, '菜单再现')
await page.eval(`[...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.trim() === '全选').click()`)
await sleep(400)
const selAll = await page.eval(`document.getSelection().toString().length`)
ok('全选选中全文', selAll > 60, String(selAll))

// —— C. 右键菜单（无选区）：只有 粘贴/全选 ——
await page.eval(`window.getSelection().removeAllRanges()`)
await sleep(250)
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry })
await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button: 'right', buttons: 2, clickCount: 1 })
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button: 'right', buttons: 0, clickCount: 1 })
const items2 = await evalUntil(
  page,
  `(() => { const m = document.querySelector('[role="menu"]'); return m ? [...m.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent.trim()) : null })()`,
  (v) => Array.isArray(v) && v.length > 0,
  8000,
  '无选区右键菜单'
)
console.log('MENU ITEMS (无选区):', JSON.stringify(items2))
ok('无选区仅 粘贴/全选', items2.length === 2 && items2.includes('粘贴') && items2.includes('全选'), JSON.stringify(items2))
// Esc 关闭
await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(300)
const menuGone = await page.eval(`!document.querySelector('[role="menu"]')`)
ok('Esc 关闭菜单', menuGone === true)

// —— D. 右键「添加到对话」（菜单入口）——
await page.eval(selExpr('潮声'))
await sleep(300)
const selRect2 = await page.eval(`(() => {
  const pm = document.querySelector('.ProseMirror')
  const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let n
  while ((n = w.nextNode())) {
    const i = n.nodeValue.indexOf('潮声')
    if (i >= 0) {
      const r = document.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + 2)
      const b = r.getBoundingClientRect()
      return { x: b.left + 2, y: b.top + b.height / 2 }
    }
  }
  return null
})()`)
const rx2 = selRect2.x
const ry2 = selRect2.y
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx2, y: ry2 })
await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx2, y: ry2, button: 'right', buttons: 2, clickCount: 1 })
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx2, y: ry2, button: 'right', buttons: 0, clickCount: 1 })
await evalUntil(page, `!!document.querySelector('[role="menu"]')`, (v) => v === true, 8000, '菜单再现2')
await page.eval(`[...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.trim() === '添加到对话').click()`)
const quote2 = await evalUntil(
  page,
  `(() => { const s = [...document.querySelectorAll('span')].find((x) => (x.className || '').includes('line-clamp-2')); return s ? s.textContent : null })()`,
  (v) => typeof v === 'string' && v.includes('潮声'),
  8000,
  '右键添加到对话进引用条'
)
ok('右键添加到对话进引用条', typeof quote2 === 'string' && quote2.includes('潮声'), String(quote2).slice(0, 40))

// —— E. dark 主题菜单截图 ——
await page.eval(`document.documentElement.classList.add('dark')`)
await sleep(300)
await page.eval(selExpr('夜班'))
await sleep(200)
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry })
await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button: 'right', buttons: 2, clickCount: 1 })
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button: 'right', buttons: 0, clickCount: 1 })
await evalUntil(page, `!!document.querySelector('[role="menu"]')`, (v) => v === true, 8000, 'dark 菜单')
await sleep(200)
const shot2 = await page.cmd('Page.captureScreenshot', { format: 'png' })
writeFileSync('/tmp/contextmenu-dark.png', Buffer.from(shot2.data, 'base64'))
await page.eval(`document.documentElement.classList.remove('dark')`)
await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })

console.log('SCREENSHOTS: /tmp/contextmenu-light.png /tmp/contextmenu-dark.png')
if (page.errors.length) { console.log('JS ERRORS:', page.errors.slice(0, 5)); fails++ }
console.log(fails === 0 ? 'ALL PASS' : ('FAILS: ' + fails))
await page.close()
process.exit(fails === 0 ? 0 : 1)
