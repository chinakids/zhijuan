// 织卷无头冒烟 · 批注侧标（gutter marker，体验层 2026-09-13 候选1② 收口）
// 用法：node scripts/anno-gutter-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim 演示项目）：选第1章 → 侧标×2 出现在正文左缘 padding 区（不遮文字/不占宽）
//       → 点击侧标跳转到对应高亮（模型选区=命中文段）→ 抽屉条目 hover 激活对应侧标（mouseMoved 真实指针）
//       → 划词新增同段批注 → 同段合并为 1 个侧标（count=2）→ 内容加长后滚动 → 侧标跟随文本移动
//       → 亮/暗主题侧标色随语义变量变化
import { appendFileSync } from 'node:fs'

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

const tab = await openTab(BASE + '/#/project/demo-aseya/novel?cb=' + Date.now())
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入')

// ① 选第1章 → 编辑器挂载 + 两条批注高亮 + 侧标×2
await page.eval(clickBtn('第1章 · 雾港', false))
await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
await evalUntil(page, `document.querySelectorAll('.zj-anno').length`, (n) => n === 2, 15000, '两条批注高亮')
await evalUntil(page, `document.querySelectorAll('.zj-anno-mark').length`, (n) => n === 2, 15000, '侧标×2')
ok('侧标×2（两条批注在不同段落）', true, '')

// ② 侧标位置：正文左缘 padding 区（marker 右缘 ≤ ProseMirror 文本区左缘；不遮文字、不占宽）
const geo = await page.eval(`(() => {
  const pm = document.querySelector('.zj-md .ProseMirror')
  const cs = getComputedStyle(pm)
  const padL = parseFloat(cs.paddingLeft)
  const pmRect = pm.getBoundingClientRect()
  const root = document.querySelector('.zj-md')
  const rootRect = root.getBoundingClientRect()
  const marks = [...document.querySelectorAll('.zj-anno-mark')]
  return {
    n: marks.length,
    padL,
    pmLeft: pmRect.left,
    rootLeft: rootRect.left,
    marks: marks.map((m) => {
      const r = m.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, rows: m.getAttribute('data-rows') }
    })
  }
})()`)
ok('侧标均在 padding 区且不遮正文（右缘 ≤ 文本左缘）', geo.marks.every((m) => m.right <= geo.pmLeft + geo.padL && m.left > geo.pmLeft - 24), JSON.stringify(geo.marks) + ' padL=' + geo.padL)
ok('侧标紧贴编辑器左缘（根左缘+3±2）', geo.marks.every((m) => Math.abs(m.left - (geo.rootLeft + 3)) < 2.5), JSON.stringify({ left: geo.marks.map((m) => m.left), rootLeft: geo.rootLeft }))
ok('侧标左右错开（两条在不同行）', Math.abs(geo.marks[0].top - geo.marks[1].top) > 10, JSON.stringify(geo.marks.map((m) => m.top)))
ok('侧标 data-rows=[1]/[2]', geo.marks[0].rows === '1' && geo.marks[1].rows === '2', JSON.stringify(geo.marks.map((m) => m.rows)))

// ③ 点击侧标[0] → 跳转到对应高亮（模型选区=命中文段）
await page.eval(`document.querySelectorAll('.zj-anno-mark')[0].click()`)
await sleep(400)
const sel1 = await page.eval(`window.__ZJ_EDITORS[0].getSelected()`)
ok('点击侧标跳转命中「雨把港口」文段', typeof sel1 === 'string' && sel1.includes('雨把港口'), 'sel=' + String(sel1).slice(0, 40))

// ④ 抽屉条目 hover → 对应侧标激活（CDP 真实指针 mouseMoved）；移开后清除
await page.eval(clickBtn('批注 2', true))
await evalUntil(page, `!!document.querySelector('.zj-anno-drawer')`, Boolean, 8000, '抽屉打开')
const itemRect = await page.eval(`(() => {
  const it = document.querySelectorAll('.zj-anno-item')[0]
  const r = it.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: itemRect.x, y: itemRect.y })
await sleep(300)
const hoverState = await page.eval(`(() => {
  const active = document.querySelector('.zj-anno-mark-active')
  return active ? active.getAttribute('data-rows') : null
})()`)
ok('抽屉条目 hover → 激活对应侧标（data-rows 含 1）', hoverState === '1', 'active=' + String(hoverState))
// 移开（抽屉头部空白处距条目足够远）
await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: itemRect.x, y: itemRect.y - 120 })
await sleep(300)
ok('指针移开 → 侧标激活清除', (await page.eval(`document.querySelector('.zj-anno-mark-active')`)) === null, '')

// ⑤ 划词新增同段批注（before=「沈藏点了根烟」，L12 段内）→ 同段合并：侧标仍 2 个，L12 侧标 title 含「同段共 2 条」
await page.eval(clickBtn('收起', true))
await evalUntil(page, `!document.querySelector('.zj-anno-drawer')`, Boolean, 5000, '收起抽屉')
await page.eval(`(() => {
  window.dispatchEvent(new CustomEvent('zj:anno-compose', { detail: { loc: '', before: '沈藏点了根烟' } }))
  return 1
})()`)
await evalUntil(page, bodyHas('添加批注'), Boolean, 8000, '批注弹层出现')
await page.eval(`(() => {
  const ta = [...document.querySelectorAll('textarea')].find((t) => t.closest('[role="dialog"]'))
  if (!ta) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '烟雾描写再克制半档，别抢台词焦点')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(400)
await page.eval(clickBtn('保存批注', true))
// 注：新批注 before（沈藏点了根烟）落在已有 L12 批注的 loc 切片内，ProseMirror 重叠装饰会拆成 >3 个 span，故断言 ≥3 + 徽标=批注 3
// 坑（2026-09-14 修）：③ 点侧标跳转后编辑器持有模型选区 → 划词浮层弹出，其「批注」按钮（title=给选中文字添加批注）
// innerText 恰为「批注」，startsWith('批注') 会先命中它导致「徽标=批注 3」恒超时（当时误判为徽标刷新链路故障）。
// 计数徽标形态是「批注 N」→ 用 /^批注 \d+$/ 严格匹配（同浮层按钮/抽屉条目区分开）。
await evalUntil(page, `document.querySelectorAll('.zj-anno').length`, (n) => n >= 3, 15000, '新增后高亮 ≥3')
await evalUntil(page, `document.querySelectorAll('.zj-anno-mark').length`, (n) => n === 2, 15000, '同段合并后仍 2 个侧标')
const badge3 = await evalUntil(page, `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /^批注 \\d+$/.test((x.innerText || '').trim()))
  return b ? b.innerText.trim() : ''
})()`, (v) => v === '批注 3', 8000, '徽标=批注 3')
ok('新增批注计数徽标 → 批注 3', badge3 === '批注 3', String(badge3))
// 合并断言须等待式（annotations 更新 → effect → rAF 重算，读一次会竞态）
const merged = await evalUntil(
  page,
  `(() => {
    const marks = [...document.querySelectorAll('.zj-anno-mark')]
    const m = marks.find((x) => (x.getAttribute('title') || '').includes('同段共 2 条批注'))
    return m ? { rows: m.getAttribute('data-rows'), title: m.getAttribute('title') } : null
  })()`,
  (v) => v !== null,
  15000,
  '同段合并 title'
)
ok('同段新增后侧标合并（条数 2，title 提示同段共 2 条）', !!merged, JSON.stringify(merged))
ok('合并侧标 data-rows 含原 L12 行号 2', !!merged && String(merged.rows).split(',').includes('2'), JSON.stringify(merged))

// ⑥ 滚动跟随：内容加长 → host 滚动 → 侧标 top 随文本移动（scroll 事件重算）
const scrollFollow = await page.eval(`(() => {
  const host = document.querySelector('.zj-md .ProseMirror')?.parentElement?.parentElement
  const mark = document.querySelector('.zj-anno-mark')
  return { hostTop: host?.getBoundingClientRect().top ?? null, before: mark?.getBoundingClientRect().top ?? null }
})()`)
// 编辑器内容加长（保批注原文），触发 markdownUpdated/scroll 任一链路重算
await page.eval(`(() => {
  const pad = Array.from({ length: 60 }, (_, i) => '第' + (i + 1) + '段：潮水一遍遍拍着防波堤，灯影在水面碎成一片一片。').join('\\n\\n')
  window.__ZJ_EDITORS[0].setContent(window.__ZJ_EDITORS[0].getMarkdown() + '\\n\\n' + pad)
  return 1
})()`)
await sleep(600)
const beforeScroll = await page.eval(`document.querySelector('.zj-anno-mark').getBoundingClientRect().top`)
const scrollable = await page.eval(`(() => {
  const host = document.querySelector('.zj-md .ProseMirror').parentElement.parentElement
  return { h: host.scrollHeight, c: host.clientHeight }
})()`)
if (scrollable.h > scrollable.c + 100) {
  await page.eval(`(() => {
    const host = document.querySelector('.zj-md .ProseMirror').parentElement.parentElement
    host.scrollTop = 200
    return host.scrollTop
  })()`)
  await sleep(500)
  const afterScroll = await page.eval(`document.querySelector('.zj-anno-mark').getBoundingClientRect().top`)
  ok('滚动后侧标跟随文本移动（top 减少 ≈200px）', Math.abs(beforeScroll - afterScroll - 200) < 8, `before=${beforeScroll} after=${afterScroll}`)
} else {
  ok('滚动跟随（跳过：内容不足以滚动）', true, JSON.stringify(scrollable))
}

// ⑦ 亮/暗主题：侧标底色随 warn 语义变量变化
const bgLight = await page.eval(`getComputedStyle(document.querySelector('.zj-anno-mark')).backgroundColor`)
await page.eval(`document.documentElement.classList.add('dark')`)
await sleep(250)
const bgDark = await page.eval(`getComputedStyle(document.querySelector('.zj-anno-mark')).backgroundColor`)
await page.eval(`document.documentElement.classList.remove('dark')`)
await sleep(250)
ok('亮/暗主题侧标底色均生效且不同', bgLight !== bgDark && bgLight !== 'rgba(0, 0, 0, 0)' && bgDark !== 'rgba(0, 0, 0, 0)', `${bgLight} vs ${bgDark}`)

// 截图（亮色主题、侧标可见；先恢复滚动到顶部，让侧标完整入画）
await page.eval(`(() => {
  const host = document.querySelector('.zj-md .ProseMirror').parentElement.parentElement
  host.scrollTop = 0
  return 1
})()`)
await sleep(500)
try {
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  appendFileSync(process.env.ZJ_SHOT || '/tmp/anno-gutter.png', Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT saved')
} catch (e) {
  console.log('SCREENSHOT skipped:', String(e).slice(0, 80))
}

console.log(`\nRESULT: ${pass} pass / ${fail} fail`)
if (fail > 0) process.exit(1)
process.exit(0)
