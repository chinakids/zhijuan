// 织卷无头冒烟 · 正文查找替换（Find & Replace：替换当前/全部替换/⌘Enter/跳过替换区/Esc）
// 用法：node scripts/find-replace-ui-smoke.mjs
// 前置：npm run build；SPA server 8123（serve-renderer.mjs）；CDP 127.0.0.1:9224
// 验收点：① 替换行渲染（查询/替换双输入+两按钮）；② 替换当前=精确一处、计数减一、跳下一处；
//         ③ 替换文本含查找词时不原地循环（跳过替换区）；④ 全部替换=一次处理全部、剩余 0、「无匹配」+按钮禁用；
//         ⑤ 真实按钮点击链路；⑥ Esc 关闭清高亮；⑦ 全程零 JS 异常。
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
    await evalUntil(page, `document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')
    await page.eval(`(() => {
      const hit = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('第1章'))
      if (!hit) return 'NOT_FOUND'
      hit.click()
      return 'CLICKED'
    })()`)
    await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0 && window.__ZJ_FIND !== undefined`, (v) => v === true, 15000, '编辑器与查找接口就绪')

    const state = () => page.eval(`window.__ZJ_FIND.getState()`)
    const md = () => page.eval(`window.__ZJ_EDITORS[0].getMarkdown()`)

    // ① ⌘F 打开：替换行渲染（替换输入 + 两个动作按钮）
    await keyCombo(page, 'f', 'KeyF', 4, 70)
    await evalUntil(page, `document.querySelector('.zj-findbar') !== null`, (v) => v === true, 8000, '⌘F 打开查找条')
    const replUi = await page.eval(`(() => {
      const bar = document.querySelector('.zj-findbar')
      if (!bar) return null
      return {
        replInput: !!bar.querySelector('.zj-find-repl'),
        acts: [...bar.querySelectorAll('.zj-find-act')].map((b) => b.textContent || '')
      }
    })()`)
    ok('R1 替换行渲染：替换输入+「替换」「全部替换」两按钮', replUi && replUi.replInput && replUi.acts.join(',') === '替换,全部替换', JSON.stringify(replUi))

    // ② 替换当前=精确一处、计数减一、跳下一处（「灯」→「灯火」，原文 2 处）
    await page.eval(`window.__ZJ_FIND.open('灯')`)
    await evalUntil(page, `window.__ZJ_FIND.getState().total`, (v) => v >= 2, 8000, '查询「灯」命中 ≥2')
    let st = await state()
    const firstFrom = st.matches[0].from
    const firstTo = st.matches[0].to
    await page.eval(`window.__ZJ_FIND.setReplacement('灯火')`)
    st = await state()
    ok('R2 替换文本已设', st.replacement === '灯火', JSON.stringify({ repl: st.replacement }))
    await page.eval(`window.__ZJ_FIND.replaceCurrent()`)
    await evalUntil(page, `window.__ZJ_FIND.getState().current`, (v) => v >= 0, 8000, '替换后定位下一处')
    st = await state()
    ok('R3 替换当前：doc 已变（旧灯→旧灯火）', (await md()).includes('旧灯火'), '')
    ok('R4 替换当前：跳过替换区不原地循环（下一处 from > 原 from）', st.matches.length >= 1 && st.matches[st.current] && st.matches[st.current].from > firstFrom, JSON.stringify({ cur: st.current, from: st.matches[st.current]?.from }))
    ok('R5 替换当前：原匹配位置不再被选（当前 from > 首匹配）', st.matches[st.current].from >= firstFrom + 2, '')

    // ③ 全部替换（「阿七」→「阿淇」，原文 2 处；先重置替换文本）
    await page.eval(`window.__ZJ_FIND.open('阿七')`)
    await evalUntil(page, `window.__ZJ_FIND.getState().total`, (v) => v >= 2, 8000, '查询「阿七」命中 ≥2')
    await page.eval(`window.__ZJ_FIND.setReplacement('阿淇')`)
    // 真实按钮点击「替换」（当前处）→ total 2→1
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('.zj-find-act')].find((x) => x.textContent === '替换')
      if (!b) return 'NOT_FOUND'
      b.click()
      return 'CLICKED'
    })()`)
    await evalUntil(page, `window.__ZJ_FIND.getState().total`, (v) => v === 1, 8000, '真实按钮替换后 total=1')
    st = await state()
    ok('R6 真实按钮「替换」：剩余 1 处且正文出现「阿淇」', st.total === 1 && (await md()).includes('阿淇'), JSON.stringify({ total: st.total }))
    // 真实按钮点击「全部替换」→ total 0
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('.zj-find-act')].find((x) => x.textContent === '全部替换')
      if (!b) return 'NOT_FOUND'
      b.click()
      return 'CLICKED'
    })()`)
    await evalUntil(page, `window.__ZJ_FIND.getState().total`, (v) => v === 0, 8000, '全部替换后 total=0')
    const afterAll = await page.eval(`(() => {
      const bar = document.querySelector('.zj-findbar')
      const acts = [...bar.querySelectorAll('.zj-find-act')]
      return {
        count: bar.querySelector('.zj-find-count')?.innerText ?? '',
        disabled: acts.every((b) => b.disabled)
      }
    })()`)
    ok('R7 全部替换：正文不再含「阿七」', !(await md()).includes('阿七'), '')
    ok('R8 全部替换：计数「无匹配」+ 按钮禁用', afterAll.count === '无匹配' && afterAll.disabled, JSON.stringify(afterAll))

    // ④ Esc 关闭：查找条消失
    await keyCombo(page, 'Escape', 'Escape', 0, 27)
    await evalUntil(page, `document.querySelector('.zj-findbar') === null`, (v) => v === true, 5000, 'Esc 关闭查找条')
    ok('R9 Esc 关闭查找条', true, '')

    // ④b ⌥⌘F 查找与替换标准键（macOS 文本应用惯例，TextEdit/Pages 同键）：打开并聚焦替换输入
    await keyCombo(page, 'f', 'KeyF', 5, 70) // meta(4)+alt(1)=5 = ⌥⌘F
    await evalUntil(page, `document.querySelector('.zj-findbar') !== null`, (v) => v === true, 8000, '⌥⌘F 打开查找条')
    await evalUntil(page, `document.activeElement?.classList.contains('zj-find-repl')`, (v) => v === true, 5000, '⌥⌘F 后焦点在替换输入')
    ok('R10 ⌥⌘F 打开查找条且焦点=替换输入', true, '')
    // 已打开时重按 ⌥⌘F：回焦替换输入（先让焦点离开）
    await page.eval(`(() => { const i = document.querySelector('.zj-find-input'); if (i) i.focus(); return true })()`)
    await keyCombo(page, 'f', 'KeyF', 5, 70)
    await evalUntil(page, `document.activeElement?.classList.contains('zj-find-repl')`, (v) => v === true, 5000, '重按 ⌥⌘F 回焦替换输入')
    ok('R11 查找条已开时重按 ⌥⌘F 回焦替换输入', true, '')
    // ⌘F 回归：聚焦查询输入
    await keyCombo(page, 'f', 'KeyF', 4, 70)
    await evalUntil(page, `document.activeElement?.classList.contains('zj-find-input')`, (v) => v === true, 5000, '⌘F 聚焦查询输入')
    ok('R12 ⌘F 打开聚焦查询输入（回归）', true, '')
    // 系统菜单「查找与替换…」经 MENU_EV_FIND 分发（devShim __ZJ_MENU_EMIT 模拟主进程菜单动作）
    await page.eval(`(() => { const i = document.querySelector('.zj-find-input'); if (i) i.focus(); return true })()`)
    await page.eval(`window.__ZJ_MENU_EMIT('findReplace')`)
    await evalUntil(page, `document.activeElement?.classList.contains('zj-find-repl')`, (v) => v === true, 5000, '菜单动作聚焦替换输入')
    ok('R13 菜单「查找与替换…」分发后焦点=替换输入', true, '')
    // Tab 序走查：替换输入 → 「替换」 → 「全部替换」（行内从左到右，两行从上到下，与 macOS 文本查找条同构）
    const tab = async () => {
      await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
      await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
      await sleep(250)
      return page.eval(`document.activeElement?.textContent || document.activeElement?.getAttribute('aria-label') || ''`)
    }
    const t1 = await tab()
    ok('R14 Tab 从替换输入→「替换」按钮', t1 === '替换', t1)
    const t2 = await tab()
    ok('R15 Tab 从「替换」→「全部替换」按钮', t2 === '全部替换', t2)
    // 收尾：Esc 清态（衔接下一段窄窗走查）
    await keyCombo(page, 'Escape', 'Escape', 0, 27)
    await evalUntil(page, `document.querySelector('.zj-findbar') === null`, (v) => v === true, 5000, 'Esc 收尾关闭')

    // ⑤ 窄窗（正文列被挤压）替换行零溢出 + dark 语义色（container 查询紧凑模式）
    await page.eval(`window.__ZJ_FIND.open('灯')`)
    await evalUntil(page, `document.querySelector('.zj-findbar') !== null`, (v) => v === true, 8000, '重开查找条')
    await page.cmd('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(500)
    const narrow = await page.eval(`(() => {
      const row2 = document.querySelector('.zj-findbar .zj-find-repl-row')
      if (!row2) return null
      return { overflow: row2.scrollWidth - row2.clientWidth, winW: window.innerWidth }
    })()`)
    ok('R11 窄窗 700 替换行零溢出', !!narrow && narrow.overflow <= 1 && narrow.winW === 700, JSON.stringify(narrow))
    await page.eval(`document.documentElement.classList.add('dark')`)
    await sleep(300)
    const dark = await page.eval(`(() => {
      const bar = document.querySelector('.zj-findbar')
      const act = bar?.querySelector('.zj-find-act')
      if (!bar || !act) return null
      const cs = (el, p) => getComputedStyle(el).getPropertyValue(p)
      return { barBg: cs(bar, 'background-color'), actColor: cs(act, 'color'), actBg: cs(act, 'background-color') }
    })()`)
    ok('R12 dark 语义色：条面深色 surface-2 且按钮文字 ink-2（非纯白底）', !!dark && dark.barBg !== 'rgb(255, 255, 255)' && dark.actBg === 'rgba(0, 0, 0, 0)', JSON.stringify(dark))
    await page.cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false })

    // ⑥ 零 JS 异常
    ok('R13 全程零 JS 异常', page.errors.length === 0, page.errors.slice(0, 2).join(' | '))
  } catch (e) {
    fails++
    console.log('NG FATAL: ' + e.message)
  } finally {
    page.close()
  }
}

console.log(fails === 0 ? '\nALL PASS' : `\nFAILS: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
