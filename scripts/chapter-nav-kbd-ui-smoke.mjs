// 织卷无头冒烟 · 正文「上一章/下一章」快捷键（创作层 2026-10-16)——⌥⌘←/→ 章导航。
// 前置：npm run build；python3 /tmp/spa_server.py 8899 out/renderer；本机无头 Chrome CDP 127.0.0.1:9224
// 用法：ZJ_SMOKE_BASE=http://127.0.0.1:8899 node scripts/chapter-nav-kbd-ui-smoke.mjs
// 验收点：① 选第1章后 ⌥⌘→ 切到第2章（选中行+正文内容变化）② ⌥⌘← 回第1章
//         ③ 第1章 ⌥⌘←（已是第一章）不动作 ④ 第5章（末章）⌥⌘→ 不动作
//         ⑤ dirty 经 ⌥⌘→ 走同一切章守卫（弹「有未保存的改动」，取消留章）
//         ⑥ 无 JS 异常；截图。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = await import('node:fs')
const OUT = process.env.HOME + '/Pictures/zhijuan'
setTimeout(() => { console.log('!! WATCHDOG 150s'); process.exit(2) }, 150000)

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
    } catch { /* 重试 */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(250)
  }
}

async function shot(page, name) {
  try {
    const { data } = await page.cmd('Page.captureScreenshot', { format: 'png' })
    fs.mkdirSync(OUT, { recursive: true })
    const p = `${OUT}/${name}.png`
    fs.writeFileSync(p, Buffer.from(data, 'base64'))
    console.log('截图 →', p)
  } catch (e) { console.log('截图失败', e.message || e) }
}

let fail = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fail++
}

// 侧栏选中行文本（bg-accent-soft=当前章）
const selRowText = `(() => { const row = document.querySelector('aside button[class*="bg-accent-soft"]'); return row ? (row.innerText || '').slice(0, 30) : null })()`
// 编辑器正文首 24 字（切章后内容变化的证据）
const bodyHead = `(() => { const p = document.querySelector('.ProseMirror'); return p ? p.innerText.slice(0, 24) : null })()`
// 点侧栏某章（文本 includes）
const clickRow = (t) => `(() => { const b = [...document.querySelectorAll('aside button')].find(x => (x.innerText || '').includes(${JSON.stringify(t)})); if (!b) return false; b.click(); return true })()`
// 派发 ⌥⌘ 方向键（合成 KeyboardEvent 到 window；监听在 window，bubbles）
const kbd = (dir) => `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(dir)}, metaKey: true, altKey: true, bubbles: true })); return true })()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
await sleep(2200)

// ① 等章节列表加载
await evalUntil(page, `document.querySelectorAll('aside button').length > 2`, (v) => v === true, 20000, '侧栏出现')
ok('侧栏章节已加载', (await page.eval(`[...document.querySelectorAll('aside button')].filter(b => (b.innerText || '').includes('第1章')).length > 0`)) === true)

// ② 选第1章
ok('点第1章', (await page.eval(clickRow('第1章'))) === true)
await evalUntil(page, selRowText, (v) => v !== null && v.includes('第1章'), 20000, '选中第1章')
const body1 = await page.eval(bodyHead)

// ③ ⌥⌘→ 切到第2章
ok('⌥⌘→ 触发', (await page.eval(kbd('ArrowRight'))) === true)
await evalUntil(page, selRowText, (v) => v !== null && v.includes('第2章'), 20000, '切到第2章')
ok('⌥⌘→ 切到第2章', true)
const body2 = await page.eval(bodyHead)
ok('正文内容随切章变化', body1 !== body2, `${JSON.stringify(body1)} → ${JSON.stringify(body2)}`)

// ④ ⌥⌘← 回第1章
ok('⌥⌘← 触发', (await page.eval(kbd('ArrowLeft'))) === true)
await evalUntil(page, selRowText, (v) => v !== null && v.includes('第1章'), 20000, '回到第1章')
ok('⌥⌘← 回第1章', true)

// ⑤ 第1章（已是第一章）⌥⌘← 不动作（sel 仍是第1章）
await page.eval(kbd('ArrowLeft'))
await sleep(600)
ok('首章 ⌥⌘← 不切换', (await page.eval(selRowText))?.includes('第1章') === true)

// ⑥ 跳末章（第5章）→ ⌥⌘→ 不动作
ok('点第5章', (await page.eval(clickRow('第5章'))) === true)
await evalUntil(page, selRowText, (v) => v !== null && v.includes('第5章'), 20000, '选中第5章')
await page.eval(kbd('ArrowRight'))
await sleep(600)
ok('末章 ⌥⌘→ 不动作', (await page.eval(selRowText))?.includes('第5章') === true)

// ⑦ dirty 经 ⌥⌘→ 走同一切章守卫（弹「有未保存的改动」，取消留章）
ok('注入dirty', (await page.eval(`(() => { const ed = window.__ZJ_EDITORS?.[0]; if (!ed) return false; ed.applyMarkdown('守卫残留A1：灯又灭了。', false); return true })()`)) === true)
await evalUntil(page, `(document.body.innerText || '').includes('未保存')`, (v) => v === true, 15000, '出现未保存')
await page.eval(kbd('ArrowLeft'))
await evalUntil(page, `(document.body.innerText || '').includes('有未保存的改动')`, (v) => v === true, 15000, '守卫确认框')
ok('dirty ⌥⌘← 弹「有未保存的改动」确认框', true)
ok('取消', (await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '取消'); if (!b) return false; b.click(); return true })()`)) === true)
await sleep(600)
ok('取消后留在第5章', (await page.eval(selRowText))?.includes('第5章') === true)
ok('取消后内容未丢', (await page.eval(`(window.__ZJ_EDITORS?.[0]?.getMarkdown?.() ?? '')`)).includes('守卫残留A1'))
await shot(page, `chapter-nav-kbd-guard-${new Date().toTimeString().slice(0, 5).replace(':', '')}`)

// ⑧ 无 JS 异常
if (page.errors.length) {
  ok('无 JS 异常', false, page.errors.slice(0, 3).join(' | '))
} else {
  ok('无 JS 异常', true)
}

page.close()
console.log(fail === 0 ? 'ALL PASS' : `FAILED ${fail}`)
process.exit(fail === 0 ? 0 : 1)
