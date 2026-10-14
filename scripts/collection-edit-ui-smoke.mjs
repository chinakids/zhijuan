// 采集任务卡「编辑并重发」UI 冒烟：无头 Chrome（CDP 9224）+ devShim 演示数据（demo-aseya）
// 覆盖：done 卡详情 → 编辑并重发 → 编辑对话框预填现卡字段 → 改需求后保存 → 卡重置为待处理（无结果/完成）
//       → 重开详情显示新需求 + 状态 pending；取消不改字段且回详情；需求空则保存禁用。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8123'
const ID = 'edit' + Date.now()

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

const dlgOf = (txt) => `[...document.querySelectorAll('[role="dialog"]')].find((d) => d.innerText.includes(${JSON.stringify(txt)}))`
const LIB = `[...document.querySelectorAll('button')].find((b) => b.title === '点击查看任务卡详情（回填的结果在此）' && b.innerText.includes('校园图书馆'))`

// 设 React 受控 textarea 的值（value 直接嵌入表达式，避免双引号嵌套）
const setTextarea = (sel, val) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)})
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  set.call(el, ${JSON.stringify(val)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return el.value
})()`

// [1] done 卡详情 → 编辑并重发 → 编辑对话框预填现卡需求
await evalJs(`${LIB}?.click(); 'ok'`)
await sleep(800)
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '编辑并重发')?.click(); 'ok'`)
await sleep(700)
const ed1 = await evalJs(`(${dlgOf('编辑并重发')}?.innerText ?? '')`)
const edVal = await evalJs(`document.querySelector('#edit-demand')?.value ?? ''`)
check('编辑对话框出现并预填现卡需求', ed1.includes('编辑并重发') && edVal.includes('校园图书馆的感官细节'), 'title滴:' + ed1.slice(0, 80) + ' | value:' + edVal.slice(0, 60))

// [2] 需求清空 → 保存按钮禁用
await evalJs(`${setTextarea('#edit-demand', '')}`)
await sleep(300)
const saveDisabled = await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '保存并重发')?.disabled`)
check('需求为空时保存禁用', saveDisabled === true, String(saveDisabled))

// [3] 改需求并保存 → 卡重置为待处理
const NEWDEMAND = '九十年代县城图书馆的旧细节——木质书架、借书卡、靠窗的旧阅览室'
await evalJs(setTextarea('#edit-demand', NEWDEMAND))
await sleep(300)
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '保存并重发')?.click(); 'ok'`)
await sleep(1000)

// [4] 重开该卡详情：显示新需求、状态 pending、无「完成」行
await evalJs(`${LIB}?.click(); 'ok'`)
await sleep(800)
const d4 = await evalJs(`(${dlgOf('删除该任务')}?.innerText ?? '')`)
check('保存后详情显示新需求', d4.includes(NEWDEMAND), d4.slice(0, 250))
check('保存后状态为待处理且无完成行', d4.includes('pending') && !d4.includes('完成'), d4.slice(0, 250))

// [5] 取消不改字段：再进编辑 → 改需求 → 取消 → 回详情，需求保持新值（未回退也未再写）
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '编辑并重发')?.click(); 'ok'`)
await sleep(700)
await evalJs(setTextarea('#edit-demand', '改到一半不存'))
await sleep(300)
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '取消')?.click(); 'ok'`)
await sleep(700)
const d5 = await evalJs(`(${dlgOf('删除该任务')}?.innerText ?? '')`)
check('取消后回详情且未写入新文本', d5.includes(NEWDEMAND) && !d5.includes('改到一半不存'), d5.slice(0, 250))

await fetch(CDP + '/json/close/' + tab.id)
ws.close()
console.log(bad ? 'SMOKE FAIL ' + bad : 'SMOKE ALL PASS')
process.exit(bad ? 1 : 0)
