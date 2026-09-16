// 织卷无头冒烟 · 建章向导「时间线」选择（周交付增量#3 创作层任务）
// 用法：node scripts/createchapter-line-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；无头 Chrome CDP 127.0.0.1:9224
// 验收点（设计文档 §4.5 建章向导：预填上一章线 / 可手输新线 / 单选已有线枚举；缺省=主线不写字段）：
//   A（demo-multiline 多线项目）：① 新建对话框时间线预填=上一章线（第5章=主线）
//   ② 已有线枚举 chips=「主线/过去线」（正文为源）；③ 预填主线直接创建→约定头不写「时间线」（零冗余缺省）
//   ④ 手输新线「现在线」创建→约定头写「时间线: 现在线」；⑤ 重开预填跟随最新章线（现在线）
//   ⑥ 点 chip 选「过去线」→输入框值=过去线→创建→约定头写「时间线: 过去线」
//   B（demo-aseya 单线项目零回归）：⑦ 预填=主线且无 chips ⑧ 直接创建不写「时间线」字段（与旧行为一致）
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

const clickBtn = (text) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find(b => b.innerText.trim() === ${JSON.stringify(text)} || b.innerText.includes(${JSON.stringify(text)}))
  if (!el || el.disabled) return false
  el.click()
  return true
})()`
const fill = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return false
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`
const openCreate = `(() => {
  const el = document.querySelector('button[title="新建章节"]')
  if (!el || el.disabled) return false
  el.click()
  return true
})()`
const lineVal = `(document.querySelector('[data-testid="line-input"]')?.value) ?? null`
const chipsText = `([...document.querySelectorAll('[data-testid^="line-chip-"]')].map(b => b.textContent.trim()))`
const readChap = (id, name) => `(async () => await window.zhijuan.readDoc(${JSON.stringify(id)}, '正文/' + ${JSON.stringify(name)}) ?? '')()`
const hasLineField = (raw) => /^时间线\s*:/m.test(raw)

async function scenarioMulti() {
  const tab = await openTab(BASE + '/#/project/demo-multiline?cb=' + cb)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, `document.querySelector('button[title="新建章节"]') !== null`, (v) => v === true, 20000, '正文页就绪')
    // ① 打开建章对话框：预填上一章线（约定头章号最大=第5章，无时间线字段=主线）
    await page.eval(openCreate)
    await evalUntil(page, `document.querySelector('[data-testid="line-input"]') !== null`, (v) => v === true, 10000, '建章对话框')
    await sleep(400) // listLines 异步填充 chips
    ok('A1 预填上一章线=主线（第5章无时间线字段）', (await page.eval(lineVal)) === '主线', 'val=' + JSON.stringify(await page.eval(lineVal)))
    ok('A2 已有线枚举 chips=[主线,过去线]（正文为源）', JSON.stringify(await page.eval(chipsText)) === JSON.stringify(['主线', '过去线']), JSON.stringify(await page.eval(chipsText)))
    await shot(page, 'create-line-multiline')

    // ③ 预填主线直接创建：约定头不写「时间线」（缺省=主线，零冗余）
    await page.eval(fill('input[placeholder="如：夏夜的信"]', '第六章 主线续'))
    await sleep(120)
    await page.eval(clickBtn('创建'))
    await evalUntil(page, `document.body.innerText.includes('第6章 · 第六章 主线续')`, (v) => v === true, 15000, '第6章列表出现')
    const raw6 = await page.eval(readChap('demo-multiline', '第06章_第六章 主线续.md'))
    ok('A3 预填主线创建→约定头不写「时间线」字段', !hasLineField(raw6), JSON.stringify((raw6.match(/^---[\s\S]*?---/) ?? [''])[0]).slice(0, 120))

    // ④ 手输新线「现在线」创建
    await page.eval(openCreate)
    await evalUntil(page, `document.querySelector('[data-testid="line-input"]') !== null`, (v) => v === true, 10000, '重开建章对话框')
    await sleep(300)
    ok('A4 重开预填跟随最新章=主线（第6章）', (await page.eval(lineVal)) === '主线', 'val=' + JSON.stringify(await page.eval(lineVal)))
    await page.eval(fill('[data-testid="line-input"]', '现在线'))
    await page.eval(fill('input[placeholder="如：夏夜的信"]', '第七章 支线'))
    await sleep(120)
    await page.eval(clickBtn('创建'))
    await evalUntil(page, `document.body.innerText.includes('第7章 · 第七章 支线')`, (v) => v === true, 15000, '第7章列表出现')
    const raw7 = await page.eval(readChap('demo-multiline', '第07章_第七章 支线.md'))
    ok('A5 手输新线创建→约定头写「时间线: 现在线」', hasLineField(raw7) && /^时间线:\s*现在线$/m.test(raw7), JSON.stringify((raw7.match(/^时间线:.*$/m) ?? [''])[0]))

    // ⑤ 重开预填跟随最新章线（第7章=现在线）
    await page.eval(openCreate)
    await evalUntil(page, `document.querySelector('[data-testid="line-input"]') !== null`, (v) => v === true, 10000, '第三次建章对话框')
    await sleep(300)
    ok('A6 重开预填跟随最新章=现在线', (await page.eval(lineVal)) === '现在线', 'val=' + JSON.stringify(await page.eval(lineVal)))

    // ⑥ 点 chip 单选已有线「过去线」
    await page.eval(`(() => {
      const chip = document.querySelector('[data-testid="line-chip-1"]')
      if (!chip) return false
      chip.click()
      return true
    })()`)
    await sleep(200)
    ok('A7 点 chip 填入「过去线」', (await page.eval(lineVal)) === '过去线', 'val=' + JSON.stringify(await page.eval(lineVal)))
    await page.eval(fill('input[placeholder="如：夏夜的信"]', '第八章 回闪'))
    await sleep(120)
    await page.eval(clickBtn('创建'))
    await evalUntil(page, `document.body.innerText.includes('第8章 · 第八章 回闪')`, (v) => v === true, 15000, '第8章列表出现')
    const raw8 = await page.eval(readChap('demo-multiline', '第08章_第八章 回闪.md'))
    ok('A8 chip 选线创建→约定头写「时间线: 过去线」', /^时间线:\s*过去线$/m.test(raw8), JSON.stringify((raw8.match(/^时间线:.*$/m) ?? [''])[0]))
    await shot(page, 'create-line-chips')

    ok('A9 全程无 JS 异常/console.error', page.errors.length === 0, page.errors.slice(0, 2).join(' ; '))
  } catch (e) {
    ok('A 场景异常', false, String(e).slice(0, 300))
  }
  page.close()
}

async function scenarioSingle() {
  const tab = await openTab(BASE + '/#/project/demo-aseya?cb=' + cb)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, `document.querySelector('button[title="新建章节"]') !== null`, (v) => v === true, 20000, '正文页就绪')
    await page.eval(openCreate)
    await evalUntil(page, `document.querySelector('[data-testid="line-input"]') !== null`, (v) => v === true, 10000, '建章对话框')
    await sleep(400)
    ok('B1 单线项目预填=主线', (await page.eval(lineVal)) === '主线', 'val=' + JSON.stringify(await page.eval(lineVal)))
    ok('B2 单线项目不显示线 chips（零打扰）', (await page.eval(chipsText)).length === 0, JSON.stringify(await page.eval(chipsText)))
    await page.eval(fill('input[placeholder="如：夏夜的信"]', '单线回归章'))
    await sleep(120)
    await page.eval(clickBtn('创建'))
    await evalUntil(page, `document.body.innerText.includes('单线回归章')`, (v) => v === true, 15000, '新章列表出现')
    const raw = await page.eval(readChap('demo-aseya', '第05章_单线回归章.md'))
    ok('B3 单线创建不写「时间线」字段（与旧行为一致）', !hasLineField(raw), JSON.stringify((raw.match(/^---[\s\S]*?---/) ?? [''])[0]).slice(0, 120))
    ok('B4 单线全程无 JS 异常', page.errors.length === 0, page.errors.slice(0, 2).join(' ; '))
  } catch (e) {
    ok('B 场景异常', false, String(e).slice(0, 300))
  }
  page.close()
}

await scenarioMulti()
await scenarioSingle()
console.log(fails === 0 ? 'CREATECHAPTER-LINE SMOKE OK' : 'CREATECHAPTER-LINE SMOKE FAILED: ' + fails)
process.exit(fails === 0 ? 0 : 1)
