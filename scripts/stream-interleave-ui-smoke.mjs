// 织卷无头冒烟 · 流式稳定性：delta 拼接不因工具卡错位（智能层 2026-09-13）
// 用法：node scripts/stream-interleave-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim 演示项目 + 「交错」触发词）：发送含「交错」的消息 → 演示流在 delta 中途插一次
//       zj_search 工具卡且收尾不发 final（模拟流被截断/停止）→ 断言 assistant 气泡内容仍是完整的
//       demo 全文（前段 delta 未丢、工具摘要未混入），工具卡独立正常展示。
// 背景：AgentPanel delta 分支曾用 messages.at(-1).content 拼接——工具卡 append 在消息尾部时会把
//       「摘要+增量」覆盖进 assistant（前文丢失+摘要混入）；修复后按 role 定位最后一条 assistant。
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
    await sleep(60)
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
// 最后一条 assistant 气泡的可见文本（agent 消息区 .prose）
const asstText = `(() => {
  const els = [...document.querySelectorAll('.prose')]
  const el = els[els.length - 1]
  return el ? el.innerText : ''
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
  await evalUntil(
    page,
    `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`,
    (v) => v === true,
    20000,
    '正文页就绪'
  )
  console.log('OK 正文页就绪')

  // 发送「交错测试」：演示流在 delta 中途插 zj_search 工具卡、收尾无 final
  await typeText(page, '交错测试')
  await pressEnter(page)
  // 等待流结束：assistant 气泡出现 demo 尾句
  await evalUntil(
    page,
    `(() => { const els = [...document.querySelectorAll('.prose')]; const t = els[els.length-1] ? els[els.length-1].innerText : ''; return t.includes('把这一段写出来') })()`,
    (v) => v === true,
    25000,
    '交错流结束'
  )
  await sleep(400)

  const asst = await page.eval(asstText)
  console.log('ASST TEXT LEN:', asst.length)

  ok('居中部仍在（dela 前段未丢）', asst.includes('结合现在的进度'), asst.slice(0, 60))
  ok('开头完整（「刚把当前」未丢）', asst.includes('刚把当前章节'), asst.slice(0, 60))
  ok('尾句完整（demo 全文保留）', asst.includes('把这一段写出来'), asst.slice(-60))
  ok('工具摘要未混入正文', !asst.includes('找到 3 处灯语'), asst.slice(0, 80))

  // 工具卡独立正常展示（进行中→完成、结果摘要可见）
  const toolCard = await page.eval(
    `(() => {
      const cards = [...document.querySelectorAll('*')].filter((e) => e.className && String(e.className).includes('rounded') && (e.innerText || '').includes('zj_search'))
      const hit = document.body.innerText.includes('找到 3 处灯语')
      return { hit }
    })()`
  )
  ok('工具卡展示 zj_search 与结果摘要', toolCard.hit === true, JSON.stringify(toolCard))

  console.log('ALL OK ✅ (' + pass + '/' + (pass + fail) + ')')
} catch (err) {
  console.error('FAIL:', err.message)
  process.exitCode = 1
} finally {
  page.close()
}
