// 织卷无头冒烟 · 提案「IO/系统失败保持 pending 可就地重试」（创作层 2026-09-16 候选1）
// 用法：node scripts/proposal-io-retry-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（真实用户语义）：注入一条 pending 提案 → 打开抽屉点「接受」→ devShim ?zj-iofail=applyProposal
//   一次性注入模拟系统/IO 失败（返回 ok:false 但**不改状态**）→ 断言：卡仍「待确认」、红字指路可直接重试、
//   「接受」按钮仍可用 → 再点「接受」（注入一次性已消费）→ 断言「已接受」，即「瞬态失败→就地重试成功」闭环。
// 对照：内容漂移（before 不匹配）仍走 rejected 不可重试（既有 anno-drift 冒烟覆盖，回归见三道门+单测）。
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.env.HOME + '/Pictures/zhijuan'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cb = Date.now()

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
    } catch { /* retry */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}
const clickBtn = (text, exact = false) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!el) return false
  el.click()
  return true
})()`

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + String(extra).slice(0, 160) : '')) }
}

const tab = await openTab(BASE + '/?cb=' + cb + '&zj-iofail=applyProposal#/project/demo-aseya/novel')
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, `document.body.innerText.includes('雾港')`, (v) => v === true, 20000, '项目页载入')

// ① 注入一条 pending 提案（target 用冒烟专用文件，不碰 demo 数据；append 两端 applyAnchor 同行为）
const created = await page.eval(`window.zhijuan.createProposals('demo-aseya', 'agent-chat', '第1章', 's', [{ target: '人物/冒烟测试.md', kind: 'append', anchor: '', before: '', after: '冒烟写入：IO 失败重试闭环', reason: '冒烟注入' }])`)
ok('createProposals 注入 pending 提案', Array.isArray(created) && created.length === 1 && created[0].status === 'pending', JSON.stringify(created))

// ② 顶栏出现「待确认提案 1」→ 点开抽屉
await evalUntil(page, `document.body.innerText.includes('待确认提案 1')`, (v) => v === true, 10000, '提案入口出现')
await page.eval(clickBtn('待确认提案 1'))
await evalUntil(page, `document.body.innerText.includes('提案') && document.body.innerText.includes('待确认')`, (v) => v === true, 10000, '抽屉打开')
await sleep(300)

// ③ 第一次「接受」→ 触发 zj-iofail 一次性注入 → 失败但状态保持 pending
await page.eval(clickBtn('接受', true))
await evalUntil(page, `document.body.innerText.includes('系统写入失败，可直接重试')`, (v) => v === true, 10000, 'IO 失败红字出现')
const s1 = await page.eval(`(() => {
  const card = [...document.querySelectorAll('[class*=rounded-xl]')].find((d) => d.innerText.includes('人物/冒烟测试.md'))
  const badge = [...(card?.querySelectorAll('span') ?? [])].map((x) => x.textContent.trim()).find((t) => ['待确认', '已接受', '已拒绝', '已过期'].includes(t))
  const accept = [...(card?.querySelectorAll('button') ?? [])].find((b) => (b.innerText || '').trim() === '接受')
  return { badge, acceptDisabled: accept ? accept.disabled : 'NO_BTN', hasErr: card?.innerText.includes('系统写入失败，可直接重试') }
})()`)
ok('① IO 失败后卡仍「待确认」（状态未被误置已拒绝）', s1.badge === '待确认', JSON.stringify(s1))
ok('② IO 失败后「接受」按钮仍可用（disabled=false）', s1.acceptDisabled === false, JSON.stringify(s1))
ok('③ 卡片红字含「系统写入失败，可直接重试」指路', s1.hasErr === true, JSON.stringify(s1))

// ④ 第二次「接受」→ 注入已消费 → 真正写入 → 已接受
await page.eval(clickBtn('接受', true))
await evalUntil(page, `document.body.innerText.includes('已接受')`, (v) => v === true, 10000, '重试成功 accepted')
const s2 = await page.eval(`(() => {
  const card = [...document.querySelectorAll('[class*=rounded-xl]')].find((d) => d.innerText.includes('人物/冒烟测试.md'))
  const badge = [...(card?.querySelectorAll('span') ?? [])].map((x) => x.textContent.trim()).find((t) => ['待确认', '已接受', '已拒绝', '已过期'].includes(t))
  return { badge, hasErr: card?.innerText.includes('系统写入失败') }
})()`)
ok('④ 就地重试成功：卡「已接受」', s2.badge === '已接受', JSON.stringify(s2))
ok('⑤ 重试成功后错误红字清除', s2.hasErr === false, JSON.stringify(s2))

// ⑥ 写入落盘验证（devShim readDoc 冒烟专用文件存在且含 after）
const doc = await page.eval(`window.zhijuan.readDoc('demo-aseya', '人物/冒烟测试.md')`)
ok('⑥ after 内容已写入冒烟文件', typeof doc === 'string' && doc.includes('冒烟写入：IO 失败重试闭环'), String(doc).slice(0, 60))

// 截图（失败态最有取证价值：待确认 + 红字 + 可用按钮）
mkdirSync(OUT, { recursive: true })
const hh = String(new Date().getHours()).padStart(2, '0')
const mm = String(new Date().getMinutes()).padStart(2, '0')
const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
const shotPath = OUT + '/proposal-io-retry-' + hh + mm + '.png'
writeFileSync(shotPath, Buffer.from(s.data, 'base64'))
console.log('SCREENSHOT:', shotPath)

ok('⑦ 零页面 JS 异常', (page.errors ?? []).length === 0, JSON.stringify(page.errors).slice(0, 200))

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
