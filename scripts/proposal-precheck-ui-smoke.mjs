// 织卷无头冒烟 · 提案「全部接受」前置预检（创作层 2026-09-21 00:45 轮；候选 3）
// 覆盖：① 有过时（目标内容已变）→ 弹带信息确认（N/M 计数）→「仍全部接受」→ 部分失败逐条可见
//       ② 「取消」= 零执行（pending 保持）
//       ③ M=0（无过时）→ 零打扰直接执行（无确认框）
//       ④ ItemCard 显示提案生成时间（候选 b：过时感知补全）
// 用法：node scripts/proposal-precheck-ui-smoke.mjs
// 前置：npm run build；out/renderer 由 scripts/serve-renderer.mjs 伺服；本机无头 Chrome CDP 127.0.0.1:9224
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
  if (cond) {
    pass++
    console.log('PASS ' + name)
  } else {
    fail++
    console.log('FAIL ' + name + (extra ? ' | ' + extra : ''))
  }
}

let fatal = null
let page = null
let screenshotPath = ''
try {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/' + PID + '/novel')
  page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文载入')

  // 准备：目标文件 + 两条 pending 提案（item1 基线将漂移 / item2 健康）
  const prep = await page.eval(`(async () => {
    const rel = '人物/测试预检.md'
    await window.zhijuan.writeDoc('${PID}', rel, '# 测试预检\\n\\n## 现时状态\\n\\n基线内容\\n')
    // item1：beforeExact=基线；随后写盘漂移 → 预检应判「内容已变化」
    // item2：beforeExact=null（生成时无节）→ 追加型健康
    const items = [
      { target: rel, anchor: '## 现时状态', kind: 'upsert-section', before: '', after: '- 将写入：预检新内容', reason: '预检测试-漂移', beforeExact: '基线内容' },
      { target: rel, anchor: '## 追加节', kind: 'upsert-section', before: '', after: '- 追加内容', reason: '预检测试-追加', beforeExact: null }
    ]
    const created = await window.zhijuan.createProposals('${PID}', 'agent-chat', '第01章', '雾港夜', items)
    // 作者后写 → item1 基线漂移
    const cur = await window.zhijuan.readDoc('${PID}', rel)
    await window.zhijuan.writeDoc('${PID}', rel, cur.replace('基线内容', '作者后写内容'))
    return { ids: created.map((c) => c.id), n: created.length }
  })()`)
  ok('注入 2 条 pending 提案（1 漂移 + 1 健康）', prep.n === 2, JSON.stringify(prep.ids))

  // 打开提案抽屉（左导航底部「待确认」入口）
  await page.eval(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('查看/处理待确认') || (b.innerText || '').includes('待确认提案'))
    if (btn) btn.click()
    return !!btn
  })()`)
  await evalUntil(page, bodyHas('扫描批注'), Boolean, 10000, '抽屉打开')

  // ④ 候选 b：生成时间显示（过时感知补全）
  const hasTime = await page.eval(`(() => {
    const s = [...document.querySelectorAll('span')].find((e) => (e.innerText || '').startsWith('生成于 2026-'))
    return s ? s.innerText : ''
  })()`)
  ok('ItemCard 显示提案生成时间（生成于 2026-…）', /^生成于 2026-\d{2}-\d{2} \d{2}:\d{2}$/.test(hasTime), hasTime)

  // ① 全部接受 → 预检弹带信息确认（1 条会失败）
  await page.eval(clickBtn('全部接受'))
  await evalUntil(page, bodyHas('部分提案的目标已变化'), Boolean, 10000, '预检确认框出现')
  const dlg = await page.eval(`(() => {
    const b = document.body.innerText
    return { t: b.includes('部分提案的目标已变化'), d: b.includes('将接受 2 条提案，其中 1 条的目标内容已变化') }
  })()`)
  ok('确认框带信息（2 条将接受、1 条已变化）', dlg.t && dlg.d, JSON.stringify(dlg))

  // ② 取消 → 零执行：pending 仍 2
  await page.eval(clickBtn('取消'))
  await evalUntil(page, `!document.body.innerText.includes('部分提案的目标已变化')`, Boolean, 6000, '取消关闭确认框')
  const pend = await page.eval(`window.zhijuan.listProposals('${PID}').then((ps) => ps.filter((p) => p.status === 'pending').length)`)
  ok('取消后全部仍 pending（零执行）', pend === 2, String(pend))

  // 再点 → 仍全部接受 → 部分失败（item1 rejected / item2 accepted）
  await page.eval(clickBtn('全部接受'))
  await evalUntil(page, bodyHas('部分提案的目标已变化'), Boolean, 10000, '确认框再次出现')
  await page.eval(clickBtn('仍全部接受'))
  await evalUntil(page, bodyHas('1 条提案未应用'), Boolean, 10000, '批量失败汇总 toast')
  const st = await page.eval(`window.zhijuan.listProposals('${PID}').then((ps) => {
    const a = ps.find((x) => x.id === ${JSON.stringify(prep.ids[0])})
    const b = ps.find((x) => x.id === ${JSON.stringify(prep.ids[1])})
    return { drift: a ? a.status : 'GONE', good: b ? b.status : 'GONE' }
  })`)
  ok('漂移提案 rejected / 健康提案 accepted', st.drift === 'rejected' && st.good === 'accepted', JSON.stringify(st))
  const md = await page.eval(`window.zhijuan.readDoc('${PID}', '人物/测试预检.md')`)
  ok('作者后写内容保留（未被覆盖）', typeof md === 'string' && md.includes('作者后写内容'), '')
  ok('健康提案 after 已写入', typeof md === 'string' && md.includes('- 追加内容'), '')

  // ③ M=0 零打扰：注入 2 条健康提案（beforeExact 与盘上当前一致）→ 全部接受不弹确认框直接执行
  const prep2 = await page.eval(`(async () => {
    const rel = '人物/测试预检.md'
    const cur = await window.zhijuan.readDoc('${PID}', rel)
    // 以盘上现节内容为基线（需精确=extractSectionBody 同口径；直接用不含标题的节体）——构造健康：beforeExact=undefined（旧档语义，无基线=恒 ok）
    const items = [
      { target: rel, anchor: '## 现时状态', kind: 'upsert-section', before: '', after: '- 健康1', reason: '预检测试-健康1' },
      { target: rel, anchor: '## 现时状态', kind: 'upsert-section', before: '', after: '- 健康2', reason: '预检测试-健康2' }
    ]
    const created = await window.zhijuan.createProposals('${PID}', 'agent-chat', '第01章', '雾港夜', items)
    return { n: created.length, cur: !!cur }
  })()`)
  ok('注入 2 条无基线健康提案', prep2.n === 2 && prep2.cur === true, JSON.stringify(prep2))
  await page.eval(clickBtn('全部接受'))
  await sleep(1500)
  const noDlg = await page.eval(`!document.body.innerText.includes('部分提案的目标已变化')`)
  ok('M=0 零打扰：无确认框直接执行', noDlg, '')
  const done2 = await page.eval(`window.zhijuan.listProposals('${PID}').then((ps) => ps.filter((p) => p.status === 'pending').length)`)
  ok('全部接受后 pending=0（均已处置）', done2 === 0, String(done2))

  try {
    const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
    screenshotPath = process.env.HOME + '/Pictures/zhijuan/proposal-precheck-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png'
    writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'))
    console.log('SCREENSHOT ' + screenshotPath)
  } catch (e) {
    console.log('SCREENSHOT_FAIL ' + String(e))
  }
} catch (e) {
  fatal = e
  console.log('FATAL ' + String(e && e.stack ? e.stack : e))
}

console.log(`RESULT: pass=${pass} fail=${fail}`)
process.exit(fatal || fail ? 1 : 0)
