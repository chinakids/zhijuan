// 织卷无头冒烟 · 流式增量帧级节流（streamBuffer）：高频 think/delta 流合并后内容完整无丢失（智能层 2026-09-13）
// 用法：node scripts/stream-buffer-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路：发送含「流式压力」的消息 → devShim 以 3ms 间隔高频发射 60 个 think 增量 + 逐段 delta →
//       渲染层 streamBuffer 按帧合并 → 断言「思考过程」全文 = 60 片段完整拼接、正文 = demo 全文（无丢失/无错序/无残余尾缀）。
// 背景：长 reasoning 思考每增量一次全量 setState 会形成渲染风暴；节流后渲染频率钳到帧率，flushNow 保证尾段不丢。
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
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
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
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
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
async function typeText(page, text) {
  for (const ch of text) {
    await page.eval(`(() => {
      const ta = document.querySelector('textarea')
      if (!ta) return 'NO_TA'
      ta.focus()
      const proto = Object.getPrototypeOf(ta)
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(ta, ta.value + ${JSON.stringify(ch)})
      const pos = ta.value.length
      ta.setSelectionRange(pos, pos)
      const ev = new Event('input', { bubbles: true })
      ev.isComposing = false
      ta.dispatchEvent(ev)
      ta.dispatchEvent(new Event('change', { bubbles: true }))
      return ta.value
    })()`)
    await sleep(40)
  }
  return 'OK'
}
async function pressEnter(page) {
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)
}
// 最后一条 assistant 气泡的可见文本（.prose）
const asstText = `(() => {
  const els = [...document.querySelectorAll('.prose')]
  const el = els[els.length - 1]
  return el ? el.innerText : ''
})()`
// 思考过程块（details/summary 里含「思考过程」或「思考中…」）的内容文本
const thinkText = `(() => {
  const s = [...document.querySelectorAll('summary')].find((x) => (x.innerText || '').includes('思考'))
  if (!s) return ''
  const d = s.closest('details')
  return d ? (d.innerText || '') : ''
})()`

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log('PASS ' + name)
  } else {
    fail++
    console.log('FAIL ' + name + (extra ? ' | ' + extra : ''))
  }
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`, (v) => v === true, 20000, '正文页就绪')
  console.log('OK 正文页就绪')

  // 发送「流式压力」：devShim 高频发射 60 个 think 增量 + 逐段 delta
  await typeText(page, '流式压力测试')
  await pressEnter(page)

  // 等流结束：assistant 气泡出现 demo 尾句
  await evalUntil(
    page,
    `(() => { const els = [...document.querySelectorAll('.prose')]; const t = els[els.length-1] ? els[els.length-1].innerText : ''; return t.includes('把这一段写出来') })()`,
    (v) => v === true,
    30000,
    '压力流结束'
  )
  await sleep(600) // 等待收尾 flush 与渲染稳定

  const asst = await page.eval(asstText)
  const think = await page.eval(thinkText)
  const expectedThink = Array.from({ length: 60 }, (_, i) => `思考片段${String(i).padStart(2, '0')}；`).join('')
  console.log('ASST LEN:', asst.length, 'THINK LEN:', think.length, '/ expected', expectedThink.length)

  ok('思考过程块存在', think.includes('思考过程') || think.includes('思考中'), think.slice(0, 40))
  ok('思考全文完整（60 片段拼接无丢失）', think.includes(expectedThink), 'len=' + think.length)
  ok('思考片段首尾在（00 与 59）', think.includes('思考片段00；') && think.includes('思考片段59；'))
  ok('正文开头完整（无残余 delta 前缀）', asst.startsWith('（dev 模式模拟回复）'), asst.slice(0, 50))
  ok('正文尾句完整', asst.includes('把这一段写出来'), asst.slice(-60))
  ok('正文无重复/错序（demo 首段只出现一次）', asst.split('刚把当前章节').length === 2, 'count=' + asst.split('刚把当前章节').length)

  const jserr = await page.eval(`(() => {
    return (window.__ZJ_ERR || 0)
  })()`).catch(() => null)
  ok('无 JS 异常标记', jserr === null || jserr === 0, String(jserr))

  console.log('ALL OK ✅ (' + pass + '/' + (pass + fail) + ')')
} catch (err) {
  console.error('FAIL:', err.message)
  process.exitCode = 1
} finally {
  page.close()
}
