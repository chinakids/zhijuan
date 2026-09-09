// 织卷无头冒烟 · 人物在场核查：审计抽屉「在场」Tab（devShim 演示数据）
// 用法：node scripts/presence-ui-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 正文页 Agent 面板出现「人物在场核查」入口按钮；② 点击后抽屉标题=人物在场核查；
//         ③ 状态行显示「本地规则核查：共列 1 条」；④ 演示条目（清单列了却未署名出场）渲染。
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

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')
  console.log('OK 正文页就绪')

  // ① Agent 面板有「人物在场核查」入口（title 含「人物在场核查」）
  const hasEntry = await page.eval(`[...document.querySelectorAll('button')].some((b) => (b.title || '').includes('人物在场核查'))`)
  if (!hasEntry) throw new Error('未找到「人物在场核查」入口按钮')
  console.log('OK 「人物在场核查」入口按钮存在')

  // ② 点击入口 → 抽屉出现（标题 = 人物在场核查）
  console.log('点击入口:', await page.eval(clickByTitle('人物在场核查：约定头「涉及人物」vs 正文实际出现（本地规则·秒级·零模型）')))
  await evalUntil(page, `document.body.innerText.includes('人物在场核查')`, (v) => v === true, 10000, '抽屉标题出现')
  console.log('OK 抽屉打开（标题=人物在场核查）')

  // ③ 状态行：本地规则核查：共列 1 条（零模型·秒级）
  await evalUntil(page, `document.body.innerText.includes('本地规则核查：共列')`, (v) => v === true, 10000, '本地规则状态行')
  console.log('OK 状态行「本地规则核查」')

  // ④ 演示条目（清单列了却未署名出场 + 阿七）渲染
  await evalUntil(page, `document.body.innerText.includes('清单列了却未署名出场')`, (v) => v === true, 10000, '条目渲染')
  const hasItem = await page.eval(`document.body.innerText.includes('阿七') && document.body.innerText.includes('让 agent 改')`)
  if (!hasItem) throw new Error('条目未渲染（缺 阿七/让 agent 改）')
  console.log('OK 演示条目渲染（含「让 agent 改」入口）')

  console.log('\nPASS: 人物在场核查（入口 → 抽屉 → 本地规则状态 → 条目）链路 OK')
} finally {
  await fetch(CDP + '/json/close/' + tab.id)
  page.close()
}
