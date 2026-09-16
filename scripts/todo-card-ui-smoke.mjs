// 织卷无头冒烟 · TodoCard 完成态语义（智能层 2026-09-16）
// 用法：node scripts/todo-card-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim 演示项目 + 「计划」触发词）：发送含「计划」的消息 → todo_write 演示卡
//       （三态：in_progress/completed/pending）→ 断言「任务清单」渲染、计数 1/3、
//       completed 项文本保留且 computed text-decoration 不含 line-through
//       （2026-09-16 语义修正：删除线=「已删除/作废」（MDN del/s），完成=达成（Claude
//       Code SDK 官方 ✅+原文范式）——见 docs/模块推进/01-智能层.md 迭代日志）
import { writeFileSync } from 'node:fs'

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
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(
    page,
    `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`,
    (v) => v === true,
    20000,
    '正文页就绪'
  )

  // 发送触发词（devShim needDemo = /计划|todo|任务|问|确认/）
  await typeText(page, '帮我列个写作计划')
  await pressEnter(page)

  // 等任务清单卡渲染
  await evalUntil(page, `document.body.innerText.includes('任务清单')`, (v) => v === true, 15000, '任务清单出现')

  const card = await page.eval(`(() => {
    const hits = [...document.querySelectorAll('div')].filter((d) => d.innerText && d.innerText.includes('任务清单'))
    const cands = hits.filter((d) => d.querySelector('li'))
    const el = cands[cands.length - 1]
    if (!el) return null
    const items = [...el.querySelectorAll('li')].map((li) => {
      const span = li.querySelector('span:last-child')
      const st = span ? getComputedStyle(span) : null
      return {
        text: li.innerText,
        deco: st ? st.textDecorationLine : '',
        hasSvg: !!li.querySelector('svg')
      }
    })
    return { text: el.innerText, items }
  })()`)
  console.log('CARD:', JSON.stringify(card, null, 2))
  if (!card) {
    ok('任务清单卡存在', false)
  } else {
    ok('标题「任务清单」', card.text.includes('任务清单'))
    ok('计数 1/3 完成', card.text.includes('1/3 完成') || card.text.includes('1/3'), JSON.stringify(card.text.slice(0, 60)))
    const doneIt = card.items.find((i) => i.text.includes('给出续写建议'))
    ok('completed 项渲染', !!doneIt)
    if (doneIt) {
      ok('completed 无 line-through', !String(doneIt.deco).includes('line-through'), 'deco=' + doneIt.deco)
      ok('completed 项有绿勾图标(svg)', doneIt.hasSvg)
    }
    const prog = card.items.find((i) => i.text.includes('进行中') || i.text.includes('读取当前章节'))
    ok('in_progress 项渲染', !!prog)
  }

  // 截图
  try {
    const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
    const name = 'todocard-completed-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png'
    const out = process.env.HOME + '/Pictures/zhijuan/' + name
    writeFileSync(out, Buffer.from(shot.data, 'base64'))
    console.log('SHOT ' + out)
    console.log('MEDIA:' + out)
  } catch (e) {
    console.log('SHOT FAIL', e.message)
  }
} catch (e) {
  console.error('FATAL', e.message)
  fail++
} finally {
  console.log(pass + ' PASS / ' + fail + ' FAIL')
  process.exit(fail === 0 ? 0 : 1)
}
