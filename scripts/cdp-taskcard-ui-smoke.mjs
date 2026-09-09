// 采集任务卡「点击看结果」UI 冒烟：无头 Chrome（CDP 9224）+ devShim 演示数据（demo-aseya 采集池任务卡）
// 步骤：开新 tab（缓存破坏参数）→ 直接 hash 导航到 项目/素材库 → 等任务卡渲染 → 点击任务卡 → 断言详情 Dialog 含结果路径
// 前置：python3 -m http.server 8123 --directory out/renderer &（本仓库），且 npm run build 已跑
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://127.0.0.1:8123'
const ID = 'tk' + Date.now()

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
await sleep(2500)

// 等任务卡渲染（CollectionBar 的按钮 title 是「点击查看任务卡详情…」）
let found = false
for (let i = 0; i < 20; i++) {
  found = await evalJs(`!!document.querySelector('button[title^="点击查看任务卡详情"]')`)
  if (found) break
  await sleep(500)
}
if (!found) {
  const body = await evalJs(`document.body.innerText.slice(0, 400)`)
  console.error('FAIL: 任务卡未渲染。页面文本：', body)
  process.exitCode = 1
} else {
  const cardText = await evalJs(`document.querySelector('button[title^="点击查看任务卡详情"]')?.innerText ?? ''`)
  console.log('[1] 任务卡已渲染:', JSON.stringify(cardText))
  // 点击任务卡
  await evalJs(`document.querySelector('button[title^="点击查看任务卡详情"]')?.click(); 'ok'`)
  await sleep(800)
  const dl = await evalJs(`(document.querySelector('[role="dialog"]')?.innerText) ?? ''`)
  console.log('[2] 详情 Dialog 文本:\n' + dl)
  const ok = dl.includes('结果') && dl.includes('素材库/环境/采集_演示图书馆.md') && dl.includes('完成') && dl.includes('2026-09-03 12:25') && dl.includes('旧图书馆') && dl.includes('校园图书馆')
  console.log(ok ? '[3] PASS: 任务卡详情含回填结果路径/完成时间/关键词' : '[3] FAIL: 详情缺字段')
  if (!ok) process.exitCode = 1
}
// 关 tab
await fetch(CDP + '/json/close/' + tab.id)
ws.close()
