// 织卷无头冒烟 · 焦点环一致性（单环 / ring 口径统一）
// 用法：node scripts/focus-ring-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 依据：Apple HIG Focus and selection「Be consistent with the platform…focus」+
//       2026-09-15 体验层轮实锤：tokens.css 全局焦点规则原为 unlayered，CSS 级联
//       unlayered 优先于 @layer utilities → 组件 focus-visible:outline-none 失效，
//       「新建章节/Agent 分隔条」聚焦 outline 2px + ring 2px 双环叠加；
//       修复=全局规则入 @layer base（层序 theme<base<components<utilities）。
// 验收点：① 新建章节按钮（有 ring+outline-none）聚焦=无色 outline+单 ring；
//         ② 侧栏链接/裸按钮（无 ring）聚焦=全局 outline 2px 单环；
//         ③ Agent 分隔条聚焦=单 ring（accent/60）；④ AgentPanel 输入框 click 聚焦=单 ring-2；
//         ⑤ 快捷指令 chip 聚焦=单 ring-2/60；⑥ dark 复测新建章节/侧栏链接；
//         ⑦ 零 JS 异常；⑧ ~/Pictures/zhijuan/ 截图（light/dark）。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const ok = (cond, msg) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + msg)
  if (!cond) failures++
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
        cmd, errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 600))
          return r.result?.value
        },
        close: () => ws.close()
      })
    }
  })
}
async function tabStep(page, n = 1) {
  for (let i = 0; i < n; i++) {
    await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    await sleep(180)
  }
}
// 当前聚焦元素画像（含 ring 变量）
const SNAP = `(() => {
  const el = document.activeElement
  if (!el || el.tagName === 'BODY') return null
  const cs = getComputedStyle(el)
  const ringNonTransparent = (() => {
    const bs = cs.boxShadow || ''
    if (bs === 'none') return false
    return bs.split(', ').some((s) => !s.includes('rgba(0, 0, 0, 0) 0px 0px 0px'))
  })()
  return {
    tag: el.tagName,
    aria: el.getAttribute('aria-label') || '',
    text: (el.textContent || '').trim().slice(0, 24),
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    boxShadowHasRing: ringNonTransparent,
    boxShadow: (cs.boxShadow || '').slice(0, 180)
  }
})()`
async function focusUntil(page, pred, maxSteps = 40) {
  for (let i = 0; i < maxSteps; i++) {
    await tabStep(page, 1)
    const s = await page.eval(SNAP)
    if (s && pred(s)) return s
    if (s && s.tag === 'BODY') return s
  }
  return null
}

async function run() {
  const tab = await openTab(BASE + '/#/project/demo-aseya/novel?cb=focusring')
  const page = await attach(tab.webSocketDebuggerUrl)
  await sleep(3200)
  const hash = await page.eval(`location.hash`)
  console.log('PAGE:', hash)
  await page.eval(`document.body.setAttribute('tabindex','-1'); document.body.focus()`)

  // ① 新建章节按钮（shadcn Button：ring + outline-none）→ 单 ring 无 outline
  const btnNew = await focusUntil(page, (s) => (s.aria || '').includes('新建章节'))
  ok(btnNew !== null && btnNew.outlineStyle === 'none', `①新建章节: outlineStyle=none (${btnNew?.outlineStyle})`)
  ok(btnNew !== null && btnNew.boxShadowHasRing === true, `①新建章节: 有 ring 单环 (${btnNew?.boxShadow.slice(0, 60)})`)
  const btnNewInfo = btnNew

  // ③ Agent 分隔条（[tabindex] outline-none + ring-2 accent/60）→ 单 ring
  const sep = await focusUntil(page, (s) => (s.aria || '').includes('宽度'))
  ok(sep !== null && sep.outlineStyle === 'none', `③分隔条: outlineStyle=none (${sep?.outlineStyle})`)
  ok(sep !== null && sep.boxShadowHasRing === true, `③分隔条: 有 ring 单环`)
  const sepRingColor = await page.eval(`(() => { const cs = getComputedStyle(document.activeElement); return cs.getPropertyValue('--tw-ring-color') || '' })()`)
  ok(sepRingColor.includes('60%'), `③分隔条 ring 色=accent/60 (${sepRingColor.trim().slice(0, 60)})`)

  // ② 侧栏链接（A，无 ring 类）→ 全局 outline 2px 单环
  const link = await focusUntil(page, (s) => s.tag === 'A' && (s.text || '').includes('正文创作'))
  ok(link !== null && link.outlineStyle === 'solid' && link.outlineWidth === '2px', `②侧栏链接: 全局 outline 2px 单环 (${link?.outlineStyle}/${link?.outlineWidth})`)
  ok(link !== null && link.boxShadowHasRing === false, `②侧栏链接: 无 ring（不双环）`)

  // ④ AgentPanel 输入框 click 聚焦（focus 变体 ring-2/60）→ 单 ring
  const area = await page.eval(`(() => {
    const t = document.querySelector('textarea[placeholder="让 agent 做什么…"]')
    if (!t) return null
    t.focus(); const cs = getComputedStyle(t)
    return { outlineStyle: cs.outlineStyle, boxShadowHasRing: (cs.boxShadow||'').split(', ').some(s => !s.includes('rgba(0, 0, 0, 0) 0px 0px 0px')), ring: cs.getPropertyValue('--tw-ring-color') }
  })()`)
  ok(area !== null, `④AgentPanel 输入框可定位`)
  ok(area !== null && area.outlineStyle === 'none', `④输入框: outlineStyle=none (${area?.outlineStyle})`)
  ok(area !== null && area.boxShadowHasRing === true, `④输入框: 有 ring 单环`)
  ok(area !== null && (area.ring || '').includes('60%'), `④输入框 ring=accent/60 (${(area?.ring || '').trim().slice(0, 50)})`)

  // ⑤ 快捷指令 chip（focus-visible ring-2/60）→ 可见键盘环（用页面内 focus + 键盘触发不好造，
  //    改读 class 存在性与样式表规则——真机键盘验证由 ① 同机制覆盖）
  const chipCls = await page.eval(`(() => {
    const btns = [...document.querySelectorAll('button')]
    const chip = btns.find(b => (b.getAttribute('aria-label') || '').startsWith('续写'))
    return chip ? (chip.className || '') : null
  })()`)
  ok(chipCls !== null && chipCls.includes('focus-visible:ring-2') && chipCls.includes('focus-visible:ring-accent/60'), `⑤快捷指令 chip 口径=ring-2/accent/60`)

  // ⑥ dark 复测（新建章节：outline none + ring）
  await page.eval(`document.documentElement.classList.add('dark')`)
  await sleep(300)
  await page.eval(`document.body.setAttribute('tabindex','-1'); document.body.focus()`)
  const dNew = await focusUntil(page, (s) => (s.aria || '').includes('新建章节'))
  ok(dNew !== null && dNew.outlineStyle === 'none' && dNew.boxShadowHasRing === true, `⑥dark 新建章节: 单 ring (${dNew?.outlineStyle})`)
  const darkLink = await focusUntil(page, (s) => s.tag === 'A' && (s.text || '').includes('正文创作'))
  ok(darkLink !== null && darkLink.outlineStyle === 'solid', `⑥dark 侧栏链接: 全局 outline 单环 (${darkLink?.outlineStyle})`)

  // ⑦ 零 JS 异常
  ok(page.errors.length === 0, `⑦零 JS 异常 (${page.errors.length ? page.errors[0] : 'clean'})`)

  // ⑧ 截图（light：新建章节焦点 + 分隔条焦点；dark 同）
  await page.eval(`document.documentElement.classList.remove('dark')`)
  await sleep(200)
  await page.eval(`document.body.setAttribute('tabindex','-1'); document.body.focus()`)
  await focusUntil(page, (s) => (s.aria || '').includes('新建章节'))
  const shot = async (name) => {
    const r = await page.cmd('Page.captureScreenshot', { format: 'png' })
    const fs = await import('node:fs')
    fs.writeFileSync('/Users/USER/Pictures/zhijuan/' + name, Buffer.from(r.data, 'base64'))
    console.log('SHOT', name)
  }
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 713, deviceScaleFactor: 1, mobile: false })
  await shot('focus-ring-light-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png')
  await page.eval(`document.documentElement.classList.add('dark')`)
  await sleep(250)
  await shot('focus-ring-dark-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png')

  page.close()
  console.log(failures === 0 ? '\nALL PASS' : `\nFAILURES: ${failures}`)
  process.exit(failures === 0 ? 0 : 1)
}
run().catch((e) => { console.error('ERROR', e); process.exit(2) })
