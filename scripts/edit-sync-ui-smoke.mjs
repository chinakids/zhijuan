// 织卷无头冒烟 · EditCard 采纳（doc:applyEdit）→ 切片同步触发（正文为源、设定为流；D-V2-13 主写入口径补链）
// 用法：node scripts/edit-sync-ui-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① devShim 发「改」→ EditCard 出现；② 点「采纳并写入」→ 状态「已采纳，已写入」正式写入；
//         ③ 卡片内出现「✓ 切片同步：无设定变化」（devShim agentSync 返回空集）——采纳后同步被触发（修复前缺失）；
//         ④ 第二次发「改」→ 再采纳 → 出现「本分钟内已同步过切片，不重复」（60s 节流生效）。
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

// React 受控 textarea：原生 setter + input 事件（同 skill-menu-smoke）
async function typeText(page, text) {
  for (const ch of text) {
    await page.eval(`(() => {
      const ta = document.querySelector('textarea')
      if (!ta) return 'NO_TA'
      ta.focus()
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
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

async function pressEnter(page) {
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)
}

async function clickAccept(page) {
  const r = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('采纳并写入'))
    if (!b) return 'NO_BTN'
    b.click()
    return 'OK'
  })()`)
  if (r !== 'OK') throw new Error('未找到「采纳并写入」按钮')
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `!!document.querySelector('textarea')`, (v) => v === true, 20000, '正文页就绪')

  // 先存原文：devShim agentSend 演示的 edit 固定 find 第一句，第一次采纳会改写它；
  // 第二次同 find 会「未找到原文」——④ 前用 writeDoc 恢复，才能真走到节流分支
  const orig = await page.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md').then((r) => r ?? '')`)
  if (!orig || !orig.includes('阿七靠着候船厅的柱子')) throw new Error('种子文档未就绪')

  // ① 发「改」→ devShim agentSend 演示 edit 事件 → EditCard
  await typeText(page, '帮我改一下这段')
  await pressEnter(page)
  await evalUntil(
    page,
    `[...document.querySelectorAll('button')].some((x) => x.textContent.includes('采纳并写入'))`,
    (v) => v === true,
    20000,
    'EditCard 出现'
  )
  console.log('OK ① EditCard 出现')

  // ② 采纳 → 状态「已采纳，已写入」
  await clickAccept(page)
  await evalUntil(page, `document.body.innerText.includes('已采纳，已写入')`, (v) => v === true, 15000, '已采纳状态')
  console.log('OK ② 采纳并写入成功')

  // ③ 切片同步被触发：卡片出现「✓ 切片同步：无设定变化」（devShim agentSync 空集）
  await evalUntil(
    page,
    `document.body.innerText.includes('切片同步：无设定变化')`,
    (v) => v === true,
    15000,
    '切片同步结果'
  )
  console.log('OK ③ 采纳后触发切片同步（✓ 无设定变化）')

  // ④ 第二次发「改」→ 再采纳 → 60s 节流提示
  // 先等第一条流程完全结束（devShim mock 流式 demo 收尾即 sending 复位；否则第二次 Enter 被 sending 拦截静默丢弃）
  await evalUntil(page, `!document.querySelector('button[aria-label="停止生成"]')`, (v) => v === true, 20000, '第一条流程结束')
  // 恢复原文（见开头注释），让第二条 edit 的 find 能命中
  await page.eval(`window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', ${JSON.stringify(orig)})`)
  await sleep(400)
  await typeText(page, '帮我再改一段')
  await pressEnter(page)
  await evalUntil(page, `document.body.innerText.includes('帮我再改一段')`, (v) => v === true, 15000, '第二条消息')
  await evalUntil(
    page,
    `[...document.querySelectorAll('button')].some((x) => x.textContent.includes('采纳并写入'))`,
    (v) => v === true,
    20000,
    '第二条 EditCard 出现'
  )
  await clickAccept(page)
  await evalUntil(
    page,
    `document.body.innerText.includes('本分钟内已同步过切片')`,
    (v) => v === true,
    15000,
    '节流提示'
  )
  console.log('OK ④ 60s 节流生效（不重复同步）')

  console.log('ALL PASS')
} finally {
  page.close()
}
