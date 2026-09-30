// 织卷无头冒烟 · 提案「重新提议」（reopen rejected，2026-09-30 创作层）
// 用法：node scripts/proposal-reopen-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；CDP 9224
// 验收点：① 已处理组 rejected 卡有「重新提议」按钮（pending 卡不显示）；② 点击→卡回待确认组
//         （状态徽标「待确认」、接受/拒绝按钮出现）；③ 再拒绝→回已处理（可逆闭环）；④ 无 JS 异常。
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

function pointerClickScript(selectorExpr) {
  return `(() => {
    const el = ${selectorExpr}
    if (!el) return 'NOT_FOUND'
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    el.click()
    return 'CLICKED'
  })()`
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

// 卡定位助手（按 reason 文本找卡）：返回卡元素 JS 表达式
const cardExpr = (reason) => `document.querySelectorAll('[data-pid]') && [...document.querySelectorAll('[data-pid]')].find((c) => c.innerText.includes(${JSON.stringify(reason)}))`

try {
  // ① 页面就绪 + 植入 2 条 pending 提案（A 留作对照、B 将被拒绝后重开）
  await evalUntil(page, `typeof window.zhijuan !== 'undefined' && typeof window.zhijuan.createProposals === 'function'`, (v) => v === true, 20000, 'devShim 就绪')
  await page.eval(`(() => {
    window.zhijuan.createProposals('demo-aseya', 'slice-sync', '第01章_雾港.md', '第一幕_雾港之夜', [
      { target: '人物/林晓.md', anchor: '切片：第一幕_雾港之夜', kind: 'upsert-section', before: '', after: '- 本幕动向：主动靠近', reason: '重开测试A' },
      { target: '世界观/切片_第一幕_雾港之夜.md', anchor: '切片：第一幕_雾港之夜', kind: 'upsert-section', before: '', after: '- 大雾', reason: '重开测试B' }
    ])
    return 1
  })()`)

  // ② 进工作区 → 打开提案抽屉
  await page.eval(`(location.hash = '#/project/demo-aseya/novel', 1)`)
  await evalUntil(page, `document.body.innerText.includes('待确认提案') && [...document.querySelectorAll('button')].some((x) => x.title && x.title.includes('待确认') && (x.innerText || '').includes('2'))`, (v) => v === true, 20000, '待确认入口')
  await evalUntil(page, `(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('待确认提案'))
    if (!b) return 'NOT_FOUND'
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    b.click()
    return 'CLICKED'
  })()`, (v) => v === 'CLICKED', 10000, '打开抽屉')

  // ③ 初始：待确认 2 条、已处理 0
  await evalUntil(page, `(${cardExpr('重开测试B')} ? true : false)`, (v) => v === true, 10000, 'B 卡出现')
  let s0 = await page.eval(`({ pending: document.body.innerText.includes('待确认 2'), done: document.body.innerText.includes('已处理 0') || !document.body.innerText.includes('已处理 1') })`)
  ok('① 初始待确认 2 / 已处理 0', s0.pending && s0.done, JSON.stringify(s0))

  // ④ 拒绝 B → 已处理组出现「重新提议」按钮；A（pending）卡不显示
  await page.eval(pointerClickScript(`(${cardExpr('重开测试B')}).querySelectorAll('button') && [...(${cardExpr('重开测试B')}).querySelectorAll('button')].find((x) => x.innerText.trim() === '拒绝')`))
  await evalUntil(page, `([...document.querySelectorAll('button')].find((x) => x.innerText === '重新提议') ? true : false)`, (v) => v === true, 10000, '重新提议按钮出现')
  // 定位 B 卡内「重新提议」按钮：B 已拒绝，卡内应有重新提议
  const bHas = await page.eval(`(() => {
    const c = ${cardExpr('重开测试B')}
    if (!c) return 'NO_CARD'
    return [...c.querySelectorAll('button')].map((x) => x.innerText.trim()).join(',')
  })()`)
  const aHas = await page.eval(`(() => {
    const c = ${cardExpr('重开测试A')}
    if (!c) return 'NO_CARD'
    return [...c.querySelectorAll('button')].map((x) => x.innerText.trim()).join(',')
  })()`)
  ok('② 拒绝后 B 卡（已处理组）显示「重新提议」', typeof bHas === 'string' && bHas.includes('重新提议'), bHas)
  ok('③ A 卡（pending）不显示「重新提议」', typeof aHas === 'string' && !aHas.includes('重新提议'), aHas)

  // ⑤ 点 B 卡「重新提议」→ 回待确认组（徽标「待确认」+ 接受/拒绝按钮出现）
  await page.eval(pointerClickScript(`(${cardExpr('重开测试B')}).querySelectorAll('button') && [...(${cardExpr('重开测试B')}).querySelectorAll('button')].find((x) => x.innerText.trim() === '重新提议')`))
  await evalUntil(page, `(() => {
    const c = ${cardExpr('重开测试B')}
    if (!c) return false
    const txt = c.innerText
    return txt.includes('待确认') && [...c.querySelectorAll('button')].some((x) => x.innerText.trim() === '拒绝')
  })()`, (v) => v === true, 10000, 'B 回待确认+拒绝按钮')
  const s5 = await page.eval(`({ done: document.body.innerText.includes('已处理 0') || !document.body.innerText.includes('已处理 1'), pending2: document.body.innerText.includes('待确认 2') })`)
  ok('④ 重开后 B 回待确认组（待确认 2 / 已处理 0）', s5.done && s5.pending2, JSON.stringify(s5))

  // ⑥ 再拒绝 B → 回已处理（可逆闭环）
  await page.eval(pointerClickScript(`(${cardExpr('重开测试B')}).querySelectorAll('button') && [...(${cardExpr('重开测试B')}).querySelectorAll('button')].find((x) => x.innerText.trim() === '拒绝')`))
  await evalUntil(page, `([...document.querySelectorAll('button')].find((x) => x.innerText === '重新提议') ? true : false)`, (v) => v === true, 10000, '再拒绝后重新提议按钮复现')
  ok('⑤ 再拒绝=回到已拒绝（重新提议按钮复现，闭环可逆）', true)

  // ⑦ 无 JS 异常
  const errs = page.errors.filter((e) => !/favicon|Download the React DevTools/.test(e))
  ok('⑥ 无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' | '))
} catch (e) {
  console.error('FATAL:', e.message)
  fails++
} finally {
  console.log(fails === 0 ? 'ALL PASS' : 'FAILED: ' + fails)
  page.close()
  process.exit(fails === 0 ? 0 : 1)
}
