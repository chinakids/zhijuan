// 织卷 · 采集管道端到端复验（UI 层）：无头 Chrome（CDP 9224）+ devShim（demo-aseya）。
// 模拟管道回填全程：① 页面发起采集 → 新任务卡 pending 上栏；② 注入脚本以管道名义改写任务卡(done+结果+完成)+写素材草稿
//    （devShim writeDoc 自动广播 fs 事件 = 真机 chokidar watcher 语义）；③ 断言页面**无需手动刷新**即显示状态流转 done，
//    详情含结果/完成，点「结果」预览素材 markdown 渲染 —— 纯织卷侧验证「App 观察外部回填」闭环，不依赖采集 cron 是否恢复。
// 前置：npm run build 已跑；python3 -m http.server 8123 --directory out/renderer 在跑；Chrome CDP 127.0.0.1:9224 已启动。
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://127.0.0.1:8123'
const ID = 'ce2e' + Date.now()
const DEMAND = 'e2e回填闭环-' + Date.now() + ' 校园老图书馆细节，写实贴国内校园'
const FIN = '2026-09-12 07:45'

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

// [0] 等采集栏渲染 + 注入 writeDoc 记录钩子（拿提交生成的任务卡精确文件名）
let ready = false
for (let i = 0; i < 20; i++) {
  ready = await evalJs(`!!document.querySelector('button[title^="点击查看任务卡详情"]')`)
  if (ready) break
  await sleep(500)
}
check('采集栏已渲染', ready)
await evalJs(`(() => {
  if (!window.__writes) {
    window.__writes = []
    const orig = window.zhijuan.writeDoc
    window.zhijuan.writeDoc = async (id, rel, content) => { window.__writes.push(rel); return orig(id, rel, content) }
  }
  return 'ok'
})()`)

// [1] 发起采集提交（需求唯一避免查重噪音）
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
let seen = false
for (let i = 0; i < 20; i++) {
  seen = await evalJs(`[...document.querySelectorAll('button[title^="点击查看任务卡详情"]')].some((b) => b.innerText.includes('e2e回填闭环'))`)
  if (seen) break
  await sleep(500)
}
check('提交后新任务卡出现在采集栏', seen)
const cardText0 = await evalJs(`[...document.querySelectorAll('button[title^="点击查看任务卡详情"]')].find((b) => b.innerText.includes('e2e回填闭环'))?.innerText ?? ''`)
check('新卡初始为 pending', cardText0.includes('pending') && !cardText0.includes('done'), cardText0.slice(0, 120))

// [2] 模拟管道回填：改写任务卡（done+结果+完成）+ 写素材草稿（app 侧无需动手，靠 fs 事件自动刷新）
const taskRel = await evalJs(`(window.__writes ?? []).filter((r) => r.startsWith('素材库/采集池/任务_')).at(-1)`).catch(() => null)
check('捕获到任务卡路径', typeof taskRel === 'string' && taskRel.endsWith('.md'), String(taskRel))
const base = taskRel.split('/').pop().replace(/^任务_/, '').replace(/\.md$/, '')
const matRel = '素材库/环境/采集_' + base + '.md'
const matText = ['---', '标签: [图书馆, 校园, 环境]', '来源: e2e 模拟回填', '---', '', '# e2e回填素材·老图书馆', '', '> 采集草稿，逐条过目后再升格。', '', '## 可复用的感官细节', '', '- **借书卡**：手写墨迹洇开，卡片边缘被翻得发毛。', '', '## 来源与版权注意', '', '- 仅作写实参考，不直接引用原文。', ''].join('\\n')
await evalJs(`(async () => {
  const rel = ${JSON.stringify(taskRel)}
  const text = await window.zhijuan.readDoc('demo-aseya', rel) ?? ''
  const closeIdx = text.indexOf('\\n---\\n')
  const head = text.slice(0, closeIdx + 1)
  const tail = '\\n' + text.slice(closeIdx + 5)
  const done = head
    .replace('status: pending', 'status: done')
    .slice(0, -1) + '\\n结果: ' + ${JSON.stringify(matRel)} + '\\n完成: ' + ${JSON.stringify(FIN)} + '\\n---' + tail
  await window.zhijuan.writeDoc('demo-aseya', rel, done)
  await window.zhijuan.writeDoc('demo-aseya', ${JSON.stringify(matRel)}, ${JSON.stringify(matText)})
  return 'filled'
})()`)

let flowed = false
for (let i = 0; i < 20; i++) {
  flowed = await evalJs(`[...document.querySelectorAll('button[title^="点击查看任务卡详情"]')].find((b) => b.innerText.includes('e2e回填闭环'))?.innerText.includes('done') ?? false`)
  if (flowed) break
  await sleep(500)
}
const cardText1 = await evalJs(`[...document.querySelectorAll('button[title^="点击查看任务卡详情"]')].find((b) => b.innerText.includes('e2e回填闭环'))?.innerText ?? ''`)
check('回填后卡片状态流转为 done（fs 事件自动刷新）', flowed && cardText1.includes('done'), cardText1.slice(0, 120))
check('done 卡不显示停滞提示', !cardText1.includes('停滞'), cardText1.slice(0, 120))

// [3] 详情：结果路径 / 完成时间 / 需求
await evalJs(`[...document.querySelectorAll('button[title^="点击查看任务卡详情"]')].find((b) => b.innerText.includes('e2e回填闭环'))?.click(); 'ok'`)
await sleep(900)
const dlg = await evalJs(`document.querySelector('[role="dialog"]')?.innerText ?? ''`)
check('详情含结果路径（可点预览）', dlg.includes('结果') && dlg.includes(matRel), dlg.slice(0, 200).replace(/\\n/g, '⏎'))
check('详情含完成时间', dlg.includes('完成') && dlg.includes(FIN), '')
check('详情需求完整', dlg.includes(DEMAND), '')

// [4] 点「结果」→ 详情内预览素材 markdown（只读渲染）
await evalJs(`document.querySelector('button[title^="点击在下方预览素材内容"]')?.click(); 'ok'`)
await sleep(900)
const pv = await evalJs(`document.querySelector('[role="dialog"]')?.innerText ?? ''`)
check('预览渲染素材草稿（标题/细节）', pv.includes('e2e回填素材·老图书馆') && pv.includes('借书卡') && pv.includes('素材预览（只读）'), '')
// [5] 收起预览
await evalJs(`document.querySelector('button[title="收起预览"]')?.click(); 'ok'`)
await sleep(400)
const closed = await evalJs(`!(document.querySelector('[role="dialog"]')?.innerText ?? '').includes('e2e回填素材·老图书馆')`)
check('预览可收起', closed)

await fetch(CDP + '/json/close/' + tab.id)
ws.close()
console.log(bad === 0 ? 'SMOKE ALL PASS' : 'SMOKE FAIL ' + bad)
process.exit(bad === 0 ? 0 : 1)
