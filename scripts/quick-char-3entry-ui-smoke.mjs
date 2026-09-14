// 织卷无头冒烟 · 守卫「建档案」动作余三入口覆盖补全（创作层 2026-09-15 06:45 候选2 收口）
// 现状：quick-char-create-ui-smoke 只驱动 Novel 主入口；Outline/HistoryDrawer/EditCard 三入口的
//       「建档案」按钮与建档落盘链路仅经 typecheck/同一组件实现保证（03:45 轮遗留观察②）。
// 本脚本：?zj-guard=2 注入守卫结果（1 已纠正 人物/沈眠.md + 1 未建档 人物/新角色1.md），
//       驱动三条真实触发路径（历史恢复 / 分幕采纳 / EditCard 采纳），各入口断言：
//       明细出现「建档案」→ 点击 → readDoc 断言档案按模板落盘 → UI 转「已建档」且按钮消失。
// 用法：node scripts/quick-char-3entry-ui-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer；本机无头 Chrome CDP 127.0.0.1:9224
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
const PID = 'demo-aseya'
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
const clickText = (text, exact = false) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!el) return false
  el.click()
  return true
})()`

let pass = 0
let fail = 0
let fatal = null
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log('PASS ' + name)
  } else {
    fail++
    console.log('FAIL ' + name + (extra ? ' | ' + extra : ''))
  }
}
const detailExpr = `(() => {
  const el = document.querySelector('[role="group"][aria-label="守卫拦截明细"]')
  if (!el) return null
  return {
    items: [...el.querySelectorAll('li')].map((li) => li.innerText),
    btnCount: [...el.querySelectorAll('button')].filter((b) => (b.innerText || '').trim() === '建档案').length
  }
})()`
const guardBtnExists = `[...document.querySelectorAll('button')].some((b) => (b.innerText || '').includes('拦截 2 条'))`
const openDetail = `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('拦截 2 条'))
  if (b) b.click()
  return !!b
})()`
const clickCreate = `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '建档案')
  if (b) b.click()
  return !!b
})()`

/** 三入口共用：明细断言 → 点「建档案」→ 落盘断言 → 「已建档」态；label 用于区分入口 */
async function driveQuickCreate(page, label) {
  await evalUntil(page, openDetail, Boolean, 8000, label + ' 展开明细')
  const d1 = await evalUntil(page, detailExpr, (d) => d && d.items.length === 2, 8000, label + ' 明细 2 条')
  ok(label + ' 明细 2 条（已纠正 + 未建档）', d1.items.length === 2, 'n=' + d1.items.length)
  ok(label + ' 未建档行含完整 reason（新角色1 / 尚未建档）', d1.items[1].includes('已丢弃') && d1.items[1].includes('人物/新角色1.md') && d1.items[1].includes('尚未建档'), JSON.stringify(d1.items[1]))
  ok(label + ' 明细出现「建档案」按钮且仅 1 个（已纠正行无）', d1.btnCount === 1, 'btn=' + d1.btnCount)
  // 点击「建档案」→ 按引导模板落盘
  const clicked = await page.eval(clickCreate)
  ok(label + ' 点击「建档案」成功', clicked === true)
  const created = await evalUntil(
    page,
    `window.zhijuan.readDoc('${PID}', '人物/新角色1.md')`,
    (t) => typeof t === 'string' && t.length > 0,
    8000,
    label + ' 档案落盘'
  )
  ok(label + ' 档案按模板落盘（约定头/H1/占位/基础档案）', created.includes('别名: []') && created.includes('# 新角色1') && created.includes('（身份 / 职业）') && created.includes('## 基础档案'), created.slice(0, 80))
  const d2 = await evalUntil(page, detailExpr, (d) => d && d.items[1] && d.items[1].includes('已建档'), 8000, label + ' 已建档标记')
  ok(label + ' 明细行转「已建档」', d2.items[1].includes('已建档'), JSON.stringify(d2.items[1]))
  ok(label + ' 「建档案」按钮消失（已建档不可重复处置）', d2.btnCount === 0, 'btn=' + d2.btnCount)
  ok(label + ' 已建档行显示完成说明', d2.items[1].includes('已快速建档'), JSON.stringify(d2.items[1]))
}

async function closeTab(tab, page) {
  page.close()
  try { await fetch(CDP + '/json/close/' + tab.id, { method: 'PUT' }) } catch {}
}

async function shoot(page, name) {
  try {
    const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
    if (shot?.data) {
      const { writeFileSync, mkdirSync } = await import('node:fs')
      mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
      const p = `${process.env.HOME}/Pictures/zhijuan/${name}-${new Date().toTimeString().slice(0, 5).replace(':', '')}.png`
      writeFileSync(p, Buffer.from(shot.data, 'base64'))
      console.log('SHOT ' + p)
    }
  } catch {}
}

try {
  // ══ Tab A：HistoryDrawer——历史恢复触发同步 → 抽屉内守卫明细 → 建档 ══
  console.log('── Tab A：HistoryDrawer 恢复→明细→建档案 ──')
  {
    const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-guard=2#/project/' + PID + '/novel')
    const page = await attach(tab.webSocketDebuggerUrl)
    await evalUntil(page, bodyHas('第1章 · 雾港'), Boolean, 20000, 'Novel 载入')
    await page.eval(clickText('第1章 · 雾港'))
    await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
    const curMd = await page.eval(`window.zhijuan.readDoc('${PID}', '正文/第01章_雾港.md')`)
    await page.eval(`window.zhijuan.writeDoc('${PID}', '正文/第01章_雾港.md', ${JSON.stringify((curMd || '') + '\n\n> 冒烟：造一版历史（快速建档三入口冒烟）。')}).then(() => true)`)
    await sleep(800)
    await page.eval(clickText('历史', true))
    await evalUntil(page, bodyHas('版本历史'), Boolean, 10000, '历史抽屉打开')
    await page.eval(clickText('恢复此版本'))
    await evalUntil(page, bodyHas('再次点击确认恢复'), Boolean, 6000, '确认文案')
    await page.eval(clickText('再次点击确认恢复'))
    await evalUntil(page, bodyHas('✓ 已恢复；切片同步'), Boolean, 15000, '恢复同步结果')
    await evalUntil(page, guardBtnExists, Boolean, 8000, 'A 拦截按钮')
    await driveQuickCreate(page, 'A HistoryDrawer')
    await shoot(page, 'quick-char-3entry-history')
    await closeTab(tab, page)
  }

  // ══ Tab B：Outline——分幕草稿采纳触发同步 → header 守卫明细 → 建档 ══
  console.log('── Tab B：Outline 分幕采纳→明细→建档案 ──')
  {
    const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-guard=2#/project/' + PID + '/outline')
    const page = await attach(tab.webSocketDebuggerUrl)
    await evalUntil(page, bodyHas('第1章 · 雾港'), Boolean, 20000, 'Outline 载入')
    await page.eval(clickText('第1章 · 雾港'))
    await sleep(500)
    await page.eval(clickText('分幕生成'))
    await evalUntil(page, bodyHas('采纳为正文'), Boolean, 10000, '采纳按钮')
    await page.eval(clickText('采纳为正文'))
    await evalUntil(page, bodyHas('再点一次确认采纳'), Boolean, 6000, '确认文案')
    await page.eval(clickText('再点一次确认采纳'))
    await evalUntil(page, bodyHas('切片同步'), Boolean, 15000, '同步结果出现')
    await evalUntil(page, guardBtnExists, Boolean, 8000, 'B 拦截按钮')
    await driveQuickCreate(page, 'B Outline')
    await shoot(page, 'quick-char-3entry-outline')
    await closeTab(tab, page)
  }

  // ══ Tab C：EditCard——正文修改卡采纳触发同步 → 卡内守卫明细 → 建档 ══
  console.log('── Tab C：EditCard 采纳→明细→建档案 ──')
  {
    const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-guard=2#/project/' + PID + '/novel')
    const page = await attach(tab.webSocketDebuggerUrl)
    await evalUntil(page, bodyHas('Agent') && `!!document.querySelector('textarea')`, Boolean, 20000, '正文页 Agent 就绪')
    await page.eval(`(() => {
      const ta = document.querySelector('textarea')
      ta.focus()
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
      setter.call(ta, '把这段改一下')
      ta.setSelectionRange(ta.value.length, ta.value.length)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      return true
    })()`)
    await evalUntil(page, bodyHas('采纳并写入'), Boolean, 20000, 'EditCard 出现')
    await page.eval(clickText('采纳并写入'))
    await evalUntil(page, bodyHas('切片同步'), Boolean, 15000, '同步结果出现')
    await evalUntil(page, guardBtnExists, Boolean, 8000, 'C 拦截按钮')
    await driveQuickCreate(page, 'C EditCard')
    await shoot(page, 'quick-char-3entry-editcard')
    await closeTab(tab, page)
  }
} catch (e) {
  fatal = e
  fail++
  console.log('FATAL ' + e.message)
}

console.log(`RESULT ${pass} passed / ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
