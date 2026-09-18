// 织卷无头冒烟 · 工具链轨迹（智能层 2026-09-15）
// 用法：node scripts/tool-chain-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim 演示项目 + 「链/续读」触发词）：发送含「链」的消息 → 演示 3 步 zj_read_doc 续读链
//       （同文档 offset 续读）→ 断言「工具链」容器（轨迹竖线 + 步序号 1/3…3/3 + 续读徽标×2 +
//       offset 参数可追溯），并回归单卡（不含链词的普通消息仍走独立工具卡，无链容器）。
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

  // ① 链演示：发送含「链」的消息 → 3 步续读链
  await typeText(page, '链演示工具链')
  await pressEnter(page)
  // 等待链完成（折叠态组头可见的确定性信号：×3 展开钮 + demo 尾句；「已读到末尾」是第 3 步摘要，
  // 折叠态不展示——原等待条件在此实现下永不满足（dc9045c 折叠化后既有的脚本 bug，档案已登记超时））
  await evalUntil(
    page,
    `document.body.innerText.includes('×3 展开') && document.body.innerText.includes('把这一段写出来')`,
    (v) => v === true,
    25000,
    '续读链结束'
  )
  await sleep(400)

  // ② 断言：工具链容器默认折叠（合并同工具：1 行 + ×3 展开钮），展开后序号/徽标/参数齐全
  const chainInfo = await page.eval(`(() => {
    const chain = document.querySelector('[data-testid="zj-tool-chain"]')
    if (!chain) return { found: false }
    return {
      found: true,
      count: chain.querySelector('[data-testid="zj-chain-count"]')?.innerText ?? '',
      steps: [...chain.querySelectorAll('[data-testid="zj-step"]')].map((e) => e.innerText.trim()),
      hasExpand: [...chain.querySelectorAll('button')].some((b) => (b.innerText || '').includes('展开')),
      continued: chain.querySelectorAll('[data-testid="zj-continued"]').length,
      args: [...chain.querySelectorAll('span')].filter((e) => (e.innerText || '').includes('第01章_雾港.md')).map((e) => e.innerText.trim()),
      text: chain.innerText
    }
  })()`)
  ok('工具链容器出现', chainInfo.found === true)
  ok('链头计数显示 3 步', (chainInfo.count || '').includes('3 步'), chainInfo.count)
  ok('默认合并为一批（步骤仅 1/3 + ×3 展开钮）', chainInfo.steps.length === 1 && chainInfo.hasExpand === true && (chainInfo.steps[0] || '').includes('1/3'), JSON.stringify(chainInfo.steps))
  const aggElapsedTitle = await page.eval(`(() => {
    const chain = document.querySelector('[data-testid="zj-tool-chain"]')
    return [...chain.querySelectorAll('span')].some((e) => (e.getAttribute('title') || '').startsWith('本组 3 步工具调用合计耗时'))
  })()`)
  ok('折叠组头显示聚合耗时（title 注明 3 步合计）', aggElapsedTitle === true)

  // 展开全部步骤
  await page.eval(`(() => { const b = [...document.querySelectorAll('[data-testid="zj-tool-chain"] button')].find((x) => (x.innerText || '').includes('展开')); if (b) b.click(); return !!b })()`)
  await sleep(350)
  const chainExpanded = await page.eval(`(() => {
    const chain = document.querySelector('[data-testid="zj-tool-chain"]')
    if (!chain) return { found: false }
    return {
      found: true,
      steps: [...chain.querySelectorAll('[data-testid="zj-step"]')].map((e) => e.innerText.trim()),
      continued: chain.querySelectorAll('[data-testid="zj-continued"]').length,
      args: [...chain.querySelectorAll('span')].filter((e) => (e.innerText || '').includes('第01章_雾港.md')).map((e) => e.innerText.trim()),
      text: chain.innerText
    }
  })()`)
  ok('展开后步序号 1/3 2/3 3/3', JSON.stringify(chainExpanded.steps) === JSON.stringify(['1/3', '2/3', '3/3']), JSON.stringify(chainExpanded.steps))
  ok('续读徽标 2 个（第 2/3 步）', chainExpanded.continued === 2, String(chainExpanded.continued))
  ok('offset 参数在卡片上可追溯', (chainExpanded.args || []).some((a) => a.includes('(offset=6000)')) && (chainExpanded.args || []).some((a) => a.includes('(offset=12000)')), JSON.stringify(chainExpanded.args))
  ok('链内无「失败」态', !chainExpanded.text.includes('失败'))

  // ③ demo 全文完整（链未破坏流；末句在最后一条 assistant 气泡）
  const asst = await page.eval(`(() => {
    const els = [...document.querySelectorAll('.prose')]
    const el = els[els.length - 1]
    return el ? el.innerText : ''
  })()`)
  ok('assistant 回复完整（demo 尾句存在）', asst.includes('把这一段写出来'), asst.slice(-60))

  // ④ 链内失败场景：发送「链失败演示」→ 折叠态组头必须显示聚合失败态（不被「绿勾+×N」吞掉）
  await typeText(page, '链失败演示')
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText.includes('你可以让我重试或改用修改卡')`,
    (v) => v === true,
    25000,
    '链失败演示结束'
  )
  await sleep(400)
  const failHead = await page.eval(`(() => {
    const chains = [...document.querySelectorAll('[data-testid="zj-tool-chain"]')]
    const chain = chains[chains.length - 1]
    if (!chain) return { found: false }
    const text = chain.innerText || ''
    return {
      found: true,
      hasFailBadge: !!chain.querySelector('[data-failed="true"]'),
      hasFailSummary: text.includes('读取失败：文件已被外部修改'),
      hasSuccessIcon: !!chain.querySelector('svg.lucide-circle-x, [class*="lucide-circle-x"]') ||
        [...chain.querySelectorAll('svg')].some((s) => (s.getAttribute('class') || '').includes('lucide-circle-x')),
      collapseInfo: [...chain.querySelectorAll('[data-testid="zj-step"]')].map((e) => e.innerText.trim())
    }
  })()`)
  ok('链失败：折叠组头呈失败态（红色文字行 data-failed）', failHead.found === true && failHead.hasFailBadge === true, JSON.stringify(failHead))
  ok('链失败：组头摘要为首个失败步内容（红色失败信号）', failHead.hasFailSummary === true)
  ok('链失败：折叠态无成功绿勾（CircleX 替代）', failHead.hasSuccessIcon === true)
  ok('链失败：默认折叠（步骤仅 1/3）', JSON.stringify(failHead.collapseInfo) === JSON.stringify(['1/3']), JSON.stringify(failHead.collapseInfo))

  // ⑤ 截图留档（链失败折叠态界面：组头失败徽标+摘要+聚合耗时）
  try {
    const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
    const name = 'tool-chain-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png'
    const out = process.env.HOME + '/Pictures/zhijuan/' + name
    writeFileSync(out, Buffer.from(shot.data, 'base64'))
    console.log('SHOT ' + out)
  } catch (e) {
    console.log('SHOT FAIL', e.message)
  }

  // ⑤ 回归：普通消息（不含链词）仍是独立工具卡、不新增链容器
  const chainsBefore = await page.eval(`document.querySelectorAll('[data-testid="zj-tool-chain"]').length`)
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
    const chains = document.querySelectorAll('[data-testid="zj-tool-chain"]').length
    const reads = [...document.querySelectorAll('*')].filter((e) => e.className && String(e.className).includes('rounded') && (e.innerText || '').includes('zj_read_doc') === false && (e.innerText || '').includes('读文档')).length
    return { chains, reads }
  })()`)
  ok('普通消息未新增链容器（链数不变=' + chainsBefore + '）', single.chains === chainsBefore, JSON.stringify(single))
  ok('普通消息仍渲染读文档卡', single.reads >= 1, JSON.stringify(single))

  console.log('ALL OK ✅ (' + pass + '/' + (pass + fail) + ')')
  if (fail > 0) process.exitCode = 1
} catch (err) {
  console.error('FAIL:', err.message)
  process.exitCode = 1
} finally {
  await fetch(CDP + '/json/close/' + tab.id).catch(() => {})
  page.close()
}
