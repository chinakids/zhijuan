// 织卷 · devShim.searchDocs 口径冒烟：验证 dev 垫片与真机 main/library.searchDocs 同口径
// 背景：2026-09-12 平台层轮次修复 devShim 缺 limit 实现（真机有默认 50）+ snippet 起点取最早 term（min 口径）。
// 断言：① limit 生效（≤N 且与全量前 N 一致）；② 默认 limit=50 同真机；③ excludePrefix 排除采集池；
//       ④ 空 query 返回 []；⑤ snippet 与真机 snippetOf 算法逐字一致；⑥ 多词 AND 语义。
// 用法：cd ~/Desktop/织卷 && node scripts/devshim-search-smoke.mjs
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://127.0.0.1:8899'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let fails = 0
const check = (name, cond) => {
  console.log((cond ? '[PASS] ' : '[FAIL] ') + name)
  if (!cond) fails++
}

const tab = await (
  await fetch(CDP + '/json/new?' + encodeURIComponent(BASE + '/?cb=devsearch' + Date.now() + '#/project/demo-aseya'), { method: 'PUT' })
).json()
const ws = new WebSocket(tab.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
await new Promise((r) => (ws.onopen = r))

async function evl(expr) {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails))
  return r.result?.value
}

// 等 devShim 就绪（缓存破坏参数已带）
let ready = false
for (let i = 0; i < 40; i++) {
  try {
    if (await evl('!!(window.zhijuan && window.__ZJ_TEST)')) { ready = true; break }
  } catch {}
  await sleep(500)
}
check('devShim 就绪（window.zhijuan + __ZJ_TEST）', ready)
if (!ready) { console.log('FAIL: 页面未就绪'); process.exit(1) }

// 探测：全量候选词，选 ≥3 个命中的词做 limit 断言
const probe = await evl(
  `(async () => {
    const ids = ['demo-aseya']
    const words = ['灯', '图书馆', '演示', '雾', '桥', '海']
    const out = []
    for (const w of words) {
      const r = await window.zhijuan.searchDocs('demo-aseya', '素材库', w)
      out.push({ w, n: r.length })
    }
    return out
  })()`
)
console.log('探测：', JSON.stringify(probe))
const pick = (probe.find((p) => p.n >= 3) ?? probe.find((p) => p.n >= 2) ?? probe[0])
check('有可用查询词（>=2 命中）', pick.n >= 2)

// ① limit 生效：≤N 且为全量前 N
const lim2 = await evl(`window.zhijuan.searchDocs('demo-aseya','素材库','${pick.w}',{limit:2})`)
check(`limit:2 返回 ≤2（实际 ${lim2.length}）`, lim2.length <= 2)
const full = await evl(`window.zhijuan.searchDocs('demo-aseya','素材库','${pick.w}')`)
check(`未传 limit 返回全量（${full.length}）`, full.length >= 2)
if (full.length >= 2) {
  check('limit:2 结果 = 全量前 2 条（顺序一致）', JSON.stringify(lim2) === JSON.stringify(full.slice(0, 2)))
}
const lim1 = await evl(`window.zhijuan.searchDocs('demo-aseya','素材库','${pick.w}',{limit:1})`)
check('limit:1 返回 ≤1', lim1.length <= 1)

// ② 默认 limit=50（同真机）：显式传 50 与不传一致
const lim50 = await evl(`window.zhijuan.searchDocs('demo-aseya','素材库','${pick.w}',{limit:50})`)
check('默认 limit=50 与显式 50 一致', JSON.stringify(lim50) === JSON.stringify(full))

// ③ excludePrefix 排除采集池
const excl = await evl(
  `window.zhijuan.searchDocs('demo-aseya','素材库','演示',{excludePrefix:['素材库/采集池/']})`
)
check('excludePrefix 排除采集池（无 任务_* 卡）', Array.isArray(excl) && excl.every((h) => !h.file.startsWith('素材库/采集池/')))

// ④ 空 query
const empty = await evl(`window.zhijuan.searchDocs('demo-aseya','素材库','  ')`)
check('空 query 返回 []', Array.isArray(empty) && empty.length === 0)

// ⑤ snippet 与真机 snippetOf 算法逐字一致（取一个内容命中项，用 readDoc 原文重算）
const snip = await evl(
  `(async () => {
    const q = '${pick.w}'
    const hi = (await window.zhijuan.searchDocs('demo-aseya','素材库',q)).find(h => h.field === 'content')
    if (!hi) return { ok: false, reason: '无内容命中' }
    const text = (await window.zhijuan.readDoc('demo-aseya', hi.file)) ?? ''
    const lower = text.toLowerCase()
    const terms = q.split(/\\s+/).map(t => t.toLowerCase()).filter(Boolean)
    let idx = -1
    for (const t of terms) { const i = lower.indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i }
    const start = text.lastIndexOf('\\n', idx) + 1
    let end = text.indexOf('\\n', idx)
    if (end < 0) end = text.length
    const line = text.slice(start, end).trim()
    const expect = line.length > 80 ? line.slice(0, 80) + '…' : line
    return { ok: expect === hi.snippet, got: hi.snippet, expect }
  })()`
)
check('内容命中 snippet = 真机 snippetOf 算法结果（最早 term 起）', snip.ok === true)

// ⑥ 多词 AND：两个词都命中才出
const andR = await evl(`window.zhijuan.searchDocs('demo-aseya','素材库','${pick.w} ${pick.w === '演示' ? '图书馆' : '演示'}')`)
check('多词 AND 返回数 ≤ 单词返回数', andR.length <= full.length)

ws.close()
await fetch(CDP + '/json/close/' + tab.id)
console.log(fails === 0 ? 'ALL PASS' : `FAILED: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
