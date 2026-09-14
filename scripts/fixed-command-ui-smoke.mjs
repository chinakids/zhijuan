// 织卷无头冒烟 · 固定逻辑命令（/巡查 /导演）：直连既有入口，结果注入对话流
// 用法：node scripts/fixed-command-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123，SPA fallback）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① / 浮层现 /巡查 /导演（带「直连」标记）；② /导演 → 工具卡+摘要入对话流（大纲/第02章_灯塔_导演.md 落资产）；
//         ③ /巡查 → 本章小环抽屉自动跑短巡查；④ /巡查 修订 → 切分层修订；⑤ /巡查 全卷 → 全卷一致性巡查抽屉；
//         ⑥ 回归：/续写 仍走模板展开（不误入固定逻辑）；⑦ /巡查 未知参数就地提示（不静默降级）；
//         ⑧ /导演 运行中点「停止」→ 取消提示 + 不再落资产。 2026-09-12 追加 ⑦⑧。
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

// 用真实键盘事件驱动输入（React 受控组件必须走原生事件，直接改 value 会被 React 覆盖）
async function typeText(page, text) {
  for (const ch of text) {
    await page.eval(`(() => {
      const ta = document.querySelector('textarea')
      if (!ta) return 'NO_TA'
      ta.focus()
      const proto = Object.getPrototypeOf(ta)
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(ta, ta.value + ${JSON.stringify(ch)})
      const pos = ta.value.length
      ta.setSelectionRange(pos, pos)
      const ev = new Event('input', { bubbles: true })
      ev.isComposing = false
      ta.dispatchEvent(ev)
      ta.dispatchEvent(new Event('change', { bubbles: true }))
      return ta.value
    })()`)
    await sleep(80)
  }
  return 'OK'
}

async function clearText(page) {
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    if (!ta) return
    ta.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
    setter.call(ta, '')
    ta.setSelectionRange(0, 0)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(250)
}

async function pressEnter(page) {
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第02章_灯塔.md'))
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(
    page,
    `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`,
    (v) => v === true,
    20000,
    '正文页就绪'
  )
  console.log('OK 正文页就绪（?ch 自动选中第02章_灯塔）')

  // ① / 浮层现 /巡查 /导演（带直连标记）
  await typeText(page, '/')
  await evalUntil(page, `!!document.querySelector('.zj-cmd-menu')`, (v) => v === true, 8000, '/ 浮层出现')
  const menu1 = await page.eval(`document.querySelector('.zj-cmd-menu')?.innerText || ''`)
  if (!menu1.includes('/巡查') || !menu1.includes('/导演') || !menu1.includes('直连')) throw new Error('浮层缺固定逻辑命令：' + menu1.slice(0, 160))
  if (!menu1.includes('/续写') || !menu1.includes('/润色') || !menu1.includes('/延伸')) throw new Error('浮层缺模板命令：' + menu1.slice(0, 160))
  await clearText(page)
  console.log('OK ① / 浮层含 巡查/导演（直连标记）与模板命令' )

  // ② /导演 → 工具卡 + 摘要入对话流（结论落资产 大纲/第02章_灯塔_导演.md）
  await typeText(page, '/导演')
  await pressEnter(page) // 选中候选（插入 /导演␣）
  await sleep(350)
  await pressEnter(page) // 发送
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('导演板已写入') && v.includes('大纲/第02章_灯塔_导演.md') && v.includes('本章任务'),
    25000,
    '/导演 结果入对话流'
  )
  const body2 = await page.eval(`document.body.innerText`)
  if (!body2.includes('章节导演') || !body2.includes('已写入 大纲/第02章_灯塔_导演.md')) throw new Error('缺工具卡：' + body2.slice(-400))
  console.log('OK ② /导演 跑通：工具卡+摘要入对话流，导演板落 大纲/' )

  // ③ /巡查 → 本章小环抽屉自动跑短巡查
  await clearText(page)
  await typeText(page, '/巡查')
  await pressEnter(page) // 选中候选
  await sleep(350)
  await pressEnter(page) // 发送
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('本章小环') && v.includes('阿七对沈藏的称呼'),
    20000,
    '本章小环短巡查结果'
  )
  const body3 = await page.eval(`document.body.innerText`)
  if (!body3.includes('已调起本章小环·短巡查')) throw new Error('缺调起提示')
  console.log('OK ③ /巡查 打开本章小环并跑短巡查（演示两处问题已出）' )

  // ④ /巡查 修订 → 切到分层修订
  await clearText(page)
  await typeText(page, '/巡查 修订')
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('把开头的说明性白线压掉'),
    20000,
    '分层修订结果'
  )
  console.log('OK ④ /巡查 修订 切分层修订并出结果' )

  // ⑤ /巡查 全卷 → 全卷一致性巡查抽屉
  await clearText(page)
  await typeText(page, '/巡查 全卷')
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('一致性巡查') && v.includes('已调起全卷一致性巡查'),
    20000,
    '全卷一致性巡查抽屉'
  )
  console.log('OK ⑤ /巡查 全卷 打开全卷一致性巡查' )

  // ⑥ 回归：/续写 仍走模板展开（不进固定逻辑）
  await clearText(page)
  await typeText(page, '/续写 一百字')
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('创作任务：续写《') && v.includes('具体要求：一百字') && v.includes('（dev 模式模拟回复）'),
    25000,
    '/续写 模板展开'
  )
  console.log('OK ⑥ 回归 /续写 模板展开正常（未误入固定逻辑）' )

  // ⑦ /巡查 未知参数 → 就地提示合法枚举，不静默降级（2026-09-12）
  await clearText(page)
  await typeText(page, '/巡查 乱写')
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('无法识别') && v.includes('本章（短巡查）'),
    8000,
    '/巡查 参数提示'
  )
  console.log('OK ⑦ /巡查 未知参数就地提示（不静默降级）' )

  // ⑧ /导演 运行中点「停止」→ 取消提示，且不再写入 大纲/（2026-09-12）
  const beforeCount = (await page.eval(`document.body.innerText`)).split('已写入 大纲/').length - 1
  await clearText(page)
  await typeText(page, '/导演')
  await pressEnter(page) // 选中候选（插入 /导演␣）
  await sleep(350)
  await pressEnter(page) // 发送 → fxBusy，出现方形停止按钮
  await evalUntil(
    page,
    `!!document.querySelector('button[title^="停止导演任务"]')`,
    (v) => v === true,
    5000,
    '停止按钮出现'
  )
  await page.eval(`document.querySelector('button[title^="停止导演任务"]')?.click()`)
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('已取消导演任务') && v.includes('已取消（未落盘）'),
    8000,
    '取消提示入对话流'
  )
  await sleep(2200) // 等 devShim 700ms 延迟的迟到结果回来（应被作废）
  const body8 = await page.eval(`document.body.innerText`)
  const afterCount = body8.split('已写入 大纲/').length - 1
  if (afterCount !== beforeCount) throw new Error(`取消后仍落盘：${beforeCount} → ${afterCount}`)
  console.log('OK ⑧ /导演 取消：提示入对话流，迟到结果未落盘（已写入计数保持 ' + beforeCount + '）')

  console.log('ALL OK ✅')
} catch (err) {
  console.error('FAIL:', err.message)
  process.exitCode = 1
} finally {
  page.close()
}
