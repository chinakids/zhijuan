// 织卷无头冒烟 · 采集栏（CollectionBar）错误态收口 + 发起采集表单 HIG Text fields 走查
// ——体验层 2026-10-07（04-体验层.md 五候选 1）
// 背景：submit/doDelete/doRetry/openView/togglePreview/refresh 六处异步调用此前均裸 await——
// writeDoc/deleteDoc/listDocs 失败 = unhandled rejection + saving/deleting 卡死；本轮补
// try/catch + toast（「提交任务失败/删除任务失败/重发任务失败/预览读取失败/刷新采集任务失败」，
// 文案口径表「X 失败」句式）+ 失败时保留现场可就地重试 + 删除失败保留确认框；
// 采集表单按 HIG Text fields 走查：Label htmlFor/输入 id 关联、初始焦点=需求描述、必填「*」提示、
// 单行字段 Enter=提交（IME 组合期守卫）、多行 Textarea 保持换行。
// 断言语义：
//   场景 A（writeDoc 失败）：提交 → toast「提交任务失败」+ 弹窗与已填内容保留 + 按钮复位可重试；
//   场景 B（deleteDoc 失败）：删除 → toast「删除任务失败」+ 确认框保留可重试 + 按钮复位；
//   场景 C（listDocs 失败）：刷新 → toast「刷新采集任务失败」（非静默）；
//   场景 D（表单 HIG）：label for↔id 四对关联、初始焦点=需求描述 textarea、必填「*」、Enter 提交成功路径；
//   全场景零 JS 异常（Runtime.exceptionThrown + console.error 双通道）。
// 用法：node scripts/collect-errors-ui-smoke.mjs（先 npm run build + serve-renderer + CDP 9224）
const base = 'http://127.0.0.1:9224'
const APP = 'http://127.0.0.1:8899'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
function ok(name, cond, extra) {
  if (cond) console.log('  ✓', name)
  else { console.log('  ✗', name, extra ?? ''); fails++ }
}
async function newTab(u) {
  const r = await fetch(`${base}/json/new?${encodeURIComponent(u)}`, { method: 'PUT' })
  if (!r.ok) throw new Error('new failed ' + r.status)
  return r.json()
}
function makeConn(tab) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  const exceptions = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push('exception: ' + ((m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text) ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') exceptions.push('console.error: ' + JSON.stringify((m.params.args || []).map((a) => a.value ?? a.description).join(' ')).slice(0, 200))
  }
  function cmd(method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  }
  return { ws, cmd, exceptions }
}
async function drive(tab) {
  const { ws, cmd, exceptions } = makeConn(tab)
  await new Promise((r) => (ws.onopen = r))
  await cmd('Runtime.enable')
  const ev = async (expression) => {
    const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails))
    return r.result?.value
  }
  return { ws, ev, exceptions }
}
async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.ev(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT: ' + label)
    await sleep(250)
  }
}
async function openCollectTab(extraParams) {
  const tab = await newTab(`${APP}/?cb=${Date.now()}${extraParams}#/project/demo-aseya/library`)
  const page = await drive(tab)
  await evalUntil(page, `document.body.innerText.includes('采集任务')`, (v) => v === true, 20000, '素材库页就绪')
  await sleep(500)
  return page
}
async function closeConn(conn) { try { conn.ws.close() } catch {} }

console.log('场景 A：提交失败（writeDoc reject）→ toast + 弹窗保留 + 按钮复位')
{
  const page = await openCollectTab('&zj-fail-x=writeDoc')
  // 打开发起采集表单
  await page.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').includes('发起采集')); if (!b) return 'no'; b.click(); return 'ok' })()`)
  await evalUntil(page, `!!document.querySelector('textarea#collect-demand')`, (v) => v === true, 8000, '表单出现')
  // 填需求（原生 setter + input 事件驱动 React）
  await page.ev(`(() => {
    const ta = document.querySelector('textarea#collect-demand')
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
    setter.call(ta, '测试提交失败的场景需求')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return ta.value
  })()`)
  await sleep(200)
  // 点提交
  await page.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').includes('提交任务')); if (!b) return 'no'; b.click(); return 'ok' })()`)
  await evalUntil(page, `(document.querySelector('[role="alert"]')?.textContent || '').includes('提交任务失败')`, (v) => v === true, 8000, '提交失败 toast')
  const A = await page.ev(`(() => ({
    dlgOpen: !!document.querySelector('[role="dialog"]') && document.body.innerText.includes('发起采集'),
    btn: [...document.querySelectorAll('button')].find((x) => (x.textContent||'').includes('提交任务'))?.textContent ?? '',
    disabled: [...document.querySelectorAll('button')].find((x) => (x.textContent||'').includes('提交任务'))?.disabled ?? null,
    demand: document.querySelector('textarea#collect-demand')?.value ?? ''
  }))()`)
  ok('toast「提交任务失败」出现', true)
  ok('提交失败后弹窗保留', A.dlgOpen, JSON.stringify(A))
  ok('提交按钮复位可重试（非提交中/禁用）', A.btn.includes('提交任务') && A.disabled === false, JSON.stringify(A))
  ok('已填需求内容保留', A.demand === '测试提交失败的场景需求', A.demand)
  ok('场景 A 零 JS 异常', page.exceptions.length === 0, page.exceptions.join(' | '))
  await closeConn(page)
}

console.log('场景 B：删除失败（deleteDoc 返回 ok:false）→ toast + 确认框保留 + 按钮复位')
{
  const page = await openCollectTab('&zj-fail-x=deleteDoc')
  // 打开「任务_演示停滞」详情
  await page.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').includes('任务_演示停滞') || (x.textContent||'').includes('雨夜码头')); if (!b) return 'no'; b.click(); return 'ok' })()`)
  await evalUntil(page, `document.body.innerText.includes('删除该任务')`, (v) => v === true, 8000, '详情出现')
  await page.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').includes('删除该任务')); b.click(); return 'ok' })()`)
  await evalUntil(page, `document.body.innerText.includes('删除任务卡？')`, (v) => v === true, 8000, '确认框出现')
  // 点确认删除
  await page.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').trim() === '删除'); if (!b) return 'no'; b.click(); return 'ok' })()`)
  await evalUntil(page, `(document.querySelector('[role="alert"]')?.textContent || '').includes('删除任务失败')`, (v) => v === true, 8000, '删除失败 toast')
  const B = await page.ev(`(() => ({
    confirmStill: document.body.innerText.includes('删除任务卡？'),
    delBtn: [...document.querySelectorAll('button')].find((x) => (x.textContent||'').trim() === '删除' || (x.textContent||'').includes('删除中'))?.textContent ?? '',
    delDisabled: [...document.querySelectorAll('button')].find((x) => (x.textContent||'').trim() === '删除')?.disabled ?? null
  }))()`)
  ok('toast「删除任务失败」出现', true)
  ok('删除失败后确认框保留（可就地重试/取消）', B.confirmStill, JSON.stringify(B))
  ok('删除按钮复位可点', B.delBtn === '删除' && B.delDisabled === false, JSON.stringify(B))
  ok('场景 B 零 JS 异常', page.exceptions.length === 0, page.exceptions.join(' | '))
  await closeConn(page)
}

console.log('场景 C：刷新失败（listDocs reject）→ toast「刷新采集任务失败」（非静默）')
{
  const page = await openCollectTab('&zj-fail-x=listDocs')
  await evalUntil(page, `(document.querySelector('[role="alert"]')?.textContent || '').includes('刷新采集任务失败')`, (v) => v === true, 8000, '刷新失败 toast')
  ok('toast「刷新采集任务失败」出现', true)
  ok('场景 C 零 JS 异常', page.exceptions.length === 0, page.exceptions.join(' | '))
  await closeConn(page)
}

console.log('场景 D：发起采集表单 HIG Text fields 走查（正常路径）')
{
  const page = await openCollectTab('')
  await page.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').includes('发起采集')); if (!b) return 'no'; b.click(); return 'ok' })()`)
  await evalUntil(page, `!!document.querySelector('textarea#collect-demand')`, (v) => v === true, 8000, '表单出现')
  const D1 = await page.ev(`(() => ({
    demand: !!document.querySelector('label[for="collect-demand"]') && !!document.querySelector('textarea#collect-demand'),
    keywords: !!document.querySelector('label[for="collect-keywords"]') && !!document.querySelector('#collect-keywords'),
    category: !!document.querySelector('label[for="collect-category"]') && !!document.querySelector('#collect-category'),
    source: !!document.querySelector('label[for="collect-source"]') && !!document.querySelector('#collect-source'),
    focused: document.activeElement?.id ?? '',
    reqLabel: document.querySelector('label[for="collect-demand"]')?.textContent ?? ''
  }))()`)
  ok('label for↔id 四对关联（需求/关键词/类别/来源）', D1.demand && D1.keywords && D1.category && D1.source, JSON.stringify(D1))
  ok('初始焦点=需求描述输入区', D1.focused === 'collect-demand', D1.focused)
  ok('必填提示「需求描述 *」', D1.reqLabel.includes('需求描述') && D1.reqLabel.includes('*'), D1.reqLabel)
  // 填需求 → 焦点移关键词 → Enter 提交（成功路径）
  await page.ev(`(() => {
    const ta = document.querySelector('textarea#collect-demand')
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
    setter.call(ta, '键盘提交验证：市集清晨的摊位细节')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return ta.value
  })()`)
  await sleep(200)
  await page.ev(`(() => { document.querySelector('#collect-keywords').focus(); return document.activeElement?.id })()`)
  await sleep(100)
  const D2 = await page.ev(`(() => {
    const el = document.querySelector('#collect-keywords')
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    return 'sent'
  })()`)
  await sleep(600)
  const D3 = await page.ev(`(() => ({
    dlgGone: document.querySelectorAll('[role="dialog"]').length === 0,
    hasNew: document.body.innerText.includes('市集清晨')
  }))()`)
  ok('单行字段 Enter=提交（表单关闭+任务卡刷新可见）', D3.dlgGone && D3.hasNew, JSON.stringify(D3))
  ok('场景 D 零 JS 异常', page.exceptions.length === 0, page.exceptions.join(' | '))
  await closeConn(page)
}

console.log(fails === 0 ? 'SMOKE OK' : 'SMOKE FAILED: ' + fails)
process.exit(fails === 0 ? 0 : 1)
