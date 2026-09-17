// 织卷无头冒烟 · 正文写入后切片同步 · 剩余两入口（批注提案接受 / 历史版本恢复）补链验收
// 用法：node scripts/anno-history-sync-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123（或 scripts/serve-renderer.mjs）；无头 Chrome CDP 127.0.0.1:9224
// 场景A（新 tab）：设置开「批注定时优化」→ 回项目 10s 自动首扫生成批注提案 → 顶栏「待确认提案」→ 抽屉「接受」
//   → 断言 window.__ZJ_SYNCS 记录 agentSync(demo-aseya|正文/第01章_雾港.md) + toast「切片同步」+ 提案 accepted
// 场景B（新 tab，独立内存/独立节流门）：writeDoc 造两版历史 → 选章 → 「历史」→ 选旧版 v1 → 恢复（二次确认）
//   → 断言 __ZJ_SYNCS 记录同步调用 + 抽屉「切片同步无设定变化」+ 正文内容确实恢复为旧版
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
        cmd,
        errors,
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
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(250)
  }
}
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const clickBtn = (text, exact = true) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!el) return false
  el.click()
  return true
})()`

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')) }
}

/* ================= 场景 A：批注提案接受 → 切片同步 ================= */
console.log('--- 场景A 批注提案接受 → 切片同步 ---')
const tabA = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/settings')
const pageA = await attach(tabA.webSocketDebuggerUrl)
try {
  await evalUntil(pageA, bodyHas('外观与数据'), Boolean, 20000, '设置页加载')
  await pageA.eval(clickBtn('外观与数据', false))
  await evalUntil(pageA, bodyHas('批注定时优化'), Boolean, 10000, '外观节批注开关')
  await pageA.eval(`(() => {
    const rows = [...document.querySelectorAll('div')].filter((d) => d.textContent && d.textContent.includes('批注定时优化') && d.querySelector('button[role="switch"]'))
    const row = rows[rows.length - 1]
    const s = row && row.querySelector('button[role="switch"]')
    if (!s) return 'NO_SWITCH'
    if (s.getAttribute('aria-checked') !== 'true') s.click()
    return 'OK'
  })()`)
  await pageA.eval(clickBtn('保存设置'))
  await sleep(700)
  await pageA.eval(`(() => { location.hash = '#/project/demo-aseya/novel'; return 1 })()`)
  await evalUntil(pageA, bodyHas('第1章'), Boolean, 20000, '正文载入')
  // 打开项目 10s 后自动首扫 → 生成批注提案
  await evalUntil(
    pageA,
    `window.zhijuan.listProposals('demo-aseya').then((ps) => ps.filter((p) => p.source === 'annotation-sync' && p.status === 'pending').length)`,
    (v) => Number(v) >= 1,
    30000,
    '自动扫描生成批注提案'
  )
  await evalUntil(pageA, bodyHas('待确认提案'), Boolean, 10000, '顶栏提案入口')
  ok('A① 生成批注提案且顶栏出现入口', true)
  await pageA.eval(clickBtn('待确认提案', false))
  await evalUntil(pageA, bodyHas('接受'), Boolean, 10000, '抽屉接受按钮')
  await pageA.eval(clickBtn('接受', true))
  // 接受后：正文被改写 → 应触发切片同步（devShim agentSync 记录）
  await evalUntil(
    pageA,
    `Array.isArray(window.__ZJ_SYNCS) && window.__ZJ_SYNCS.includes('demo-aseya|正文/第01章_雾港.md')`,
    Boolean,
    20000,
    '批注接受触发切片同步'
  )
  ok('A② 接受批注提案后 agentSync 被调用（正文/第01章_雾港.md）', true)
  const toastSeen = await pageA.eval(`document.body.innerText.includes('切片同步') && document.body.innerText.includes('正文已改写')`)
  ok('A③ 切片同步结果 toast 出现（正文已改写…无设定变化）', toastSeen === true)
  const accepted = await pageA.eval(`window.zhijuan.listProposals('demo-aseya').then((ps) => ps.some((p) => p.source === 'annotation-sync' && p.status === 'accepted'))`)
  ok('A④ 提案状态转为 accepted', accepted === true)
} finally {
  pageA.close()
}

/* ================= 场景 B：历史版本恢复 → 切片同步 ================= */
console.log('--- 场景B 历史版本恢复 → 切片同步 ---')
const tabB = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
const pageB = await attach(tabB.webSocketDebuggerUrl)
try {
  await evalUntil(pageB, bodyHas('第1章'), Boolean, 20000, '正文载入')
  // 造两版历史：writeDoc 内容变化时旧内容入史（devShim 与真机 isVersionedRel 同口径）
  const orig = await pageB.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md').then((r) => r ?? '')`)
  if (!orig || !orig.includes('阿七靠着候船厅的柱子')) throw new Error('种子文档未就绪')
  await pageB.eval(`window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', ${JSON.stringify(orig + '\n\n<!-- 修改一 -->')})`)
  await sleep(300)
  await pageB.eval(`window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', ${JSON.stringify(orig + '\n\n<!-- 修改一 -->\n\n<!-- 修改二 -->')})`)
  await sleep(400)
  // 选章（Novel 页默认不挂编辑器）→ 打开版本历史抽屉
  await pageB.eval(clickBtn('第1章', false))
  await evalUntil(pageB, bodyHas('历史'), Boolean, 20000, '编辑器底栏出现')
  await pageB.eval(clickBtn('历史', true))
  await evalUntil(pageB, bodyHas('共 2 版'), Boolean, 15000, '历史抽屉两版')
  ok('B① 制造两版历史并打开抽屉', true)
  // 选最老一版（v1）→ 恢复（两次点击确认）
  await pageB.eval(clickBtn('v1 ', false))
  await sleep(400)
  await pageB.eval(clickBtn('恢复此版本', true))
  await sleep(300)
  await pageB.eval(clickBtn('再次点击确认恢复', true))
  // 恢复后：正文回退 → 应触发切片同步 + 抽屉提示；且 readDoc 确实回到旧版
  await evalUntil(
    pageB,
    `Array.isArray(window.__ZJ_SYNCS) && window.__ZJ_SYNCS.includes('demo-aseya|正文/第01章_雾港.md')`,
    Boolean,
    20000,
    '恢复触发切片同步'
  )
  ok('B② 恢复旧版后 agentSync 被调用（正文/第01章_雾港.md）', true)
  await evalUntil(pageB, bodyHas('切片同步无设定变化'), Boolean, 20000, '恢复后同步提示')
  ok('B③ 抽屉显示「✓ 已恢复；切片同步无设定变化」', true)
  const after = await pageB.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md').then((r) => r ?? '')`)
  ok('B④ 正文内容确实恢复为旧版原文', after === orig, 'len=' + after.length + ' vs ' + orig.length)
  // 非正文 rel（大纲审读）应被 isChapterTarget 挡住：写审读报告再恢复不触发同步
  const beforeOther = await pageB.eval(`Array.isArray(window.__ZJ_SYNCS) ? window.__ZJ_SYNCS.length : 0`)
  await pageB.eval(`window.zhijuan.writeDoc('demo-aseya', '大纲/审读_全卷.md', '审读报告v1')`)
  await sleep(300)
  await pageB.eval(`window.zhijuan.writeDoc('demo-aseya', '大纲/审读_全卷.md', '审读报告v2（内容变化）')`)
  await sleep(300)
  const afterOther = await pageB.eval(`Array.isArray(window.__ZJ_SYNCS) ? window.__ZJ_SYNCS.length : 0`)
  ok('B⑤ 仅 writeDoc 写大纲审读不触发同步（无 UI 恢复动作，收口拦截）', afterOther === beforeOther, `${beforeOther} -> ${afterOther}`)
} finally {
  pageB.close()
}

const errAll = [...pageA.errors, ...pageB.errors]
if (errAll.length) { fail++; console.log('FAIL 无 JS 异常: ' + errAll.slice(0, 3).join(' | ')) }
else { pass++; console.log('PASS 无 JS 异常') }
console.log('RESULT: ' + pass + ' PASS / ' + fail + ' FAIL')
if (fail > 0) process.exit(1)
console.log('ALL PASS')
