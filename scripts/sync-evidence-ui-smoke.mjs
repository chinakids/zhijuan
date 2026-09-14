// 织卷无头冒烟 · 切片同步「无设定变化」比对基准证据（创作层 2026-09-14 21:45 候选 2）
// 用法：node scripts/sync-evidence-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim 演示项目 + ?zj-slice= 注入基准证据）：
//   Tab A（Novel，切片=雾港夜）：保存 → 浮条「✓ 无设定变化 · 已比对 切片「雾港夜」、人档 5、1 人未建档」
//   Tab B（Novel，zj-slice=__empty__）：保存 → 浮条「⚠约定头未设切片名」（硬信号分支）
//   Tab C（AgentPanel EditCard，切片=雾港夜）：发「改」→ 采纳并写入 → 卡内「切片同步：无设定变化 · 已比对…」
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
    await sleep(300)
  }
}
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const clickBtn = (text, exact = false) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!el) return false
  el.click()
  return true
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

// ---------- Tab A：Novel 正常基准 ----------
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-slice=雾港夜#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入')
    await page.eval(clickBtn('第1章 · 雾港', false))
    await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
    await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('冒烟追加：雾更浓了。', false)`)
    await evalUntil(page, bodyHas('未保存'), Boolean, 10000, '文档变脏')
    await evalUntil(page, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 0, 1000, 'sync 探针就绪')
    await page.eval(clickBtn('保存', false))
    await evalUntil(page, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 1, 20000, '切片同步被触发')
    await evalUntil(page, bodyHas('✓ 无设定变化 · 已比对 切片「雾港夜」、人档 5、1 人未建档'), Boolean, 15000, '证据小字（正常基准）')
    ok('A① 浮条出现「✓ 无设定变化 · 已比对 切片「雾港夜」、人档 5、1 人未建档」', true)
    ok('A② 不出现「未设切片名」分支', (await page.eval(bodyHas('⚠约定头未设切片名'))) === false)
    const msg = await page.eval(`([...document.querySelectorAll('div')].map((d) => d.innerText || '').filter((t) => t.includes('已比对 切片「雾港夜」')).sort((a, b) => a.length - b.length)[0]) ?? ''`)
    ok('A③ 证据与「无设定变化」同段（非独立噪音）', msg.includes('✓ 无设定变化') && msg.length < 80, 'msg=' + msg.slice(0, 90))
  } finally {
    page.close()
  }
}

// ---------- Tab B：Novel 未设切片（硬信号分支） ----------
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-slice=__empty__#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入（B）')
    await page.eval(clickBtn('第1章 · 雾港', false))
    await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载（B）')
    await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('冒烟追加：浪更急了。', false)`)
    await evalUntil(page, bodyHas('未保存'), Boolean, 10000, '文档变脏（B）')
    await evalUntil(page, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 0, 1000, 'sync 探针就绪（B）')
    await page.eval(clickBtn('保存', false))
    await evalUntil(page, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 1, 20000, '切片同步被触发（B）')
    await evalUntil(page, bodyHas('✓ 无设定变化 · 已比对 ⚠约定头未设切片名、人档 5、1 人未建档'), Boolean, 15000, '证据小字（未设切片）')
    ok('B① 浮条出现「⚠约定头未设切片名」硬信号证据', true)
  } finally {
    page.close()
  }
}

// ---------- Tab C：AgentPanel EditCard 采纳 → 卡内证据 ----------
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-slice=雾港夜#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, `!!document.querySelector('textarea')`, (v) => v === true, 20000, '正文页就绪（C）')
    // 发「改」→ devShim agentSend 演示 edit 事件 → EditCard
    await page.eval(`(() => {
      const ta = document.querySelector('textarea')
      ta.focus()
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
      setter.call(ta, '帮我改一下这段')
      const pos = ta.value.length
      ta.setSelectionRange(pos, pos)
      const ev = new Event('input', { bubbles: true })
      ev.isComposing = false
      ta.dispatchEvent(ev)
      ta.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    await page.eval(`(() => {
      const ta = document.querySelector('textarea')
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      return true
    })()`)
    await evalUntil(page, `[...document.querySelectorAll('button')].some((x) => x.textContent.includes('采纳并写入'))`, (v) => v === true, 20000, 'EditCard 出现（C）')
    await page.eval(clickBtn('采纳并写入', false))
    await evalUntil(page, bodyHas('切片同步：无设定变化 · 已比对 切片「雾港夜」、人档 5、1 人未建档'), Boolean, 20000, 'EditCard 证据小字')
    ok('C① EditCard 卡内「切片同步：无设定变化 · 已比对 切片「雾港夜」…」', true)
  } finally {
    page.close()
  }
}

console.log(`\n==== sync-evidence-ui-smoke: ${pass}/${pass + fail} ====`)
process.exit(fail ? 1 : 0)
