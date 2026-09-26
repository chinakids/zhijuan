// 织卷无头冒烟 · ask/todo 卡停止终态语义（智能层 2026-09-26，候选1）
// 用法：node scripts/stop-terminal-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim「提问被停」触发词）：todo 卡 + ask 卡出现 → devShim 补发 aborted →
//       ask 卡落「已取消 · 问题未作答」（提交按钮消失、选项禁用）；todo 卡 header「已取消」、
//       in_progress 项停转圈（无 .zj-ind-arc）；流式结束（无「停止生成」）。
import { writeFileSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (name, v, extra = '') => { console.log((v ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : '')); v ? pass++ : fail++ }

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
    let v
    try {
      v = await page.eval(expr)
    } catch {
      v = undefined
    }
    if (pred(v)) return v
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT: ' + label)
    await sleep(300)
  }
}
async function typeText(page, text) {
  await page.eval(`(() => { const ta = document.querySelector('textarea'); if (!ta) return false; ta.focus(); const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
}
async function pressEnter(page) {
  await page.eval(`(() => { const ta = document.querySelector('textarea'); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); return true })()`)
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`, (v) => v === true, 20000, '正文页就绪')
  await typeText(page, '先列个计划再问问我，然后停一下（模拟提问被停）')
  await pressEnter(page)

  // ask 卡出现（提问在停止前已发出）
  await evalUntil(page, `document.body.innerText.includes('风格选择')`, (v) => v === true, 15000, 'AskCard 出现')
  ok('AskCard 出现（停止前已发出提问）', true)

  // 停止终态：ask 卡落「已取消 · 问题未作答」
  await evalUntil(page, `!!document.querySelector('[data-testid="ask-cancelled"]')`, (v) => v === true, 15000, 'ask-cancelled 出现')
  ok('AskCard 落「已取消 · 问题未作答」', true)

  const noSubmit = await page.eval(
    `[...document.querySelectorAll('button')].some((b) => b.innerText.includes('提交回答'))`
  )
  ok('提交回答按钮隐藏（冻结等待态）', noSubmit === false)

  const optDisabled = await page.eval(
    `[...document.querySelectorAll('button')].filter((b) => b.innerText.includes('保持现状')).every((b) => b.disabled === true)`
  )
  ok('选项禁用（不可再作答）', optDisabled === true)

  // todo 卡终态：header「已取消」+ 未完成项停转圈（无 .zj-ind-arc）
  await evalUntil(page, `!!document.querySelector('[data-testid="todo-cancelled"]')`, (v) => v === true, 8000, 'todo-cancelled 出现')
  ok('TodoCard header「已取消」', true)

  const noSpinner = await page.eval(
    `[...document.querySelectorAll('.zj-ind-arc')].length === 0`
  )
  ok('清单无转圈（in_progress 冻结）', noSpinner === true)

  const doneKept = await page.eval(
    `document.body.innerText.includes('读取当前章节与人物设定')`
  )
  ok('已完成项仍保留', doneKept === true)

  // 流式结束：无「停止生成」按钮
  await sleep(500)
  const noStop = await page.eval(
    `[...document.querySelectorAll('button')].every((b) => (b.getAttribute('title') || '') !== '停止生成')`
  )
  ok('轮次已收尾（无停止生成）', noStop === true)

  // ── T2：真点「停止生成」（agentCancel 路径）——needDemo 发 todo/ask 后流式中点停止，
  // devShim agentCancel 补发 aborted（与真机 agent:cancel → abortRequest 同口径），
  // 验证「作者主动停止」同样落取消终态（不只是 devShim 直发 aborted 的种子路径）
  const tab2 = await openTab(BASE + '/?cb=' + Date.now() + '&zj-agent-delay=200#/project/demo-aseya/novel')
  const page2 = await attach(tab2.webSocketDebuggerUrl)
  try {
    await evalUntil(page2, `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`, (v) => v === true, 20000, 'T2 正文页就绪')
    await typeText(page2, '这段要不要先确认一下？')
    await pressEnter(page2)
    await evalUntil(page2, `document.body.innerText.includes('风格选择')`, (v) => v === true, 15000, 'T2 AskCard 出现')
    await sleep(300)
    const stopped = await page2.eval(
      `(() => { const b = document.querySelector('button[title="停止生成"]'); if (!b) return false; b.click(); return true })()`
    )
    ok('T2 点停止生成按钮', stopped === true)
    await evalUntil(page2, `!!document.querySelector('[data-testid="ask-cancelled"]')`, (v) => v === true, 15000, 'T2 ask-cancelled 出现')
    ok('T2 点停止后 AskCard 落「已取消 · 问题未作答」', true)
    const t2NoSubmit = await page2.eval(
      `[...document.querySelectorAll('button')].some((b) => b.innerText.includes('提交回答'))`
    )
    ok('T2 提交回答按钮隐藏', t2NoSubmit === false)
    const t2Cancelled = await page2.eval(
      `!!document.querySelector('[data-testid="todo-cancelled"]')`
    )
    ok('T2 TodoCard 落「已取消」', t2Cancelled === true)
  } catch (e) {
    console.error('T2 FATAL', e.message)
    fail++
  } finally {
    await page2.cmd('Page.close').catch(() => {})
  }

  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const name = 'stop-terminal-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png'
  const out = process.env.HOME + '/Pictures/zhijuan/' + name
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log('SHOT ' + out)
  console.log('MEDIA:' + out)
} catch (e) {
  console.error('FATAL', e.message)
  fail++
} finally {
  console.log(pass + ' PASS / ' + fail + ' FAIL')
  process.exit(fail === 0 ? 0 : 1)
}
