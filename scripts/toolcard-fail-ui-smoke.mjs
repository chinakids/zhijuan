// 织卷无头冒烟 · 工具活动卡失败态（meta-done ok:false → 红色失败徽标）
// 用法：node scripts/toolcard-fail-ui-smoke.mjs
// 前置：npm run build；python3 -m http.server 8123 --directory out/renderer；CDP 9224
// 验收：① devShim 演示 prompt 含「读不到」→ zj_search 失败卡（红「失败」徽标 + 错误摘要）；
//       ② 同轮成功工具卡仍渲染对勾；③ 无 JS 异常。
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

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`, (v) => v === true, 20000, 'Novel+Agent 就绪')
  ok('① Novel 页 + agent 输入框就绪', true)

  // 聚焦输入框并真实键入（触发「读不到」→ devShim 失败演示；不含「改/修/润」避免修改演示）
  await page.cmd('DOM.enable')
  const doc = await page.cmd('DOM.getDocument')
  const { nodeId } = await page.cmd('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'textarea' })
  await page.cmd('DOM.focus', { nodeId })
  await page.cmd('Input.insertText', { text: '帮我读一下那个不存在的文件，看看会不会报错' })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })

  // ② 失败工具卡出现：红「失败」徽标 + 错误摘要「未找到匹配（ENOENT）」
  await evalUntil(page, `document.body.innerText.includes('未找到匹配（ENOENT）')`, (v) => v === true, 20000, '失败卡摘要')
  ok('② 失败工具卡·错误摘要出现', true)
  const failBadge = await page.eval(`(() => { const els = [...document.querySelectorAll('span')].filter((e) => e.innerText.trim() === '失败'); return els.map((e) => { const c = getComputedStyle(e); return { color: c.color, bg: c.backgroundColor } }) })()`)
  ok('③ 失败徽标渲染（text-danger/bg-danger-soft 系）', failBadge.length >= 1, JSON.stringify(failBadge.slice(0, 2)))
  const isRed = failBadge.some((x) => {
    const m = String(x.color).match(/[0-9]+/g)
    if (!m || m.length < 3) return false
    const [r, g, b] = m.map(Number)
    return r > g && r > b && r > 100
  })
  ok('③ 失败徽标为红色', isRed, JSON.stringify(failBadge.slice(0, 2)))

  // ④ 本轮成功工具卡仍为对勾（zj_read_doc 成功）
  await evalUntil(page, `document.body.innerText.includes('章节已读完')`, (v) => v === true, 8000, '成功卡摘要')
  const okBadge = await page.eval(`(() => { const s = [...document.querySelectorAll('span')].find((e) => e.innerText === '章节已读完'); if (!s) return null; const row = s.closest('div'); return row ? { text: row.innerText, cls: row.className } : null })()`)
  ok('④ 成功工具卡仍渲染（对勾绿）', !!okBadge && /border-hair/.test(okBadge.cls), JSON.stringify(okBadge))

  // ⑤ 无 JS 异常
  const errs = page.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e) && !/DevTools/.test(e))
  ok('⑤ 无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))
} catch (e) {
  console.error('FATAL ' + e.message)
  fails++
}
page.close()

console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL (' + fails + ')')
process.exit(fails === 0 ? 0 : 1)
