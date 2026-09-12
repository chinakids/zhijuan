// 织卷无头冒烟 · 文案口径第二波：标点/空格 + 动词句式（HIG Writing + 中文排版指北）
// 用法：node scripts/copy-voice-ui-smoke.mjs
// 前置：npm run build；/tmp/spa_server.py（8123）；CDP 9224
// 验收点：① 建章对话框涉及人物占位=全角逗号「如：林晚，顾知远」；
//         ② 有上一章时预填涉及人物=全角逗号分隔「阿七，沈藏」（join('，') 口径）；
//         ③ 预填切片仍用原名；④ 正文空态/命令面板空态文案（正文空态用 demo 有章节绕过，命令面板由 cmdk-ui-smoke 覆盖）；
//         ⑤ 全程无 JS 异常。截图：~/Pictures/zhijuan/copy-punctuation-<HHMM>.png
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
const OUT = path.join(os.homedir(), 'Pictures', 'zhijuan')
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
      await cmd('Page.enable')
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
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(250)
  }
}

const inputVal = (ph) => `document.querySelector('input[placeholder="${ph}"]')?.value ?? '__NONE__'`
const fill = (sel, text) => `(() => { const el = document.querySelector('${sel}'); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '${text}'); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

try {
  // ① 正文页就绪（demo-aseya 有 4 章）
  await evalUntil(page, `document.body.innerText.includes('第1章') && document.body.innerText.includes('第4章')`, (v) => v === true, 25000, '正文页就绪')
  ok('正文页就绪（demo 4 章）', true)

  // ② 打开建章对话框（应预填最新上一章：第4章_雾夜 / 第四幕_雾夜 / 阿七, 沈藏）
  await page.eval(`(() => { const els=[...document.querySelectorAll('button')]; const el=els.find(b=>b.title==='新建章节'); if(!el) return false; el.click(); return true })()`)
  await evalUntil(page, `document.querySelector('input[placeholder="如：林晚，顾知远"]') !== null`, (v) => v === true, 10000, '建章对话框')
  ok('① 涉及人物占位=全角逗号「如：林晚，顾知远」', true)

  const phSlice = `document.querySelector('input[placeholder="如：第二幕_台风夜（留空则用章号）"]')?.value`
  ok('② 预填涉及人物=全角逗号「阿七，沈藏」',
    (await page.eval(inputVal('如：林晚，顾知远'))) === '阿七，沈藏',
    'val=' + JSON.stringify(await page.eval(inputVal('如：林晚，顾知远'))))
  ok('③ 预填切片=「第四幕_雾夜」',
    (await page.eval(phSlice)) === '第四幕_雾夜',
    'val=' + JSON.stringify(await page.eval(phSlice)))

  // ④ 截图：建章对话框（placeholder + 预填全角逗号可见）
  fs.mkdirSync(OUT, { recursive: true })
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const hh = new Date().toTimeString().slice(0, 5).replace(':', '')
  const fpath = path.join(OUT, `copy-punctuation-${hh}.png`)
  fs.writeFileSync(fpath, Buffer.from(shot.data, 'base64'))
  ok('④ 截图已存 ' + path.basename(fpath), fs.existsSync(fpath))

  // ⑤ 无 JS 异常
  await sleep(600)
  ok('⑤ 无 JS 异常', page.errors.length === 0, page.errors.slice(0, 3).join(' || '))
} catch (e) {
  console.error('FAIL:', e.message)
  fails++
} finally {
  page.close()
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL`)
process.exit(fails === 0 ? 0 : 1)
