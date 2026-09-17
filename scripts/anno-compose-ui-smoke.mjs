// 织卷无头冒烟 · 编辑器划词→批注（创作层 2026-09-13）
// 验证 Prose 划词工具条「批注」真实触发路径：DOM 选文本→zj-sel-bubble→dispatchAnno
//   →zj:anno-compose（loc 尽力计算 + before 原文）→Novel 弹层→保存→csv 落盘
// 前置：node scripts/serve-renderer.mjs 8123；无头 Chrome CDP 127.0.0.1:9224
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
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
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
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT ' + label)
    await sleep(300)
  }
}
let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')) }
}

const tab = await openTab(BASE + '/#/project/demo-aseya/novel?ac=1')
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, `document.body.innerText.includes('雾港')`, Boolean, 25000, '页载')
// ① 选中章节 → 编辑器挂载
await page.eval(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('雾港'))
  if (b) b.click()
  return !!b
})()`)
await evalUntil(page, `!!document.querySelector('.ProseMirror')`, Boolean, 20000, '编辑器挂载')
ok('选中第1章后编辑器挂载', true)
await evalUntil(page, `document.querySelector('.ProseMirror').innerText.includes('雨把港口淋成一片灰')`, Boolean, 15000, '正文加载')
ok('正文内容加载（含待选文本）', true)

// ② 真选择文本（原生 Selection API，selectionchange 自动触发）
const selRes = await page.eval(`(() => {
  const target = '雨把港口淋成一片灰'
  const walker = document.createTreeWalker(document.querySelector('.ProseMirror'), NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) { if (n.nodeValue && n.nodeValue.includes(target)) break }
  if (!n) return 'NO_TEXT_NODE'
  const start = n.nodeValue.indexOf(target)
  const range = document.createRange()
  range.setStart(n, start)
  range.setEnd(n, start + target.length)
  const s = window.getSelection()
  s.removeAllRanges()
  s.addRange(range)
  return 'OK:' + s.toString()
})()`)
ok('DOM 选择成功（原文片段）', typeof selRes === 'string' && selRes.startsWith('OK:') && selRes.includes('雨把港口'), String(selRes))

// ③ 划词浮层出现
await evalUntil(page, `!!document.querySelector('.zj-sel-bubble')`, Boolean, 10000, '划词浮层')
const bubbleTxt = await page.eval(`(document.querySelector('.zj-sel-bubble') || {}).innerText || ''`)
console.log('BUBBLE:', JSON.stringify(bubbleTxt))
ok('划词浮层出现且含「批注」按钮', bubbleTxt.includes('批注') && bubbleTxt.includes('对话'), bubbleTxt.replace(/\n/g, '|'))

// ④ 点「批注」→ Novel 弹层（before 原文 + loc）
await page.eval(`(() => {
  const b = [...document.querySelectorAll('.zj-sel-bubble button')].find((x) => (x.innerText || '').trim() === '批注')
  if (!b) return 'NO_BTN'
  b.click()
  return 'OK'
})()`)
await evalUntil(page, `document.body.innerText.includes('添加批注')`, Boolean, 8000, '批注弹层')
const dlgDesc = await page.eval(`(document.querySelector('[role=dialog]') || {}).innerText || ''`)
console.log('DLG:', JSON.stringify(dlgDesc.slice(0, 120)))
ok('弹层显示选中原文「已选中：雨把港口…」', dlgDesc.includes('已选中') && dlgDesc.includes('雨把港口'), dlgDesc.slice(0, 60))

// ⑤ 填意图 → 保存 → csv 落盘（第三列 before + loc）
await page.eval(`(() => {
  const ta = document.querySelector('[role=dialog] textarea')
  if (!ta) return 'NO_TA'
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
  setter.call(ta, '雨句再收一点，换成两句短句。')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'OK'
})()`)
await page.eval(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '保存批注')
  if (!b) return 'NO_BTN'
  b.click()
  return 'OK'
})()`)
await evalUntil(page, `document.body.innerText.includes('批注已添加')`, Boolean, 10000, '保存成功 toast')
ok('保存后出现「批注已添加」', true)
const csv = await page.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港_批注.csv')`)
// loc 留空（第 1 列空）+ 第 2 列意图 + 第 3 列原文（before 兜底定位口径）
ok('csv 新增行：loc 空 + 意图 + 选中原文（第三列）', typeof csv === 'string' && csv.includes(',雨句再收一点，换成两句短句。,雨把港口淋成一片灰'), JSON.stringify(csv))

// ⑥ before 兜底定位闭环：扫描 → 新批注（loc 空）按原文匹配生成提案
const scan = await page.eval(`window.zhijuan.scanAnnotations('demo-aseya')`)
console.log('SCAN:', JSON.stringify(scan))
ok('扫描命中新行（found≥3）', scan && Number(scan.found) >= 3, JSON.stringify(scan))
const props = await page.eval(`window.zhijuan.listProposals('demo-aseya').then((ps) => ps.filter((p) => p.source === 'annotation-sync'))`)
ok(
  '生成提案里含 before=雨句（loc 空兜底定位成功）',
  Array.isArray(props) && props.some((p) => JSON.stringify(p).includes('雨把港口淋成一片灰')),
  JSON.stringify(props.map((p) => p.target + '/' + (p.anchor || '')))
)

console.log(`RESULT: pass=${pass} fail=${fail}`)
if (page.errors.length) { fail++; console.log('FAIL 无 JS 异常:', page.errors.slice(0, 3).join(' | ')) }
else { pass++; console.log('PASS 无 JS 异常') }
process.exit(fail ? 1 : 0)
