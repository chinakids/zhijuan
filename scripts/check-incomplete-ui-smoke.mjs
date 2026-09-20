// 织卷无头冒烟 · 检查抽屉「提取失败≠零发现」语义（2026-09-20 智能层，候选「检查域空结果语义收口」）：
// 真机 runSubtask 提取失败（模型未按格式回复、重试后仍空）→ {ok:true, result, lastRaw} 弱结果；
// devShim 用 ?zj-checkfail=1 / ?zj-dcheckfail=1 注入同形态，验证：
//   Tab1 本章小环（短巡查+分层修订）→ 显示「检查未完成」+重试，而非「这一遍没有发现问题」；重试会重新驱动（出现运行态）；
//   Tab2 ?zj-checkempty=1 合法空 JSON（真零发现）→ 仍显示「这一遍没有发现问题」（语义区分守卫）；
//   Tab3 导演兑现检查 → 「检查未完成」，而非「这一遍没有核对出值得写下的条目」；
//   全程零 JS 异常（Runtime.enable + exceptionThrown + console error 双通道）。
// 用法：node scripts/check-incomplete-ui-smoke.mjs（前置：npm run build；serve-renderer 8123；CDP 9224）
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = await import('node:fs')
const SHOT_DIR = process.env.ZJ_SHOT_DIR || process.env.HOME + '/Pictures/zhijuan'
fs.mkdirSync(SHOT_DIR, { recursive: true })

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
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    }
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
        cmd,
        errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        shot: async (file) => {
          const r = await cmd('Page.captureScreenshot', { format: 'png' })
          fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
          return file
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

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}
const clickChapter = (titlePart) => `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes(${JSON.stringify(titlePart)})); if (!b) return 'NOT_FOUND'; b.click(); return 'CLICKED' })()`
const clickTitleStartsWith = (prefix) => `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title && x.title.startsWith(${JSON.stringify(prefix)})); if (!b) return 'NOT_FOUND'; b.click(); return 'CLICKED' })()`
const clickText = (text) => `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(text)}); if (!b) return 'NOT_FOUND'; b.click(); return 'CLICKED' })()`
const clickAria = (label) => `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute && (x.getAttribute('aria-label') || '') === ${JSON.stringify(label)}); if (!b) return 'NOT_FOUND'; b.click(); return 'CLICKED' })()`

// ── Tab 1：本章小环（短巡查 + 分层修订）提取失败 ——
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-checkfail=1#/project/demo-aseya/novel')
  console.log('TAB1:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, `document.body.innerText.includes('第01章') || document.body.innerText.includes('雾港')`, (v) => v === true, 20000, 'Novel 就绪')
    ok('Tab1 Novel 页就绪', true)
    await evalUntil(page, clickChapter('雾港'), (v) => v === 'CLICKED', 8000, '选章')
    await sleep(400)
    await evalUntil(page, clickTitleStartsWith('本章小环'), (v) => v === 'CLICKED', 8000, '打开小环')
    // 弱结果 → 「检查未完成」；不得出现「这一遍没有发现问题」
    await evalUntil(page, `document.body.innerText.includes('检查未完成')`, (v) => v === true, 10000, '短巡查弱结果呈现')
    ok('Tab1 短巡查显示「检查未完成」', true)
    const body1 = await page.eval(`document.body.innerText`)
    ok('Tab1 未出现「这一遍没有发现问题」（假零发现）', !body1.includes('这一遍没有发现问题'))
    ok('Tab1 有「重试」按钮', await page.eval(`[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === '重试')`))
    const stamp = new Date().toTimeString().slice(0, 5).replace(':', '')
    await page.shot(SHOT_DIR + '/checkfail-chapter-' + stamp + '.png')
    console.log('SHOT: ' + SHOT_DIR + '/checkfail-chapter-' + stamp + '.png')
    // 重试 → 断言真的重新驱动：devShim 瞬时返回，「运行态」帧可能来不及绘制（React 微任务批量），
    // 故给 agentChapterCheck 挂调用计数（重置为弱结果注入），点「重试」后计数 +1 即证明重新驱动。
    await page.eval(`(() => { let calls = 0; window.zhijuan.agentChapterCheck = async () => { calls++; return { ok: true, result: { summary: '', items: [] }, lastRaw: '（演示）重试注入：仍未按格式回复' } }; window.__RETRY_CALLS = () => calls; return true })()`)
    await evalUntil(page, clickText('重试'), (v) => v === 'CLICKED', 5000, '点重试')
    await evalUntil(page, `window.__RETRY_CALLS() >= 1`, (v) => v === true, 8000, '重试重新驱动')
    ok('Tab1 重试重新驱动（agentChapterCheck 再次被调用）', true)
    await evalUntil(page, `document.body.innerText.includes('检查未完成')`, (v) => v === true, 10000, '重试后仍弱')
    ok('Tab1 重试后仍显示「检查未完成」', true)
    // 分层修订同型
    await evalUntil(page, clickText('分层修订'), (v) => v === 'CLICKED', 5000, '切分层修订')
    await evalUntil(page, `document.body.innerText.includes('检查未完成')`, (v) => v === true, 10000, '分层修订弱结果呈现')
    ok('Tab1 分层修订同型「检查未完成」', true)
    const errs = page.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e))
    ok('Tab1 零 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))
    page.close()
  } catch (e) {
    console.error('FATAL(1) ' + e.message)
    fails++
    page.close()
  }
  await fetch(CDP + '/json/close/' + tab.id)
}

// ── Tab 2：合法空 JSON（真零发现）语义保留 ——
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-checkempty=1#/project/demo-aseya/novel')
  console.log('TAB2:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, `document.body.innerText.includes('第01章') || document.body.innerText.includes('雾港')`, (v) => v === true, 20000, 'Novel 就绪')
    await evalUntil(page, clickChapter('雾港'), (v) => v === 'CLICKED', 8000, '选章')
    await sleep(400)
    await evalUntil(page, clickTitleStartsWith('本章小环'), (v) => v === 'CLICKED', 8000, '打开小环')
    await evalUntil(page, `document.body.innerText.includes('这一遍没有发现问题')`, (v) => v === true, 10000, '真零发现呈现')
    ok('Tab2 真零发现仍显示「这一遍没有发现问题」', true)
    ok('Tab2 未出现「检查未完成」', !(await page.eval(`document.body.innerText`)).includes('检查未完成'))
    const stamp = new Date().toTimeString().slice(0, 5).replace(':', '')
    await page.shot(SHOT_DIR + '/checkempty-true-' + stamp + '.png')
    console.log('SHOT: ' + SHOT_DIR + '/checkempty-true-' + stamp + '.png')
    const errs = page.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e))
    ok('Tab2 零 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))
    page.close()
  } catch (e) {
    console.error('FATAL(2) ' + e.message)
    fails++
    page.close()
  }
  await fetch(CDP + '/json/close/' + tab.id)
}

// ── Tab 3：导演兑现检查提取失败 ——
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-dcheckfail=1#/project/demo-aseya/outline')
  console.log('TAB3:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, `document.body.innerText.includes('章卡') && document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '大纲页就绪')
    ok('Tab3 大纲页就绪', true)
    await evalUntil(page, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('第1章 · 雾港')); if (!b) return 'NOT_FOUND'; b.click(); return 'CLICKED' })()`, (v) => v === 'CLICKED', 8000, '选中第1章')
    await evalUntil(page, clickAria('兑现检查'), (v) => v === 'CLICKED', 8000, '打开兑现检查')
    await evalUntil(page, `document.body.innerText.includes('检查未完成')`, (v) => v === true, 10000, '兑现检查弱结果呈现')
    ok('Tab3 兑现检查显示「检查未完成」', true)
    const body3 = await page.eval(`document.body.innerText`)
    ok('Tab3 未出现「这一遍没有核对出值得写下的条目」', !body3.includes('这一遍没有核对出值得写下的条目'))
    ok('Tab3 有「重试」按钮', await page.eval(`[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === '重试')`))
    const stamp = new Date().toTimeString().slice(0, 5).replace(':', '')
    await page.shot(SHOT_DIR + '/dcheckfail-' + stamp + '.png')
    console.log('SHOT: ' + SHOT_DIR + '/dcheckfail-' + stamp + '.png')
    const errs = page.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e))
    ok('Tab3 零 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))
    page.close()
  } catch (e) {
    console.error('FATAL(3) ' + e.message)
    fails++
    page.close()
  }
  await fetch(CDP + '/json/close/' + tab.id)
}

console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL (' + fails + ')')
process.exit(fails === 0 ? 0 : 1)
