// 织卷无头冒烟 · 编辑器浮层键盘可达（体验层 2026-09-13 20:15 轮：候选 1 质感主线补充）
// 用法：node scripts/float-kbd-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim 演示项目，第1章）：键盘选择（Shift+↓）→ 浮层出现（toolbar 语义）
//   → 焦点在编辑器内 Esc 关浮层 → 再键盘选择 → Tab 经侧标进浮层按钮 → Enter 激活「对话」→ 浮层关+焦点回编辑器+引用入 agent
//   → 批注气泡：点开不抢焦点 → Tab×3 入气泡 → Tab/⇧Tab 圈闭不逃逸 → Esc 关+焦点回编辑器
//   → 查找高亮对比度走查（暖纸/深色两主题：样式规则+变量 → WCAG 相对亮度/对比度，cur 与 hit 文字对比 ≥4.5）
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
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((res) => {
    ws.onopen = () =>
      res({
        cmd,
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
const clickText = (text, exact = true) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!el) return false
  el.click()
  return true
})()`
const ae = () => `(() => { const a = document.activeElement; return { tag: a?.tagName || '', aria: a?.getAttribute?.('aria-label') || '', txt: (a?.innerText || '').trim().slice(0, 10), isPM: !!a?.closest?.('.ProseMirror'), inFloat: !!a?.closest?.('.zj-sel-bubble'), inPop: !!a?.closest?.('.zj-anno-pop') } })()`
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

// —— ① 键盘选择（Shift+ArrowDown×3）→ 浮层出现且为 toolbar 语义 ——
for (let i = 0; i < 3; i++) await page.key('ArrowDown', { modifiers: SHIFT, code: 'ArrowDown', vk: 40 })
await evalUntil(page, `!!document.querySelector('.zj-sel-bubble')`, Boolean, 8000, '键盘选择出浮层')
ok('键盘选择（Shift+↓）出划词浮层', true, '')
const bubInfo = await page.eval(`(() => { const b = document.querySelector('.zj-sel-bubble'); return { role: b?.getAttribute('role') || '', label: b?.getAttribute('aria-label') || '', btns: [...(b?.querySelectorAll('button') ?? [])].map((x) => x.getAttribute('aria-label')) } })()`)
ok('浮层 role=toolbar + aria-label（语义容器）', bubInfo.role === 'toolbar' && bubInfo.label === '选中文字操作', JSON.stringify(bubInfo))
ok('浮层三操作（复制/对话/批注）及 aria-label', JSON.stringify(bubInfo.btns) === JSON.stringify(['复制选中文字', '添加到对话', '添加批注']), JSON.stringify(bubInfo.btns))

// —— ② 焦点在编辑器内按 Esc → 浮层关、焦点留编辑器（HIG：Esc 取消当前上下文）——
await page.key('Escape', { code: 'Escape', vk: 27 })
await evalUntil(page, `!document.querySelector('.zj-sel-bubble')`, Boolean, 5000, 'Esc 关浮层')
const ae2 = await page.eval(ae())
ok('编辑器内 Esc 关浮层', true, '')
ok('Esc 后焦点仍在编辑器（不丢）', ae2.isPM === true, JSON.stringify(ae2))

// —— ③ 再键盘选择 → Tab 序列（PM→批注侧标×2→浮层按钮）→ Enter 激活「对话」→ 浮层关+焦点回编辑器+引用入 agent ——
for (let i = 0; i < 3; i++) await page.key('ArrowDown', { modifiers: SHIFT, code: 'ArrowDown', vk: 40 })
await evalUntil(page, `!!document.querySelector('.zj-sel-bubble')`, Boolean, 8000, '浮层再现')
let entered = false
for (let i = 1; i <= 6; i++) {
  await page.key('Tab', { code: 'Tab', vk: 9 })
  await sleep(200)
  const a = await page.eval(ae())
  if (a.inFloat) { entered = true; break }
}
ok('Tab 键盘可达浮层按钮（经批注侧标）', entered, JSON.stringify(await page.eval(ae())))
const focusInFloat = await page.eval(ae())
ok('焦点落在浮层内（复制按钮为首焦）', focusInFloat.inFloat && focusInFloat.aria === '复制选中文字', JSON.stringify(focusInFloat))
// Enter 激活当前按钮？先 Tab 到「对话」按钮（第 2 个）
await page.key('Tab', { code: 'Tab', vk: 9 })
await sleep(200)
const cur = await page.eval(ae())
ok('Tab 到「添加到对话」按钮', cur.inFloat && cur.aria === '添加到对话', JSON.stringify(cur))
await page.key('Enter', { code: 'Enter', vk: 13, text: '\r' })
await sleep(800)
ok('Enter 激活「对话」后浮层关闭', (await page.eval(`!!document.querySelector('.zj-sel-bubble')`)) === false, '')
const ae3 = await page.eval(ae())
ok('动作后焦点回编辑器', ae3.isPM === true, JSON.stringify(ae3))
await evalUntil(
  page,
  `[...document.querySelectorAll('span')].some((s) => s.className.includes('line-clamp-2') && s.textContent.includes('雨把港口'))`,
  Boolean,
  8000,
  'agent 引用条出现'
)
ok('选中文字作为引用进入 agent 区', true, '')

// —— ④ 批注气泡：点高亮打开（不抢焦点）→ Tab×3 入气泡 → 圈闭 → ⇧Tab 反向 → Esc 关+回焦 ——
await page.eval(`document.querySelector('.zj-anno').click()`)
await evalUntil(page, `!!document.querySelector('.zj-anno-pop')`, Boolean, 8000, '气泡出现')
const ae4 = await page.eval(ae())
ok('气泡打开不抢焦点（焦点留编辑器）', ae4.isPM === true || ae4.inPop === true, JSON.stringify(ae4))
await page.key('Tab', { code: 'Tab', vk: 9 }) // 侧标1
await sleep(200)
await page.key('Tab', { code: 'Tab', vk: 9 }) // 侧标2
await sleep(200)
await page.key('Tab', { code: 'Tab', vk: 9 }) // 气泡「加入对话」
await sleep(200)
const ae5 = await page.eval(ae())
ok('Tab 键盘进气泡（加入对话为首焦）', ae5.inPop && ae5.aria === '加入对话', JSON.stringify(ae5))
await page.key('Tab', { code: 'Tab', vk: 9 })
await sleep(200)
const ae6 = await page.eval(ae())
ok('Tab 圈闭→删除该批注', ae6.inPop && ae6.aria === '删除该批注', JSON.stringify(ae6))
await page.key('Tab', { code: 'Tab', vk: 9 })
await sleep(200)
const ae7 = await page.eval(ae())
ok('Tab 再循环回「加入对话」（不逃逸）', ae7.inPop && ae7.aria === '加入对话', JSON.stringify(ae7))
await page.key('Tab', { code: 'Tab', vk: 9, modifiers: SHIFT })
await sleep(200)
const ae8 = await page.eval(ae())
ok('⇧Tab 反向圈闭', ae8.inPop && ae8.aria === '删除该批注', JSON.stringify(ae8))
await page.key('Escape', { code: 'Escape', vk: 27 })
await evalUntil(page, `!document.querySelector('.zj-anno-pop')`, Boolean, 5000, 'Esc 关气泡')
const ae9 = await page.eval(ae())
ok('气泡 Esc 关闭后焦点回编辑器', ae9.isPM === true, JSON.stringify(ae9))

// —— ⑤ 查找高亮对比度走查（暖纸/深色两主题；::highlight 无法 computed，用样式规则+变量→WCAG 公式）——
const wcag = await page.eval(`(() => {
  const cs = document.documentElement
  const gv = (n) => cs.style.getPropertyValue(n)
  const rule = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules] } catch { return [] } })
    .filter((r) => r.selectorText && r.selectorText.includes('zj-find-hit')).map((r) => r.cssText).join(' | ')
  const ruleCur = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules] } catch { return [] } })
    .filter((r) => r.selectorText && r.selectorText.includes('zj-find-cur')).map((r) => r.cssText).join(' | ')
  function parseVars() {
    const st = getComputedStyle(document.documentElement)
    return { accent: st.getPropertyValue('--accent').trim(), accentInk: st.getPropertyValue('--accent-ink').trim(), surface: st.getPropertyValue('--surface').trim(), ink: st.getPropertyValue('--ink').trim() }
  }
  return { light: { vars: parseVars(), hitRule: rule, curRule: ruleCur }, dark: null }
})()`)
// 深色：切主题后读
await page.eval(`window.dispatchEvent(new CustomEvent('zj:theme-toggle-test'))`).catch(() => {})
const darkVars = await page.eval(`(() => { document.documentElement.classList.add('dark'); const st = getComputedStyle(document.documentElement); const o = { accent: st.getPropertyValue('--accent').trim(), accentInk: st.getPropertyValue('--accent-ink').trim(), surface: st.getPropertyValue('--surface').trim(), ink: st.getPropertyValue('--ink').trim() }; document.documentElement.classList.remove('dark'); return o })()`)
ok('命中高亮规则为 accent 22% 混合（zj-find-hit）', wcag.light.hitRule.includes('22%'), wcag.light.hitRule.slice(0, 120))
ok('当前高亮规则为 accent 实底+accent-ink（zj-find-cur）', wcag.light.curRule.includes('background: var(--accent)') || wcag.light.curRule.includes('--accent-ink'), wcag.light.curRule.slice(0, 120))

// WCAG 对比度计算
function lin(c) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
function lum(rgb) { return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]) }
function ratio(a, b) { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) }
function hex(h) {
  h = h.trim()
  if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3] // 3 位缩写（如 #fff）
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}
function mix(a, b, p) { return [0, 1, 2].map((i) => Math.round(a[i] * p + b[i] * (1 - p))) }
const themes = [
  { name: '暖纸', v: wcag.light.vars },
  { name: '深色', v: darkVars }
]
for (const t of themes) {
  const accent = hex(t.v.accent), ink = hex(t.v.ink), surface = hex(t.v.surface), accentInk = hex(t.v.accentInk)
  const hitBg = mix(accent, surface, 0.22) // color-mix(in srgb, accent 22%, transparent) 叠 surface（近似 srgb 空间）
  const curRatio = ratio(accent, accentInk)
  const hitTextRatio = ratio(ink, hitBg)
  ok(`${t.name} · 当前高亮 (cur) 对比度 ≥4.5`, curRatio >= 4.5, 'curRatio=' + curRatio.toFixed(2))
  ok(`${t.name} · 命中高亮 (hit) 文字对比度 ≥4.5`, hitTextRatio >= 4.5, 'hitTextRatio=' + hitTextRatio.toFixed(2) + ' hitBg=rgb(' + hitBg.join(',') + ')')
}

console.log('---')
console.log(pass + '/' + (pass + fail) + ' PASS')
page.close()
process.exit(fail ? 1 : 0)
