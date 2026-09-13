// 织卷无头冒烟 · 侧栏「发起采集」快捷入口（平台层 2026-09-13，模块设计 §五 B 采集入口快捷方式）
// 用法：node scripts/nav-collect-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：
// ① 正文页侧栏底部有「发起采集」入口（模块设计 §五 B）
// ② 点击 → 跳到素材库页且采集表单 Dialog 自动打开（「需求描述」可见）
// ③ 关闭后 URL 的 ?collect=1 已被消费清除（刷新不残留）
// ④ 直接进素材库页（无参）不自动弹表单
// ⑤ 已在素材库页时点击侧栏入口仍能再弹表单（tick 递增场景）
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
        close: () => ws.close()
      })
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

// 点击按钮（可按 scope 限定）
async function clickText(page, text, scope) {
  const r = await page.eval(`(() => {
    const roots = ${scope ? `[...document.querySelectorAll(${JSON.stringify(scope)})]` : '[document]'}
    const el = roots.flatMap((root) => [...root.querySelectorAll('button')]).find((b) => b.textContent.includes(${JSON.stringify(text)}))
    if (!el) return 'NO_BTN'
    el.click()
    return 'OK'
  })()`)
  if (r !== 'OK') throw new Error('clickText failed: ' + r + ' for ' + text)
}

// 点击侧栏导航 <a>（NavLink 渲染为 a，不是 button）
async function clickNav(page, text) {
  const r = await page.eval(`(() => {
    const el = [...document.querySelectorAll('aside.w-60 a')].find((a) => a.textContent.includes(${JSON.stringify(text)}))
    if (!el) return 'NO_A'
    el.click()
    return 'OK'
  })()`)
  if (r !== 'OK') throw new Error('clickNav failed: ' + r + ' for ' + text)
}

const formOpen = `(() => {
  const d = document.querySelector('[role=dialog]')
  return !!d && d.innerText.includes('需求描述')
})()`

let pass = 0
let fail = 0
async function step(name, fn) {
  try {
    await fn()
    pass++
    console.log('PASS', name)
  } catch (e) {
    fail++
    console.log('FAIL', name, '-', e.message)
  }
}

// ① 正文页侧栏底部有「发起采集」入口
await step('① 侧栏存在「发起采集」入口', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('雾港'), Boolean, 20000, 'novel loaded')
  const has = await page.eval(`[...document.querySelectorAll('aside.w-60 a')].some((a) => a.textContent.includes('发起采集'))`)
  if (!has) throw new Error('侧栏无「发起采集」入口')
  page.close()
})

// ② 点击 → 跳素材库页且采集表单自动打开
await step('② 点击后素材库页表单自动打开', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('雾港'), Boolean, 20000, 'novel loaded')
  await clickNav(page, '发起采集')
  await evalUntil(page, `location.hash.includes('/library')`, Boolean, 15000, 'route to library')
  await evalUntil(page, formOpen, Boolean, 15000, 'collection form dialog')
  page.close()
})

// ③ 关闭后 URL 的 collect 参数已清除（刷新不残留）
await step('③ 关闭表单后 URL 无 collect 残留', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('雾港'), Boolean, 20000, 'novel loaded')
  await clickNav(page, '发起采集')
  await evalUntil(page, formOpen, Boolean, 15000, 'form open')
  await evalUntil(page, `location.hash.includes('/library') && !location.hash.includes('collect')`, Boolean, 10000, 'collect param cleared')
  await clickText(page, '取消', '[role=dialog]')
  await evalUntil(page, `!document.querySelector('[role=dialog]')`, Boolean, 10000, 'dialog closed')
  page.close()
})

// ④ 直接进素材库页（无参）不自动弹表单
await step('④ 直接进素材库页不自动弹表单', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/library')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('采集任务'), Boolean, 20000, 'library loaded')
  await sleep(1000)
  const open = await page.eval(`!!document.querySelector('[role=dialog]')`)
  if (open) throw new Error('无参进入时不该自动弹表单')
  page.close()
})

// ⑤ 已在素材库页时点击侧栏入口仍能再弹表单（tick 递增生效）
await step('⑤ 素材库页内点击入口再次弹表单', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/library')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('采集任务'), Boolean, 20000, 'library loaded')
  await sleep(600)
  await clickNav(page, '发起采集')
  await evalUntil(page, formOpen, Boolean, 15000, 'form open on same page')
  page.close()
})

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
