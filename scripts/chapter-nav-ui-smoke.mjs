// 织卷无头冒烟 · 正文「上一章/下一章」导航（创作层 2026-10-07）——多章连写闭环：写完一章→下一章无需回侧栏找。
// 前置：npm run build；python3 /tmp/spa_server.py 8899 out/renderer；本机无头 Chrome CDP 127.0.0.1:9224
// 用法：ZJ_SMOKE_BASE=http://127.0.0.1:8899 node scripts/chapter-nav-ui-smoke.mjs
// 验收点：① 底部状态条「‹ ›」按钮存在（data-testid=chapter-prev/next）
//         ② 选第1章：prev 禁用（已是第一章）、next 可用
//         ③ 点 next → 切到第2章（选中行变化+编辑器内容变化）
//         ④ 末章（第5章）next 禁用（已是最后一章）
//         ⑤ 点 prev → 回第4章；全程无 JS 异常；截图两态。
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

// 状态条导航按钮（ChapterNav 渲染于 DocEditor 底部状态条）
const prevBtn = `document.querySelector('[data-testid="chapter-prev"]')`
const nextBtn = `document.querySelector('[data-testid="chapter-next"]')`
const btnState = (sel) => `(() => { const b = ${sel}; if (!b) return null; return { disabled: !!b.disabled, title: b.title, label: b.getAttribute('aria-label') } })()`
// 侧栏选中行文本（bg-accent-soft=当前章）
const selRowText = `(() => { const row = document.querySelector('aside button[class*="bg-accent-soft"]'); return row ? (row.innerText || '').slice(0, 30) : null })()`
// 编辑器正文首 20 字（切章后内容变化的证据）
const bodyHead = `(() => { const p = document.querySelector('.ProseMirror'); return p ? p.innerText.slice(0, 24) : null })()`
// 点侧栏某章（文本 includes）
const clickRow = (t) => `(() => { const b = [...document.querySelectorAll('aside button')].find(x => (x.innerText || '').includes(${JSON.stringify(t)})); if (!b) return false; b.click(); return true })()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
await sleep(2200)

// ① 等章节列表加载（侧栏出现第1章）
await evalUntil(page, `document.querySelectorAll('aside button').length > 2`, (v) => v === true, 20000, '侧栏出现')
ok('侧栏章节已加载', (await page.eval(`[...document.querySelectorAll('aside button')].filter(b => (b.innerText || '').includes('第1章')).length > 0`)) === true)

// ② 先选第1章（无选章时 DocEditor 不挂载=无状态条；初始可能自动恢复上次上下文，点一次幂等）
ok('点第1章', (await page.eval(clickRow('第1章'))) === true)
await evalUntil(page, selRowText, (v) => v !== null && v.includes('第1章'), 20000, '选中第1章')
// 导航按钮随 DocEditor 挂载出现
await evalUntil(page, `!!document.querySelector('[data-testid="chapter-prev"]') && !!document.querySelector('[data-testid="chapter-next"]')`, (v) => v === true, 20000, '导航按钮出现')
ok('状态条 ‹› 按钮存在', true)

// ③ 第1章：prev 禁用 / next 可用
let st = await page.eval(btnState(prevBtn))
ok('第1章 prev 禁用', st !== null && st.disabled === true, JSON.stringify(st))
ok('第1章 prev title=已是第一章', st !== null && (st.title || '').includes('已是第一章'))
st = await page.eval(btnState(nextBtn))
ok('第1章 next 可用', st !== null && st.disabled === false, JSON.stringify(st))
ok('第1章 next title 含下一章第2章', st !== null && st.title.includes('下一章') && st.title.includes('第2章'))
const body1 = await page.eval(bodyHead)
await shot(page, `chapter-nav-first-${new Date().toTimeString().slice(0, 5).replace(':', '')}`)

// ④ 点 next → 第2章（选中行+正文内容变化）
ok('点next', (await page.eval(`(() => { const b = document.querySelector('[data-testid="chapter-next"]'); if (!b) return false; b.click(); return true })()`)) === true)
await evalUntil(page, selRowText, (v) => v !== null && v.includes('第2章'), 20000, '切到第2章')
ok('next 切到第2章', true)
const body2 = await page.eval(bodyHead)
ok('正文内容随切章变化', body1 !== body2, `${JSON.stringify(body1)} → ${JSON.stringify(body2)}`)
await shot(page, `chapter-nav-next-${new Date().toTimeString().slice(0, 5).replace(':', '')}`)

// ⑤ 跳末章（点第5章）→ next 禁用
ok('点第5章', (await page.eval(clickRow('第5章'))) === true)
await evalUntil(page, selRowText, (v) => v !== null && v.includes('第5章'), 20000, '选中第5章')
st = await page.eval(btnState(nextBtn))
ok('第5章 next 禁用', st !== null && st.disabled === true, JSON.stringify(st))
ok('第5章 next title=已是最后一章', st !== null && (st.title || '').includes('已是最后一章'))

// ⑥ prev 回第4章
ok('点prev', (await page.eval(`(() => { const b = document.querySelector('[data-testid="chapter-prev"]'); if (!b) return false; b.click(); return true })()`)) === true)
await evalUntil(page, selRowText, (v) => v !== null && v.includes('第4章'), 20000, '回到第4章')
ok('prev 回第4章', true)

// ⑦ dirty（未保存）经导航切换 → 走同一切章守卫（requestSwitch），不静默丢内容
ok('注入dirty', (await page.eval(`(() => { const ed = window.__ZJ_EDITORS?.[0]; if (!ed) return false; ed.applyMarkdown('守卫残留A1：灯又灭了。', false); return true })()`)) === true)
await evalUntil(page, `(document.body.innerText || '').includes('未保存')`, (v) => v === true, 15000, '出现未保存')
ok('dirty 点 next 弹守卫', (await page.eval(`(() => { const b = document.querySelector('[data-testid="chapter-next"]'); if (!b) return false; b.click(); return true })()`)) === true)
await evalUntil(page, `(document.body.innerText || '').includes('有未保存的改动')`, (v) => v === true, 15000, '守卫确认框')
ok('弹「有未保存的改动」确认框', true)
ok('取消', (await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '取消'); if (!b) return false; b.click(); return true })()`)) === true)
await sleep(600)
ok('取消后留在第4章', (await page.eval(selRowText))?.includes('第4章') === true)
ok('取消后内容未丢', (await page.eval(`(window.__ZJ_EDITORS?.[0]?.getMarkdown?.() ?? '')`)).includes('守卫残留A1'))
await shot(page, `chapter-nav-dirty-guard-${new Date().toTimeString().slice(0, 5).replace(':', '')}`)

// ⑧ 无 JS 异常
if (page.errors.length) {
  ok('无 JS 异常', false, page.errors.slice(0, 3).join(' | '))
} else {
  ok('无 JS 异常', true)
}

page.close()
console.log(fail === 0 ? 'ALL PASS' : `FAILED ${fail}`)
process.exit(fail === 0 ? 0 : 1)
