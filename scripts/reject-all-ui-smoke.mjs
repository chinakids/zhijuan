// 织卷无头冒烟 · 提案「全部拒绝」（批量否决）——与「全部接受」对称的整批否决出口
// 用法：node scripts/reject-all-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；CDP 9224
// 验收点：① 待确认组头「全部拒绝」按钮存在（与「全部接受」同排）；② 点击弹确认框（标题+后果描述+N 计数）；
//         ③ 取消=零执行（pending 不变）；④ 确认=全部置 rejected、pending 清零、已处理组 3 张「已拒绝」；
//         ⑤ 无 JS 异常。
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

try {
  // ① 页面就绪 + 植入 3 条 pending 提案（模拟切片同步/批注批量产出）
  await evalUntil(page, `typeof window.zhijuan !== 'undefined' && typeof window.zhijuan.createProposals === 'function'`, (v) => v === true, 20000, 'devShim 就绪')
  await page.eval(`(() => {
    window.zhijuan.createProposals('demo-aseya', 'slice-sync', '第01章_雾港.md', '第一幕_雾港之夜', [
      { target: '人物/林晓.md', anchor: '切片：第一幕_雾港之夜', kind: 'upsert-section', before: '', after: '- 本幕动向：主动靠近', reason: '测试A' },
      { target: '人物/陈默.md', anchor: '', kind: 'append', before: '', after: '- 台词调整', reason: '测试B' },
      { target: '世界观/切片_第一幕_雾港之夜.md', anchor: '切片：第一幕_雾港之夜', kind: 'upsert-section', before: '', after: '- 大雾', reason: '测试C' }
    ])
    return 1
  })()`)

  // ② 进入工作区页 → 徽标 3 → 点开抽屉
  await page.eval(`(location.hash = '#/project/demo-aseya/novel', 1)`)
  await evalUntil(page, `document.body.innerText.includes('待确认提案') && [...document.querySelectorAll('button')].some((x) => x.title && x.title.includes('待确认') && (x.innerText || '').includes('3'))`, (v) => v === true, 20000, '待确认徽标 3')
  await evalUntil(page, `(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('待确认提案'))
    if (!b) return 'NOT_FOUND'
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    b.click()
    return 'CLICKED'
  })()`, (v) => v === 'CLICKED', 10000, '打开抽屉')

  // ③ 抽屉内：组头「全部拒绝」+「全部接受」同排；尚只有一个「全部拒绝」按钮
  await evalUntil(page, `document.body.innerText.includes('待确认 3')`, (v) => v === true, 10000, '待确认组头')
  const headerBtns = await page.eval(`(() => {
    const btns = [...document.querySelectorAll('button')].filter((x) => x.innerText === '全部拒绝' || x.innerText === '全部接受')
    return { count: btns.length, rejectText: btns.map((x) => x.innerText).join(','), sameRow: (() => {
      const r = btns.find((x) => x.innerText === '全部拒绝'); const a = btns.find((x) => x.innerText === '全部接受')
      if (!r || !a) return false
      return Math.abs(r.getBoundingClientRect().top - a.getBoundingClientRect().top) < 8
    })() }
  })()`)
  ok('组头「全部拒绝/全部接受」同排', headerBtns.sameRow && headerBtns.rejectText === '全部拒绝,全部接受', JSON.stringify(headerBtns))

  // ④ 点「全部拒绝」→ 确认框出现（标题+后果描述+N 计数）
  await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText === '全部拒绝')
    if (!b) return 'NOT_FOUND'
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    b.click()
    return 'CLICKED'
  })()`)
  await evalUntil(page, `document.body.innerText.includes('拒绝全部提案？')`, (v) => v === true, 10000, '确认框标题')
  const desc = await page.eval(`([...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join(' ') || '')`)
  ok('确认框携带后果与计数', desc.includes('将拒绝 3 条提案') && desc.includes('同类修改不再重复提出') && desc.includes('重新提议'), desc.slice(0, 200))
  const dialogRejectBtns = await page.eval(`(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => (x.innerText || '').includes('拒绝全部提案？'))
    return d ? [...d.querySelectorAll('button')].filter((x) => x.innerText === '全部拒绝').length : -1
  })()`)
  ok('确认框内「全部拒绝」按钮', dialogRejectBtns === 1, String(dialogRejectBtns))

  // ⑤ 取消 = 零执行：pending 仍 3、卡片仍「待确认」
  await page.eval(`(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => (x.innerText || '').includes('拒绝全部提案？'))
    const b = d ? [...d.querySelectorAll('button')].find((x) => x.innerText === '取消') : null
    if (!b) return 'NOT_FOUND'
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    b.click()
    return 'CLICKED'
  })()`)
  await evalUntil(page, `![...document.querySelectorAll('[role="dialog"]')].some((d) => (d.innerText || '').includes('拒绝全部提案？'))`, (v) => v === true, 10000, '确认框关闭')
  const afterCancel = await page.eval(`({ hasPending3: document.body.innerText.includes('待确认 3'), rejectedCards: [...document.querySelectorAll('[role="dialog"], .rounded-xl')].filter((x) => (x.innerText || '').includes('已拒绝')).length })`)
  ok('取消后 pending 不变', afterCancel.hasPending3 && afterCancel.rejectedCards === 0, JSON.stringify(afterCancel))

  // ⑥ 再点「全部拒绝」→ 确认 → 全部置 rejected；pending 清零、已处理组 3 张「已拒绝」
  await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText === '全部拒绝')
    if (!b) return 'NOT_FOUND'
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    b.click()
    return 'CLICKED'
  })()`)
  await evalUntil(page, `document.body.innerText.includes('拒绝全部提案？')`, (v) => v === true, 10000, '确认框二次出现')
  await page.eval(`(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => (x.innerText || '').includes('拒绝全部提案？'))
    const b = d ? [...d.querySelectorAll('button')].find((x) => x.innerText === '全部拒绝') : null
    if (!b) return 'NOT_FOUND'
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    b.click()
    return 'CLICKED'
  })()`)
  await evalUntil(page, `document.body.innerText.includes('已处理 3 条')`, (v) => v === true, 15000, '已处理组 3 条')
  const afterReject = await page.eval(`({
    pendingGone: !document.body.innerText.includes('待确认 3'),
    doneHeader: document.body.innerText.includes('已处理 3 条'),
    rejectedCards: [...document.querySelectorAll('.rounded-xl')].filter((x) => (x.innerText || '').includes('已拒绝')).length
  })`)
  ok('确认后 pending 清零+已处理组3张已拒绝', afterReject.pendingGone && afterReject.doneHeader && afterReject.rejectedCards === 3, JSON.stringify(afterReject))

  // ⑦ 无页面异常
  const errs = page.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e))
  ok('无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))
} catch (e) {
  console.error('FATAL ' + e.message)
  fails++
} finally {
  page.close()
  console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL (' + fails + ')')
  process.exit(fails === 0 ? 0 : 1)
}
