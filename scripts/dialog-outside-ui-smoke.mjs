// 织卷无头冒烟 · 对话框点外关闭策略（体检候选 1，2026-09-15 23:15 体验层轮）
// 验收点：① 新建章节（输入类）填题名后真实鼠标点遮罩 → dialog 保持打开、输入保留（HIG Modality 防丢数据）；
//         ② 同 dialog Esc → 仍可正常取消关闭（HIG「Provide alternative ways to cancel」）；
//         ③ 删除章节（确认类）点遮罩 → dialog 关闭（=取消语义，无数据风险，默认行为不变）；
//         ④ 删除章节打开后初始焦点在「取消」按钮（Enter=取消，macOS 破坏性确认框惯例，回归保护）；
//         ⑤ 全程无 JS 异常；截图存档。
// 用法：node scripts/dialog-outside-ui-smoke.mjs （前置：npm run build + serve-renderer 8123 + CDP 9224）
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = await import('node:fs')

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
        mouse: async (type, x, y, button = 'left') =>
          cmd('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1 }),
        close: () => ws.close()
      })
    }
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(200)
  }
}
const has = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const DIALOG_OPEN = `document.querySelector('[role=dialog]') !== null`
const clickByTitle = (t) => `(() => { const el=[...document.querySelectorAll('button')].find(b=>b.getAttribute('title')===${JSON.stringify(t)}); if(!el) return false; el.click(); return true })()`
const clickByText = (t) => `(() => { const els=[...document.querySelectorAll('button, [role=menuitem]')]; const el=els.find(b=>(b.innerText||'').trim()===${JSON.stringify(t)}); if(!el) return false; el.click(); return true })()`
const ctxMenuOn = (label) => `(() => {
  const btn = [...document.querySelectorAll('aside button')].find(b => (b.innerText || '').includes(${JSON.stringify(label)}))
  if (!btn) return false
  btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 200, button: 2 }))
  return true
})()`
const fill = (sel, val) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(val)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return el.value
})()`

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}
async function shot(page, name) {
  try {
    const r = await page.cmd('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync('/tmp/' + name, Buffer.from(r.data, 'base64'))
    console.log('SHOT /tmp/' + name)
  } catch (e) {
    console.log('SHOT WARN', String(e).slice(0, 100))
  }
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(page, has('第1章 · 雾港'), (v) => v === true, 20000, '章节列表就绪')

  // ① 新建章节：填题名 → 点遮罩 → 不关 + 输入保留
  ok('打开新建章节', (await page.eval(clickByTitle('新建章节'))) === true)
  await evalUntil(page, DIALOG_OPEN, (v) => v === true, 8000, '新建章节 dialog')
  await evalUntil(page, has('本章目标'), (v) => v === true, 5000, '表单就绪')
  await page.eval(fill('input[placeholder="如：夏夜的信"]', '防误关测试章'))
  await sleep(200)
  const rect = JSON.parse(await page.eval(`JSON.stringify((() => { const d=document.querySelector('[role=dialog]'); const r=d.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height} })())`))
  const px = rect.x + rect.w / 2
  const py = Math.max(2, rect.y - 40)
  await page.mouse('mouseMoved', px, py)
  await page.mouse('mousePressed', px, py)
  await page.mouse('mouseReleased', px, py)
  await sleep(600)
  ok('点遮罩后 dialog 仍打开（输入类）', (await page.eval(DIALOG_OPEN)) === true)
  const valKept = await page.eval(`document.querySelector('input[placeholder="如：夏夜的信"]')?.value ?? '(no-input)'`)
  ok('已填题名保留', valKept === '防误关测试章', String(valKept))
  await shot(page, 'zj-dialog-outside-keep.png')

  // ② Esc 取消仍有效
  await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`)
  await sleep(500)
  ok('Esc 后 dialog 关闭（取消路径可用）', (await page.eval(DIALOG_OPEN)) === false)

  // ③ 删除章节（确认类）：点遮罩 → 关闭（=取消语义）
  ok('右键第4章', (await page.eval(ctxMenuOn('第4章 · 雾夜'))) === true)
  await evalUntil(page, has('删除'), (v) => v === true, 6000, '上下文菜单')
  await page.eval(clickByText('删除'))
  await evalUntil(page, has('移入废纸篓'), (v) => v === true, 6000, '删除确认框')
  await sleep(400)
  // ④ 初始焦点=取消按钮
  const ae = await page.eval(`(() => { const a = document.activeElement; return { tag: a?.tagName, txt: (a?.innerText || '').trim().slice(0, 10) } })()`)
  ok('删除确认框初始焦点=取消', ae.tag === 'BUTTON' && ae.txt === '取消', JSON.stringify(ae))
  const rect2 = JSON.parse(await page.eval(`JSON.stringify((() => { const d=document.querySelector('[role=dialog]'); const r=d.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height} })())`))
  const px2 = rect2.x + rect2.w / 2
  const py2 = Math.max(2, rect2.y - 40)
  await page.mouse('mouseMoved', px2, py2)
  await page.mouse('mousePressed', px2, py2)
  await page.mouse('mouseReleased', px2, py2)
  await sleep(600)
  ok('点遮罩后确认框关闭（确认类默认=取消）', (await page.eval(DIALOG_OPEN)) === false)
  ok('第4章未删（点外=取消）', (await page.eval(has('第4章 · 雾夜'))) === true)

  const jsErrors = page.errors.filter((e) => !e.includes('favicon')).slice(0, 5)
  ok('无 JS 异常', jsErrors.length === 0, jsErrors.join(' ; '))
} catch (e) {
  ok('脚本异常', false, String(e).slice(0, 300))
}
page.close()
console.log(fails === 0 ? 'ALL PASS' : `FAILS: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
