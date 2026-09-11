// 采集任务卡「需求规格完整性」UI 冒烟：无头 Chrome（CDP 9224）+ devShim 演示数据（demo-aseya）
// 背景：任务卡 front matter 的「需求」曾静默截断 120 字（管道按 FM 需求当规格，长需求被砍）；
//       且查重按截断后的需求比较，>120 字相同需求会漏警。本轮修复：FM 需求不截断。
// 步骤：开新 tab（缓存破坏）→ 素材库页 → 发起采集：填 130+ 字需求提交 → 详情出现完整需求（未被截断）
//       → 再次发起采集填相同需求 → 出现查重警告（>120 字相同需求不再漏警）
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://127.0.0.1:8123'
const ID = 'spec' + Date.now()
// 135+ 字：旧代码截 120 会丢掉尾部标记【尾标Q7】
const DEMAND = '需要一段描写：' + '教学楼连廊的雨后积水'.repeat(12) + '【尾标Q7】'

const tab = await (await fetch(CDP + '/json/new?' + encodeURIComponent(BASE + '/?cb=' + ID), { method: 'PUT' })).json()
const ws = new WebSocket(tab.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function evalJs(expression) {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 500))
  return r.result?.value
}
await new Promise((r) => (ws.onopen = r))
await cmd('Page.enable')
await cmd('Page.navigate', { url: BASE + '/?cb=' + ID + '#/project/demo-aseya/library' })
await sleep(2800)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (cond ? '' : ' | ' + extra))
  if (!cond) bad++
}

// [0] 前置校验：需求确实 >120 字
check(`需求文本 >120 字（${DEMAND.length}）`, DEMAND.length > 120, 'len=' + DEMAND.length)

// 等采集栏渲染
for (let i = 0; i < 20; i++) {
  const ok = await evalJs(`!!document.querySelector('button[title^="点击查看任务卡详情"]')`)
  if (ok) break
  await sleep(500)
}

// [1] 发起采集：填 135+ 字需求并提交
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('发起采集'))?.click(); 'ok'`)
await sleep(600)
await evalJs(`(() => {
  const ta = document.querySelector('[role="dialog"] textarea')
  if (!ta) return 'no-ta'
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  set.call(ta, ${JSON.stringify(DEMAND)})
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'set:' + ta.value.length
})()`)
await sleep(300)
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '提交任务')?.click(); 'ok'`)
// 等新卡出现在采集栏（summary = 正文首行标题截 40）
let seen = false
for (let i = 0; i < 20; i++) {
  seen = await evalJs(`[...document.querySelectorAll('button[title^="点击查看任务卡详情"]')].some((b) => b.innerText.includes('需要一段描写'))`)
  if (seen) break
  await sleep(500)
}
check('提交后新卡片出现在采集栏', seen)

// [2] 打开详情：需求完整（含尾部标记【尾标Q7】，长度未被截断）
await evalJs(`[...document.querySelectorAll('button[title^="点击查看任务卡详情"]')].find((b) => b.innerText.includes('需要一段描写'))?.click(); 'ok'`)
await sleep(900)
const dlg = await evalJs(`document.querySelector('[role="dialog"]')?.innerText ?? ''`)
const flatDemand = DEMAND.replace(/\n/g, ' ')
check('详情需求=完整原文（含尾标，未截断）', dlg.includes('【尾标Q7】') && dlg.includes(flatDemand.slice(0, 40)) && dlg.includes(flatDemand.slice(-10)), dlg.slice(0, 120).replace(/\n/g, '⏎'))

// [3] 关闭详情 → 再次发起采集填同一需求 → 查重警告出现（>120 字相同需求不再漏警）
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '关闭')?.click(); 'ok'`)
await sleep(500)
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('发起采集'))?.click(); 'ok'`)
await sleep(600)
await evalJs(`(() => {
  const ta = document.querySelector('[role="dialog"] textarea')
  if (!ta) return 'no-ta'
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  set.call(ta, ${JSON.stringify(DEMAND)})
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'set:' + ta.value.length
})()`)
await sleep(600)
const warn = await evalJs(`document.querySelector('[role="dialog"]')?.innerText.includes('已有进行中的需求相同任务') ?? false`)
check('长需求重复提交出现查重警告', warn)

console.log(bad === 0 ? 'ALL PASS (6/6)' : 'FAILED ' + bad)
ws.close()
process.exit(bad === 0 ? 0 : 1)
