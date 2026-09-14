// 织卷无头冒烟 · 守卫拦截明细「三入口」覆盖补全（创作层 2026-09-14 18:45 候选 2 收口）
// 现状：GuardIssuesNote 已接 HistoryDrawer（历史恢复）/ Outline header（分幕采纳）/ EditCard（正文修改采纳）
//       三入口（15:45 轮 65788ff 接线，仅 typecheck 覆盖）；Novel 主入口已有 guard-issues-ui-smoke 9/9。
// 本脚本：?zj-guard=2 注入守卫结果（1 条已纠正 人物/沈眠.md + 1 条已丢弃 人物/新角色1.md），
//       驱动三条真实触发路径，断言各入口「拦截 2 条」摘要出现且展开明细完整可达。
// 用法：node scripts/guard-issues-3entry-ui-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer；本机无头 Chrome CDP 127.0.0.1:9224
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
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
    await sleep(300)
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
// 守卫明细展开后的逐条断言（三条入口共用）：明细浮层 role=group[aria-label=守卫拦截明细]
const detailExpr = `(() => {
  const el = document.querySelector('[role="group"][aria-label="守卫拦截明细"]')
  if (!el) return null
  return {
    z: getComputedStyle(el).zIndex,
    text: el.innerText,
    items: [...el.querySelectorAll('li')].map((li) => li.innerText)
  }
})()`
const guardBtnExpr = `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('拦截 2 条'))
  if (!b) return null
  return { text: b.innerText, expanded: b.getAttribute('aria-expanded') }
})()`

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log('PASS ' + name)
  } else {
    fail++
    console.log('FAIL ' + name + (extra ? ' | ' + extra : ''))
  }
}
const shots = []
async function shoot(page, name) {
  try {
    const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
    if (shot?.data) {
      const { writeFileSync, mkdirSync } = await import('node:fs')
      mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
      const p = `${process.env.HOME}/Pictures/zhijuan/${name}-${new Date().toTimeString().slice(0, 5).replace(':', '')}.png`
      writeFileSync(p, Buffer.from(shot.data, 'base64'))
      shots.push(p)
      console.log('SHOT ' + p)
    }
  } catch {}
}
// 断言展开明细完整（2 条：已纠正/已丢弃 + 完整 target + reason 不截断 + z-40）
async function assertDetail(page, label) {
  await evalUntil(page, `!!document.querySelector('[role="group"][aria-label="守卫拦截明细"]')`, Boolean, 8000, label + ' 明细浮层')
  const detail = await page.eval(detailExpr)
  ok(label + ' 明细共 2 条', detail.items.length === 2, 'n=' + detail.items.length)
  ok(label + ' 明细含「已纠正 人物/沈眠.md」', detail.items[0].includes('已纠正') && detail.items[0].includes('人物/沈眠.md') && detail.items[0].includes('沈藏'), JSON.stringify(detail.items[0]))
  ok(label + ' 明细含「已丢弃 人物/新角色1.md」完整 reason', detail.items[1].includes('已丢弃') && detail.items[1].includes('人物/新角色1.md') && detail.items[1].includes('尚未建档'), JSON.stringify(detail.items[1]))
  ok(label + ' 浮层 z-index=40', detail.z === '40', 'z=' + detail.z)
}

// ══ Tab A：HistoryDrawer——历史恢复触发同步 → 抽屉内守卫明细 ══
console.log('── Tab A：HistoryDrawer 恢复→守卫明细 ──')
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-guard=2#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('第1章 · 雾港'), Boolean, 20000, 'Novel 载入')
  await page.eval(clickText('第1章 · 雾港'))
  await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
  // 造历史：writeDoc 改正文 → devShim 入史一版（不触发 agentSync，守卫结果留给恢复后的同步）
  const curMd = await page.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')`)
  await page.eval(`window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', ${JSON.stringify((curMd || '') + '\n\n> 冒烟：造一版历史（三入口守卫冒烟）。')}).then(() => true)`)
  await sleep(800)
  await page.eval(clickText('历史', true))
  await evalUntil(page, bodyHas('版本历史'), Boolean, 10000, '历史抽屉打开')
  await page.eval(clickText('恢复此版本'))
  await evalUntil(page, bodyHas('再次点击确认恢复'), Boolean, 6000, '确认文案')
  await page.eval(clickText('再次点击确认恢复'))
  // 恢复后 runSync → zj-guard 注入 → 抽屉内「拦截 2 条」
  await evalUntil(page, bodyHas('✓ 已恢复；切片同步'), Boolean, 15000, '恢复同步结果')
  const btn = await evalUntil(page, guardBtnExpr, Boolean, 8000, '历史抽屉拦截按钮')
  ok('A1 恢复后抽屉内「拦截 2 条」入口出现', Boolean(btn), JSON.stringify(btn && btn.text))
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('拦截 2 条')); if (b) b.click(); return !!b })()`)
  await assertDetail(page, 'A2 HistoryDrawer')
  await shoot(page, 'guard-3entry-history')
  // Esc 关闭
  await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(400)
  ok('A3 Esc 关闭明细', await page.eval(`!document.querySelector('[role="group"][aria-label="守卫拦截明细"]')`))
  page.close()
  try { await fetch(CDP + '/json/close/' + tab.id, { method: 'PUT' }) } catch {}
}

// ══ Tab B：Outline——分幕草稿采纳触发同步 → header 守卫明细 ══
console.log('── Tab B：Outline 分幕采纳→守卫明细 ──')
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-guard=2#/project/demo-aseya/outline')
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
  const btn = await evalUntil(page, guardBtnExpr, Boolean, 8000, 'Outline 拦截按钮')
  ok('B1 采纳后 header「拦截 2 条」入口出现', Boolean(btn), JSON.stringify(btn && btn.text))
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('拦截 2 条')); if (b) b.click(); return !!b })()`)
  await assertDetail(page, 'B2 Outline')
  await shoot(page, 'guard-3entry-outline')
  page.close()
  try { await fetch(CDP + '/json/close/' + tab.id, { method: 'PUT' }) } catch {}
}

// ══ Tab C：EditCard——正文修改卡采纳触发同步 → 卡内守卫明细 ══
console.log('── Tab C：EditCard 采纳→守卫明细 ──')
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-guard=2#/project/demo-aseya/novel')
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
  const btn = await evalUntil(page, guardBtnExpr, Boolean, 8000, 'EditCard 拦截按钮')
  ok('C1 采纳后卡内「拦截 2 条」入口出现', Boolean(btn), JSON.stringify(btn && btn.text))
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('拦截 2 条')); if (b) b.click(); return !!b })()`)
  await assertDetail(page, 'C2 EditCard')
  await shoot(page, 'guard-3entry-editcard')
  page.close()
  try { await fetch(CDP + '/json/close/' + tab.id, { method: 'PUT' }) } catch {}
}

// ══ Tab D：ProposalDrawer——批注提案接受 → toast 守卫明细逐行呈现（whitespace-pre-wrap + \n 分隔） ══
console.log('── Tab D：批注接受→toast 守卫明细逐行 ──')
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-guard=2#/project/demo-aseya/settings')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('外观与数据'), Boolean, 20000, '设置页加载')
  await page.eval(clickText('外观与数据'))
  await evalUntil(page, bodyHas('批注定时优化'), Boolean, 10000, '批注开关')
  await page.eval(`(() => {
    const rows = [...document.querySelectorAll('div')].filter((d) => d.textContent && d.textContent.includes('批注定时优化') && d.querySelector('button[role="switch"]'))
    const row = rows[rows.length - 1]
    const s = row && row.querySelector('button[role="switch"]')
    if (!s) return 'NO_SWITCH'
    if (s.getAttribute('aria-checked') !== 'true') s.click()
    return 'OK'
  })()`)
  await page.eval(clickText('保存设置', true))
  await sleep(600)
  await page.eval(`(() => { location.hash = '#/project/demo-aseya/novel'; return 1 })()`)
  await evalUntil(page, bodyHas('第1章 · 雾港'), Boolean, 20000, '正文载入')
  // 批注首扫（打开项目 10s）→ 生成提案 → 顶栏「待确认提案」
  await evalUntil(page, bodyHas('待确认提案'), Boolean, 25000, '批注提案入口')
  await page.eval(clickText('待确认提案'))
  await evalUntil(page, bodyHas('来自：批注同步'), Boolean, 10000, '抽屉批注提案')
  await page.eval(clickText('接受'))
  // zj-guard=2：接受后切片同步出守卫明细 → toast description 逐行（\n + whitespace-pre-wrap）
  await evalUntil(
    page,
    `[...document.querySelectorAll('.zj-toast')].some((t) => (t.innerText || '').includes('切片同步'))`,
    Boolean,
    15000,
    '同步结果 toast'
  )
  const toastInfo = await page.eval(`(() => {
    const ts = [...document.querySelectorAll('.zj-toast')]
    const t = ts.find((x) => (x.innerText || '').includes('切片同步'))
    if (!t) return null
    const desc = [...t.querySelectorAll('div')].filter((d) => (d.textContent || '').includes('已纠正')).at(-1)
    return {
      text: t.innerText,
      hasNewline: (desc ? desc.textContent : '').includes('\\n'),
      innerNewline: (desc ? desc.textContent : '').includes(String.fromCharCode(10)),
      whiteSpace: desc ? getComputedStyle(desc).whiteSpace : null
    }
  })()`)
  ok('D1 批注接受后切片同步 toast 出现', Boolean(toastInfo), JSON.stringify(toastInfo && toastInfo.text.slice(0, 60)))
  ok('D2 toast 明细含「（拦截 2 条）」与已纠正/已丢弃完整行', toastInfo.text.includes('（拦截 2 条）') && toastInfo.text.includes('已纠正 人物/沈眠.md') && toastInfo.text.includes('已丢弃 人物/新角色1.md'), JSON.stringify(toastInfo.text.slice(0, 120)))
  ok('D3 toast description 逐条换行（\\n 生效）', toastInfo.hasNewline || toastInfo.innerNewline, JSON.stringify({ hasNewline: toastInfo.hasNewline, innerNewline: toastInfo.innerNewline }))
  ok('D4 toast description white-space=pre-wrap', toastInfo.whiteSpace === 'pre-wrap', 'ws=' + toastInfo.whiteSpace)
  await shoot(page, 'guard-3entry-toast')
  page.close()
  try { await fetch(CDP + '/json/close/' + tab.id, { method: 'PUT' }) } catch {}
}

console.log(`RESULT ${pass} passed / ${fail} failed`)
console.log('SHOTS ' + shots.join(' '))
process.exit(fail > 0 ? 1 : 0)
