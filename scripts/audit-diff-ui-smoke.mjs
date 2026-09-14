// 织卷无头冒烟 · 审读存档版本化三期：审计抽屉「与上次对比」→ 语义三态（新增/已解决/依旧）
// 用法：node scripts/audit-diff-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；无头 Chrome CDP 127.0.0.1:9224
// 验收：① 预写两版报告（历史留 1 版）后打开一致性巡查 → 落盘第三版（历史 2 版）；
//       ② 点「与上次对比」→ 三态计数（新增 1/已解决 2/依旧 2）+ 1 条严重度变化 + shiftHint 提示；
//       ③ 依旧组显示「严重度 low → medium」；④ 返回列表复原；⑤ 冷读报告首跑无历史 → 空态提示；
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

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/' + ID + '/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

try {
  await evalUntil(page, `[...document.querySelectorAll('button')].some((x) => (x.title || '').includes('一致性巡查'))`, (v) => v === true, 20000, '正文页+Agent 面板就绪')

  // ① 预写两版报告（内容不同；首写无快照、第二写把第一版留进历史）
  const preseed = await page.eval(`(async () => {
    const V1 = '# 审读报告 · 一致性巡查\\n\\n> 织卷写作引擎 · 冒烟初始版\\n\\n## 一句话结论\\n\\n冒烟：第一版。\\n\\n## 条目（0）\\n\\n这一遍没有发现问题。\\n'
    const V2 = [
      '# 审读报告 · 一致性巡查', '',
      '> 织卷写作引擎 · 冒烟第二版（含 4 条：1 同款、1 严重度变化、2 已解决候选）', '',
      '## 一句话结论', '',
      '冒烟：四处以三态对照。', '',
      '## 条目（4）', '',
      '### 1 · [高] 设定冲突', '',
      '- 位置：第2章 · 灯塔夜访（正文/第02章_灯塔夜访.md）',
      '- 现象：“顾岸的旧车”前文是烟青色，这里写成了黑色',
      '- 建议：统一为烟青色并顺手修正后文描写',
      '- 关联档案：人物/顾岸.md', '',
      '### 2 · [低] 人物漂移', '',
      '- 位置：第3章',
      '- 现象：沈确的称呼在“你”与“您”之间跳了两次',
      '- 建议：保持对这个人物的固定称呼', '',
      '### 3 · [中] 结构', '',
      '- 位置：第5章',
      '- 现象：分幕与章节数对不上',
      '- 建议：按章节结构重排分幕', '',
      '### 4 · [中] 伏笔', '',
      '- 位置：第1章 · 雾港之夜',
      '- 现象：开头雨景与后文不接',
      '- 建议：让雨景呼应后文事件', ''
    ].join('\\n')
    await window.zhijuan.writeDoc(${JSON.stringify(ID)}, ${JSON.stringify(REL)}, V1)
    await window.zhijuan.writeDoc(${JSON.stringify(ID)}, ${JSON.stringify(REL)}, V2)
    return await window.zhijuan.listHistory(${JSON.stringify(ID)}, ${JSON.stringify(REL)}).then((l) => l.length)
  })()`)
  ok('预写两版后历史留 1 版（老内容）', preseed === 1, 'history=' + preseed)

  // ② 打开一致性巡查（Agent 面板头部盾牌按钮）→ 自动跑第一遍 → 落盘演示版（历史变 2 版）
  const opened = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').includes('一致性巡查'))
    if (b) b.click()
    return !!b
  })()`)
  ok('找到并点击「一致性巡查」按钮', opened === true)
  await evalUntil(page, `document.body.innerText.includes('与上次对比') && document.body.innerText.includes('墙角提到一封信')`, (v) => v === true, 20000, '审计抽屉打开并渲染演示条目')
  const histAfter = await page.eval(`window.zhijuan.listHistory(${JSON.stringify(ID)}, ${JSON.stringify(REL)}).then((l) => l.length)`)
  ok('审计落盘第三版后历史 2 版', histAfter === 2, 'history=' + histAfter)

  // ③ 点「与上次对比」→ 语义三态
  const clicked = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('与上次对比'))
    if (b) b.click()
    return !!b
  })()`)
  ok('找到并点击「与上次对比」', clicked === true)
  await evalUntil(page, `document.body.innerText.includes('新增（这次发现）')`, (v) => v === true, 15000, '对比视图渲染')

  const text = await page.eval(`document.body.innerText`)
  ok('三态计数：新增 1 / 已解决 2 / 依旧 2', /新增\s*1/.test(text) && /已解决\s*2/.test(text) && /依旧\s*2/.test(text), text.match(/新增\s*\d+.*?(?=⚠|$)/s)?.[0]?.slice(0, 60) ?? '')
  ok('严重度变化标注（其中 1 条严重度变化）', text.includes('其中 1 条严重度变化'))
  ok('新增组含演示新条目（信件）', text.includes('新增（这次发现）') && text.includes('墙角提到一封信'))
  ok('已解决组含两条旧条目', text.includes('分幕与章节数对不上') && text.includes('开头雨景与后文不接'))
  ok('依旧组含严重度变化显示（low → medium）', text.includes('严重度 low → medium'))
  ok('措辞漂移提示（同一位置一增一消）', text.includes('同一位置「一增一消」'))
  ok('对比头部显示上一版时间与条数（共 4 条）', /上一版 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} · 共 4 条/.test(text))

  // ③-b 候选 1③（2026-09-13）：diff 条目处置入口与清单视图同规则（有 target 即可转提案）
  const propCountBefore = await page.eval(`window.zhijuan.listProposals().then((l) => l.length)`)
  const diffTransCount = await page.eval(`[...document.querySelectorAll('button')].filter((x) => (x.textContent || '').includes('转提案')).length`)
  ok('对比视图有 target 的条目带「转提案」入口（依旧组 2 条）', diffTransCount === 2, 'count=' + diffTransCount)
  const clickedTrans = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('转提案'))
    if (b) b.click()
    return !!b
  })()`)
  ok('点击第一条「转提案」', clickedTrans === true)
  await evalUntil(page, `document.body.innerText.includes('已建提案')`, (v) => v === true, 10000, '转提案后显示已建提案')
  const propCountAfter = await page.eval(`window.zhijuan.listProposals().then((l) => l.length)`)
  ok('提案库新增 1 条', propCountAfter === propCountBefore + 1, 'before=' + propCountBefore + ' after=' + propCountAfter)
  const propTarget = await page.eval(`window.zhijuan.listProposals().then((l) => { const p = l[l.length - 1]; return (p && p.items && p.items[0] && p.items[0].target) || '' })`)
  ok('提案 target 等于条目关联档案（人物/顾岸.md）', propTarget === '人物/顾岸.md', 'target=' + propTarget)

  // ④ 返回列表复原
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('返回列表')); if (b) b.click(); return !!b })()`)
  await evalUntil(page, `document.body.innerText.includes('沈确的称呼') && !document.body.innerText.includes('新增（这次发现）')`, (v) => v === true, 10000, '返回列表视图')
  ok('返回列表后恢复清单视图', true)

  // ⑤ 冷读报告首跑（无历史）→ 「与上次对比」给出空态提示
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').includes('冷读报告')); if (b) b.click(); return !!b })()`)
  await evalUntil(page, `document.body.innerText.includes('与上次对比') && document.body.innerText.includes('这一遍没有发现问题') || document.body.innerText.includes('开篇节奏')`, (v) => v === true, 15000, '冷读抽屉打开')
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('与上次对比')); if (b) b.click(); return !!b })()`)
  await evalUntil(page, `document.body.innerText.includes('还没有上一版可对比')`, (v) => v === true, 10000, '空态提示')
  ok('无历史时给出空态提示', true)

  // ⑥ 无 JS 异常
  ok('无 JS 异常', page.errors.length === 0, page.errors.join(' | ').slice(0, 300))

  // ⑦ 截图（回到一致性巡查三态视图截图：重新打开再对比）
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').includes('一致性巡查')); if (b) b.click(); return !!b })()`)
  await evalUntil(page, `document.body.innerText.includes('与上次对比') && document.body.innerText.includes('沈确的称呼')`, (v) => v === true, 15000, '重开一致性巡查')
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('与上次对比')); if (b) { b.click(); return true } return false })()`)
  await evalUntil(page, `document.body.innerText.includes('新增（这次发现）')`, (v) => v === true, 15000, '对比视图（截图）')
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('fs')
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  fs.mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
  const shotPath = process.env.HOME + '/Pictures/zhijuan/audit-diff-' + hhmm + '.png'
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT: ' + shotPath)
} finally {
  await fetch(CDP + '/json/close/' + tab.id)
  page.close()
}

console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL: ' + fails)
process.exit(fails === 0 ? 0 : 1)
