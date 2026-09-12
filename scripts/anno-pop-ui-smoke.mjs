// 织卷无头冒烟 · 批注气泡交互（体验层 2026-09-13；批注显示第二轮候选1）
// 用法：node scripts/anno-pop-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim 演示项目）：选第1章 → 高亮带 data-anno-row → 点击弹出批注气泡（意图+位置+动作）
//       → 加入对话（进 agent 引用条）→ 再点开 → 删除该批注（csv 删行 → 高亮/徽标即时减少 + toast）
//       → 点外/Esc 关闭 → 亮/暗主题卡片配色核对
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

const tab = await openTab(BASE + '/#/project/demo-aseya/novel?cb=' + Date.now())
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入')

// ① 选第1章 → 编辑器挂载（Novel 页默认不挂编辑器）
await page.eval(clickBtn('第1章 · 雾港', false))
await evalUntil(page, `!!document.querySelector('.ProseMirror')`, Boolean, 20000, '编辑器挂载')

// ② 两条批注高亮且带 data-anno-row（1/2 对应 csv 行号）
await evalUntil(page, `document.querySelectorAll('.zj-anno').length`, (n) => n === 2, 15000, '两条批注高亮')
const rows = await page.eval(`[...document.querySelectorAll('.zj-anno')].map((s) => s.getAttribute('data-anno-row'))`)
ok('高亮×2 且 data-anno-row=[1,2]', JSON.stringify(rows) === JSON.stringify(['1', '2']), JSON.stringify(rows))
ok('高亮仍有 title（hover 轻提示保留）', (await page.eval(`document.querySelector('.zj-anno').getAttribute('title')`))?.length > 0, '')

// ③ 点击第一条高亮 → 批注气泡出现（意图/位置/动作）
await page.eval(`document.querySelector('.zj-anno').click()`)
await evalUntil(page, `!!document.querySelector('.zj-anno-pop')`, Boolean, 8000, '批注气泡出现')
const popInfo = await page.eval(`(() => {
  const p = document.querySelector('.zj-anno-pop')
  return { note: p.querySelector('.zj-anno-pop-note')?.textContent || '', meta: p.querySelector('.zj-anno-pop-meta')?.textContent || '', btns: [...p.querySelectorAll('button')].map((b) => (b.innerText || '').trim()), z: getComputedStyle(p).zIndex }
})()`)
ok('气泡含批注意图', popInfo.note.includes('这句太文艺了'), 'note=' + popInfo.note.slice(0, 40))
ok('气泡含位置（L10 行号）', popInfo.meta.includes('L10:1-L10:34'), 'meta=' + popInfo.meta.slice(0, 40))
ok('气泡含「加入对话/删除该批注」', popInfo.btns.includes('加入对话') && popInfo.btns.includes('删除该批注'), JSON.stringify(popInfo.btns))
ok('气泡在浮层之上（z>60）', Number(popInfo.z) > 60, 'z=' + popInfo.z)

// ④「加入对话」→ 引用进 agent 区（quote 条），气泡关闭
await page.eval(clickBtn('加入对话', true))
await evalUntil(
  page,
  `[...document.querySelectorAll('span')].some((s) => s.className.includes('line-clamp-2') && s.textContent.includes('雨把港口'))`,
  Boolean,
  8000,
  'agent 引用条出现'
)
ok('加入对话后气泡关闭', (await page.eval(`!!document.querySelector('.zj-anno-pop')`)) === false, '')

// ⑤ 再点开 → 删除该批注 → 高亮/徽标减少 + toast，csv 行删除由主进程/单测覆盖
await page.eval(`document.querySelector('.zj-anno').click()`)
await evalUntil(page, `!!document.querySelector('.zj-anno-pop')`, Boolean, 8000, '批注气泡再次出现')
await page.eval(clickBtn('删除该批注', true))
await evalUntil(page, `document.querySelectorAll('.zj-anno').length`, (n) => n === 1, 10000, '删除后高亮×1')
ok('删除后 toast「批注已删除」', (await page.eval(bodyHas('批注已删除'))) === true, '')
const badge1 = await evalUntil(
  page,
  `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim().startsWith('批注 ')); return b ? b.innerText.trim() : '' })()`,
  (v) => v === '批注 1',
  8000,
  '徽标变批注 1'
)
ok('删除后徽标「批注 1」', badge1 === '批注 1', String(badge1))
const rowLeft = await page.eval(`document.querySelector('.zj-anno')?.getAttribute('data-anno-row')`)
ok('剩余高亮为 csv 第 1 行（沈藏批注）', rowLeft === '1', 'row=' + rowLeft)

// ⑥ 点外关闭（mousedown 在 pop 外）
await page.eval(`document.querySelector('.zj-anno').click()`)
await evalUntil(page, `!!document.querySelector('.zj-anno-pop')`, Boolean, 8000, '气泡第三次出现')
await page.eval(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
await evalUntil(page, `!document.querySelector('.zj-anno-pop')`, Boolean, 5000, '点外关闭气泡')
ok('点外 mousedown 关闭气泡', true, '')

// ⑦ Esc 关闭
await page.eval(`document.querySelector('.zj-anno').click()`)
await evalUntil(page, `!!document.querySelector('.zj-anno-pop')`, Boolean, 8000, '气泡第四次出现')
await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
await evalUntil(page, `!document.querySelector('.zj-anno-pop')`, Boolean, 5000, 'Esc 关闭气泡')
ok('Esc 关闭气泡', true, '')

// ⑧ 亮/暗主题卡片配色（语义变量）
await page.eval(`document.querySelector('.zj-anno').click()`)
await evalUntil(page, `!!document.querySelector('.zj-anno-pop')`, Boolean, 8000, '气泡第五次出现')
const bgLight = await page.eval(`getComputedStyle(document.querySelector('.zj-anno-pop')).backgroundColor`)
await page.eval(`document.documentElement.classList.add('dark')`)
await sleep(250)
const bgDark = await page.eval(`getComputedStyle(document.querySelector('.zj-anno-pop')).backgroundColor`)
await page.eval(`document.documentElement.classList.remove('dark')`)
ok('亮/暗主题气泡底色均生效且不同', bgLight !== bgDark && bgLight !== 'rgba(0, 0, 0, 0)' && bgDark !== 'rgba(0, 0, 0, 0)', `${bgLight} vs ${bgDark}`)

console.log(`\nRESULT: ${pass} pass / ${fail} fail`)
if (fail > 0) process.exit(1)
process.exit(0)
