// 织卷无头冒烟 · 批注四件套联动矩阵（体验层 2026-09-20 14:15 轮：候选 1 批注交互面 HIG 走查）
// 用法：node scripts/anno-matrix-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 走查矩阵（高亮/徽标/侧标/抽屉/气泡五件套的外围交互，非单件功能——单件已有 anno-pop/nav/gutter 冒烟）：
//   ① 基线：高亮×2 + 徽标「批注 2」+ 侧标×2，且侧标容器不再 aria-hidden（焦点可播报，WCAG 4.1.2）
//   ② 侧标点击 → 跳转命中 + 划词浮层不弹（2026-09-20 修复：定位≠划词，PM 同步 DOM 选区不再开浮层）
//   ③ 抽屉条目点击 → 跳转命中 + 浮层不弹 + 焦点留在抽屉（模态不逃逸，键盘不改正文）+ 抽屉保持打开
//   ④ 批注气泡开着 → 键盘划词（Shift+↓）→ 气泡自动收起、只留划词浮层（HIG Popovers：一次只显示一个浮层）
//   ⑤ 气泡删除两条 → 徽标消失 / 侧标清零 / 高亮清零 / 抽屉不重开
//   ⑥ 全程零 JS 异常
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let fails = 0
let total = 0
function ok(name, cond, detail = '') {
  total++
  if (!cond) fails++
  console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (cond ? '' : '  ← ' + detail))
}

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
        cmd,
        errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        key: async (key, opts = {}) => {
          const { code = key, vk = 0, text, modifiers = 0 } = opts
          await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text, windowsVirtualKeyCode: vk, modifiers })
          await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers })
        },
        close: () => ws.close()
      })
    }
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT: ' + label)
    await sleep(300)
  }
}
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const state = (page) =>
  page.eval(`JSON.stringify({
    pop: !!document.querySelector('.zj-anno-pop'),
    bubble: !!document.querySelector('.zj-sel-bubble'),
    drawer: !!document.querySelector('.zj-anno-drawer'),
    badge: (() => { const b = [...document.querySelectorAll('button')].find((x) => /^批注 \\d+$/.test((x.innerText || '').trim())); return b ? b.innerText.trim() : null })(),
    marks: document.querySelectorAll('.zj-anno-mark').length,
    hl: document.querySelectorAll('.zj-anno').length,
    gutterAriaHidden: document.querySelector('.zj-anno-gutter')?.getAttribute('aria-hidden') ?? null,
    sel: window.__ZJ_EDITORS && window.__ZJ_EDITORS[0] ? (window.__ZJ_EDITORS[0].getSelected() ?? '') : '',
    aeInDrawer: !!(document.activeElement && document.activeElement.closest('.zj-anno-drawer')),
    aeInEdit: !!(document.activeElement && document.activeElement.closest('.ProseMirror'))
  })`).then(JSON.parse)

// —— 前置：打开正文页并选第1章（demo-aseya 演示批注在第1章）——
const tab = await openTab(BASE + '/#/project/demo-aseya/novel?cb=' + Date.now())
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入')
await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('第1章') && (x.textContent || '').includes('雾港')); if (b) { b.click(); return true } return false })()`)
await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
await evalUntil(page, `document.querySelectorAll('.zj-anno').length`, (n) => n === 2, 15000, '两条批注高亮')

// —— ① 基线：高亮×2 + 徽标 + 侧标×2 + 侧标容器无 aria-hidden ——
let s = await state(page)
ok('基线：高亮×2 + 徽标「批注 2」+ 侧标×2', s.hl === 2 && s.badge === '批注 2' && s.marks === 2, JSON.stringify(s))
ok('侧标容器不再 aria-hidden（isFocusable 可播报，WCAG 4.1.2）', s.gutterAriaHidden === null, 'aria-hidden=' + s.gutterAriaHidden)
ok('侧标按钮带 aria-label（定位第 N 行批注）', (await page.eval(`document.querySelector('.zj-anno-mark')?.getAttribute('aria-label') || ''`)).includes('定位第'), '')

// —— ② 侧标点击 → 跳转命中 + 划词浮层不弹（2026-09-20 联动走查修复①）——
await page.eval(`document.querySelectorAll('.zj-anno-mark')[0].click()`)
await sleep(500)
s = await state(page)
ok('侧标点击 → 模型选区命中「雨把港口」', typeof s.sel === 'string' && s.sel.includes('雨把港口'), 'sel=' + String(s.sel).slice(0, 30))
ok('侧标点击 → 划词浮层不弹（定位≠划词）', s.bubble === false, JSON.stringify({ bubble: s.bubble }))
ok('侧标点击 → 批注气泡也不弹（纯定位）', s.pop === false, '')

// —— ③ 抽屉条目点击 → 跳转 + 浮层不弹 + 焦点留在抽屉 + 抽屉保持打开（修复②）——
await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^批注 \\d+$/.test((x.innerText || '').trim())); if (!b) return false; b.click(); return true })()`)
await evalUntil(page, `!!document.querySelector('.zj-anno-drawer')`, Boolean, 8000, '抽屉出现')
await page.eval(`document.querySelectorAll('[data-testid="anno-nav-item"]')[0].click()`)
await sleep(500)
s = await state(page)
ok('抽屉条目点击 → 模型选区命中「雨把港口」', typeof s.sel === 'string' && s.sel.includes('雨把港口'), 'sel=' + String(s.sel).slice(0, 30))
ok('抽屉条目点击 → 划词浮层不弹', s.bubble === false, JSON.stringify({ bubble: s.bubble }))
ok('抽屉条目点击 → 焦点留在抽屉（模态不逃逸）', s.aeInDrawer === true && s.aeInEdit === false, JSON.stringify({ inDrawer: s.aeInDrawer, inEdit: s.aeInEdit }))
ok('抽屉保持打开（连续浏览）', s.drawer === true, '')
// 模态开着时敲键不得改正文：按 x 后文档长度不变
const lenBefore = await page.eval(`window.__ZJ_EDITORS[0].getMarkdown().length`)
await page.key('x', { code: 'KeyX', vk: 88, text: 'x' })
await sleep(400)
const lenAfter = await page.eval(`window.__ZJ_EDITORS[0].getMarkdown().length`)
ok('抽屉模态内敲键不改正文（修复②）', lenAfter === lenBefore, `len ${lenBefore}→${lenAfter}`)
// 收起抽屉（Esc）
await page.key('Escape', { code: 'Escape', vk: 27 })
await evalUntil(page, `!document.querySelector('.zj-anno-drawer')`, Boolean, 5000, 'Esc 关抽屉')

// —— ④ 批注气泡 + 键盘划词互斥（修复③）——
await page.eval(`document.querySelectorAll('.zj-anno')[0].click()`) // JS click 开气泡（同 anno-pop 冒烟口径）
await evalUntil(page, `!!document.querySelector('.zj-anno-pop')`, Boolean, 8000, '气泡出现')
await page.eval(`(() => { if (document.activeElement && !document.activeElement.closest('.ProseMirror')) { (document.querySelector('.ProseMirror') || document.body).focus() } return 1 })()`)
await page.key('ArrowDown', { code: 'ArrowDown', vk: 40, modifiers: 8 }) // Shift+↓ 键盘划词
await page.key('ArrowDown', { code: 'ArrowDown', vk: 40, modifiers: 8 })
await sleep(600)
s = await state(page)
ok('气泡开着 → Shift+↓ 划词后气泡自动收起（一次只留一个浮层）', s.pop === false && s.bubble === true, JSON.stringify({ pop: s.pop, bubble: s.bubble }))
await page.key('Escape', { code: 'Escape', vk: 27 })
await sleep(300)

// —— ⑤ 气泡删除两条 → 徽标/侧标/高亮清零 + 抽屉自动收起 ——
await page.eval(`document.querySelectorAll('.zj-anno')[0].click()`)
await evalUntil(page, `!!document.querySelector('.zj-anno-pop')`, Boolean, 8000, '气泡再次出现')
await page.eval(`document.querySelector('.zj-anno-pop-remove').click()`)
await evalUntil(page, `document.querySelectorAll('.zj-anno').length`, (n) => n === 1, 12000, '删除后剩 1 条')
await page.eval(`document.querySelectorAll('.zj-anno')[0].click()`)
await evalUntil(page, `!!document.querySelector('.zj-anno-pop')`, Boolean, 8000, '气泡（第二条）出现')
await page.eval(`document.querySelector('.zj-anno-pop-remove').click()`)
await evalUntil(page, `document.querySelectorAll('.zj-anno').length`, (n) => n === 0, 12000, '删除后清零')
await sleep(600)
s = await state(page)
ok('清零后徽标消失', s.badge === null, JSON.stringify({ badge: s.badge }))
ok('清零后侧标 0（重算清空）', s.marks === 0, 'marks=' + s.marks)
ok('清零后抽屉不重开（annoCount 0 自动收起）', s.drawer === false, '')

// —— ⑥ 零 JS 异常 ——
ok('全程零 JS 异常', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 3)))

console.log(`\n${total - fails}/${total} 通过`)
if (fails) process.exit(1)
page.close()
