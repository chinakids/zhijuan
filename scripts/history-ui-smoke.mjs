// 织卷无头冒烟 · 正文版本历史 UI（M3）
// 用法：node scripts/history-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收：① 编辑器底部「历史」入口存在；② 保存两个版本后抽屉列出 ≥2 版；
//       ③ 默认选中最新版并渲染行级 diff（− + 行存在）；④ 两击「恢复此版本」→ 正文回旧版且历史新增一版；
//       ⑤ writeDoc 模拟 fs:event 广播（观察项①）；⑥ 恢复后编辑器经 extVersion 静默重载为恢复内容；⑦ 无 JS 异常。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const REL = '正文/第01章_雾港.md'
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
        cmd, errors,
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
    await sleep(300)
  }
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

// 等编辑器就绪
await evalUntil(page, `(() => { const el = document.querySelector('.ProseMirror'); return el && el.textContent.length > 10 })()`, (x) => x === true, 25000, 'ProseMirror 带正文')

// ① 历史入口按钮
const hasEntry = await page.eval(`(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '历史'))()`)
ok('编辑器底部有「历史」入口', hasEntry === true, String(hasEntry))

// fs 事件链路（观察项①）：挂监听收集，writeDoc 后应与真机 watcher（主进程→fs:event→useFsEvents→extVersion）同语义广播
await page.eval(`(() => { window.__FS = []; window.zhijuan.onFsEvent((e) => window.__FS.push(e)); return true })()`)

// 造两个版本：v1 = 原文追加一段；v2 = v1 再追加一段（mock 依据「内容变化才快照」留档 v1、v2）
const makeVersions = await page.eval(`(async () => {
  const id = 'demo-aseya'
  const base = (await window.zhijuan.readDoc(id, ${JSON.stringify(REL)})) || ''
  const v1 = base + '\\n\\n冒烟：第一版新增的句子。——'
  const v2 = v1 + '\\n冒烟：第二版新增的句子。——'
  await window.zhijuan.writeDoc(id, ${JSON.stringify(REL)}, v1)
  await window.zhijuan.writeDoc(id, ${JSON.stringify(REL)}, v2)
  return { v1, v2, base }
})()`)
console.log('versions built, v1 len =', makeVersions.v1.length)

// ⑤ writeDoc 应模拟出与真机同语义的 fs 事件（观察项①：devShim 补事件模拟后，此链路可无头验证）
const fsEvents = await page.eval(`(() => window.__FS)()`)
const fsHit = fsEvents.find((e) => e.projectId === 'demo-aseya' && e.kind === 'change' && e.path === REL)
const fsPaths = fsEvents.map((e) => e.path)
ok('writeDoc 广播 fs:event（change/相对路径）', !!fsHit && fsPaths.filter((p) => p === REL).length >= 2, JSON.stringify(fsEvents.slice(-2)))

// 打开历史抽屉
await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '历史'); if (b) b.click(); return !!b })()`)
await evalUntil(page, `document.body.innerText.includes('版本历史') && document.body.innerText.includes('共 ')`, (x) => x === true, 15000, '抽屉打开且有版本列表')
// ② 版本数 ≥ 2（写 v1/v2 → 快照 2 版）
const listState = await page.eval(`(() => {
  const t = document.body.innerText
  const m = t.match(/共 (\\d+) 版/)
  return m ? Number(m[1]) : -1
})()`)
ok('版本列表 ≥ 2', listState >= 2, 'count=' + listState)

// ③ 默认选中最新版本，diff 渲染（del/ins 配色行）
await evalUntil(page, `document.querySelectorAll('[class*="bg-danger-soft"]').length > 0`, (x) => x === true, 15000, 'diff 有删除行')
const diffState = await page.eval(`(() => ({
  del: document.querySelectorAll('[class*="bg-danger-soft"]').length,
  ins: document.querySelectorAll('[class*="bg-accent-soft"]').length,
  hasVersions: document.body.innerText.includes('对比：')
}))()`)
ok('diff 渲染出 − 行', diffState.del > 0, JSON.stringify(diffState))
ok('diff 渲染出 + 行', diffState.ins > 0, JSON.stringify(diffState))

// ④ 两击恢复：第一次点击变确认文案，第二次真正恢复
const clickRestore = await page.eval(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('恢复此版本'))
  if (btn) { btn.click(); return true }
  return false
})()`)
ok('找到「恢复此版本」按钮', clickRestore === true)
const confirmShown = await evalUntil(page, `document.body.innerText.includes('再次点击确认恢复')`, (x) => x === true, 5000, '两击确认态')
ok('第一击出现确认文案', confirmShown === true)
await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('再次点击确认恢复')); if (b) b.click(); return !!b })()`)
await evalUntil(page, `document.body.innerText.includes('已恢复')`, (x) => x === true, 15000, '恢复成功提示')

// 恢复后：readDoc 应等于 v1（第二次写入前的内容），且历史新增（共 3 版）
const after = await page.eval(`(async () => {
  const id = 'demo-aseya'
  const cur = await window.zhijuan.readDoc(id, ${JSON.stringify(REL)})
  const t = document.body.innerText
  const m = t.match(/共 (\\d+) 版/)
  return { sameAsV1: cur === ${JSON.stringify(makeVersions.v1)}, count: m ? Number(m[1]) : -1 }
})()`)
ok('恢复后正文 = v1', after.sameAsV1 === true, JSON.stringify(after))
ok('恢复后历史新增一版（≥3）', after.count >= 3, 'count=' + after.count)

// ⑥ 观察项①落点：恢复后编辑器应经 extVersion 静默重载为恢复内容（无 fs 事件模拟时编辑器会停留在旧态）
const reloaded = await evalUntil(
  page,
  `(document.querySelector('.ProseMirror') || { textContent: '' }).textContent`,
  (t) => typeof t === 'string' && t.includes('冒烟：第一版新增的句子'),
  20000,
  '编辑器静默重载出恢复内容'
)
ok('恢复后编辑器静默重载为 v1（fs→extVersion）', reloaded.includes('冒烟：第一版新增的句子') && !reloaded.includes('冒烟：第二版新增的句子'), 'len=' + reloaded.length)

// 截图存档（给主人看界面）
const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
const fs = await import('fs')
fs.writeFileSync('/tmp/history-ui-diff.png', Buffer.from(shot.data, 'base64'))
console.log('SCREENSHOT: /tmp/history-ui-diff.png')

console.log('JS errors:', JSON.stringify(page.errors))
ok('无 JS 异常', page.errors.length === 0, page.errors.join(' | ').slice(0, 300))

page.close()
console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL: ' + fails)
process.exit(fails === 0 ? 0 : 1)
