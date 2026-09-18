// 织卷无头冒烟 · 工具活动失败态（meta-done ok:false → 失败行 data-failed + 红色文字）
// 用法：node scripts/toolcard-fail-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；CDP 9224
// 验收：① devShim 演示 prompt 含「读不到」→ zj_search 失败行（data-failed 锚点 + 红色文字 + 错误摘要）；
//       ② 同轮成功工具行仍渲染（成功色对勾、无 data-failed）；③ 无 JS 异常。
// 适配（2026-09-18 平台层）：9048f00 工具调用去卡片化（F-20260917-04）后失败态=行级 data-failed="true"＋
//       文字颜色（移除「失败」徽标 pill 与 bg-danger-soft 卡片、border-hair 卡容器），断言改 data-failed 锚点（同 fail-guide-ui-smoke 口径）。
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

  // ② 失败工具行出现：data-failed 锚点 + 错误摘要「未找到匹配（ENOENT）」
  await evalUntil(page, `document.body.innerText.includes('未找到匹配（ENOENT）')`, (v) => v === true, 20000, '失败行摘要')
  ok('② 失败工具行·错误摘要出现', true)
  // ③ 失败态=行级 data-failed="true" + 红色文字（去卡片化 F-20260917-04：无「失败」徽标 pill/bg-danger-soft 卡片）
  const failState = await page.eval(`(() => {
    const rows = [...document.querySelectorAll('[data-failed="true"]')]
    if (!rows.length) return { found: false }
    const row = rows.find((r) => r.innerText.includes('未找到匹配（ENOENT）'))
    if (!row) return { found: false }
    const label = [...row.querySelectorAll('span')].find((s) => /text-danger/.test(s.className || ''))
    if (!label) return { found: true, hasDangerClass: false }
    const m = String(getComputedStyle(label).color).match(/[0-9]+/g)
    const isRed = !!m && m.length >= 3 && Number(m[0]) > Number(m[1]) + 40 && Number(m[0]) > Number(m[2]) + 40
    return { found: true, hasDangerClass: true, isRed, redColor: getComputedStyle(label).color, labelText: label.innerText }
  })()`)
  ok('③ 失败行 data-failed 锚点 + 红字', failState.found && failState.hasDangerClass && failState.isRed, JSON.stringify(failState))

  // ④ 本轮成功工具行仍渲染（zj_read_doc 成功：成功色对勾、无 data-failed）
  await evalUntil(page, `document.body.innerText.includes('章节已读完')`, (v) => v === true, 8000, '成功行摘要')
  const okState = await page.eval(`(() => {
    const s = [...document.querySelectorAll('span')].find((e) => e.innerText === '章节已读完')
    if (!s) return { found: false }
    const row = s.closest('[data-testid="zj-tool-detail"]')
    if (!row) return { found: true, inRow: false }
    const chk = [...row.querySelectorAll('svg')].find((svg) => /text-success/.test(svg.getAttribute('class') || ''))
    return { found: true, inRow: true, hasCheck: !!chk, failed: row.hasAttribute('data-failed') }
  })()`)
  ok('④ 同轮成功工具行仍渲染（成功色对勾）', okState.found && okState.inRow && okState.hasCheck === true && okState.failed === false, JSON.stringify(okState))

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
