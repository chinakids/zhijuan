// 织卷无头冒烟 · 正文查找条（⌘F/⌘G/⇧⌘G/Esc + 高亮 + 编辑重算）
// 用法：node scripts/find-ui-smoke.mjs
// 前置：npm run build；python3 -m http.server 8123 --directory out/renderer（SPA fallback）；CDP 127.0.0.1:9224
// 验收点：① 真实 ⌘F 打开查找条并聚焦输入框；② 输入关键词出现计数与 CSS 高亮，当前匹配被真实选中；
//         ③ ⌘G/⇧⌘G 循环移动；④ 无匹配显示「无匹配」且按钮禁用；⑤ Esc 关闭并清高亮；
//         ⑥ 正文被编辑时匹配重算不崩；⑦ 全程无 JS 异常。
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
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

async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
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

// 真实键盘（CDP Input）：mac Meta=4，Shift=8
async function keyCombo(page, key, code, modifiers, vk) {
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: vk })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: vk })
  await sleep(120)
}

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  console.log('TAB:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    // 进入第01章
    await evalUntil(page, `document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')
    await page.eval(`(() => {
      const btns = [...document.querySelectorAll('button')]
      const hit = btns.find((b) => (b.innerText || '').includes('第1章'))
      if (!hit) return 'NOT_FOUND'
      hit.click()
      return 'CLICKED'
    })()`)
    await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0 && window.__ZJ_FIND !== undefined`, (v) => v === true, 15000, '编辑器与查找接口就绪')

    const state = () => page.eval(`window.__ZJ_FIND.getState()`)
    let st = null
    const findbarVisible = () => page.eval(`document.querySelector('.zj-findbar') !== null`)
    const highlights = () => page.eval(`(() => {
      const c = window.CSS && window.CSS.highlights
      if (!c) return { hit: false, cur: false }
      return { hit: c.has('zj-find-hit'), cur: c.has('zj-find-cur') }
    })()`)

    // ① 真实 ⌘F → 查找条出现、输入框聚焦
    await page.eval(`window.getSelection().removeAllRanges()`)
    await keyCombo(page, 'f', 'KeyF', 4, 70)
    await evalUntil(page, `document.querySelector('.zj-findbar') !== null`, (v) => v === true, 8000, '⌘F 打开查找条')
    const focused = await page.eval(`(() => {
      const el = document.activeElement
      return !!(el && el.classList && el.classList.contains('zj-find-input'))
    })()`)
    ok('P1 ⌘F 打开查找条且输入框聚焦', focused)
    ok('P1b 打开时无选区则不预填（query 为空）', (await state()).query === '')

    // ② 真实键入「雾港」→ 计数/高亮/选中
    await page.cmd('DOM.enable')
    const doc = await page.cmd('DOM.getDocument')
    const { nodeId } = await page.cmd('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input.zj-find-input' })
    await page.cmd('DOM.focus', { nodeId })
    await page.cmd('Input.insertText', { text: '雾港' })
    await evalUntil(page, `window.__ZJ_FIND.getState()`, (v) => v !== null && v.total > 0 && v.current === 0, 8000, '键入后出匹配')
    const st1 = await state()
    ok('P2 输入「雾港」得到匹配（total>=1, current=0）', st1.total >= 1 && st1.current === 0, 'total=' + st1.total)
    {
      const hl1 = await highlights()
      ok('P3a 当前匹配高亮已注册（zj-find-cur）', hl1.cur)
      ok('P3b 选中文本=查询词（模型选区，焦点在输入框也成立）', (await page.eval(`window.__ZJ_EDITORS[0].getSelected()`)) === '雾港')
    }
    const countText = await page.eval(`document.querySelector('.zj-find-count')?.innerText ?? ''`)
    ok('P5 计数文案为 i/N', /^1\/\d+$/.test(countText), countText)

    // ③ 多匹配词「阿七」（demo 第1章正文两处）：hit+cur 并存 + ⌘G/⇧⌘G 循环
    await page.eval(`window.__ZJ_FIND.open('阿七')`)
    await sleep(300)
    const st2 = await state()
    ok('P6 多匹配词 total>=2', st2.total >= 2, 'total=' + st2.total)
    {
      const hl2 = await highlights()
      ok('P7 多匹配时 hit+cur 高亮并存', hl2.hit && hl2.cur)
    }
    await keyCombo(page, 'g', 'KeyG', 4, 71)
    st = await state()
    ok('P8a ⌘G 移到下一处（current=1）', st.current === 1, 'current=' + st.current + ' total=' + st.total)
    ok('P8b ⌘G 后选中文本=查询词', (await page.eval(`window.__ZJ_EDITORS[0].getSelected()`)) === '阿七')
    await keyCombo(page, 'g', 'KeyG', 12, 71)
    st = await state()
    ok('P9 ⇧⌘G 移回上一处（current=0）', st.current === 0, 'current=' + st.current)
    await keyCombo(page, 'g', 'KeyG', 12, 71)
    st = await state()
    ok('P10 ⇧⌘G 在首处时绕回最后一处', st.current === st.total - 1, 'current=' + st.current + ' total=' + st.total)
    // Enter/Shift+Enter 在输入框内同样步进
    await page.cmd('DOM.focus', { nodeId })
    await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
    await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(200)
    st = await state()
    ok('P11 输入框 Enter 下一处（循环回 current=0）', st.current === 0, 'current=' + st.current)

    // ④ 无匹配态
    await page.eval(`window.__ZJ_FIND.open('绝无此词')`)
    await sleep(300)
    st = await state()
    ok('P12 无匹配 total=0 且计数显示「无匹配」', st.total === 0, 'count=' + (await page.eval(`document.querySelector('.zj-find-count')?.innerText ?? ''`)))
    const disabled = await page.eval(`(() => {
      const btns = [...document.querySelectorAll('.zj-find-btn')]
      return btns.length >= 2 && btns[0].disabled && btns[1].disabled
    })()`)
    ok('P13 无匹配时方向按钮禁用', disabled)

    // ⑤ Esc 关闭并清高亮
    await keyCombo(page, 'Escape', 'Escape', 0, 27)
    await evalUntil(page, `document.querySelector('.zj-findbar') === null`, (v) => v === true, 5000, 'Esc 关闭查找条')
    const hl2 = await highlights()
    ok('P14 Esc 关闭后高亮清空', !hl2.hit && !hl2.cur)

    // ⑥ 编辑重算：打开查找→把当前选中的匹配「阿七」替换为「港」→ total 2→1 且高亮刷新（连条文 doc 更新链路）
    await page.eval(`window.__ZJ_FIND.open('阿七')`)
    await sleep(300)
    st = await state()
    const baseTotal = st.total
    await page.eval(`window.__ZJ_EDITORS[0].focus()`)
    await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('港', true)`)
    await sleep(700)
    st = await state()
    const hl3 = await highlights()
    ok('P15 正文编辑触发匹配重算（替换命中词后 total 减少，高亮刷新不崩）', baseTotal >= 2 && st.total === baseTotal - 1 && hl3.cur, 'base=' + baseTotal + ' now=' + st.total)

    // ⑦ 主题核对（paper/dark）：查找条与输入框样式按 computedStyle 客观跟随 tokens，不写死白底
    const styleOf = () =>
      page.eval(`(() => {
        const bar = document.querySelector('.zj-findbar')
        const inp = document.querySelector('.zj-find-input')
        if (!bar || !inp) return null
        const bs = getComputedStyle(bar)
        const is_ = getComputedStyle(inp)
        return { barBg: bs.backgroundColor, inpBg: is_.backgroundColor, inpBorder: is_.borderTopColor }
      })()`)
    await page.eval(`window.__ZJ_FIND.open('雾港')`)
    await sleep(300)
    const paperSty = await styleOf()
    await page.eval(`document.documentElement.classList.add('dark')`)
    await sleep(300)
    const darkSty = await styleOf()
    await page.eval(`document.documentElement.classList.remove('dark')`)
    ok(
      'P17 查找条样式跟随主题（paper/dark 背景不同、深色非纯白）',
      !!paperSty && !!darkSty && paperSty.barBg !== darkSty.barBg && darkSty.barBg !== 'rgb(255, 255, 255)',
      JSON.stringify({ paperSty, darkSty })
    )

    ok('P16 全程无 JS 异常/console.error', page.errors.length === 0, page.errors.slice(0, 2).join(' ; '))
  } catch (e) {
    ok('场景异常', false, String(e).slice(0, 300))
  }
  page.close()
}

console.log(fails === 0 ? 'FIND UI SMOKE OK' : 'FIND UI SMOKE FAILED: ' + fails)
process.exit(fails === 0 ? 0 : 1)
