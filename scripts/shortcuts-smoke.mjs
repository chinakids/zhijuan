// 织卷无头冒烟 · 写作快捷键（⌘E 用选区设查找词 / ⌘G 工作流 / Esc 清高亮）+ 快捷键速查面板入口（⌘K 帮助组 / 设置页关于）
// 用法：node scripts/shortcuts-smoke.mjs
// 前置：npm run build；python3 -m http.server 8123 --directory out/renderer（SPA fallback）；CDP 127.0.0.1:9224
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
  await sleep(150)
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
      const btns = [...document.querySelectorAll('button')]
      const hit = btns.find((b) => (b.innerText || '').includes('第1章'))
      if (!hit) return 'NOT_FOUND'
      hit.click()
      return 'CLICKED'
    })()`)
    await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0 && window.__ZJ_FIND !== undefined`, (v) => v === true, 15000, '编辑器与查找接口就绪')

    const state = () => page.eval(`window.__ZJ_FIND.getState()`)
    const highlights = () => page.eval(`(() => {
      const c = window.CSS && window.CSS.highlights
      if (!c) return { hit: false, cur: false }
      return { hit: c.has('zj-find-hit'), cur: c.has('zj-find-cur') }
    })()`)

    // —— ① ⌘E：用模型选区设置查找词（demo 第1章「阿七」出现两处），不展开查找条 ——
    // 先经 ⌘F 走一遍真实键盘把模型选区落在「阿七」第一处，再 Esc 关条（选区保留在模型）
    await keyCombo(page, 'f', 'KeyF', 4, 70)
    await evalUntil(page, `document.querySelector('.zj-findbar') !== null`, (v) => v === true, 8000, '⌘F 打开查找条')
    await page.eval(`window.__ZJ_FIND.open('阿七')`)
    await sleep(400)
    let st = await state()
    ok('P1 预置：open(阿七) total>=2 且选区在命中处', st.total >= 2 && st.current === 0, 'total=' + st.total)
    await keyCombo(page, 'Escape', 'Escape', 0, 27)
    await evalUntil(page, `document.querySelector('.zj-findbar') === null`, (v) => v === true, 5000, 'Esc 关闭查找条')

    // 真实 ⌘E（模型选区仍在「阿七」第一处）
    await keyCombo(page, 'e', 'KeyE', 4, 69)
    await sleep(300)
    st = await state()
    ok('P2 ⌘E 用选区设置查找词（query=阿七，面板不开）', st.query === '阿七' && st.total >= 2 && st.open === false, JSON.stringify({ q: st.query, t: st.total, open: st.open }))
    const barGone = await page.eval(`document.querySelector('.zj-findbar') === null`)
    ok('P3 ⌘E 不展开查找条', barGone)
    {
      const hl = await highlights()
      ok('P4 ⌘E 刷新高亮（hit/cur 注册）', hl.cur, JSON.stringify(hl))
    }

    // —— ② ⌘E→⌘G 工作流：面板关闭状态下 ⌘G 仍然步进 ——
    await keyCombo(page, 'g', 'KeyG', 4, 71)
    st = await state()
    ok('P5 面板关时 ⌘G 移到下一处（current=1）', st.current === 1, 'current=' + st.current + ' total=' + st.total)
    ok('P5b ⌘G 后模型选区命中词', (await page.eval(`window.__ZJ_EDITORS[0].getSelected()`)) === '阿七')
    await keyCombo(page, 'g', 'KeyG', 12, 71)
    st = await state()
    ok('P6 ⇧⌘G 移回上一处（current=0）', st.current === 0, 'current=' + st.current)

    // —— ③ ⌘E 后 Esc 清除高亮并结束查找（面板未开也拦截） ——
    await keyCombo(page, 'Escape', 'Escape', 0, 27)
    await sleep(250)
    st = await state()
    const hl2 = await highlights()
    ok('P7 Esc（面板关）清除高亮且 matches 清空', st.total === 0 && !hl2.hit && !hl2.cur, 'total=' + st.total + ' hl=' + JSON.stringify(hl2))
    ok('P7b Esc 后保留查找词（再次 ⌘F 可预填）', st.query === '阿七')

    // —— ④ 无选区时 ⌘E no-op（折叠光标后 ⌘E 不改变状态） ——
    await page.eval(`window.__ZJ_EDITORS[0].focus()`)
    await keyCombo(page, 'ArrowLeft', 'ArrowLeft', 0, 37)
    await keyCombo(page, 'ArrowRight', 'ArrowRight', 0, 39)
    const selBefore = await page.eval(`window.__ZJ_EDITORS[0].getSelected()`)
    await keyCombo(page, 'e', 'KeyE', 4, 69)
    await sleep(250)
    st = await state()
    ok('P8 无选区时 ⌘E no-op（state 不变）', selBefore === null && st.total === 0, 'sel=' + selBefore + ' total=' + st.total)

    // —— ⑤ ⌘K 面板 → 帮助 → 键盘快捷键速查 ——
    await keyCombo(page, 'k', 'KeyK', 4, 75)
    await evalUntil(page, `document.body.innerText.includes('键盘快捷键速查')`, (v) => v === true, 8000, '⌘K 帮助组条目出现')
    await page.eval(`(() => {
      const el = [...document.querySelectorAll('[role="option"], [cmdk-item]')].find((e) => (e.textContent || '').includes('键盘快捷键速查'))
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'CLICKED'
    })()`)
    await evalUntil(page, `document.body.innerText.includes('用选区设置查找词') && document.body.innerText.includes('命令面板')`, (v) => v === true, 8000, '速查面板打开')
    const kbdCount = await page.eval(`(() => {
      const k = document.querySelectorAll('kbd').length
      const title = [...document.querySelectorAll('[role="dialog"] h2, [role="dialog"] h3')].some((e) => (e.textContent || '').includes('键盘快捷键'))
      return { k, title }
    })()`)
    ok('P9 速查面板标题与键帽渲染（kbd>=8）', kbdCount.title && kbdCount.k >= 8, JSON.stringify(kbdCount))
    const pl = await page.eval(`(() => {
      const s = document.body.innerText
      return { cmdK: s.includes('命令面板'), find: s.includes('在正文中查找'), save: s.includes('保存当前文档') }
    })()`)
    ok('P10 速查内容含 ⌘K/⌘F/⌘S 条目', pl.cmdK && pl.find && pl.save, JSON.stringify(pl))
    await keyCombo(page, 'Escape', 'Escape', 0, 27)
    await sleep(300)
    const closed1 = await page.eval(`!document.body.innerText.includes('用选区设置查找词')`)
    ok('P11 Esc 关闭速查面板', closed1)

    // —— ⑥ 设置页「关于」入口（设置是项目内路由 /project/:id/settings） ——
    await page.eval(`location.hash = '#/project/demo-aseya/settings'`)
    await evalUntil(page, `document.body.innerText.includes('工作区与项目')`, (v) => v === true, 12000, '设置页就绪')
    // 切到「关于」一级分区（按钮文本是 icon 字+label 拼接，用 includes 匹配）
    await page.eval(`(() => {
      const el = [...document.querySelectorAll('aside button')].find((e) => (e.textContent || '').includes('关于'))
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'CLICKED'
    })()`)
    await evalUntil(page, `document.body.innerText.includes('键盘快捷键速查（⌘K 里也能打开）')`, (v) => v === true, 8000, '关于区按钮出现')
    // 点击关于区按钮
    await page.eval(`(() => {
      const el = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').includes('键盘快捷键速查'))
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'CLICKED'
    })()`)
    await evalUntil(page, `document.body.innerText.includes('用选区设置查找词')`, (v) => v === true, 8000, '设置页入口打开速查')
    const opened = await page.eval(`document.body.innerText.includes('用选区设置查找词')`)
    ok('P12 设置页关于入口打开速查面板', opened)

    ok('P13 全程无 JS 异常/console.error', page.errors.length === 0, page.errors.slice(0, 2).join(' ; '))
  } catch (e) {
    ok('场景异常', false, String(e).slice(0, 300))
  }
  page.close()
}

console.log(fails === 0 ? 'SHORTCUTS SMOKE OK' : 'SHORTCUTS SMOKE FAILED: ' + fails)
process.exit(fails === 0 ? 0 : 1)
