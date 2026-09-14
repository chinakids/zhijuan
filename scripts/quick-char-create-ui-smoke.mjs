// 织卷无头冒烟 · 守卫「未建档」条目就地快速建档（创作层 2026-09-15 候选2 收口）
// 用法：node scripts/quick-char-create-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim + ?zj-guard=2 注入 1 已纠正 + 1 未建档(新角色1)）：
//   选第1章 → 编辑正文 → 保存 → 浮条「拦截 2 条」→ 明细逐条：
//   已纠正行无「建档案」按钮；未建档行有 → 点击 → 人物/新角色1.md 按模板落盘（readDoc 断言）
//   → 徽标变「已建档」→ 再编辑保存重跑同步 → 该 target 不再拦截（只剩已纠正 1 条）
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const PID = 'demo-aseya'
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
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const clickBtn = (text, exact = true) => `(() => {
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
const detailExpr = `(() => {
  const el = document.querySelector('[role="group"][aria-label="守卫拦截明细"]')
  if (!el) return null
  return {
    items: [...el.querySelectorAll('li')].map((li) => li.innerText),
    btnCount: [...el.querySelectorAll('button')].filter((b) => (b.innerText || '').trim() === '建档案').length
  }
})()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-guard=2#/project/' + PID + '/novel')
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入')

// ① 选章 → 编辑器挂载 → 追加内容 → 保存 → 同步触发（注入 2 条拦截）
await page.eval(clickBtn('第1章 · 雾港', false))
await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('快速建档冒烟：雾更浓了。', false)`)
await evalUntil(page, `document.body.innerText.includes('● 未保存') || document.body.innerText.includes('保存中…')`, Boolean, 10000, '文档变脏')
await page.eval(clickBtn('保存', false))
await evalUntil(page, bodyHas('拦截 2 条'), Boolean, 20000, '拦截浮条出现')

// ② 展开明细：已纠正行无「建档案」；未建档行有
const openExpr = `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('拦截 ') && (x.innerText || '').includes('查看'))
  if (b) b.click()
  return !!b
})()`
await page.eval(openExpr)
const d1 = await evalUntil(page, detailExpr, (d) => d && d.items.length === 2, 8000, '明细 2 条')
ok('明细 2 条（已纠正 + 未建档）', d1.items.length === 2, JSON.stringify(d1.items.length))
ok('已纠正行无「建档案」按钮（非未建档不提供动作）', d1.btnCount === 1, JSON.stringify(d1.btnCount))
ok('未建档行 = 已丢弃 人物/新角色1.md + 完整 reason', d1.items[1].includes('已丢弃') && d1.items[1].includes('人物/新角色1.md') && d1.items[1].includes('尚未建档'), JSON.stringify(d1.items[1]))

// ③ 点击「建档案」→ 模板落盘到 人物/新角色1.md
await page.eval(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '建档案')
  if (b) b.click()
  return !!b
})()`)
const created = await evalUntil(
  page,
  `window.zhijuan.readDoc('${PID}', '人物/新角色1.md')`,
  (t) => typeof t === 'string' && t.length > 0,
  8000,
  '档案落盘'
)
ok('档案落盘：约定头 + H1 + 定位占位', created.includes('别名: []') && created.includes('# 新角色1') && created.includes('（身份 / 职业）') && created.includes('## 基础档案'), created.slice(0, 80))
const d2 = await evalUntil(page, detailExpr, (d) => d && d.items[1].includes('已建档'), 8000, 'UI 标记已建档')
ok('明细行变为「已建档」状态', d2.items[1].includes('已建档'), JSON.stringify(d2.items[1]))
ok('已建档行不再出现「建档案」按钮（可重复点击已禁用）', d2.btnCount === 0, JSON.stringify(d2.btnCount))

// ④ 截图存证（明细展开、已建档状态）
const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
if (shot?.data) {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
  const p = `${process.env.HOME}/Pictures/zhijuan/quick-char-create-${new Date().toTimeString().slice(0, 5).replace(':', '')}.png`
  writeFileSync(p, Buffer.from(shot.data, 'base64'))
  console.log('SHOT ' + p)
}

// ⑤ 重跑同步（再保存）→ 已建档 target 不再拦截（只剩已纠正 1 条）
await page.eval(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
await sleep(300)
await page.eval(`(() => { const els = [...document.querySelectorAll('.zj-md .ProseMirror')]; return !!els[0] })()`)
// 清掉上次追加导致的「未保存」…直接再追加一段触发变脏再保存
await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('再保存一次：重跑同步。', false)`)
await evalUntil(page, `document.body.innerText.includes('● 未保存') || document.body.innerText.includes('保存中…')`, Boolean, 10000, '再次变脏')
await page.eval(clickBtn('保存', false))
await evalUntil(page, bodyHas('拦截 1 条'), Boolean, 20000, '重跑后只剩已纠正 1 条')
await page.eval(openExpr)
const d3 = await evalUntil(page, detailExpr, (d) => d && d.items.length === 1, 8000, '明细 1 条')
ok('重跑后明细仅 1 条（新角色1 已建档不再拦）', d3.items.length === 1 && d3.items[0].includes('已纠正'), JSON.stringify(d3.items))
ok('明细不再含 新角色1', !JSON.stringify(d3.items).includes('新角色1'))

console.log(`RESULT ${pass} passed / ${fail} failed`)
await page.close()
try {
  const r = await fetch(CDP + '/json/close/' + tab.id, { method: 'PUT' })
  await r.text()
} catch {}
process.exit(fail > 0 ? 1 : 0)
