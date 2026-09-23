// 织卷无头冒烟 · AskCard 交互链路（智能层 2026-09-23，候选 1 工具事件面体检）
// 用法：node scripts/ask-card-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim 演示项目 + 「问/确认」触发词 → ask 演示）：AskCard 出现 → 无 ask_user_question
//       工具行（交互类工具不再发 meta，双卡消除）→ 选选项 → 提交回答 → 已提交态。
// 临时冒烟（用完删除）：devShim ask 演示——AskCard 出现、无 ask_user_question 工具行
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
      v = undefined // 页面尚未就绪（body null 等）→ 继续等
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
  await typeText(page, '这段要不要先确认一下？')
  await pressEnter(page)
  await evalUntil(page, `document.body.innerText.includes('风格选择')`, (v) => v === true, 15000, 'AskCard 出现')
  ok('AskCard 出现（风格选择）', true)

  const noToolRow = await page.eval(
    `[...document.querySelectorAll('div')].some((d) => d.innerText === 'ask_user_question' || d.innerText === 'todo_write')`
  )
  ok('无交互类工具行（双卡消除）', noToolRow === false)

  // 回答提交：点选项 → 点「提交回答」→ 卡片进入已提交态
  await evalUntil(page, `document.body.innerText.includes('保持现状')`, (v) => v === true, 10000, '选项可见')
  const clicked = await page.eval(`(() => { const els = [...document.querySelectorAll('button, [role="button"]')].filter((b) => b.innerText.includes('保持现状')); if (!els.length) return false; els[0].click(); return true })()`)
  ok('可点击选项', clicked === true)
  await sleep(300)
  const subClicked = await page.eval(`(() => { const els = [...document.querySelectorAll('button')].filter((b) => b.innerText.includes('提交回答')); if (!els.length) return false; els[0].click(); return true })()`)
  ok('可点击提交回答', subClicked === true)
  await evalUntil(page, `document.body.innerText.includes('已提交')`, (v) => v === true, 8000, '已提交态出现')
  ok('作答后卡片进入已提交态', true)

  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const name = 'askcard-single-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png'
  const out = process.env.HOME + '/Pictures/zhijuan/' + name
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log('SHOT ' + out)
} catch (e) {
  console.error('FATAL', e.message)
  fail++
} finally {
  console.log(pass + ' PASS / ' + fail + ' FAIL')
  process.exit(fail === 0 ? 0 : 1)
}
