// 织卷无头冒烟 · 批注显示 UI（体验层 2026-09-13；F-20260912-04 后半）
// 用法：node scripts/anno-display-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim 演示项目）：打开正文页 → 选第1章 → 批注高亮（.zj-anno，title=批注意图）
//       → 底部「批注 N」徽标 → 点击跳第一条 → ⌘F 查找高亮共存 → 亮/暗主题色核对
//       → 划词新增批注（zj:anno-compose 弹层 → 保存）→ 高亮与计数即时刷新
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
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

const tab = await openTab(BASE + '/#/project/demo-aseya/novel?cb=13')
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入')

// ① 选第1章（章节按钮内文本为分行结构，用 includes 复合匹配）
await page.eval(clickBtn('第1章 · 雾港', false))
await evalUntil(page, `!!document.querySelector('.ProseMirror')`, Boolean, 20000, '编辑器挂载')

// ② 批注高亮出现（demo 种子两条批注，loc 切片定位到正文）
await evalUntil(page, `document.querySelectorAll('.zj-anno').length`, (n) => n === 2, 15000, '两条批注高亮')
const annos = await page.eval(
  `[...document.querySelectorAll('.zj-anno')].map((s) => ({ title: s.getAttribute('title') || '', text: s.textContent }))`
)
ok('高亮片段×2 且 title=批注意图', annos.length === 2 && annos.every((a) => a.title.length > 0), JSON.stringify(annos).slice(0, 200))
ok('高亮文本与批注行一致（雨句/沈藏台词）', annos.some((a) => a.text.includes('雨把港口淋成一片灰')) && annos.some((a) => a.text.includes('沈藏')), '')

// ③ 底部「批注 2」徽标 → 打开批注导航抽屉（2026-09-13 候选1③：跳转入口收敛到抽屉列表）
await page.eval(`(() => { window.__ZJ_SEL0 = ''; return 1 })()`)
const badge = await evalUntil(page, `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim().startsWith('批注 2'))
  return b ? b.innerText.trim() : ''
})()`, (v) => v !== '', 8000, '批注徽标')
ok('底部「批注 2」徽标', badge === '批注 2', String(badge))
await page.eval(clickBtn('批注 2', true))
await evalUntil(page, `!!document.querySelector('.zj-anno-drawer')`, Boolean, 8000, '批注导航抽屉打开')
const drawerShown = await page.eval(`(() => {
  const d = document.querySelector('.zj-anno-drawer')
  if (!d) return { open: false }
  return { open: d.getAttribute('role') === 'dialog', items: d.querySelectorAll('.zj-anno-item').length }
})()`)
ok('点击徽标后展开批注导航抽屉（含两条列表项）', drawerShown.open === true && drawerShown.items === 2, JSON.stringify(drawerShown))
await page.eval(clickBtn('收起', true))
await evalUntil(page, `!document.querySelector('.zj-anno-drawer')`, Boolean, 5000, '抽屉收起')

// ④ 查找高亮共存（⌘F 查找「雨」→ 批注高亮仍在）
await page.eval(`(() => { if (window.__ZJ_FIND) window.__ZJ_FIND.open('雨'); return 1 })()`)
await evalUntil(page, `window.CSS && CSS.highlights && (CSS.highlights.has('zj-find-hit') || CSS.highlights.has('zj-find-cur'))`, Boolean, 8000, '查找高亮激活')
const coexist = await page.eval(`document.querySelectorAll('.zj-anno').length`)
ok('与查找高亮共存（批注高亮仍在×2）', coexist === 2, 'count=' + coexist)
await page.eval(`(() => { if (window.__ZJ_FIND) window.__ZJ_FIND.close(); return 1 })()`)
await sleep(300)

// ⑤ 亮/暗主题：批注底色随 warn-soft 语义变量变化
const bgLight = await page.eval(`getComputedStyle(document.querySelector('.zj-anno')).backgroundColor`)
await page.eval(`document.documentElement.classList.add('dark')`)
await sleep(200)
const bgDark = await page.eval(`getComputedStyle(document.querySelector('.zj-anno')).backgroundColor`)
await page.eval(`document.documentElement.classList.remove('dark')`)
await sleep(200)
ok('亮/暗主题批注底色均生效且不同', bgLight !== bgDark && bgLight !== 'rgba(0, 0, 0, 0)' && bgDark !== 'rgba(0, 0, 0, 0)', `${bgLight} vs ${bgDark}`)

// ⑥ 划词新增批注 → 即时高亮与计数刷新（zj:anno-compose 弹层 = 划词「批注」按钮的同一入口）
await page.eval(`(() => {
  window.dispatchEvent(new CustomEvent('zj:anno-compose', { detail: { loc: '', before: '阿七低头看手里那张泛黄的船票' } }))
  return 1
})()`)
await evalUntil(page, bodyHas('添加批注'), Boolean, 8000, '批注弹层出现')
const typed = await page.eval(`(() => {
  const ta = [...document.querySelectorAll('textarea')].find((t) => t.closest('[role="dialog"]'))
  if (!ta) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '船票细节写实一点，别让年代感出戏')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
ok('批注弹层已填写意图', typed === true, '')
await sleep(400)
await page.eval(clickBtn('保存批注', true))
await evalUntil(page, `document.querySelectorAll('.zj-anno').length`, (n) => n === 3, 15000, '新增后高亮×3')
const badge2 = await evalUntil(page, `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim().startsWith('批注 3'))
  return b ? b.innerText.trim() : ''
})()`, (v) => v === '批注 3', 8000, '批注 3 徽标')
ok('新增批注即时高亮（.zj-anno ×3，含新 title）', (await page.eval(`[...document.querySelectorAll('.zj-anno')].some((s) => (s.getAttribute('title') || '').includes('船票细节写实'))`)) === true, '')
ok('新增后计数徽标 → 批注 3', badge2 === '批注 3', String(badge2))

console.log(`\nRESULT: ${pass} pass / ${fail} fail`)
if (fail > 0) process.exit(1)
process.exit(0)
