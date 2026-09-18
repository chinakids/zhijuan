// 织卷无头冒烟 · 工具卡「细节展开」（智能层 2026-09-15）
// 用法：node scripts/tool-detail-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）+ out/renderer 已 build；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim + 触发词）：「链/续读」→ 3 步续读链 → 断言链内卡均有详情入口、默认折叠；
//     点击展开 → 参数 JSON（格式化）+ 结果全文可见；再点折叠；「失败」→ 失败卡展开见完整报错（不再被 80 字截断）；
//     回归：普通单卡有入口且可展开。
import { writeFileSync } from 'node:fs'

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
    await sleep(250)
  }
}
async function typeText(page, text) {
  for (const ch of text) {
    await page.eval(`(() => {
      const ta = document.querySelector('textarea')
      if (!ta) return 'NO_TA'
      ta.focus()
      const proto = Object.getPrototypeOf(ta)
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(ta, ta.value + ${JSON.stringify(ch)})
      const pos = ta.value.length
      ta.setSelectionRange(pos, pos)
      const ev = new Event('input', { bubbles: true })
      ev.isComposing = false
      ta.dispatchEvent(ev)
      ta.dispatchEvent(new Event('change', { bubbles: true }))
      return ta.value
    })()`)
    await sleep(60)
  }
  return 'OK'
}
async function pressEnter(page) {
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)
}

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

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(
    page,
    `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`,
    (v) => v === true,
    20000,
    '正文页就绪'
  )
  console.log('OK 正文页就绪')

  // ① 链演示 → 请求正常结束（折叠态组头可见的确定性信号：×3 展开钮 + demo 尾句；
  // 「已读到末尾」是第 3 步摘要折叠态不展示——原等待条件永不满（与 tool-chain 冒烟同根因））
  await typeText(page, '链演示工具链')
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText.includes('×3 展开') && document.body.innerText.includes('把这一段写出来')`,
    (v) => v === true,
    25000,
    '续读链结束'
  )
  await sleep(400)

  // ② 链内卡片：折叠态组头有详情入口；默认折叠（无展开体）
  const chainGui = await page.eval(`(() => {
    const chain = document.querySelector('[data-testid="zj-tool-chain"]')
    if (!chain) return { found: false }
    const toggles = chain.querySelectorAll('[data-testid="zj-tool-detail-toggle"]')
    const bodies = chain.querySelectorAll('[data-testid="zj-tool-detail-body"]').length
    return { found: true, toggles: toggles.length, bodies }
  })()`)
  console.log('CHAIN GUI:', JSON.stringify(chainGui).slice(0, 400))
  ok('折叠组头有详情入口', chainGui.found === true && chainGui.toggles >= 1, String(chainGui.toggles))
  ok('默认折叠（无展开体）', chainGui.bodies === 0, String(chainGui.bodies))

  // ②b 展开链后 3 张卡均有详情入口（dc9045c 折叠化后原「toggles===3」断言在折叠态永不满足——改为展开态验证）
  await page.eval(`(() => { const b = [...document.querySelectorAll('[data-testid="zj-tool-chain"] button')].find((x) => (x.innerText || '').includes('展开')); if (b) b.click(); return !!b })()`)
  await sleep(300)
  const togglesExpanded = await page.eval(`document.querySelectorAll('[data-testid="zj-tool-detail-toggle"]').length`)
  ok('展开后 3 张卡均有详情入口', togglesExpanded === 3, String(togglesExpanded))
  // 收起链，回到折叠态继续后续步骤（③ 从组头 toggle 开始）
  await page.eval(`(() => { const b = [...document.querySelectorAll('[data-testid="zj-tool-chain"] button')].find((x) => (x.innerText || '').includes('收起')); if (b) b.click(); return !!b })()`)
  await sleep(300)

  // ③ 点击第 1 个 toggle → 展开：参数 JSON（含 file）+ 结果全文
  await page.eval(`(() => {
    const chain = document.querySelector('[data-testid="zj-tool-chain"]')
    const t = chain.querySelector('[data-testid="zj-tool-detail-toggle"]')
    t.click()
    return true
  })()`)
  await sleep(300)
  const open1 = await page.eval(`(() => {
    const chain = document.querySelector('[data-testid="zj-tool-chain"]')
    const body = chain.querySelector('[data-testid="zj-tool-detail-body"]')
    if (!body) return { found: false }
    return { found: true, text: body.innerText, argText: body.textContent }
  })()`)
  console.log('OPEN1:', JSON.stringify(open1).slice(0, 500))
  ok('展开体出现', open1.found === true)
  ok('参数区含 file JSON', open1.found && open1.text.includes('"file"') && open1.text.includes('第01章_雾港.md'), open1.text?.slice(0, 120))
  ok('结果区显示全文（含节选标记）', open1.found && open1.text.includes('结果') && open1.text.includes('第 1-6000 字符节选'), open1.text?.slice(0, 200))

  // ④ 再点折叠
  await page.eval(`(() => {
    const chain = document.querySelector('[data-testid="zj-tool-chain"]')
    const t = chain.querySelector('[data-testid="zj-tool-detail-toggle"]')
    t.click()
    return true
  })()`)
  await sleep(300)
  const closed = await page.eval(`(() => document.querySelectorAll('[data-testid="zj-tool-detail-body"]').length)()`)
  ok('再点收起（展开体消失）', closed === 0, String(closed))

  // ⑤ 失败工具卡：展开见完整报错（此前只显示 80 字摘要）
  await typeText(page, '失败演示读不到')
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText.includes('未找到匹配') && document.body.innerText.includes('把这一段写出来')`,
    (v) => v === true,
    25000,
    '失败演示结束'
  )
  await sleep(400)
  // 找到失败卡（data-failed 行）的 toggle
  await page.eval(`(() => {
    const cards = [...document.querySelectorAll('[data-testid="zj-tool-detail"]')]
    const card = cards.find((c) => c.getAttribute('data-failed') === 'true')
    const t = card && card.querySelector('[data-testid="zj-tool-detail-toggle"]')
    if (t) t.click()
    return !!t
  })()`)
  await sleep(300)
  const failBody = await page.eval(`(() => {
    const cards = [...document.querySelectorAll('[data-testid="zj-tool-detail"]')]
    const card = cards.find((c) => c.querySelector('[data-testid="zj-tool-detail-body"]'))
    return card ? card.innerText : ''
  })()`)
  console.log('FAIL DETAIL:', JSON.stringify(failBody).slice(0, 400))
  ok('失败卡展开显示完整报错（ENOENT 详情）', failBody.includes('ENOENT') && failBody.includes('请检查关键词或换一个词再试'), failBody.slice(0, 160))

  // ⑥ 截图（展开态）
  try {
    const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
    const name = 'tool-detail-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png'
    const out = process.env.HOME + '/Pictures/zhijuan/' + name
    writeFileSync(out, Buffer.from(shot.data, 'base64'))
    console.log('SHOT ' + out)
  } catch (e) {
    console.log('SHOT FAIL', e.message)
  }

  // ⑦ 回归：普通消息单卡也有详情入口并可展开
  await typeText(page, '看看当前章节')
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText.includes('章节已读完') && document.body.innerText.includes('把这一段写出来')`,
    (v) => v === true,
    25000,
    '单卡演示结束'
  )
  await sleep(300)
  const single = await page.eval(`(() => {
    const cards = [...document.querySelectorAll('[data-testid="zj-tool-detail"]')]
    const last = cards[cards.length - 1]
    if (!last) return { found: false }
    const t = last.querySelector('[data-testid="zj-tool-detail-toggle"]')
    return { found: true, hasToggle: !!t }
  })()`)
  ok('单卡也有详情入口', single.found === true && single.hasToggle === true, JSON.stringify(single))

  console.log('ALL OK ✅ (' + pass + '/' + (pass + fail) + ')')
  if (fail > 0) process.exitCode = 1
} catch (err) {
  console.error('FAIL:', err.message)
  process.exitCode = 1
} finally {
  await fetch(CDP + '/json/close/' + tab.id).catch(() => {})
  page.close()
}
