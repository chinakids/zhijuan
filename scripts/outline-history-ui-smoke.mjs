// 织卷无头冒烟 · 写作副产物版本化（2026-09-14 智能层）：章卡/导演板/分幕草稿入史 + 大纲区「历史」入口
// 用法：node scripts/outline-history-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123（或 node scripts/serve-renderer.mjs）；CDP 127.0.0.1:9224
// 验收：① seed 章卡/导演板 → 对应「历史」按钮存在、分幕未生成时无 acts-history；
//       ② 导演本章覆盖 seed → 旧版入史（共 1 版）+ 抽屉 diff 可见；③ writeDoc 再改版 → 共 2 版 + 恢复可走（两击确认）；
//       ④ 章卡/分幕：writeDoc 改版 → 对应历史共 1 版（首次无旧版 → 空态）；⑤ 索引行无历史按钮（不入史）；
//       ⑥ 无 JS 异常；⑦ 截图存档。
// 说明：mock 任务每次生成固定文本（与真机"模型每次输出不同"不同），同内容写盘不会入史——这正是与真机
//       writeSnapshot 一致的行为；冒烟用 writeDoc 写入不同内容模拟「重跑覆盖」，与 audit-history-entry-smoke 同套路。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const ID = 'demo-aseya'
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
    await sleep(250)
  }
}

const CARD = '大纲/第01章_雾港.md'
const BOARD = '大纲/第01章_雾港_导演.md'
const ACTS = '大纲/第01章_雾港_分幕.md'

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/' + ID + '/outline')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}
const clickBtn = (text) => page.eval(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes(${JSON.stringify(text)}))
  if (b) { b.click(); return true }
  return false
})()`)
const clickAria = (label) => page.eval(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === ${JSON.stringify(label)})
  if (b) { b.click(); return true }
  return false
})()`)
const hasTestId = (tid) => page.eval(`!!document.querySelector('[data-testid="${tid}"]')`)
const clickHistory = (tid) => page.eval(`(() => { const b = document.querySelector('[data-testid="${tid}"]'); if (b) { b.click(); return true } return false })()`)
const drawerClose = async (label) => {
  await clickBtn('收起')
  await evalUntil(page, `!document.body.innerText.includes('版本历史')`, (v) => v === true, 8000, '抽屉收起 ' + label)
}
const writeV2 = (rel, content) => page.eval(`window.zhijuan.writeDoc(${JSON.stringify(ID)}, ${JSON.stringify(rel)}, ${JSON.stringify(content)})`)

try {
  await evalUntil(page, `document.body.innerText.includes('章卡索引')`, (v) => v === true, 25000, '大纲页就绪')
  console.log('OK 大纲页就绪')

  // ① 入口存在性：seed 章卡/导演板 → card/board 历史按钮存在；分幕未生成 → 无 acts-history
  ok('初始 card-history 存在（seed 章卡）', (await hasTestId('card-history')) === true)
  ok('初始 board-history 存在（seed 导演板）', (await hasTestId('board-history')) === true)
  ok('初始无 acts-history', (await hasTestId('acts-history')) === false)

  // ② 章卡历史：seed 直接入内存未入史 → 抽屉空态；writeDoc 改版 → 共 1 版
  await clickHistory('card-history')
  await evalUntil(page, `document.body.innerText.includes('版本历史')`, (v) => v === true, 15000, '章卡历史抽屉打开')
  ok('章卡未重跑过 → 空态提示', await page.eval(`document.body.innerText.includes('还没有历史版本')`))
  await drawerClose('card-1')
  await writeV2(CARD, '# 章卡 v2\n\n## 一句话定位\n\n（冒烟二版）定位改写。\n\n## 关键事件\n\n- 事件 A（v2）\n')
  await clickHistory('card-history')
  await evalUntil(page, `document.body.innerText.includes('共 1 版')`, (v) => v === true, 15000, '章卡入史 1 版')
  ok('章卡被覆盖时旧版自动留档（共 1 版）', true)
  await drawerClose('card-2')

  // ③ 选中第一章 → 「导演本章」覆盖 seed 导演板 → seed 旧版入史（共 1 版）
  await clickBtn('第1章')
  await sleep(300)
  const d1 = await clickAria('导演本章')
  ok('可点「导演本章」', d1 === true)
  await evalUntil(page, `document.body.innerText.includes('生成本章导演板') || document.body.innerText.includes('演示数据')`, (v) => v === true, 20000, '第一次导演完成')
  const firstBoardText = await page.eval(`window.zhijuan.readDoc(${JSON.stringify(ID)}, ${JSON.stringify(BOARD)})`)
  ok('第一次导演后导演板已落盘', !!firstBoardText && firstBoardText.includes('导演板'))
  await clickHistory('board-history')
  await evalUntil(page, `document.body.innerText.includes('版本历史')`, (v) => v === true, 15000, '历史抽屉打开')
  const c1 = await page.eval(`(() => { const m = document.body.innerText.match(/共 (\\d+) 版/) ; return m ? Number(m[1]) : -1 })()`)
  ok('导演覆盖 seed 后旧版入史：共 1 版', c1 === 1, 'count=' + c1)
  const d1v = await page.eval(`(() => ({
    ins: document.querySelectorAll('[class*="bg-accent-soft"]').length,
    del: document.querySelectorAll('[class*="bg-danger-soft"]').length
  }))()`)
  ok('抽屉显示行级 diff（+ / − 行）', d1v.ins > 0 || d1v.del > 0, JSON.stringify(d1v))
  await drawerClose('board-1')

  // ④ writeDoc 再改版（模拟模型重跑输出不同）→ 共 2 版；恢复可走（两击确认 → 内容回 v1）
  const boardV2 = (await page.eval(`window.zhijuan.readDoc(${JSON.stringify(ID)}, ${JSON.stringify(BOARD)})`)) + '\n\n（导演板 v2：新增一条红线）\n'
  await writeV2(BOARD, boardV2)
  await clickHistory('board-history')
  await evalUntil(page, `document.body.innerText.includes('版本历史') && document.body.innerText.includes('共 2 版')`, (v) => v === true, 15000, '共 2 版')
  await clickBtn('恢复此版本')
  await evalUntil(page, `document.body.innerText.includes('再次点击确认恢复')`, (v) => v === true, 5000, '两击确认态')
  await clickBtn('再次点击确认恢复')
  await evalUntil(page, `document.body.innerText.includes('已恢复')`, (v) => v === true, 15000, '恢复成功提示')
  await sleep(400)
  const afterRestore = await page.eval(`window.zhijuan.readDoc(${JSON.stringify(ID)}, ${JSON.stringify(BOARD)})`)
  ok('恢复后导演板内容已回旧版（与恢复前 v2 不同）', afterRestore !== null && afterRestore !== boardV2 && afterRestore.includes('导演板'))
  await drawerClose('board-2')

  // ⑤ 分幕：生成 → acts-history 出现；writeDoc 改版 → 共 1 版（首次无旧版 → 先经空态）
  await clickBtn('分幕生成')
  await evalUntil(page, `document.body.innerText.includes('分幕草稿已生成')`, (v) => v === true, 25000, '分幕生成完成')
  ok('分幕后 acts-history 出现', (await hasTestId('acts-history')) === true)
  await writeV2(ACTS, '# 分幕草稿 v2\n\n> 冒烟：模拟重写后的草稿\n\n## 第 1 段\n\n（v2 段文本）\n')
  await clickHistory('acts-history')
  await evalUntil(page, `document.body.innerText.includes('共 1 版')`, (v) => v === true, 15000, '分幕入史 1 版')
  ok('分幕草稿被覆盖时旧版自动留档（共 1 版）', true)
  await drawerClose('acts-1')

  // ⑥ 索引行不入史：历史按钮恰 3 个（章卡/导演板/分幕），无 index-history
  const histCount = await page.eval(`document.querySelectorAll('[data-testid$="-history"]').length`)
  ok('历史按钮共 3 个（章卡/导演板/分幕），索引无入口', histCount === 3, 'count=' + histCount)

  // ⑦ 无 JS 异常
  ok('无 JS 异常', page.errors.length === 0, page.errors.join(' | ').slice(0, 300))

  // ⑧ 截图存档
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('fs')
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  fs.mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
  const shotPath = process.env.HOME + '/Pictures/zhijuan/outline-history-' + hhmm + '.png'
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT: ' + shotPath)
} finally {
  await fetch(CDP + '/json/close/' + tab.id).catch(() => {})
  page.close()
}

console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL: ' + fails)
process.exit(fails === 0 ? 0 : 1)
