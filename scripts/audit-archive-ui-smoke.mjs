// 织卷无头冒烟 · 审读存档：全卷审计自动落盘 大纲/审读_<名>.md + 大纲区「审读存档」可回看（devShim 演示数据）
// 用法：node scripts/audit-archive-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 正文页 Agent 面板点「一致性巡查」→ 抽屉跑完显示「已存档」；
//         ② 大纲/ 下真有 审读_一致性巡查.md（listDocs 读到、内容含报告头）；
//         ③ 大纲区出现「审读存档」区且可点击 → 编辑器渲染出报告内容。
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

  // ① 打开一致性巡查抽屉（会自动开跑 devShim mock）
  console.log('打开巡查:', await page.eval(clickByTitle('一致性巡查：按设定档案检查全卷')))
  await evalUntil(page, `document.body.innerText.includes('全卷读完')`, (v) => v === true, 15000, '巡查出结果')
  await evalUntil(page, `document.body.innerText.includes('已存档')`, (v) => v === true, 8000, '出现已存档标记')
  console.log('OK 抽屉显示「已存档」')

  // ② 落盘实锤：大纲/ 下出现 审读_一致性巡查.md
  const files = await page.eval(`window.zhijuan.listDocs('demo-aseya', '大纲')`)
  const hit = files.find((d) => d.file === '审读_一致性巡查.md')
  if (!hit) throw new Error('大纲/ 下没有 审读_一致性巡查.md: ' + JSON.stringify(files))
  const md = await page.eval(`window.zhijuan.readDoc('demo-aseya', '大纲/审读_一致性巡查.md')`)
  if (!md || !md.includes('# 审读报告 · 一致性巡查')) throw new Error('存档内容不对: ' + String(md).slice(0, 80))
  console.log('OK 落盘实锤：大纲/审读_一致性巡查.md（内容含报告头）')

  // ③ 大纲区「审读存档」可点击回看
  await page.eval(`location.hash = '#/project/demo-aseya/outline'`)
  await evalUntil(page, `document.body.innerText.includes('审读存档')`, (v) => v === true, 15000, '大纲区出现审读存档区')
  console.log('OK 大纲区出现「审读存档」')
  console.log('点击审读条目:', await page.eval(clickByText('一致性巡查')))
  await evalUntil(page, `document.body.innerText.includes('设定需要再看一眼')`, (v) => v === true, 10000, '编辑器渲染出报告内容')
  console.log('OK 编辑器渲染出审读报告内容')

  console.log('\nPASS: 审读存档（自动落盘 + 大纲区回看）链路 OK')
} finally {
  await fetch(CDP + '/json/close/' + tab.id)
  page.close()
}
