// 写作习惯学习 · devShim 同口径无头冒烟（增量 4c，2026-09-22 智能层）
// 验证：devShim 的 insightsRun/insightsStatus/draftsList/draftPromote/draftDelete 五方法在页面可直接用
//       （体验层草稿区 UI/设置开关落地前的数据面契约）+ 全程零 JS 异常。
// 用法：cd ~/Desktop/织卷 && npm run build && node scripts/serve-renderer.mjs 8899 & 然后：
//       node scripts/devshim-insights-smoke.mjs
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8899'
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

let pass = 0
const fail = (name, e) => {
  console.error('  ✗ 断言失败: ' + name + (e ? ' :: ' + e.message : ''))
  process.exit(1)
}
const assert = (name, cond) => {
  if (!cond) fail(name)
  pass++
  console.log('  ✓ ' + name)
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya')
const c = await attach(tab.webSocketDebuggerUrl)
await c.cmd('Runtime.enable')
const errors = []
c._onMsg = (m) => {
  if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + JSON.stringify(m.params?.exceptionDetails?.exception?.description ?? m.params).slice(0, 200))
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push('console.error: ' + m.params?.args?.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
}
// 覆盖 onmessage 收集（在 attach 内部 pending 之外补充收集通道）
const rawWs = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise((r) => { rawWs.onopen = r })
rawWs.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + JSON.stringify(m.params?.exceptionDetails?.exception?.description ?? m.params).slice(0, 200))
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push('console.error: ' + JSON.stringify(m.params?.args ?? []).slice(0, 200))
}
const j = (s) => JSON.stringify(s)

await sleep(2500) // 等 devShim 挂载 + 演示项目数据就绪
assert('devShim 已挂载', (await c.eval('window.__ZJ_TEST === true')) === true)

const d0 = await c.eval('window.zhijuan.draftsList()')
assert('draftsList 种子 2 条（草稿+报告）', Array.isArray(d0) && d0.length === 2 && d0.some((x) => x.kind === 'draft') && d0.some((x) => x.kind === 'report'))

const st = await c.eval('window.zhijuan.insightsStatus("demo-aseya")')
assert('insightsStatus 非空且 lastRunAt>0', !!st && typeof st.lastRunAt === 'number' && st.lastRunAt > 0)

const pf = await c.eval('window.zhijuan.draftPromote("2026-09-22-写作习惯.md")')
assert('draftPromote 成功', pf && pf.ok === true)
const d1 = await c.eval('window.zhijuan.draftsList()')
assert('转正后草稿区剩报告 1 条', Array.isArray(d1) && d1.length === 1 && d1[0].kind === 'report')
const sk = await c.eval('window.zhijuan.listSkills()')
assert('转正技能进入清单', Array.isArray(sk) && sk.some((s) => s.name === 'writing-habits'))
const del = await c.eval('window.zhijuan.draftDelete("2026-09-22-写作习惯-报告.md")')
assert('draftDelete 成功', del && del.ok === true)
const d2 = await c.eval('window.zhijuan.draftsList()')
assert('删除后草稿区空', Array.isArray(d2) && d2.length === 0)
const run = await c.eval('window.zhijuan.insightsRun("demo-aseya")')
assert('insightsRun 幂等再生成（draftFile 含 _drafts）', run && run.ok === true && String(run.draftFile).includes('_drafts'))
const d3 = await c.eval('window.zhijuan.draftsList()')
assert('insightsRun 后草稿区恢复 2 条', Array.isArray(d3) && d3.length === 2)

await sleep(500)
rawWs.close()
c.close()
if (errors.length) fail('全程零 JS 异常', new Error(errors[0]))
else console.log('  ✓ 全程零 JS 异常')

console.log(`\n=== devshim-insights-smoke: ${pass} 断言全过 ===`)
