// 织卷无头冒烟 · 审读条目「让 agent 改」：审计抽屉条目一键发给 agent 区（devShim 演示数据）
// 用法：node scripts/audit-toagent-ui-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 正文页打开「一致性巡查」抽屉出结果；② 每条目出现「让 agent 改」按钮；
//         ③ 点击后抽屉关闭、agent 区出现含「审读发现」的用户消息（即条目指令文本）；
//         ④ devShim mock 对含「改/修」的 prompt 回编辑事件 → 页面出现正文修改卡（zj_edit_doc 通道收到）。
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

const clickByTitle = (title) => `(() => {
  const btns = [...document.querySelectorAll('button')]
  const hit = btns.find((b) => b.title === ${JSON.stringify(title)})
  if (!hit) return 'NOT_FOUND'
  hit.click()
  return 'CLICKED'
})()`

const clickByText = (text) => `(() => {
  const btns = [...document.querySelectorAll('button')]
  const hit = btns.find((b) => b.textContent.trim() === ${JSON.stringify(text)})
  if (!hit) return 'NOT_FOUND'
  hit.click()
  return 'CLICKED'
})()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')
  console.log('OK 正文页就绪')

  // ① 打开一致性巡查抽屉（devShim mock 自动出结果）
  console.log('打开巡查:', await page.eval(clickByTitle('一致性巡查：按设定档案检查全卷')))
  await evalUntil(page, `document.body.innerText.includes('全卷读完')`, (v) => v === true, 15000, '巡查出结果')
  console.log('OK 抽屉出结果')

  // ② 存在「让 agent 改」按钮（devShim 演示条目有 target 与无 target 都应有）
  const btnCount = await page.eval(`[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === '让 agent 改').length`)
  if (!btnCount || btnCount < 3) throw new Error('「让 agent 改」按钮数量不对: ' + btnCount)
  console.log('OK 「让 agent 改」按钮存在 ×' + btnCount)

  // ③ 点击第一条「让 agent 改」→ 抽屉关闭 + agent 区出现指令消息（含审读发现）
  console.log('点击:', await page.eval(clickByText('让 agent 改')))
  await evalUntil(page, `document.body.innerText.includes('请处理下面这条审读发现')`, (v) => v === true, 10000, 'agent 区出现审读指令消息')
  console.log('OK agent 区出现审读指令消息（即审计条目文本已打包进对话）')

  // ④ 修改卡（devShim mock 对含「改/修」prompt 回 edit 事件）
  await evalUntil(page, `document.body.innerText.includes('已生成正文修改方案')`, (v) => v === true, 15000, '出现正文修改卡')
  const hasEditCard = await page.eval(`document.body.innerText.includes('L8 │') && document.body.innerText.includes('采纳')`)
  if (!hasEditCard) throw new Error('未发现修改卡对比/采纳 UI: 已生成正文修改方案 但缺 EditCard 渲染')
  console.log('OK 正文修改卡（zj_edit_doc 通道）到达 agent 区')

  console.log('\nPASS: 审读条目「让 agent 改」（打包进对话 + 修改卡回显）链路 OK')
} finally {
  await fetch(CDP + '/json/close/' + tab.id)
  page.close()
}
