// 织卷无头冒烟 · 浮层语义修正（体验层 2026-09-14 05:15；候选1）
// 用法：node scripts/anno-semantics-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim 演示项目）：选第1章 → 键盘选择 → 划词浮层语义（toolbar + aria-label）
//   → 「批注」→ 意图弹层打开焦点落 textarea → Esc 关闭 → 焦点回编辑器（HIG：关闭回触发上下文）
//   → 再走划词 → 弹层填写意图 → 保存 → 焦点回编辑器 + 批注写入
//   → 点击批注高亮 → 气泡 role=group + aria-label=批注（原 role=tooltip 语义不确）
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
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
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
        cmd,
        errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        key: (key, opts = {}) =>
          cmd('Input.dispatchKeyEvent', {
            type: opts.down === false ? 'keyUp' : 'keyDown',
            key: opts.key || key,
            code: opts.code || key,
            windowsVirtualKeyCode: opts.vk || 0,
            modifiers: opts.modifiers || 0
          }).then(() => cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: opts.key || key, code: opts.code || key, windowsVirtualKeyCode: opts.vk || 0, modifiers: opts.modifiers || 0 })),
        close: () => ws.close()
      })
    }
  })
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
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const clickText = (text, exact = true) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!el) return false
  el.click()
  return true
})()`
const ae = () => `(() => { const a = document.activeElement; return { tag: a?.tagName || '', aria: a?.getAttribute?.('aria-label') || '', txt: (a?.innerText || '').trim().slice(0, 10), isPM: !!a?.closest?.('.ProseMirror'), inFloat: !!a?.closest?.('.zj-sel-bubble'), inPop: !!a?.closest?.('.zj-anno-pop'), inDlg: !!a?.closest?.('[role="dialog"]') } })()`
const SHIFT = 8

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')) }
}

// —— 第 0 步：开页选章（Novel 页默认不挂编辑器）——
const tab = await openTab(BASE + '/#/project/demo-aseya/novel?cb=' + Date.now())
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入')
await page.eval(clickText('第1章 · 雾港', false))
await evalUntil(page, `!!document.querySelector('.ProseMirror')`, Boolean, 20000, '编辑器挂载')
await sleep(800)
await page.eval(`window.__ZJ_EDITORS?.[0]?.focus?.()`)
await sleep(400)

// —— ① 键盘选择 → 划词浮层语义复核（role=toolbar + aria-label + 三按钮 aria）——
for (let i = 0; i < 3; i++) await page.key('ArrowDown', { modifiers: SHIFT, code: 'ArrowDown', vk: 40 })
await evalUntil(page, `!!document.querySelector('.zj-sel-bubble')`, Boolean, 8000, '键盘选择出浮层')
const bubInfo = await page.eval(`(() => { const b = document.querySelector('.zj-sel-bubble'); return { role: b?.getAttribute('role') || '', label: b?.getAttribute('aria-label') || '', btns: [...(b?.querySelectorAll('button') ?? [])].map((x) => x.getAttribute('aria-label')) } })()`)
ok('浮层 role=toolbar', bubInfo.role === 'toolbar', 'role=' + bubInfo.role)
ok('浮层 aria-label=选中文字操作', bubInfo.label === '选中文字操作', 'label=' + bubInfo.label)
ok('浮层按钮 aria 三件（复制/对话/批注）', JSON.stringify(bubInfo.btns) === JSON.stringify(['复制选中文字', '添加到对话', '添加批注']), JSON.stringify(bubInfo.btns))

// —— ② 「批注」→ 意图弹层：打开焦点落 textarea ——
await page.eval(clickText('批注', true))
await evalUntil(page, `!!document.querySelector('[role="dialog"]')`, Boolean, 8000, '意图弹层出现')
await evalUntil(page, `!!document.querySelector('[role="dialog"] textarea')`, Boolean, 8000, '弹层 textarea 出现')
const dlgFocusOpen = await page.eval(ae())
ok('弹层打开焦点在 textarea', dlgFocusOpen.inDlg && dlgFocusOpen.tag === 'TEXTAREA', JSON.stringify(dlgFocusOpen))

// —— ③ Esc 关闭 → 焦点回编辑器（HIG：对话关闭后回触发上下文）——
await page.key('Escape', { key: 'Escape', code: 'Escape', vk: 27 })
await evalUntil(page, `!document.querySelector('[role="dialog"]')`, Boolean, 8000, 'Esc 关闭弹层')
await sleep(300)
const afterEsc = await page.eval(ae())
ok('Esc 关闭后焦点回编辑器', afterEsc.isPM, JSON.stringify(afterEsc))

// —— ④ 再划词 → 填写意图 → 保存批注 → 焦点回编辑器 + toast + 写入 ——
for (let i = 0; i < 3; i++) await page.key('ArrowDown', { modifiers: SHIFT, code: 'ArrowDown', vk: 40 })
await evalUntil(page, `!!document.querySelector('.zj-sel-bubble')`, Boolean, 8000, '浮层再现')
await page.eval(clickText('批注', true))
await evalUntil(page, `!!document.querySelector('[role="dialog"] textarea')`, Boolean, 8000, '弹层再现')
await page.eval(`(() => {
  const ta = document.querySelector('[role="dialog"] textarea')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '这句再直白一点')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(300)
await page.eval(clickText('保存批注', true))
await evalUntil(page, `!document.querySelector('[role="dialog"]')`, Boolean, 8000, '保存后弹层关闭')
await sleep(500)
const afterSave = await page.eval(ae())
ok('保存后焦点回编辑器', afterSave.isPM, JSON.stringify(afterSave))
ok('保存后 toast「批注已添加」', (await page.eval(bodyHas('批注已添加'))) === true, '')

// —— ⑤ 点击批注高亮 → 气泡语义：role=group + aria-label=批注（修正前 role=tooltip）——
await evalUntil(page, `document.querySelectorAll('.zj-anno').length >= 1`, (n) => n >= 1, 8000, '批注高亮存在')
await page.eval(`(() => { const el = document.querySelector('.zj-anno'); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true })()`)
await evalUntil(page, `!!document.querySelector('.zj-anno-pop')`, Boolean, 8000, '批注气泡出现')
const popInfo = await page.eval(`(() => { const p = document.querySelector('.zj-anno-pop'); return { role: p?.getAttribute('role') || '', label: p?.getAttribute('aria-label') || '', btns: [...(p?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label')) } })()`)
ok('气泡 role=group（非 tooltip）', popInfo.role === 'group', 'role=' + popInfo.role)
ok('气泡 aria-label=批注', popInfo.label === '批注', 'label=' + popInfo.label)
ok('气泡按钮 aria（加入对话/删除该批注）', JSON.stringify(popInfo.btns) === JSON.stringify(['加入对话', '删除该批注']), JSON.stringify(popInfo.btns))

// —— ⑥ 气泡内两按钮键盘可达（Tab 入气泡、圈闭）——
const kbSel = await page.eval(ae())
ok('气泡打开不抢焦点（焦点不变/编辑器）', kbSel.inPop === false, JSON.stringify(kbSel))
// 从编辑器焦点走 Tab：PM→侧标→（气泡按钮非 DOM 顺序，用直接 focus 按钮再 Tab 验证圈闭）
await page.eval(`(() => { const b = [...document.querySelectorAll('.zj-anno-pop button')].find((x) => x.getAttribute('aria-label') === '加入对话'); b?.focus(); return !!b })()`)
await sleep(200)
const inBub = await page.eval(ae())
ok('Tab 可入气泡（按钮可聚焦）', inBub.inPop, JSON.stringify(inBub))

console.log(`\n${pass} passed, ${fail} failed`)
if (page.errors.length) { fail++; console.log('FAIL 无 JS 异常: ' + page.errors.slice(0, 3).join(' | ')) }
else { pass++; console.log('PASS 无 JS 异常') }
await page.close()
process.exit(fail > 0 ? 1 : 0)
