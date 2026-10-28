// 织卷 · 章节「涉及人物」修改 · 无头 UI 冒烟（体验层 2026-10-28，F-20261028-07）
// 覆盖：①章列 ⋯ 菜单有「修改涉及人物」入口 ②对话框预填当前清单
//      ③保存后约定头真的更新（正文体零变化） ④「按正文识别」能补漏列（本地规则）
// devShim 内存数据；末尾恢复演示数据。
// 用法：node scripts/chapter-cast-ui-smoke.mjs [base]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] || 'http://127.0.0.1:8899'
const CDP = 'http://127.0.0.1:9224'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CH1 = '正文/第01章_雾港.md'
const CH5 = '正文/第05章_灯下.md'

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

const ev = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)))
  return r.result?.value
}
const clickEl = async (expr) => {
  const box = await ev(`(() => { const el=${expr}; if(!el) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2} })()`)
  if (!box) return false
  await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
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

await cmd('Page.navigate', { url: `${base}/?cb=castsmoke#/project/demo-aseya/novel` })
await sleep(3500)
const orig1 = await ev(`window.zhijuan.readDoc('demo-aseya', ${JSON.stringify(CH1)}).then((v) => v ?? '')`)
const orig5 = await ev(`window.zhijuan.readDoc('demo-aseya', ${JSON.stringify(CH5)}).then((v) => v ?? '')`)
check('准备：读到第 1 章', typeof orig1 === 'string' && orig1.includes('涉及人物'))

// ① 第 1 章行 ⋯ 菜单
const okOpen = await clickEl(`document.querySelectorAll('button[aria-haspopup="menu"]')[0]`)
check('章列 ⋯ 菜单可打开', okOpen)
await sleep(600)
const hasItem = await ev(`[...document.querySelectorAll('[role="menuitem"]')].some((x)=>/修改涉及人物/.test(x.innerText))`)
check('① 菜单含「修改涉及人物」', hasItem)
await clickEl(`[...document.querySelectorAll('[role="menuitem"]')].find((x)=>/修改涉及人物/.test(x.innerText))`)
await sleep(600)
const prefilled = await ev(`document.querySelector('[data-testid="edit-cast-input"]')?.value ?? ''`)
check('② 对话框预填当前清单', /阿七/.test(prefilled), prefilled)

// ③ 改成 阿七，沈藏 保存 → 约定头更新，正文体不变
const setInput = async (v) => await ev(`(() => {
  const el=document.querySelector('[data-testid="edit-cast-input"]'); if(!el) return 'no input'
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set
  setter.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'
})()`)
check('③ 输入可写', (await setInput('阿七，沈藏')) === 'ok')
await clickEl(`document.querySelector('[data-testid="edit-cast-save"]')`)
await sleep(1300)
const after1 = await ev(`window.zhijuan.readDoc('demo-aseya', ${JSON.stringify(CH1)}).then((v) => v ?? '')`)
check('③ 约定头已写入沈藏', /涉及人物:\s*\[[^\]]*沈藏/.test(after1), (after1.match(/涉及人物:[^\n]*/) ?? [''])[0])
check('③ 正文体未变', after1.slice(after1.indexOf('---', 4)) === orig1.slice(orig1.indexOf('---', 4)))
await shot('chapter-cast-edit')

// ④ 第 5 章「按正文识别」：正文出现「沈爷」（沈藏别名）→ 应补出沈藏
await clickEl(`document.querySelectorAll('button[aria-haspopup="menu"]')[4]`)
await sleep(600)
await clickEl(`[...document.querySelectorAll('[role="menuitem"]')].find((x)=>/修改涉及人物/.test(x.innerText))`)
await sleep(600)
const v5 = await ev(`document.querySelector('[data-testid="edit-cast-input"]')?.value ?? ''`)
check('④ 第 5 章对话框打开', v5.length > 0, v5)
await clickEl(`document.querySelector('[data-testid="edit-cast-suggest"]')`)
await sleep(1400)
const v5b = await ev(`document.querySelector('[data-testid="edit-cast-input"]')?.value ?? ''`)
check('④ 按正文识别补出别名人物', /沈藏/.test(v5b), v5b)
await clickEl(`document.querySelector('[data-testid="edit-cast-save"]')`)
await sleep(1300)
const after5 = await ev(`window.zhijuan.readDoc('demo-aseya', ${JSON.stringify(CH5)}).then((v) => v ?? '')`)
check('④ 第 5 章清单已落盘', /涉及人物:[^\n]*沈藏/.test(after5), (after5.match(/涉及人物:[^\n]*/) ?? [''])[0])

check('无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '))

// 恢复
await ev(`window.zhijuan.writeDoc('demo-aseya', ${JSON.stringify(CH1)}, ${JSON.stringify(orig1)})`)
await ev(`window.zhijuan.writeDoc('demo-aseya', ${JSON.stringify(CH5)}, ${JSON.stringify(orig5)})`)
await fetch(CDP + '/json/close/' + tab.id)
console.log(`\n=== ${pass} passed, ${fail} failed ===`)
process.exit(fail ? 1 : 0)