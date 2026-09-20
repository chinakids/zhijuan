// 织卷无头冒烟 · 审读失败态呈现（2026-09-20 智能层，配合 runAudit 空结果保护）：
// 真机 runAudit 提取失败（模型未按格式回复）→ {ok:false, error} 且不覆盖上次存档；
// devShim 用 ?zj-auditfail=1 注入同形态返回，验证抽屉错误呈现 + 未落盘。
// 用法：node scripts/audit-empty-ui-smoke.mjs（前置：out/renderer 服务器 8123 + CDP 9224）
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
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
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.text ?? 'exception')
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push('console.error: ' + (m.params.args?.[0]?.value ?? ''))
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
      try { await cmd('Runtime.enable') } catch {}
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
const clickByTitle = (title) => `(() => {
  const els = [...document.querySelectorAll('button, [role="menuitem"]')]
  const hit = els.find((b) => b.title === ${JSON.stringify(title)})
  if (!hit) return 'NOT_FOUND'
  hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  hit.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  hit.click()
  return 'CLICKED'
})()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-auditfail=1#/project/demo-aseya/novel')
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')

  // 计数包装（在开抽屉前安装）：验证失败态「重试」真的重新驱动 agentAudit（与 check-incomplete 冒烟同口径）
  await page.eval(`(() => {
    window.__auditCalls = 0
    const orig = window.zhijuan.agentAudit
    window.zhijuan.agentAudit = async (...a) => { window.__auditCalls++; return orig(...a) }
    return true
  })()`)

  // 打开检查菜单 → 一致性巡查
  console.log('打开检查菜单:', await page.eval(clickByTitle('检查阵容：一致性/冷读/多视角/本地核查')))
  await sleep(350)
  console.log('打开巡查:', await page.eval(clickByTitle('一致性巡查：按设定档案检查全卷')))

  // 抽屉应显示提取失败错误文案（与真机 runAudit 保护返回同文案），而非「这一遍没有发现问题」
  await evalUntil(page, `document.body.innerText.includes('检查没有完成')`, (v) => v === true, 20000, '抽屉显示提取失败错误')
  console.log('OK 抽屉显示「检查没有完成」错误文案')
  await evalUntil(page, `document.body.innerText.includes('一致性巡查失败')`, (v) => v === true, 8000, 'toast 失败提示')
  console.log('OK toast 显示「一致性巡查失败」')
  if ((await page.eval(`document.body.innerText`)).includes('这一遍没有发现问题')) {
    throw new Error('失败态不应显示「这一遍没有发现问题」（假零发现）')
  }
  console.log('OK 未出现「这一遍没有发现问题」假正反馈')

  // 未落盘：大纲/ 下不应出现 审读_一致性巡查.md
  const files = await page.eval(`window.zhijuan.listDocs('demo-aseya', '大纲')`)
  const hit = files.find((d) => d.file === '审读_一致性巡查.md')
  if (hit) throw new Error('提取失败后不应落盘审读报告: ' + JSON.stringify(files))
  console.log('OK 提取失败未落盘（大纲/ 无 审读_一致性巡查.md）')

  // 失败态处置入口：正文区应有「重试」按钮（与本章小环/兑现检查同口径），点击后重新驱动 agentAudit
  const calls1 = await page.eval(`window.__auditCalls`)
  if (calls1 !== 1) throw new Error('auto-run 应恰好驱动一次 agentAudit，实际 ' + calls1)
  console.log('OK 抽屉打开自动驱动 agentAudit（1 次）')
  const retryOk = await page.eval(`!!document.querySelector('[data-testid="zj-audit-retry"]')`)
  if (!retryOk) throw new Error('失败态应渲染「重试」按钮（data-testid=zj-audit-retry）')
  console.log('OK 失败态含「重试」按钮')
  await page.eval(`(() => {
    const b = document.querySelector('[data-testid="zj-audit-retry"]')
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    b.click()
    return true
  })()`)
  await evalUntil(page, `window.__auditCalls`, (v) => v === 2, 10000, '重试后 agentAudit 重新驱动')
  console.log('OK 点击「重试」后 agentAudit 重新驱动（2 次）')
  await evalUntil(page, `document.body.innerText.includes('检查没有完成')`, (v) => v === true, 10000, '重试后仍显示失败文案（注入持续失败）')
  console.log('OK 重试后仍为失败态呈现（注入持续，语义正确）')

  try {
    const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
    const fs = await import('node:fs')
    const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
    fs.writeFileSync(`${process.env.HOME}/Pictures/zhijuan/audit-retry-${hhmm}.png`, Buffer.from(shot.data, 'base64'))
    console.log(`📸 截图 saved: ~/Pictures/zhijuan/audit-retry-${hhmm}.png`)
  } catch (e) {
    console.log('截图失败（不阻断）: ' + e.message)
  }
  if (page.errors.length) throw new Error('JS 异常: ' + page.errors.join('; ').slice(0, 400))
  console.log('OK 全程零 JS 异常')

  console.log('\nPASS: 审读失败态（提取失败→错误呈现+不落盘+重试入口）OK')
} finally {
  await fetch(CDP + '/json/close/' + tab.id)
  page.close()
}
