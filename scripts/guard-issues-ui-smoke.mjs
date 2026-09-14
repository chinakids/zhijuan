// 织卷无头冒烟 · 守卫拦截明细完整可达（创作层 2026-09-14 候选2 收口）
// 用法：node scripts/guard-issues-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim 演示项目 + ?zj-guard=2 注入守卫拦截）：选第1章 → 编辑正文 → 保存
//       → 切片同步浮条出现「拦截 2 条」按钮 → 点击「查看」→ 展开浮层逐条给
//       完整明细（已纠正 人物/沈眠.md / 已丢弃 人物/新角色1.md + 完整 reason）
//       → 关停；另验 Outline 分幕采纳 header 同组件（devShim 模拟缺段草稿硬采路径）
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

const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-guard=2#/project/demo-aseya/novel')
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入')

// ① 选第1章 → 编辑器挂载
await page.eval(clickBtn('第1章 · 雾港', false))
await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')

// ② 编辑正文（追加一段）→ 变脏 → 点「保存 ⌘S」→ 触发切片同步（devShim agentSync 注入 2 条拦截）
await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('冒烟追加：雾更浓了。', false)`)
await evalUntil(page, `document.body.innerText.includes('● 未保存') || document.body.innerText.includes('保存中…')`, Boolean, 10000, '文档变脏')
await evalUntil(page, `window.__ZJ_SYNCS ? window.__ZJ_SYNCS.length : 0`, (n) => n >= 0, 1000, 'sync 探针就绪') // 探针挂载等待
await page.eval(clickBtn('保存', false))
await evalUntil(page, `(window.__ZJ_SYNCS ?? []).length`, (n) => n >= 1, 20000, '切片同步被触发')
await evalUntil(page, bodyHas('✓ 无设定变化'), Boolean, 15000, '同步结果浮条出现')

// ③ 浮条出现「拦截 2 条」入口（摘要即按钮，渐进披露第一层）
const guardBtn = await evalUntil(
  page,
  `(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('拦截 2 条'))
    return b ? { text: b.innerText, expanded: b.getAttribute('aria-expanded') } : null
  })()`,
  Boolean,
  8000,
  '拦截按钮出现'
)
ok('浮条出现「拦截 2 条」入口', Boolean(guardBtn), JSON.stringify(guardBtn))
ok('入口含「查看」暗示可展开', guardBtn.text.includes('查看'), JSON.stringify(guardBtn.text))

// ④ 点击 → 展开完整明细（第二层：处置徽标 + 原 target + 完整 reason）
await page.eval(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('拦截 2 条'))
  if (b) b.click()
  return !!b
})()`)
await evalUntil(page, bodyHas('人物/沈眠.md'), Boolean, 8000, '明细浮层出现')
const detail = await page.eval(`(() => {
  const el = document.querySelector('[role="group"][aria-label="守卫拦截明细"]')
  if (!el) return null
  return {
    z: getComputedStyle(el).zIndex,
    text: el.innerText,
    items: [...el.querySelectorAll('li')].map((li) => li.innerText)
  }
})()`)
ok('明细含「已纠正 人物/沈眠.md」完整行', detail.items[0].includes('已纠正') && detail.items[0].includes('人物/沈眠.md') && detail.items[0].includes('沈藏'), JSON.stringify(detail.items[0]))
ok('明细含「已丢弃 人物/新角色1.md」完整 reason（不截断）', detail.items[1].includes('已丢弃') && detail.items[1].includes('人物/新角色1.md') && detail.items[1].includes('尚未建档'), JSON.stringify(detail.items[1]))
ok('明细总数 = 2 条', detail.items.length === 2, JSON.stringify(detail.items.length))
ok('浮层 z-index=40（低于批注抽屉 50/划词 60/气泡 61）', detail.z === '40', 'z=' + detail.z)
ok('展开后 aria-expanded=true', (await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('拦截 2 条')); return b ? b.getAttribute('aria-expanded') : null })()`)) === 'true')

// ⑤ 截图存证
const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
if (shot?.data) {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
  const p = `${process.env.HOME}/Pictures/zhijuan/guard-issues-${new Date().toTimeString().slice(0, 5).replace(':', '')}.png`
  writeFileSync(p, Buffer.from(shot.data, 'base64'))
  console.log('SHOT ' + p)
}

// ⑥ 点外部关闭（验证收起）+ Esc 路径
await page.eval(`document.querySelector('.zj-md .ProseMirror').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
await sleep(400)
const closed = await page.eval(`!document.querySelector('[aria-label="守卫拦截明细"]')`)
ok('点击明细外区域 → 收起', closed)

// ⑦ 重开再验 Esc 关闭
await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('拦截 2 条')); if (b) b.click(); return !!b })()`)
await evalUntil(page, `!!document.querySelector('[aria-label="守卫拦截明细"]')`, Boolean, 5000, '重开明细')
await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(400)
ok('Esc 关闭明细', await page.eval(`!document.querySelector('[aria-label="守卫拦截明细"]')`))

console.log(`RESULT ${pass} passed / ${fail} failed`)
await page.close()
try {
  const r = await fetch(CDP + '/json/close/' + tab.id, { method: 'PUT' })
  await r.text()
} catch {}
process.exit(fail > 0 ? 1 : 0)
