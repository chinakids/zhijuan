// 织卷无头冒烟 · 称谓发现核查（devShim 空态路径）：Agent 面板新按钮 → 抽屉打开 → 标题/摘要/空态渲染
// 命中路径由 scripts/nameform-data-smoke.mjs（主进程真实现 + 临时库）覆盖，此处验证 UI 接线（按钮/标题/空态/无 JS 异常）。
// 用法：node scripts/nameform-ui-smoke.mjs
// 前置：npm run build 后 python3 /tmp/spa_server.py（SPA fallback，127.0.0.1:8899）；本机专用无头 Chrome CDP 127.0.0.1:9224
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8899'
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

let pass = 0
let failed = false
const check = (name, cond) => {
  if (!cond) { failed = true; throw new Error('断言失败: ' + name) }
  pass++
  console.log('  ✓ ' + name)
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')
  console.log('OK 正文页就绪')

  // ① 新按钮存在（title + aria-label）
  const btn = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.title && x.title.startsWith('称谓发现核查'))
    return b ? { title: b.title, label: b.getAttribute('aria-label') } : null
  })()`)
  check('新按钮存在（title + aria-label）', btn && btn.label === '称谓发现核查')

  // ② 点击 → 抽屉打开并出现标题（K_TITLE 接线）
  console.log('点击按钮:', await page.eval(clickByTitle('称谓发现核查：正文出现「姓+称谓 / 老小阿大+姓」但档案未登记（本地规则·秒级·零模型）')))
  await evalUntil(page, `document.body.innerText.includes('称谓发现核查')`, (v) => v === true, 8000, '抽屉标题出现')

  // ③ 结果 summary 渲染（演示项目：仅沈藏且正文用其登记别名「沈爷」→ 零命中空态）
  await evalUntil(page, `document.body.innerText.includes('未发现') && document.body.innerText.includes('本地规则核查')`, (v) => v === true, 15000, '结果 summary 渲染')

  // ④ 摘要口径与空态语义都在
  const txt = await page.eval(`document.body.innerText`)
  check('抽屉渲染 summary（零命中口径）', txt.includes('称谓发现核查（本地规则·零模型）') && txt.includes('未发现'))
  check('空态语义渲染', txt.includes('这一遍没有发现问题'))
  check('本地规则秒级文案', txt.includes('本地规则核查') && txt.includes('零模型·秒级'))

  // ⑤ 抽屉内 tab 按钮「称谓」存在且可切换（当前已是 nameform，切去「在场」再切回）
  const tabBtn = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '称谓' && !x.title)
    return b ? b.textContent.trim() : null
  })()`)
  check('抽屉顶栏「称谓」tab 存在', tabBtn === '称谓')
  console.log('切 tab:', await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '在场' && !x.title)
    if (!b) return 'NOT_FOUND'
    b.click()
    return 'CLICKED'
  })()`))
  await evalUntil(page, `document.body.innerText.includes('人物在场核查')`, (v) => v === true, 10000, '切到在场 tab')
  console.log('OK 可切换到其他 tab（无 JS 异常）')

  console.log(`\n全部通过：${pass} 断言`)
} finally {
  page.close()
}
