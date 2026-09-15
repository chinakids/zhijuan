// 织卷无头冒烟 · EditCard 采纳失败态出口（2026-09-15 智能层：error 态新增「重试采纳/拒绝」，
// 修复前 error 态无任何按钮=卡死，只能清空对话重来；与切片同步「失败可感知可重试」同口径）
// 用法：node scripts/edit-error-retry-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123（或 ZJ_SMOKE_BASE）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 发「改」→ EditCard；② 破坏 find（writeDoc 改原句）→ 采纳 → error 态出现（重试/拒绝按钮+「未找到原文」）；
//         ③ 点「拒绝」→「已拒绝」；④ 再发「改」→ 破坏 → 失败 → 恢复原文 → 点「重试采纳」→「已采纳，已写入」+ 切片同步触发。
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

async function clickByText(page, text) {
  const r = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(text)}))
    if (!b) return 'NO_BTN'
    b.click()
    return 'OK'
  })()`)
  if (r !== 'OK') throw new Error('未找到按钮「' + text + '」')
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

let failures = 0
const step = (name, ok) => {
  console.log((ok ? 'OK ' : 'FAIL ') + name)
  if (!ok) failures++
}

try {
  await evalUntil(page, `!!document.querySelector('textarea')`, (v) => v === true, 20000, '正文页就绪')

  const orig = await page.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md').then((r) => r ?? '')`)
  if (!orig || !orig.includes('阿七靠着候船厅的柱子')) throw new Error('种子文档未就绪')

  // ① 发「改」→ EditCard
  await typeText(page, '帮我改一下这段')
  await pressEnter(page)
  await evalUntil(
    page,
    `[...document.querySelectorAll('button')].some((x) => x.textContent.includes('采纳并写入'))`,
    (v) => v === true,
    20000,
    'EditCard 出现'
  )
  step('① EditCard 出现', true)

  // ② 破坏 find → 采纳 → 失败 error 态：「未找到原文」+ 重试/拒绝按钮
  const broken = orig.replace('攥着那盏旧灯。', '攥着那盏旧铜灯。')
  if (broken === orig) throw new Error('破坏句未生效（原文不含目标句）')
  await page.eval(`window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', ${JSON.stringify(broken)})`)
  await sleep(400)
  await clickByText(page, '采纳并写入')
  await evalUntil(
    page,
    `(() => { const t = document.body.innerText; return t.includes('未找到原文') && !!document.querySelector('[data-testid="zj-edit-retry"]') && !!document.querySelector('[data-testid="zj-edit-reject"]') })()`,
    (v) => v === true,
    15000,
    'error 态（重试/拒绝按钮）'
  )
  step('② 采纳失败 → error 态 + 重试/拒绝按钮 + 未找到原文', true)

  // ③ 点「拒绝」→ 「已拒绝」（此时 error 态按钮组消失）
  await page.eval(`document.querySelector('[data-testid="zj-edit-reject"]').click()`)
  await evalUntil(page, `document.body.innerText.includes('已拒绝')`, (v) => v === true, 10000, '已拒绝')
  const noRetryBtn = await page.eval(`!document.querySelector('[data-testid="zj-edit-retry"]')`)
  step('③ 拒绝 →「已拒绝」且 error 按钮组消失', noRetryBtn)

  // ④ 等第一条流程结束 → 恢复原文 → 再发「改」→ 破坏 → 失败 → 恢复 → 重试采纳 → 成功+同步
  await evalUntil(page, `!document.querySelector('button[aria-label="停止生成"]')`, (v) => v === true, 20000, '第一条流程结束')
  await page.eval(`window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', ${JSON.stringify(orig)})`)
  await sleep(400)
  await typeText(page, '帮我再改一段')
  await pressEnter(page)
  await evalUntil(
    page,
    `[...document.querySelectorAll('button')].some((x) => x.textContent.includes('采纳并写入'))`,
    (v) => v === true,
    20000,
    '第二条 EditCard 出现'
  )
  await page.eval(`window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', ${JSON.stringify(broken)})`)
  await sleep(400)
  await clickByText(page, '采纳并写入')
  await evalUntil(
    page,
    `!!document.querySelector('[data-testid="zj-edit-retry"]')`,
    (v) => v === true,
    15000,
    '第二条失败 error 态'
  )
  // 恢复原文后点「重试采纳」
  await page.eval(`window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', ${JSON.stringify(orig)})`)
  await sleep(400)
  await page.eval(`document.querySelector('[data-testid="zj-edit-retry"]').click()`)
  await evalUntil(page, `document.body.innerText.includes('已采纳，已写入')`, (v) => v === true, 15000, '重试后已采纳')
  await evalUntil(page, `document.body.innerText.includes('切片同步：无设定变化')`, (v) => v === true, 15000, '重试后切片同步触发')
  step('④ 重试采纳 →「已采纳，已写入」+ 切片同步触发', true)

  if (failures === 0) {
    console.log('ALL PASS')
  } else {
    console.log('FAILURES: ' + failures)
    process.exitCode = 1
  }
} finally {
  page.close()
}
