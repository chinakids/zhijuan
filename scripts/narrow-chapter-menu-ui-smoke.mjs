// 织卷 · 窄屏章节抽屉右键菜单 · 无头 UI 冒烟（体验层 2026-10-28，F-20261028-10）
// 覆盖：①窄屏打开章节抽屉 ②右键章节行弹出菜单 ③点「重命名」对话框真的弹出
//      ④点「修改涉及人物」对话框真的弹出（此前抽屉先卸载导致 onSelect 丢失）
// 用法：node scripts/narrow-chapter-menu-ui-smoke.mjs [base]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] || 'http://127.0.0.1:8899'
const CDP = 'http://127.0.0.1:9224'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const tab = await (await fetch(CDP + '/json/new?url=' + encodeURIComponent('about:blank'), { method: 'PUT' })).json()
const ws = new WebSocket(tab.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })) })
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Network.enable'); await cmd('Network.setCacheDisabled', { cacheDisabled: true })
await cmd('Emulation.setDeviceMetricsOverride', { width: 820, height: 780, deviceScaleFactor: 1, mobile: false })

const ev = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)))
  return r.result?.value
}
const mouse = async (expr, button = 'left') => {
  const box = await ev(`(() => { const el=${expr}; if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2} })()`)
  if (!box) return false
  await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button, clickCount: 1 })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button, clickCount: 1 })
  return true
}
let pass = 0, fail = 0
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✓', name, extra) } else { fail++; console.log('  ✗', name, extra) } }
const shot = async (name) => {
  try {
    const { data } = await cmd('Page.captureScreenshot', { format: 'png' })
    const d = new Date(); const hhmm = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0')
    const f = path.join(os.homedir(), 'Pictures', 'zhijuan', `${name}-${hhmm}.png`)
    fs.writeFileSync(f, Buffer.from(data, 'base64')); console.log('  截图 →', f)
  } catch {}
}

await cmd('Page.navigate', { url: `${base}/?cb=narrowmenu#/project/demo-aseya/novel` })
await sleep(3200)
check('窄屏生效（无固定章列）', (await ev(`!document.querySelector('[data-testid="chapter-sidebar"]')`)) === true)

// 打开抽屉（无选中章节时走空态按钮）
await mouse(`document.querySelector('[data-testid="pick-chapter"]')`)
await sleep(600)
check('① 章节抽屉打开', (await ev(`!!document.querySelector('[data-testid="chapter-drawer"]')`)) === true)

// 先选章，再从工具栏开关打开抽屉（与用户动线一致）
await mouse(`[...document.querySelectorAll('[data-testid="chapter-drawer"] button')].find(b=>/第1章/.test(b.innerText))`)
await sleep(1500)
await mouse(`document.querySelector('[data-testid="chapter-toggle"]')`)
await sleep(700)
check('① 已选章后抽屉可再次打开', (await ev(`!!document.querySelector('[data-testid="chapter-drawer"]')`)) === true)

// ② 右键
const rowSel = `[...document.querySelectorAll('[data-testid="chapter-drawer"] button')].find(b=>/第1章/.test(b.innerText))`
check('② 右键触发菜单', await mouse(rowSel, 'right'))
await sleep(700)
check('② 菜单可见', (await ev(`document.querySelectorAll('[role="menu"]').length`)) === 1)

// ③ 点「重命名」→ 对话框
await mouse(`[...document.querySelectorAll('[role="menuitem"]')].find(x=>x.innerText.trim()==='重命名')`)
await sleep(800)
const dlg1 = await ev(`document.querySelector('[role="dialog"]')?.innerText.slice(0,40).replace(/\\n/g,' | ') ?? ''`)
check('③ 重命名对话框弹出', /重命名/.test(dlg1), dlg1)
await shot('narrow-menu-rename')
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
await sleep(500)

// ④ 再开抽屉 → 右键 → 修改涉及人物
await mouse(`document.querySelector('[data-testid="chapter-toggle"]')`)
await sleep(600)
await mouse(rowSel, 'right')
await sleep(700)
await mouse(`[...document.querySelectorAll('[role="menuitem"]')].find(x=>x.innerText.trim()==='修改涉及人物')`)
await sleep(800)
const dlg2 = await ev(`document.querySelector('[data-testid="edit-cast-input"]') ? 'cast-dialog' : (document.querySelector('[role="dialog"]')?.innerText.slice(0,30) ?? '')`)
check('④ 涉及人物对话框弹出', dlg2 === 'cast-dialog', dlg2)

check('无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '))
await fetch(CDP + '/json/close/' + tab.id)
console.log(`\n=== ${pass} passed, ${fail} failed ===`)
process.exit(fail ? 1 : 0)