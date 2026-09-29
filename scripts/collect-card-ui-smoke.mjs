// 织卷无头冒烟 · agent 素材采集建议卡（智能层候选 1「agent 建议素材采集」，2026-09-29）
// 前置：npm run build；python3 -m http.server 8123 --directory out/renderer（或 scripts/serve-renderer.mjs）；CDP 127.0.0.1:9224
// 验收点（devShim「建议采集」触发词：zj_collect_suggest 工具卡 → collect 事件 → CollectCard）：
// ① 建议卡出现：需求/关键词/建议理由/类别输入（默认模型建议值）；
// ② 「创建采集任务」→ 任务卡落采集池（status: pending + 需求/关键词/类别/创建 front matter 可读回）；
// ③ 同需求任务已存在 → 查重提示不重复创建；
// ④ 「忽略」→ 建议卡标已忽略（不再创建）；
// ⑤ 全程无 JS 异常（双通道捕获：Runtime.exceptionThrown + consoleAPICalled type=error）。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DEMAND = '九十年代小城火车站候车室的常见陈设与氛围'

async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}
async function closeTab(tab) {
  try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
}
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params?.exceptionDetails?.text || '') + ' ' + (m.params?.exceptionDetails?.exception?.description || '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push('console.error: ' + JSON.stringify((m.params.args || []).map((a) => a.value ?? a.description).join(' ')).slice(0, 200))
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
      await cmd('Runtime.enable').catch(() => {})
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
async function sendPrompt(page, text) {
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
    setter.call(ta, ${JSON.stringify(text)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return ta.value
  })()`)
  await sleep(300)
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    ta.dispatchEvent(ev)
    return true
  })()`)
  // 流式轮后等待空闲（devShim 演示轮：done 前有 delta 循环+卡片延时——后续操作输入区前必须等生成结束）
  await evalUntil(page, `!document.querySelector('button[title="停止生成"]')`, (v) => v === true, 30000, 'agent 空闲')
}

let fail = 0
let tab = null
try {
  tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  console.log('TAB:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`, (v) => v === true, 20000, '正文页就绪')
  console.log('OK 正文页就绪')
  await evalUntil(page, `[...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('第1章 · 雾港'))`, (v) => v === true, 10000, '章节项出现')
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('第1章 · 雾港')); b.click(); return true })()`)
  await sleep(800)
  console.log('OK 选中第1章')

  // ① 首次建议：出现 CollectCard（需求/关键词/理由/类别默认值）
  await sendPrompt(page, '建议采集')
  await evalUntil(page, `!!document.querySelector('[data-testid="zj-collect-create"]')`, (v) => v === true, 15000, '建议卡出现')
  const cardInfo = await page.eval(`(() => {
    const card = document.querySelector('[data-testid="zj-collect-create"]').closest('.rounded-xl')
    return {
      text: card.innerText,
      cat: document.querySelector('[data-testid="zj-collect-category"]')?.value ?? ''
    }
  })()`)
  if (!cardInfo.text.includes('建议采集素材')) throw new Error('① 建议卡标题缺失')
  if (!cardInfo.text.includes(DEMAND)) throw new Error('① 建议卡需求文本缺失')
  if (!cardInfo.text.includes('火车站候车室')) throw new Error('① 建议卡关键词缺失')
  if (!cardInfo.text.includes('第03章雾港线')) throw new Error('① 建议卡理由缺失')
  if (cardInfo.cat !== '环境') throw new Error('① 类别输入默认值应为 环境，实际=' + cardInfo.cat)
  console.log('OK ① 建议卡内容完整（需求/关键词/理由/类别=' + cardInfo.cat + '）')

  // ② 创建采集任务：任务卡落采集池（front matter 可读回）
  await page.eval(`(() => { document.querySelector('[data-testid="zj-collect-create"]').click(); return true })()`)
  await evalUntil(page, `!!document.querySelector('[data-testid="zj-collect-result"]')`, (v) => v === true, 10000, '创建结果出现')
  const r1 = await page.eval(`document.querySelector('[data-testid="zj-collect-result"]').textContent`)
  const m = r1.match(/任务_\d+/)
  if (!m) throw new Error('② 创建结果未含任务卡文件名：' + r1)
  const taskFile = m[0] + '.md'
  const cardText = await page.eval(`window.zhijuan.readDoc('demo-aseya', '素材库/采集池/${taskFile}')`)
  if (!cardText || !cardText.includes('status: pending')) throw new Error('② 任务卡未落 pending：' + String(cardText).slice(0, 120))
  if (!cardText.includes(DEMAND)) throw new Error('② 任务卡缺需求字段')
  if (!cardText.includes('关键词: [火车站候车室, 九十年代, 候车室陈设]')) throw new Error('② 任务卡缺关键词字段')
  if (!cardText.includes('类别: 环境')) throw new Error('② 任务卡缺类别字段')
  if (!cardText.includes('创建:')) throw new Error('② 任务卡缺创建字段')
  console.log('OK ② 任务卡落盘：' + m[0] + '（front matter 四字段齐）')

  // ③ 同需求查重：再发一次建议 → 创建 → 提示已有进行中的同需求任务
  await sendPrompt(page, '建议采集')
  await evalUntil(
    page,
    `document.querySelectorAll('[data-testid="zj-collect-create"]').length >= 1 && document.querySelectorAll('[data-testid="zj-collect-category"]').length >= 2`,
    (v) => v === true,
    15000,
    '第二条建议卡出现'
  )
  await page.eval(`(() => { const bs = document.querySelectorAll('[data-testid="zj-collect-create"]'); bs[bs.length - 1].click(); return true })()`)
  await evalUntil(page, `document.querySelectorAll('[data-testid="zj-collect-result"]').length >= 2`, (v) => v === true, 10000, '第二条结果出现')
  const r2 = await page.eval(`document.querySelectorAll('[data-testid="zj-collect-result"]')[1].textContent`)
  if (!r2.includes('已有进行中的同需求任务')) throw new Error('③ 查重提示缺失：' + r2)
  console.log('OK ③ 同需求查重命中，未重复创建')

  // ④ 忽略：第三条建议 → 忽略 → 已忽略态
  await sendPrompt(page, '建议采集')
  await evalUntil(
    page,
    `document.querySelectorAll('[data-testid="zj-collect-ignore"]').length >= 1 && document.querySelectorAll('[data-testid="zj-collect-category"]').length >= 3`,
    (v) => v === true,
    15000,
    '第三条建议卡出现'
  )
  await page.eval(`(() => { const bs = document.querySelectorAll('[data-testid="zj-collect-ignore"]'); bs[bs.length - 1].click(); return true })()`)
  await evalUntil(page, `document.body.innerText.includes('已忽略')`, (v) => v === true, 10000, '忽略态出现')
  console.log('OK ④ 忽略路径：建议卡标已忽略')

  // ⑤ 无 JS 异常
  await sleep(500)
  const errs = page.errors.filter((e) => !e.includes('favicon'))
  if (errs.length) { console.log('JS ERRORS: ' + JSON.stringify(errs, null, 2)); fail++ }
  console.log('OK ⑤ 无 JS 异常（errors=' + errs.length + '）')
  await closeTab(tab)
} catch (e) {
  console.error('FAIL: ' + e.message)
  fail++
} finally {
  if (tab?.id && fail > 0) await closeTab(tab)
}
console.log(fail === 0 ? 'ALL PASS' : 'FAILED ' + fail)
process.exit(fail === 0 ? 0 : 1)
