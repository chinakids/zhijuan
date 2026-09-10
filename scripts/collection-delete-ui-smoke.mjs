// 采集任务卡「重发 / 删除」UI 冒烟：无头 Chrome（CDP 9224）+ devShim 演示数据（demo-aseya）
// 前置：npm run build 已跑；python3 -m http.server 8123 --directory out/renderer 在跑
// 步骤：开新 tab（缓存破坏）→ 素材库页 → 停滞卡详情（含重发/删除按钮）→ 重发后停滞徽标消失
//       → 删除弹确认（非终态文案）→ 取消不误删 → 确认后卡片从列表消失 → done 卡无重发按钮/终态确认文案
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://127.0.0.1:8123'
const ID = 'del' + Date.now()

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

const CARD = `[...document.querySelectorAll('button')].find((b) => b.title === '点击查看任务卡详情（回填的结果在此）' && b.innerText.includes('雨夜码头'))`
const dlgOf = (txt) => `[...document.querySelectorAll('[role="dialog"]')].find((d) => d.innerText.includes(${JSON.stringify(txt)}))`

// [1] 停滞卡详情：出现「删除该任务」+「重发任务」按钮，且非终态删除按钮可见
await evalJs(`${CARD}?.click(); 'ok'`)
await sleep(800)
const d1 = await evalJs(`(${dlgOf('删除该任务')}?.innerText ?? '')`)
check('详情含重发/删除按钮', d1.includes('重发任务') && d1.includes('删除该任务'), d1.slice(0, 300))

// [2] 点「重发任务」→ 详情关闭 → 列表雨夜码头卡仍在、停滞徽标消失（mtime 已刷新）
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '重发任务')?.click(); 'ok'`)
await sleep(900)
const bar2 = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => b.title === '点击查看任务卡详情（回填的结果在此）')
  return btns.map((b) => b.innerText)
})()`)
check('重发后卡仍在列表且无停滞徽标', bar2.some((t) => t.includes('雨夜码头') && !t.includes('停滞')), JSON.stringify(bar2))

// [3] 删除：详情点删除 → 确认框出现（非终态文案：任务尚未完成/管道不再处理）
await evalJs(`${CARD}?.click(); 'ok'`)
await sleep(800)
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '删除该任务')?.click(); 'ok'`)
await sleep(600)
const d3 = await evalJs(`(${dlgOf('删除任务卡')}?.innerText ?? '')`)
check('确认框文案为非终态（警示管道不再处理）', d3.includes('任务尚未完成') && d3.includes('本机管道将不再处理'), d3.slice(0, 300))

// [4] 取消 → 确认框消失、卡片仍在
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '取消')?.click(); 'ok'`)
await sleep(600)
const bar4 = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => b.title === '点击查看任务卡详情（回填的结果在此）')
  return { texts: btns.map((b) => b.innerText), dialogs: document.querySelectorAll('[role="dialog"]').length }
})()`)
check('取消后卡仍在、无确认框残留', bar4.texts.some((t) => t.includes('雨夜码头')) && bar4.dialogs === 0, JSON.stringify(bar4))

// [5] 再次删除并确认 → 卡片从列表消失（列表只剩已完成的图书馆卡）
await evalJs(`${CARD}?.click(); 'ok'`)
await sleep(700)
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '删除该任务')?.click(); 'ok'`)
await sleep(500)
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '删除')?.click(); 'ok'`)
await sleep(1000)
const bar5 = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => b.title === '点击查看任务卡详情（回填的结果在此）')
  return btns.map((b) => b.innerText)
})()`)
check('确认删除后卡片消失、只剩图书馆卡', !bar5.some((t) => t.includes('雨夜码头')) && bar5.some((t) => t.includes('校园图书馆')), JSON.stringify(bar5))

// [6] done 卡详情：无「重发任务」按钮；点删除 → 确认文案为终态提示
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.title === '点击查看任务卡详情（回填的结果在此）' && b.innerText.includes('校园图书馆'))?.click(); 'ok'`)
await sleep(700)
const d6a = await evalJs(`(${dlgOf('删除该任务')}?.innerText ?? '')`)
check('done 卡无重发按钮', !d6a.includes('重发任务'), d6a.slice(0, 200))
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '删除该任务')?.click(); 'ok'`)
await sleep(500)
const d6b = await evalJs(`(${dlgOf('删除任务卡')}?.innerText ?? '')`)
check('done 卡确认文案为已终态（无警示）', d6b.includes('已终态') && !d6b.includes('尚未完成'), d6b.slice(0, 250))
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '取消')?.click(); 'ok'`)
await sleep(300)

await fetch(CDP + '/json/close/' + tab.id)
ws.close()
console.log(bad ? 'SMOKE FAIL ' + bad : 'SMOKE ALL PASS')
process.exit(bad ? 1 : 0)
