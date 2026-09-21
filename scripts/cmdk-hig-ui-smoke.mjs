// 织卷无头冒烟 · 命令面板（⌘K）HIG 整页走查——Keyboard/Search fields/Menus/Lists 条款逐项核对
// 用法：node scripts/cmdk-hig-ui-smoke.mjs
// 前置：SPA server 8123（out/renderer）+ 无头 Chrome CDP 9224
// 覆盖：① ⌘K 开关+Esc 关闭  ② 打开聚焦输入框  ③ 占位/搜索图标/清空按钮
//       ④ 分组渲染（页面/最近素材/打开章节/打开项目/帮助）  ⑤ 输入即搜（本地过滤+素材全文搜索）
//       ⑥ 上下键选择+Enter 执行  ⑦ 空态文案  ⑧ 窄窗 1000×700 无溢出  ⑨ dark 语义色  ⑩ 零 JS 异常
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
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
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    }
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
    await sleep(250)
  }
}

async function press(page, key, code, vk, mod = 0) {
  await page.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mod })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mod })
}
const cmdK = (page) => press(page, 'k', 'KeyK', 75, 4) // Meta+K
const esc = (page) => press(page, 'Escape', 'Escape', 27)
const arrow = (page, dir) => press(page, dir, dir, dir === 'ArrowDown' ? 40 : 38)
const enter = (page) => press(page, 'Enter', 'Enter', 13)

async function openPalette(page, label = '') {
  await cmdK(page)
  await evalUntil(page, `!!document.querySelector('[cmdk-root]')`, (v) => v === true, 8000, '面板出现' + label)
}

async function closePalette(page) {
  await esc(page)
  await evalUntil(page, `!document.querySelector('[cmdk-root]')`, (v) => v === true, 8000, '面板关闭')
}

const itText = (page) => page.eval(`[...document.querySelectorAll('[cmdk-item]')].filter((i) => !i.hasAttribute('hidden')).map((i) => i.innerText.trim())`)
const groups = (page) => page.eval(`[...document.querySelectorAll('[cmdk-group-heading]')].map((g) => g.innerText)`)

try {
  // ============ Tab A：项目内·宽窗 ============
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, `document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')

  // ① ⌘K 打开 + 打开即聚焦 + 占位/搜索图标
  await openPalette(page, ' A①')
  ok('A① ⌘K 打开面板', true)
  const focused = await page.eval(`document.activeElement && document.activeElement.matches('[cmdk-input]')`)
  ok('A② 打开即聚焦输入框', focused === true)
  const ph = await page.eval(`document.querySelector('[cmdk-input]')?.getAttribute('placeholder') ?? ''`)
  ok('A③ 占位文字', ph.includes('页面') && ph.includes('章节') && ph.includes('素材'), ph)
  const hasSearchIcon = await page.eval(`!!document.querySelector('[cmdk-input-wrapper] svg.lucide-search')`)
  ok('A④ 搜索图标', hasSearchIcon === true)

  // ④ 分组渲染（q 空：页面/最近素材/打开章节/打开项目/帮助）
  await sleep(1200) // 等最近素材/章节加载
  const g0 = await groups(page)
  ok('A⑤ 分组渲染', ['页面', '最近素材', '打开章节', '打开项目', '帮助'].every((g) => g0.includes(g)), 'groups=' + JSON.stringify(g0))
  const recentVisible = await page.eval(`(() => { const g = [...document.querySelectorAll('[cmdk-group]')].find((x) => x.querySelector('[cmdk-group-heading]')?.innerText.includes('最近素材')); if (!g) return 0; return [...g.querySelectorAll('[cmdk-item]')].filter((i) => !i.hasAttribute('hidden')).length })()`)
  ok('A⑥ 最近素材建议可达（q 空显示）', recentVisible > 0, 'n=' + recentVisible)

  // 可访问名称（WCAG 4.1.2：dialog/combobox/listbox 均须有名称；探针曾实锤三项为 null/英文默认）
  const aria = await page.eval(`(() => {
    const dlg = document.querySelector('[role="dialog"]')
    const input = document.querySelector('[cmdk-input]')
    const list = document.querySelector('[cmdk-list]')
    const lbl = input ? document.getElementById(input.getAttribute('aria-labelledby')) : null
    return { dlgLabel: dlg?.getAttribute('aria-label') ?? null, listLabel: list?.getAttribute('aria-label') ?? null, inputLbl: lbl ? lbl.textContent ?? '' : null }
  })()`)
  ok('A⑥b 对话框有可访问名称', aria.dlgLabel === '命令面板', JSON.stringify(aria))
  ok('A⑥c 结果列表 aria-label 中文', aria.listLabel === '搜索结果', aria.listLabel)
  ok('A⑥d 输入框有可访问名称', (aria.inputLbl ?? '').includes('命令面板'), JSON.stringify(aria.inputLbl))

  // ⑤ 输入即搜：本地过滤（输入「人物」→ 页面「人物设定」）且素材全文搜索组出现（输入「茶楼」→ 素材命中）
  await page.eval(`document.querySelector('[cmdk-input]').focus()`)
  await page.cmd('Input.insertText', { text: '人物' })
  await sleep(500)
  let items = await itText(page)
  ok('A⑦ 输入即搜·本地过滤', items.some((t) => t.includes('人物设定')) && items.every((t) => !t.includes('打开项目')), 'items=' + JSON.stringify(items.slice(0, 6)))
  // 清空按钮
  const clearVis = await page.eval(`!!document.querySelector('[data-testid="cmd-input-clear"]')`)
  ok('A⑧ 清空按钮（非空时显示）', clearVis === true)
  await page.eval(`document.querySelector('[data-testid="cmd-input-clear"]').click()`)
  await sleep(400)
  const q2 = await page.eval(`document.querySelector('[cmdk-input]').value`)
  ok('A⑨ 清空按钮清空+回焦', q2 === '' && (await page.eval(`document.activeElement && document.activeElement.matches('[cmdk-input]')`)) === true)
  // 素材全文搜索
  await page.cmd('Input.insertText', { text: '茶楼' })
  await sleep(1400) // 300ms 防抖 + 搜索
  items = await itText(page)
  const matGroup = await page.eval(`[...document.querySelectorAll('[cmdk-group-heading]')].map((g) => g.innerText).filter((t) => t.includes('素材'))`)
  ok('A⑩ 素材全文搜索·分组+命中', matGroup.some((t) => t.includes('素材')) && items.some((t) => t.includes('茶楼')), 'mat=' + JSON.stringify(matGroup) + ' items=' + JSON.stringify(items.slice(0, 4)))
  // 清空输入
  await page.eval(`(() => { const el = document.querySelector('[cmdk-input]'); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await sleep(500)

  // ⑥ 上下键选择 + Enter 执行：多命中查询（雾）→ ArrowDown 移动选中 → 语义断言
  await page.eval(`document.querySelector('[cmdk-input]').focus()`)
  await page.cmd('Input.insertText', { text: '雾' })
  await sleep(600)
  const selBefore = await page.eval(`document.querySelector('[cmdk-item][data-selected="true"]')?.innerText ?? ''`)
  ok('A⑪ 默认有选中项', selBefore.length > 0, selBefore.slice(0, 30))
  await arrow(page, 'ArrowDown')
  await sleep(300)
  const selAfter = await page.eval(`document.querySelector('[cmdk-item][data-selected="true"]')?.innerText ?? ''`)
  ok('A⑫ ↓ 键移动选中', selAfter !== selBefore && selAfter.length > 0, 'before=' + JSON.stringify(selBefore.slice(0, 20)) + ' after=' + JSON.stringify(selAfter.slice(0, 20)))
  // 回退选中「页面」项再 Enter 跳时间线：输入「时间线」（单命中→选中即该项）
  await page.eval(`(() => { const el = document.querySelector('[cmdk-input]'); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await sleep(400)
  await page.cmd('Input.insertText', { text: '时间线' })
  await sleep(600)
  await enter(page)
  await evalUntil(page, `location.hash.includes('timeline')`, (v) => v === true, 8000, '跳转时间线')
  ok('A⑬ Enter 执行选中项', true, 'hash=' + (await page.eval(`location.hash`)))

  // ⑦ 空态文案
  await openPalette(page, ' A⑦')
  await page.eval(`document.querySelector('[cmdk-input]').focus()`)
  await page.cmd('Input.insertText', { text: 'zzzz不存在' })
  await sleep(700)
  const empty = await page.eval(`document.querySelector('[cmdk-empty]')?.innerText ?? ''`)
  ok('A⑭ 空态文案', empty.includes('没有匹配的结果'), empty)
  await closePalette(page)
  ok('A⑮ Esc 关闭面板', true)

  // ============ Tab B：窄窗 1000×700 + dark ============
  const tab2 = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  const page2 = await attach(tab2.webSocketDebuggerUrl)
  await evalUntil(page2, `document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪2')
  await page2.cmd('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  await openPalette(page2, ' B')
  await sleep(1200)
  // 面板宽度/位置
  const box = await page2.eval(`(() => { const d = document.querySelector('[cmdk-root]'); if (!d) return null; const r = d.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), sw: window.innerWidth, sh: window.innerHeight } })()`)
  ok('B① 窄窗面板在视口内', !!box && box.x >= 0 && box.y >= 0 && box.x + box.w <= box.sw && box.y + box.h <= box.sh, JSON.stringify(box))
  const overflowX = await page2.eval(`(() => { const d = document.querySelector('[cmdk-list]'); return d ? d.scrollWidth - d.clientWidth : -1 })()`)
  ok('B② 结果列无横向溢出', overflowX === 0, 'overflowX=' + overflowX)
  // 行内元素不越界（检查所有 item 的 scrollWidth）
  const rowOverflow = await page2.eval(`[...document.querySelectorAll('[cmdk-item]')].filter((i) => !i.hasAttribute('hidden')).map((i) => i.scrollWidth - i.clientWidth).filter((d) => d > 1).length`)
  ok('B③ 行内无越界', rowOverflow === 0, 'n=' + rowOverflow)
  // dark 语义色（主题=class 开关，applyTheme 同制）
  await page2.eval(`(() => { document.documentElement.classList.add('dark'); return true })()`)
  await sleep(400)
  const darkBg = await page2.eval(`getComputedStyle(document.querySelector('[cmdk-root]')).backgroundColor`)
  ok('B④ dark 面板背景为语义深色', !!darkBg && !/rgba\(255, 255, 255/.test(darkBg) && darkBg !== 'rgba(0, 0, 0, 0)', darkBg)
  const darkItemFg = await page2.eval(`getComputedStyle(document.querySelector('[cmdk-item]')).color`)
  ok('B⑤ dark 条目文字可读', !!darkItemFg && darkItemFg !== 'rgba(0, 0, 0, 0)', darkItemFg)

  // 零 JS 异常（两 tab 合并检查）
  await sleep(500)
  const errs = [...page.errors, ...page2.errors].filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e))
  ok('B⑥ 零 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))

  page.close()
  page2.close()
  await sleep(400)
} catch (e) {
  console.error('FATAL ' + e.message)
  fails++
}

console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL (' + fails + ')')
process.exit(fails === 0 ? 0 : 1)
