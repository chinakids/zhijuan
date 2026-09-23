// 织卷无头冒烟 · 右键菜单「写入批注」+ 非正文批注入口隐藏（Apple HIG Context menus 一致性）
// 用法：node scripts/context-menu-anno-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 正文有选区右键菜单含「写入批注」（写作域组内批注在前）；
//         ② 点「写入批注」→ Novel「添加批注」弹层（Description 含选中原文）→ 填意图保存 → 高亮 + 徽标「批注 1」；
//         ③ 无选区右键菜单无「写入批注」（隐藏不可用，HIG）；
//         ④ 人物档案页（DocSection, anno=false）：划词浮层无「批注」钮、右键菜单无「写入批注」；
//         ⑤ 全程无 JS 异常 + 截图存档。
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
      ws.onerror = (e) => rej(new Error('browser ws error'))
    })
    ws.send(JSON.stringify({ id: 1, method: 'Browser.grantPermissions', params: { origin: 'http://localhost:8123', permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] } }))
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

const MD_SAMPLE = `# 雾港

　潮声从窗缝里渗进来，像雾港灯塔在夜里呼吸。

## 夜班

陈默在机舱值夜，海浪反复撞向防波堤。远处有灯。

- 雾气漫过甲板
- 缆绳在风里作响

> 值夜的人不能睡，这是规矩。`
const b64 = Buffer.from(MD_SAMPLE).toString('base64')
const DECODE = `(t) => new TextDecoder().decode(Uint8Array.from(atob(t), (c) => c.charCodeAt(0)))`

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

// 选中正文第一个出现 needle 的文本（DOM Range）
const selExpr = (needle) => `(() => {
  const pm = document.querySelector('.ProseMirror')
  if (!pm) return null
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

const menuItemsExpr = `(() => {
  const m = document.querySelector('[role="menu"]')
  return m ? [...m.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent.trim()) : null
})()`

const rightClickAt = async (page, x, y) => {
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 })
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 })
  await sleep(800)
}

const selRectExpr = (needle) => `(() => {
  const pm = document.querySelector('.ProseMirror')
  if (!pm) return null
  const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let n
  while ((n = w.nextNode())) {
    const i = n.nodeValue.indexOf('${needle}')
    if (i >= 0) {
      const r = document.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + '${needle}'.length)
      const b = r.getBoundingClientRect()
      return { x: b.left + 2, y: b.top + b.height / 2 }
    }
  }
  return null
})()`

await grantClipboard()
await sleep(500)

// ══ A. 正文（Novel）══：用 devShim 预设第01章正文（带原 2 条批注 csv，与 anno-gutter 同口径）
const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, `(() => { const e = document.querySelector('.ProseMirror'); return e && e.textContent.includes('泛黄的船票') })()`, (v) => v === true, 25000, '正文编辑器就绪（预设内容）')
await sleep(900)

const SEL = '泛黄的船票'
// A1. 有选区右键 → 菜单含「写入批注」，写作域组内批注在前
const rect = await page.eval(selRectExpr(SEL))
ok('选中文本定位', !!rect, JSON.stringify(rect))
await page.eval(selExpr(SEL))
await rightClickAt(page, rect.x, rect.y)
const items1 = await evalUntil(page, menuItemsExpr, (v) => Array.isArray(v) && v.length > 0, 8000, '右键菜单出现')
console.log('MENU(有选区):', JSON.stringify(items1))
ok('菜单含 剪切/复制/粘贴/全选', ['剪切', '复制', '粘贴', '全选'].every((t) => items1.includes(t)), JSON.stringify(items1))
ok('菜单含「写入批注」', items1.includes('写入批注'), JSON.stringify(items1))
ok('写入批注 排在 添加到对话 之前', items1.indexOf('写入批注') >= 0 && items1.indexOf('写入批注') < items1.indexOf('添加到对话'), JSON.stringify(items1))
// 截图（菜单打开态）
const shot1 = await page.cmd('Page.captureScreenshot', { format: 'png' })
const { writeFileSync } = await import('node:fs')
writeFileSync('/tmp/ctx-anno-menu.png', Buffer.from(shot1.data, 'base64'))

// A2. 点击「写入批注」→「添加批注」弹层（Description 含选中原文）
await page.eval(`[...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.trim() === '写入批注').click()`)
await evalUntil(page, `document.body.innerText.includes('添加批注')`, Boolean, 8000, '批注弹层出现')
const dlgDesc = await page.eval(`(() => { const d = document.querySelector('[role="dialog"]'); return d ? d.innerText : '' })()`)
ok('弹层含选中原文', dlgDesc.includes(SEL), dlgDesc.slice(0, 120).replace(/\n/g, ' '))

// A3. 填意图 → 保存批注 → 高亮（原 2 条 + 新 1 = ≥3） + 徽标「批注 3」
await page.eval(`(() => {
  const ta = [...document.querySelectorAll('textarea')].find((t) => t.closest('[role="dialog"]'))
  if (!ta) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '这段比喻太常见，改成灯塔本身在呼吸的错觉')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(400)
await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存批注').click()`)
await evalUntil(page, `document.querySelectorAll('.zj-anno').length`, (n) => n >= 3, 15000, '批注高亮出现（原2+新1）')
const badge = await evalUntil(page, `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /^批注 \\d+$/.test((x.innerText || '').trim()))
  return b ? b.innerText.trim() : ''
})()`, (v) => v === '批注 3', 10000, '徽标=批注 3')
ok('右键批注保存后高亮 ≥3 且徽标=批注 3', badge === '批注 3', String(badge))
ok('保存动作 toast 出现', (await page.eval(`document.body.innerText.includes('批注已添加')`)) === true, '')
const shot2 = await page.cmd('Page.captureScreenshot', { format: 'png' })
writeFileSync('/tmp/ctx-anno-saved.png', Buffer.from(shot2.data, 'base64'))

// A4. 无选区右键 → 无「写入批注」（隐藏不可用）
await page.eval(`(() => { const s = window.getSelection(); s.removeAllRanges(); return true })()`)
await sleep(300)
await rightClickAt(page, rect.x, rect.y)
const items2 = await evalUntil(page, menuItemsExpr, (v) => Array.isArray(v) && v.length > 0, 8000, '无选区右键菜单')
console.log('MENU(无选区):', JSON.stringify(items2))
ok('无选区菜单 = 粘贴/全选（无剪切复制批注）', items2.length === 2 && items2.includes('粘贴') && items2.includes('全选'), JSON.stringify(items2))
await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
await sleep(300)

// ══ B. 人物档案页（DocSection, anno=false）══
const tab2 = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/characters')
const page2 = await attach(tab2.webSocketDebuggerUrl)
await evalUntil(page2, `document.body.innerText.includes('人物档案')`, Boolean, 20000, '人物页就绪')
// 点选「阿七」档案（列表项为 button）
const clicked = await page2.eval(`(() => {
  const it = [...document.querySelectorAll('button')].find((b) => /阿七/.test(b.textContent || ''))
  if (!it) return 'NOT_FOUND'
  it.click()
  return 'OK'
})()`)
console.log('PICK:', clicked)
await evalUntil(page2, `(() => { const e = document.querySelector('.ProseMirror'); return e && e.textContent.includes('基础档案') })()`, (v) => v === true, 20000, '人物档案编辑器就绪')
// 直接用预设文档文本（避免注入不确定性；人物页无批注 csv 关联）
const P_SEL = '基础档案'
const rect2 = await page2.eval(selRectExpr(P_SEL))
ok('人物页选中文本定位', !!rect2, JSON.stringify(rect2))
await page2.eval(selExpr(P_SEL))
await evalUntil(page2, `!!document.querySelector('.zj-sel-bubble')`, (v) => v === true, 8000, '人物页浮层出现')
const bubbleBtns = await page2.eval(`[...document.querySelectorAll('.zj-sel-bubble button')].map((b) => b.textContent.trim())`)
ok('人物页浮层无「批注」钮（anno=false）', !bubbleBtns.includes('批注') && bubbleBtns.includes('复制'), JSON.stringify(bubbleBtns))
const shot3 = await page2.cmd('Page.captureScreenshot', { format: 'png' })
writeFileSync('/tmp/ctx-anno-none-char.png', Buffer.from(shot3.data, 'base64'))
await page2.eval(`(() => { const s = window.getSelection(); s.removeAllRanges(); return true })()`)
await sleep(300)
// 人物页右键：有选区 = 无「写入批注」
await page2.eval(selExpr(P_SEL))
await rightClickAt(page2, rect2.x, rect2.y)
const items3 = await evalUntil(page2, menuItemsExpr, (v) => Array.isArray(v) && v.length > 0, 8000, '人物页右键菜单')
console.log('MENU(人物页):', JSON.stringify(items3))
ok('人物页右键菜单无「写入批注」（有 添加到对话）', !items3.includes('写入批注') && items3.includes('添加到对话'), JSON.stringify(items3))

// ══ 汇总 ══
console.log('JS ERRORS novel:', JSON.stringify(page.errors.slice(0, 4)))
console.log('JS ERRORS char:', JSON.stringify(page2.errors.slice(0, 4)))
ok('novel 页无 JS 异常', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 2)))
ok('characters 页无 JS 异常', page2.errors.length === 0, JSON.stringify(page2.errors.slice(0, 2)))
console.log(fails === 0 ? 'ALL PASS' : fails + ' FAIL')
process.exit(fails === 0 ? 0 : 1)
