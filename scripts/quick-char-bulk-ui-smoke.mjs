// 织卷无头冒烟 · 守卫「未建档」条目批量快速建档（创作层 2026-09-22 候选3 收口）
// 用法：node scripts/quick-char-bulk-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim + ?zj-guard=4 注入 1 已纠正 + 3 未建档(新角色1/2/3)）：
//   选第1章 → 编辑正文 → 保存 → 浮条「拦截 4 条」→ 展开明细：
//   批量按钮「为 3 名人物建档案」（data-testid=guard-bulk-create，N=未建档且未建档中条目数）
//   → 预写 人物/新角色2.md（模拟作者已建=skipped 分支）→ 点击批量 → 新角色1/3 落盘转「已建档」、
//     新角色2 标「已有档」（reason「已有档案未改动」）、逐条按钮清零、批量按钮消失
//   → 再编辑保存重跑同步 → 已建档/已有档 target 不再拦截（只剩已纠正 1 条）；全程零 JS 异常
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
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
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
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
    ws.onopen = async () => {
      await cmd('Runtime.enable')
      res({
        cmd,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        errors,
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
    badges: [...el.querySelectorAll('li')].map((li) => li.querySelector('span')?.innerText ?? ''),
    btnCount: [...el.querySelectorAll('button')].filter((b) => (b.innerText || '').trim() === '建档案').length,
    bulkBtn: !!el.querySelector('[data-testid="guard-bulk-create"]'),
    bulkLabel: (() => { const b = el.querySelector('[data-testid="guard-bulk-create"]'); return b ? (b.innerText || '').trim() : null })()
  }
})()`
const openExpr = `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('拦截 ') && (x.innerText || '').includes('查看'))
  if (b) b.click()
  return !!b
})()`

try {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-guard=4#/project/' + PID + '/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入')

  // ① 选章 → 编辑器挂载 → 追加内容 → 保存 → 同步触发（注入 4 条拦截）
  await page.eval(clickBtn('第1章 · 雾港', false))
  await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
  await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('批量建档冒烟：雾更浓了。', false)`)
  await evalUntil(page, `document.body.innerText.includes('● 未保存') || document.body.innerText.includes('保存中…')`, Boolean, 10000, '文档变脏')
  await page.eval(clickBtn('保存', false))
  await evalUntil(page, bodyHas('拦截 4 条'), Boolean, 20000, '拦截浮条出现')

  // ② 展开明细：4 条（1 已纠正 + 3 未建档）；批量按钮「为 3 名人物建档案」
  await page.eval(openExpr)
  const d1 = await evalUntil(page, detailExpr, (d) => d && d.items.length === 4, 8000, '明细 4 条')
  ok('明细 4 条（已纠正 1 + 未建档 3）', d1.items.length === 4, JSON.stringify(d1.items.length))
  ok('未建档行逐条「建档案」按钮 3 个（已纠正行无）', d1.btnCount === 3, JSON.stringify(d1.btnCount))
  ok('批量按钮出现且文案「为 3 名人物建档案」', d1.bulkBtn === true && d1.bulkLabel === '为 3 名人物建档案', JSON.stringify(d1.bulkLabel))

  // ③ 预写 人物/新角色2.md（模拟作者在别处已建=skipped 分支；模板同 quickCharDocMarkdown 形态）→ 点击批量按钮
  await page.eval(`(() => {
    const t = '---\\n别名: []\\n---\\n# 新角色2\\n\\n> 定位：（待补充：身份 / 职业）\\n> 关键特征：（待补充：关键特征）\\n\\n## 基础档案\\n\\n（作者在别处已建）'
    return window.zhijuan.writeDoc('${PID}', '人物/新角色2.md', t)
  })()`)
  await page.eval(`(() => {
    const b = document.querySelector('[data-testid="guard-bulk-create"]')
    if (b) b.click()
    return !!b
  })()`)
  for (const name of ['新角色1', '新角色2', '新角色3']) {
    const created = await evalUntil(
      page,
      `window.zhijuan.readDoc('${PID}', '人物/${name}.md')`,
      (t) => typeof t === 'string' && t.length > 0,
      10000,
      '档案在盘 ' + name
    )
    ok(`档案在盘 人物/${name}.md（模板含约定头/占位/基础档案）`, created.includes('别名: []') && created.includes('# ' + name) && created.includes('（待补充：身份 / 职业）') && created.includes('## 基础档案'), created.slice(0, 80))
  }
  const d2 = await evalUntil(page, detailExpr, (d) => d && d.badges && d.badges.filter((b) => b === '已建档').length === 2, 8000, '两行已建档')
  ok('批量后 2 行「已建档」+1 行「已有档」（skipped 区分）', d2.badges.filter((b) => b === '已建档').length === 2 && d2.badges.filter((b) => b === '已有档').length === 1 && d2.badges.filter((b) => b === '已纠正').length === 1, JSON.stringify(d2.badges))
  ok('已建档行 reason「已快速建档…」', d2.items.some((t) => t.includes('已快速建档')), JSON.stringify(d2.items))
  ok('已有档行 reason「已有档案未改动…」', d2.items.some((t) => t.includes('已有档案未改动')), JSON.stringify(d2.items))
  ok('逐条「建档案」按钮清零', d2.btnCount === 0, JSON.stringify(d2.btnCount))
  ok('批量按钮消失（无未建档条目）', d2.bulkBtn === false, JSON.stringify(d2.bulkBtn))

  // ④ 截图存证（明细展开、批量建档后状态）
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
    const p = `${process.env.HOME}/Pictures/zhijuan/quick-char-bulk-${new Date().toTimeString().slice(0, 5).replace(':', '')}.png`
    writeFileSync(p, Buffer.from(shot.data, 'base64'))
    console.log('SHOT ' + p)
  }

  // ⑤ 重跑同步（再保存）→ 已建档 target 不再拦截（只剩已纠正 1 条）
  // 先收起展开的浮层（否则 openExpr 点到「拦截 1 条」按钮会是收起而非展开——实例未重挂载、open 状态保留）
  await page.eval(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  await sleep(300)
  await page.eval(`window.__ZJ_EDITORS[0].applyMarkdown('再保存一次：重跑同步。', false)`)
  await evalUntil(page, `document.body.innerText.includes('● 未保存') || document.body.innerText.includes('保存中…')`, Boolean, 10000, '再次变脏')
  await page.eval(clickBtn('保存', false))
  await evalUntil(page, bodyHas('拦截 1 条'), Boolean, 20000, '重跑后只剩已纠正 1 条')
  await page.eval(openExpr)
  const d3 = await evalUntil(page, detailExpr, (d) => d && d.items.length === 1, 8000, '明细 1 条')
  ok('重跑后明细仅 1 条（3 名已建档不再拦）', d3.items.length === 1 && d3.items[0].includes('已纠正'), JSON.stringify(d3.items))
  ok('明细不再含 新角色', !JSON.stringify(d3.items).includes('新角色'))

  // ⑥ 零 JS 异常
  await sleep(500)
  ok('全程零 JS 异常', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 3)))

  await page.close()
  try {
    const r = await fetch(CDP + '/json/close/' + tab.id, { method: 'PUT' })
    await r.text()
  } catch {}
} catch (e) {
  fatal = e
  fail++
  console.log('FATAL ' + e.message)
}

console.log(`RESULT ${pass} passed / ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
