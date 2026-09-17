// 织卷无头冒烟 · IME 组合期交互体检（2026-09-18 体验层轮：F-IME-01/02 修复防回归）
// 用例：① @ 浮层组合期收起（compositionstart 清空）＋组合态 Enter 不误插引用（onAtKeyDown isComposing 放行）；
//      ② 查找条组合态 Enter 不跳匹配（FindBar onKeyDown isComposing 放行）、正常态 Enter 仍跳；
//      ③ 正文划词浮层组合期不误弹（selectionchange 组合态 collapsed）。
// 前置：node scripts/serve-renderer.mjs 8899；本机无头 Chrome CDP 127.0.0.1:9224
// 用法：node scripts/ime-composition-ui-smoke.mjs
const CDP = 'http://127.0.0.1:9224'
const PORT = 8899
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); cond ? pass++ : fail++ }

// 开 tab（/json/new 只开空白页，须再 Page.navigate——2026-09-18 实踩：url 参数会被忽略）
const r = await fetch(CDP + '/json/new', { method: 'PUT' })
const tab = await r.json()
const page = await attach(tab.webSocketDebuggerUrl)
await page.cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })

async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.text || 'exc')
    else if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push('console.error')
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  await new Promise((res) => {
    ws.onopen = async () => {
      try { await cmd('Runtime.enable'); await cmd('Page.enable') } catch {}
      res()
    }
  })
  return {
    cmd,
    errors,
    eval: async (expression) => {
      const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
      return r.result?.value
    },
    close: () => ws.close()
  }
}
async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(250)
  }
}
const taSel = `[placeholder^="让 agent"]`
const setTa = (v) => page.eval(`(() => {
  const ta = document.querySelector(${JSON.stringify(taSel)}); if (!ta) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, ${JSON.stringify(v)})
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  ta.focus()
  return true
})()`)
const taVal = () => page.eval(`(document.querySelector(${JSON.stringify(taSel)})||{value:''}).value`)

try {
  // ===== 就绪：选章等编辑器挂载（Novel 页默认不挂编辑器） =====
  await evalUntil(page, `document.body.innerText.includes('Agent')`, (v) => v === true, 20000, '页面就绪')
  await evalUntil(page, `(() => { const el=[...document.querySelectorAll('button')].find(b=>((b.textContent||'').includes('第1章'))&&!b.closest('[aria-hidden="true"]')); if(el){el.click();return true} return false })()`, (v) => v === true, 20000, '选章')
  await evalUntil(page, `!!document.querySelector('.zj-md .milkdown .ProseMirror')`, (v) => v === true, 20000, '编辑器挂载')

  // ===== ① @ 浮层组合期 =====
  await setTa('写 @')
  await evalUntil(page, `!!document.querySelector('.zj-at-menu')`, (v) => v === true, 8000, '@ 浮层出现')
  ok(true, '@ 输入后浮层出现（基线）')
  await page.cmd('Input.imeSetComposition', { text: 'renwu', selectionStart: 5, selectionEnd: 5 })
  await sleep(600)
  ok(await page.eval(`!document.querySelector('.zj-at-menu')`), '组合期 @ 浮层收起（compositionstart 清空）')
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 })
  await sleep(400)
  const v1 = await taVal()
  ok(!v1.includes('〔'), `组合态 Enter 不误插引用（实际 "${v1.slice(0, 24)}"）`)
  // 组合态 Enter 后若组合被提交→compositionend 重解析属预期；浮层重弹时须按新 query（无匹配→空态提示）而非全量候选
  const after1 = await page.eval(`(() => { const m=document.querySelector('.zj-at-menu'); if(!m) return 'closed'; return m.innerText.slice(0,20) })()`)
  ok(after1 === 'closed' || after1.includes('没有匹配'), `组合态 Enter 后浮层状态合理（${after1}）`)
  // 取消组合（CDP 文档：空文本=取消）
  try { await page.cmd('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }) } catch {}
  await setTa('')
  await sleep(200)

  // ===== ② 查找条组合期 =====
  await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'f',metaKey:true,bubbles:true,cancelable:true}))`)
  await evalUntil(page, `!!document.querySelector('.zj-findbar')`, (v) => v === true, 8000, '查找条')
  await page.eval(`(() => { const i=document.querySelector('.zj-find-input'); i.focus(); return !!i })()`)
  await sleep(300)
  await page.cmd('Input.imeSetComposition', { text: '港', selectionStart: 1, selectionEnd: 1 })
  await sleep(500)
  const c1 = await page.eval(`(document.querySelector('.zj-find-count')||{innerText:''}).innerText`)
  ok(c1 === '1/2', `组合期查找实时查询（count=${c1}）`)
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 })
  await sleep(400)
  const c2 = await page.eval(`(document.querySelector('.zj-find-count')||{innerText:''}).innerText`)
  ok(c2 === '1/2', `组合态 Enter 不跳匹配（count=${c2} 仍 1/2）`)
  // 取消组合（CDP 文档：空文本=取消；会清空查找词）→ 重写「港」模拟提交后状态 → 正常态 Enter 仍跳下一处
  try { await page.cmd('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }) } catch {}
  await sleep(300)
  await page.eval(`(() => {
    const i = document.querySelector('.zj-find-input'); if (!i) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(i, '港')
    i.dispatchEvent(new Event('input', { bubbles: true }))
    i.focus()
    return true
  })()`)
  await sleep(400)
  const c2b = await page.eval(`(document.querySelector('.zj-find-count')||{innerText:''}).innerText`)
  ok(c2b === '1/2', `提交后重写查找词（count=${c2b}）`)
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 })
  await sleep(400)
  const c3 = await page.eval(`(document.querySelector('.zj-find-count')||{innerText:''}).innerText`)
  ok(c3 === '2/2', `正常态 Enter 仍跳下一处（count=${c3}）`)
  await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`)
  await sleep(300)

  // ===== ③ 正文划词浮层组合期不误弹 =====
  await page.eval(`(() => { const p=document.querySelector('.ProseMirror'); if(p) p.focus(); return !!p })()`)
  await sleep(300)
  await page.cmd('Input.imeSetComposition', { text: '测试', selectionStart: 2, selectionEnd: 2 })
  await sleep(500)
  ok(!(await page.eval(`!!document.querySelector('.zj-sel-bubble')`)), '组合期划词浮层不误弹')
  try { await page.cmd('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }) } catch {}

  ok(page.errors.length === 0, `无 JS 异常（errors=${page.errors.length}）`)
} catch (e) {
  console.error('❌ FATAL: ' + e.message)
  fail++
} finally {
  console.log(`\nPASS=${pass} FAIL=${fail}`)
  try { await fetch(`${CDP}/json/close/${tab.id}`) } catch {}
  process.exit(fail > 0 ? 1 : 0)
}
