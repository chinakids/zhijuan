// 织卷无头冒烟 · 审读存档版本化二期：大纲区「审读存档」条目旁「历史」按钮 → HistoryDrawer 复用
// 用法：node scripts/audit-history-entry-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收：① 无审读报告时大纲区无「审读存档」区；② writeDoc 重跑两版（旧内容留档 1 版）后区出现；
//       ③ 条目旁有「历史」按钮且点击弹出 HistoryDrawer（版本历史/共 1 版/相对路径头/diff + 行）；
//       ④ 点条目本身仍走原文打开（回归）；⑤ 抽屉内两击「恢复此版本」→ 报告回旧版、历史新增一版；
//       ⑥ 无 JS 异常；⑦ 截图存档 ~/Pictures/zhijuan/。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const ID = 'demo-aseya'
const REL = '大纲/审读_一致性巡查.md'
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
async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
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

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/' + ID + '/outline')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

try {
  await evalUntil(page, `document.body.innerText.includes('章卡索引')`, (v) => v === true, 20000, '大纲页就绪')
  console.log('OK 大纲页就绪')

  // ① 初始无「审读存档」区（无报告时区不出现）
  const initHas = await page.eval(`document.body.innerText.includes('审读存档')`)
  ok('初始无审读报告时不显示「审读存档」区', initHas === false, String(initHas))

  // ② 用 writeDoc 模拟两次重跑（旧内容自动留档 1 版、新内容为当前版）
  const mk = await page.eval(`(async () => {
    const c1 = '# 审读报告 · 一致性巡查\\n\\n> 织卷写作引擎 · 冒烟一\\n\\n## 一句话结论\\n\\n冒烟：第一版结论。\\n\\n## 条目\\n\\n- 韩青机场值夜（线索 A）\\n'
    const c2 = '# 审读报告 · 一致性巡查\\n\\n> 织卷写作引擎 · 冒烟二\\n\\n## 一句话结论\\n\\n冒烟：第二版结论。\\n\\n## 条目\\n\\n- 韩青机场值夜（线索 A，依旧）\\n- 新增：第二版条目（线索 B）\\n'
    await window.zhijuan.writeDoc(${JSON.stringify(ID)}, ${JSON.stringify(REL)}, c1)
    await window.zhijuan.writeDoc(${JSON.stringify(ID)}, ${JSON.stringify(REL)}, c2)
    return { c1, c2 }
  })()`)
  await evalUntil(page, `document.body.innerText.includes('审读存档') && document.body.innerText.includes('一致性巡查')`, (v) => v === true, 15000, '审读存档区出现')
  ok('重跑两次后「审读存档」区出现并列出报告', true)

  // ③ 「历史」按钮（data-testid=audit-history）存在
  const btnState = await page.eval(`(() => {
    const b = document.querySelector('[data-testid="audit-history"]')
    return b ? { title: b.getAttribute('title'), aria: b.getAttribute('aria-label') } : null
  })()`)
  ok('条目旁有「历史」按钮', !!btnState && btnState.aria === '版本历史', JSON.stringify(btnState))

  // ④ 点条目本身 → 编辑器打开当前版（回归：原文入口不受影响）
  await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '一致性巡查')
    if (b) b.click()
    return !!b
  })()`)
  await evalUntil(page, `document.body.innerText.includes('第二版结论')`, (v) => v === true, 15000, '编辑器渲染当前版')
  ok('点条目本身仍打开报告（当前版）', true)

  // ⑤ 点「历史」按钮 → HistoryDrawer 打开：版本历史 / 共 1 版 / 相对路径 / diff +
  await page.eval(`(() => { const b = document.querySelector('[data-testid="audit-history"]'); if (b) b.click(); return !!b })()`)
  await evalUntil(page, `document.body.innerText.includes('版本历史') && document.body.innerText.includes('共 1 版')`, (v) => v === true, 15000, '历史抽屉打开')
  const drawer = await page.eval(`(() => ({
    hasPath: document.body.innerText.includes(${JSON.stringify(REL)}),
    ins: document.querySelectorAll('[class*="bg-accent-soft"]').length,
    del: document.querySelectorAll('[class*="bg-danger-soft"]').length
  }))()`)
  ok('抽屉显示相对路径标题', drawer.hasPath === true)
  ok('默认选中旧版并渲染行级 diff（+ 行）', drawer.ins > 0, JSON.stringify(drawer))

  // ⑥ 两击「恢复此版本」→ 报告回旧版（c1），历史增至 2 版（当前版 c2 自动留档）
  const clickRestore = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('恢复此版本'))
    if (b) { b.click(); return true }
    return false
  })()`)
  ok('找到「恢复此版本」', clickRestore === true)
  await evalUntil(page, `document.body.innerText.includes('再次点击确认恢复')`, (v) => v === true, 5000, '两击确认态')
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('再次点击确认恢复')); if (b) b.click(); return !!b })()`)
  await evalUntil(page, `document.body.innerText.includes('已恢复')`, (v) => v === true, 15000, '恢复成功提示')
  const after = await page.eval(`(async () => {
    const cur = await window.zhijuan.readDoc(${JSON.stringify(ID)}, ${JSON.stringify(REL)})
    const m = document.body.innerText.match(/共 (\\d+) 版/)
    return { sameAsC1: cur === ${JSON.stringify(mk.c1)}, count: m ? Number(m[1]) : -1 }
  })()`)
  ok('恢复后报告 = 第一版（c1）', after.sameAsC1 === true, JSON.stringify(after))
  ok('恢复后历史新增一版（共 2 版）', after.count === 2, 'count=' + after.count)

  // ⑦ 无 JS 异常
  ok('无 JS 异常', page.errors.length === 0, page.errors.join(' | ').slice(0, 300))

  // ⑧ 截图存档（给主人看界面）
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('fs')
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  fs.mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
  const shotPath = process.env.HOME + '/Pictures/zhijuan/audit-history-entry-' + hhmm + '.png'
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT: ' + shotPath)
} finally {
  await fetch(CDP + '/json/close/' + tab.id)
  page.close()
}

console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL: ' + fails)
process.exit(fails === 0 ? 0 : 1)
