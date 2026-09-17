// 织卷无头冒烟 · 建章预填基准按选中章（2026-09-17 创作层候选 2）
// 用法：node scripts/createchapter-prefill-selection-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；无头 Chrome CDP 127.0.0.1:9224
// 验收点（shared/line.prefillSource 决策源：仅当「选中章线 ≠ 最新章线」时预填跟随选中章，否则=最新章零回归）：
//   A（demo-multiline，无选中）① 预填=最新章线（主线）+最新章切片/人物（基线=旧行为）
//   B（选中过去线第2章_旧信）② 预填跟随选中章：线=过去线、切片=昔_旧信、人物=陆离，周晚 ③ 提示含「当前选中章」
//   C（选中第5章_破晓=最新章）④ 预填=最新章（选中即最新 → latest，与旧口径一致）
//   D（选中第1章_夜航=主线非最新）⑤ 同线 → latest 零回归：切片仍=最新章「今_破晓」而非选中章「今_夜航」
//   E 全程无 JS 异常（双通道收集）
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.env.HOME + '/Pictures/zhijuan'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cb = Date.now()
let fails = 0
function ok(name, cond, detail = '') {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + String(detail).slice(0, 160) : ''))
  if (!cond) fails++
}

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
        cmd, errors,
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
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch { /* retry */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}
async function shot(page, name) {
  mkdirSync(OUT, { recursive: true })
  const hh = String(new Date().getHours()).padStart(2, '0')
  const mm = String(new Date().getMinutes()).padStart(2, '0')
  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const p = OUT + '/' + name + '-' + hh + mm + '.png'
  writeFileSync(p, Buffer.from(s.data, 'base64'))
  console.log('SCREENSHOT:', p)
}

const openCreate = `(() => {
  const el = document.querySelector('button[title="新建章节"]')
  if (!el || el.disabled) return false
  el.click()
  return true
})()`
const clickChapter = (text) => `(() => {
  const el = [...document.querySelectorAll('button')].find(b => b.innerText.includes(${JSON.stringify(text)}))
  if (!el) return false
  el.click()
  return true
})()`
const closeDialog = `(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find(x => x.innerText.includes('新建章节'))
  if (!d) return false
  const btn = [...d.querySelectorAll('button')].find(b => b.innerText.trim() === '取消')
  if (!btn) return false
  btn.click()
  return true
})()`
const dialogReady = `document.querySelector('[data-testid="line-input"]') !== null`
const lineVal = `(document.querySelector('[data-testid="line-input"]')?.value) ?? null`
const sliceVal = `(document.querySelector('input[placeholder*="留空则用章号"]')?.value) ?? null`
const castVal = `(document.querySelector('input[placeholder="如：林晚，顾知远"]')?.value) ?? null`
const hintText = `(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find(x => x.innerText.includes('新建章节'))
  return d ? (d.innerText.match(/已沿用[^。]*。/) ?? [''])[0] : ''
})()`

async function main() {
  const tab = await openTab(BASE + '/#/project/demo-multiline?cb=' + cb)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, `document.querySelector('button[title="新建章节"]') !== null`, (v) => v === true, 20000, '正文页就绪')

    // A 基线：无选中章 → 预填=最新章（第5章主线：切片 今_破晓 / 人物 陆离）
    await page.eval(openCreate)
    await evalUntil(page, dialogReady, (v) => v === true, 10000, '建章对话框')
    await sleep(400)
    ok('A1 无选中→预填线=主线（最新章）', (await page.eval(lineVal)) === '主线', 'val=' + JSON.stringify(await page.eval(lineVal)))
    ok('A2 无选中→预填切片=今_破晓（最新章）', (await page.eval(sliceVal)) === '今_破晓', 'val=' + JSON.stringify(await page.eval(sliceVal)))
    ok('A3 无选中→预填人物=陆离（最新章）', (await page.eval(castVal)) === '陆离', 'val=' + JSON.stringify(await page.eval(castVal)))
    ok('A4 提示含「上一章」', ((await page.eval(hintText)) || '').includes('上一章'), JSON.stringify(await page.eval(hintText)))
    await page.eval(closeDialog)
    await evalUntil(page, dialogReady, (v) => v === false, 8000, '对话框关闭 A')

    // B 选中过去线第2章_旧信（线≠最新章线）→ 预填跟随选中章（切片/时间线/人物同源）
    ok('B0 点选第2章_旧信成功', (await page.eval(clickChapter('第2章 · 旧信'))) === true)
    await sleep(500)
    await page.eval(openCreate)
    await evalUntil(page, dialogReady, (v) => v === true, 10000, '建章对话框 B')
    await sleep(400)
    ok('B1 选中过去线章→预填线=过去线', (await page.eval(lineVal)) === '过去线', 'val=' + JSON.stringify(await page.eval(lineVal)))
    ok('B2 选中过去线章→预填切片=昔_旧信（同源）', (await page.eval(sliceVal)) === '昔_旧信', 'val=' + JSON.stringify(await page.eval(sliceVal)))
    ok('B3 选中过去线章→预填人物=陆离，周晚（同源）', (await page.eval(castVal)) === '陆离，周晚', 'val=' + JSON.stringify(await page.eval(castVal)))
    ok('B4 提示含「当前选中章」', ((await page.eval(hintText)) || '').includes('当前选中章'), JSON.stringify(await page.eval(hintText)))
    await shot(page, 'create-prefill-selection-past')
    await page.eval(closeDialog)
    await evalUntil(page, dialogReady, (v) => v === false, 8000, '对话框关闭 B')

    // C 选中第5章_破晓（=最新章主线）→ latest（与旧口径一致）
    ok('C0 点选第5章_破晓成功', (await page.eval(clickChapter('第5章 · 破晓'))) === true)
    await sleep(500)
    await page.eval(openCreate)
    await evalUntil(page, dialogReady, (v) => v === true, 10000, '建章对话框 C')
    await sleep(400)
    ok('C1 选中即最新章→预填线=主线（latest）', (await page.eval(lineVal)) === '主线', 'val=' + JSON.stringify(await page.eval(lineVal)))
    ok('C2 选中即最新章→预填切片=今_破晓', (await page.eval(sliceVal)) === '今_破晓', 'val=' + JSON.stringify(await page.eval(sliceVal)))
    await page.eval(closeDialog)
    await evalUntil(page, dialogReady, (v) => v === false, 8000, '对话框关闭 C')

    // D 选中第1章_夜航（主线、非最新）→ 同线 → latest 零回归：预填仍最新章「今_破晓」而非「今_夜航」
    ok('D0 点选第1章_夜航成功', (await page.eval(clickChapter('第1章 · 夜航'))) === true)
    await sleep(500)
    await page.eval(openCreate)
    await evalUntil(page, dialogReady, (v) => v === true, 10000, '建章对话框 D')
    await sleep(400)
    ok('D1 同线选中（主线第1章）→预填线=主线（latest 零回归）', (await page.eval(lineVal)) === '主线', 'val=' + JSON.stringify(await page.eval(lineVal)))
    ok('D2 同线选中→预填切片仍=最新章今_破晓（非选中章今_夜航）', (await page.eval(sliceVal)) === '今_破晓', 'val=' + JSON.stringify(await page.eval(sliceVal)))
    await shot(page, 'create-prefill-selection-same-line')
    await page.eval(closeDialog)
    await evalUntil(page, dialogReady, (v) => v === false, 8000, '对话框关闭 D')

    ok('E 全程无 JS 异常/console.error', page.errors.length === 0, page.errors.slice(0, 2).join(' ; '))
  } catch (e) {
    ok('场景异常', false, String(e).slice(0, 300))
  }
  page.close()
}

await main()
console.log(fails === 0 ? 'CREATECHAPTER-PREFILL-SELECTION SMOKE OK' : 'CREATECHAPTER-PREFILL-SELECTION SMOKE FAILED: ' + fails)
process.exit(fails === 0 ? 0 : 1)
