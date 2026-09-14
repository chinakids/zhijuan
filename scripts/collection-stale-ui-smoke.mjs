// 采集任务卡「停滞提示 + 提交查重」UI 冒烟：无头 Chrome（CDP 9224）+ devShim 演示数据（demo-aseya）
// 前置：npm run build 已跑；node scripts/serve-renderer.mjs 8123 在跑
// 步骤：开新 tab（缓存破坏）→ hash 导航 项目/素材库 → 断言列表出现「停滞 3 天」徽标（演示停滞卡）
//       → 点卡片 → 详情出现「任务已停滞 3 天」提示 → 关闭 → 发起采集：输入相同需求出现查重警告、改文本警告消失
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8123'
const ID = 'stale' + Date.now()

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

// [1] 顶部采集栏：演示停滞卡出现「停滞 3 天」徽标 + 摘要「雨夜码头」；已完成的图书馆卡不出现停滞徽标
const bar = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => b.title === '点击查看任务卡详情（回填的结果在此）')
  const txts = btns.map((b) => b.innerText)
  return txts
})()`)
check('采集栏含停滞卡（摘要+停滞3天徽标）', bar.some((t) => t.includes('雨夜码头') && t.includes('停滞 3 天')), JSON.stringify(bar))
check('完成卡不带停滞徽标', bar.some((t) => t.includes('校园图书馆') && !t.includes('停滞')), JSON.stringify(bar))

// [2] 点停滞卡 → 详情出现「任务已停滞 3 天」提示
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.title === '点击查看任务卡详情（回填的结果在此）' && b.innerText.includes('雨夜码头'))?.click(); 'ok'`)
await sleep(800)
const dlg = await evalJs(`document.querySelector('[role="dialog"]')?.innerText ?? ''`)
check('详情出现停滞提示', dlg.includes('任务已停滞 3 天') && dlg.includes('本机管道似乎未处理该卡'), dlg.slice(0, 200))

// [3] 关闭详情 → 发起采集：相同需求 → 查重警告；改文本 → 警告消失
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '关闭')?.click(); 'ok'`)
await sleep(500)
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('发起采集'))?.click(); 'ok'`)
await sleep(600)
await evalJs(`(() => {
  const ta = document.querySelector('[role="dialog"] textarea')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '雨夜的码头描写，要能闻到咸腥味和柴油味')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`)
await sleep(500)
const warn1 = await evalJs(`document.querySelector('[role="dialog"]')?.innerText ?? ''`)
check('相同需求出现查重警告', warn1.includes('已有进行中的需求相同任务') && warn1.includes('任务：雨夜码头'), warn1.slice(0, 300))
await evalJs(`(() => {
  const ta = document.querySelector('[role="dialog"] textarea')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '另一条完全不同的需求：街边小吃摊的油烟味')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`)
await sleep(500)
const warn2 = await evalJs(`document.querySelector('[role="dialog"]')?.innerText ?? ''`)
check('改文本后警告消失', !warn2.includes('已有进行中的需求相同任务'), warn2.slice(0, 200))

// [4] 提交按钮仍可用（查重不阻止、只提示）
const btnOk = await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.includes('提交任务'))?.disabled ?? true`)
check('查重警告下提交按钮未被禁用', btnOk === false, String(btnOk))

await fetch(CDP + '/json/close/' + tab.id)
ws.close()
console.log(bad ? 'SMOKE FAIL ' + bad : 'SMOKE ALL PASS')
process.exit(bad ? 1 : 0)
