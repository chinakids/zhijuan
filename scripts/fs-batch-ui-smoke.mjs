// 织卷 · fs 事件「只看最后一条」竞态修复验证（UI 层）：无头 Chrome（CDP 9224）+ devShim（demo-aseya）。
// 场景：同 tick 连续两次写盘（人物/ + 素材库/环境/），旧代码 events[events.length-1] 只看到末条（人物/，非素材库前缀）
//       → 素材库页列表不刷新（与 CollectionBar 18dda8c 同类竞态）；新 useFsChanged 原语检查批内全部新事件 → 列表刷新。
// 前置：npm run build 已跑；serve-renderer（8123）在跑；Chrome CDP 127.0.0.1:9224 已启动。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8123'
const ID = 'fsb' + Date.now()
const TS = Date.now()

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

// [0] 等类别树渲染
let ready = false
for (let i = 0; i < 20; i++) {
  ready = await evalJs(`!!document.querySelector('[data-zj-libtree]') && document.body.innerText.includes('素材库')`)
  if (ready) break
  await sleep(500)
}
check('素材库页已渲染', ready)

// [1] 点「环境」类别（其下已有 采集_演示图书馆.md）
const clicked = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('[data-zj-libtree] button')]
  const b = btns.find((x) => x.innerText.includes('环境'))
  if (!b) return 'no-cat'
  b.click()
  return 'ok:' + b.innerText.replace(/\\n/g, '/')
})()`)
check('点选「环境」类别', clicked.startsWith('ok:'), String(clicked))

// [2] 等右列素材列表出现既有素材
let shown = false
for (let i = 0; i < 20; i++) {
  shown = await evalJs(`document.body.innerText.includes('采集_演示图书馆')`)
  if (shown) break
  await sleep(500)
}
check('环境类别素材列表已显示', shown)

// 基线：环境类别计数
const count0 = await evalJs(`(() => {
  const b = [...document.querySelectorAll('[data-zj-libtree] button')].find((x) => x.innerText.includes('环境'))
  const m = (b?.innerText ?? '').match(/(\\d+)/)
  return m ? Number(m[1]) : -1
})()`)
check('基线计数可读', count0 >= 0, String(count0))

// [3] 同 tick 连续两次写盘（素材库/ 在前、人物/ 在后——旧实现只看末条（人物/）必漏）→ 素材库页必须自动刷新出现新素材
const matRel = '素材库/环境/冒烟fs_' + TS + '.md'
const matText = ['---', '标签: [环境, 冒烟]', '---', '', '# 冒烟fs 素材·' + TS, '', '> fs 批量事件竞态验证素材。', ''].join('\\n')
const wrote = await evalJs(`(async () => {
  const p1 = window.zhijuan.writeDoc('demo-aseya', ${JSON.stringify(matRel)}, ${JSON.stringify(matText)})
  const p2 = window.zhijuan.writeDoc('demo-aseya', '人物/冒烟fs_' + ${TS} + '.md', '# 冒烟临时人物\\n')
  await Promise.all([p1, p2])
  return 'wrote'
})()`)
check('批量写盘完成', wrote === 'wrote', String(wrote))

let appeared = false
for (let i = 0; i < 20; i++) {
  appeared = await evalJs(`document.body.innerText.includes('冒烟fs_${TS}')`)
  if (appeared) break
  await sleep(500)
}
check('混合前缀批量事件后素材库自动刷新（新素材出现）', appeared)

const count1 = await evalJs(`(() => {
  const b = [...document.querySelectorAll('[data-zj-libtree] button')].find((x) => x.innerText.includes('环境'))
  const m = (b?.innerText ?? '').match(/(\\d+)/)
  return m ? Number(m[1]) : -1
})()`)
check('类别计数 +1（refresh 真实执行）', count1 === count0 + 1, count0 + ' → ' + count1)

// [4] 清理：删除临时素材与人物，避免污染后续冒烟
await evalJs(`(async () => {
  await window.zhijuan.deleteDoc('demo-aseya', ${JSON.stringify(matRel)}).catch(() => null)
  await window.zhijuan.deleteDoc('demo-aseya', '人物/冒烟fs_' + ${TS} + '.md').catch(() => null)
  return 'cleaned'
})()`)

await fetch(CDP + '/json/close/' + tab.id)
ws.close()
console.log(bad === 0 ? 'SMOKE ALL PASS' : 'SMOKE FAIL ' + bad)
process.exit(bad === 0 ? 0 : 1)
