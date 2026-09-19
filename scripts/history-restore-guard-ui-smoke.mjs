// 织卷无头冒烟 · 版本恢复防线（P1 F-20260917-10 衍生，2026-09-19 智能层）
// 用法：node scripts/history-restore-guard-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收：① 制造「历史最新版=仅约定头、磁盘=完整正文」现场；② 打开历史抽屉默认选中该空版本；
//       ③ 两次点击恢复 → 拦截提示「该版本正文为空」；④ 磁盘未被改写成空版本（readDoc 不变）；
//       ⑤ 恢复按钮确认态复位；⑥ 无 JS 异常。
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
const clickByText = (page, text) =>
  page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes(${JSON.stringify(text)})); if (b) { b.click(); return true } return false })()`)

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

await evalUntil(page, `(() => { const el = document.querySelector('.ProseMirror'); return el && el.textContent.length > 10 })()`, (x) => x === true, 25000, 'ProseMirror 带正文')

// ① 制造现场：历史最新版=仅约定头（损坏版），磁盘=完整正文
const setup = await page.eval(`(async () => {
  const id = 'demo-aseya'
  const cur = (await window.zhijuan.readDoc(id, ${JSON.stringify(REL)})) || ''
  const m = cur.match(/^---\\n[\\s\\S]*?\\n---\\n/)
  const fmOnly = m ? m[0] : '---\\n章号: 1\\n---\\n'
  await window.zhijuan.writeDoc(id, ${JSON.stringify(REL)}, fmOnly)  // 存一个「仅约定头」版本 → 快照=当前完整版
  await window.zhijuan.writeDoc(id, ${JSON.stringify(REL)}, cur)      // 磁盘恢复完整 → 快照=仅约定头（成为最新历史）
  return { cur, fmOnly }
})()`)
ok('现场已构造（历史最新=仅约定头）', setup.cur.length > 50 && setup.fmOnly.length < 120, `cur=${setup.cur.length} fm=${setup.fmOnly.length}`)

// ② 打开历史抽屉
await clickByText(page, '历史')
await evalUntil(page, `document.body.innerText.includes('版本历史')`, (x) => x === true, 15000, '抽屉打开')
await evalUntil(page, `document.body.innerText.includes('对比：')`, (x) => x === true, 15000, '对比区域出现')
const selState = await page.eval(`(() => {
  const t = document.body.innerText
  const m = t.match(/共 (\\d+) 版/)
  return { count: m ? Number(m[1]) : -1, emptyOld: t.includes('该版本与当前正文完全一致') ? 'same' : 'diff' }
})()`)
ok('抽屉列出 ≥2 版（完整版+空版本）', selState.count >= 2, 'count=' + selState.count)

// ③ 两次点击恢复 → 拦截提示
await clickByText(page, '恢复此版本')
await evalUntil(page, `document.body.innerText.includes('再次点击确认恢复')`, (x) => x === true, 5000, '确认态')
await clickByText(page, '再次点击确认恢复')
await evalUntil(page, `document.body.innerText.includes('该版本正文为空')`, (x) => x === true, 8000, '拦截提示')
ok('恢复被拦截并提示「该版本正文为空」', true)
await sleep(500)
const after = await page.eval(`(async () => {
  const cur = (await window.zhijuan.readDoc('demo-aseya', ${JSON.stringify(REL)})) || ''
  const t = document.body.innerText
  const m = t.match(/共 (\\d+) 版/)
  const btnText = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('恢复'))?.textContent || ''
  return { unchanged: cur === ${JSON.stringify(setup.cur)}, count: m ? Number(m[1]) : -1, btnBack: btnText.includes('恢复此版本') && !btnText.includes('再次点击') }
})()`)
ok('磁盘正文未被改写（仍为完整版）', after.unchanged === true, JSON.stringify({ unchanged: after.unchanged, count: after.count }))
ok('历史版数未新增（拦截未写盘）', after.count === selState.count, 'count=' + after.count)
ok('确认态复位（按钮回到「恢复此版本」）', after.btnBack === true, JSON.stringify({ btnBack: after.btnBack }))

// 截图存档（主人确认防线 UI）
const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
const fs = await import('node:fs')
const name = '/Users/USER/Pictures/zhijuan/history-restore-guard-' + new Date().toISOString().slice(11, 16).replace(':', '') + '.png'
try {
  fs.mkdirSync('/Users/USER/Pictures/zhijuan', { recursive: true })
  fs.writeFileSync(name, Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT: ' + name)
} catch (e) {
  console.log('SCREENSHOT-FAIL: ' + e.message)
}

console.log('JS errors:', JSON.stringify(page.errors))
ok('无 JS 异常', page.errors.length === 0, page.errors.join(' | ').slice(0, 300))

page.close()
console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL: ' + fails)
process.exit(fails === 0 ? 0 : 1)
