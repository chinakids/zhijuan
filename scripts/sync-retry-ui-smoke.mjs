// 织卷无头冒烟 · 切片同步失败→就地重试闭环（03:45 观察② → 06:45 候选 2）
// Tab A（Novel）：保存正文→agentSync 一次性失败→失败浮条「✗ 切片同步失败」+「重试同步」按钮
//                →留驻不自动清除→点击重试→成功提示（✓ 无设定变化）+ 按钮消失 + agentSync 被调 2 次
// Tab B（Outline）：分幕采纳→agentSync 一次性失败→toast「切片同步失败」+ action「重试同步」
//                →点击重试→toast 更新「切片同步完成」
// 用法：node scripts/sync-retry-ui-smoke.mjs
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
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
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

const pageHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const clickText = (text, exact = false) => `(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!btn || btn.disabled) return false
  btn.click()
  return true
})()`
const saveEnabled = `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('保存'))
  return !!b && !b.disabled
})()`
const syncCount = `window.__SYNC_CALLS ? window.__SYNC_CALLS.length : -1`
/** 页面运行时封装 agentSync 计数（zj-fail 探针抛错时原 mock 不打点，这里对成败都计数） */
const spyAgentSync = `(() => {
  window.__SYNC_CALLS = []
  const orig = window.zhijuan.agentSync
  window.zhijuan.agentSync = (...a) => { window.__SYNC_CALLS.push(1); return orig(...a) }
  return true
})()`

let passed = 0
const ok = (label, cond, extra = '') => {
  if (!cond) throw new Error('FAIL: ' + label + (extra ? ' | ' + extra : ''))
  passed++
  console.log('  ✓', label)
}

try {
  // ══ Tab A：Novel 保存失败 → 浮条 + 重试成功 ══
  console.log('── Tab A：Novel 保存失败→重试 ──')
  const tabA = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail=agentSync#/project/demo-aseya/novel')
  const pageA = await attach(tabA.webSocketDebuggerUrl)
  await evalUntil(pageA, pageHas('第1章 · 雾港'), (v) => v === true, 20000, 'Novel 章节列表就绪')
  console.log('  页面就绪')
  await pageA.eval(spyAgentSync)
  await pageA.eval(clickText('第1章 · 雾港'))
  await evalUntil(pageA, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, (v) => v === true, 20000, '编辑器挂载')
  console.log('  编辑器已挂载')
  // 改内容置 dirty → 等保存按钮可用 → 点保存
  await pageA.eval(`window.__ZJ_EDITORS[0].setContent(window.__ZJ_EDITORS[0].getMarkdown() + '\\n\\n> 冒烟：触发切片同步。')`)
  await evalUntil(pageA, saveEnabled, (v) => v === true, 10000, '保存按钮可用')
  console.log('  内容已修改（dirty），保存按钮可用')
  await pageA.eval(clickText('保存 ⌘S'))
  // ① 一次性失败 → 失败浮条
  await evalUntil(pageA, pageHas('✗ 切片同步失败'), (v) => v === true, 15000, '失败浮条出现')
  ok('① 保存后失败浮条「✗ 切片同步失败」出现', true)
  ok('② 失败浮条带「重试同步」按钮', (await pageA.eval(pageHas('重试同步'))) === true)
  ok('③ agentSync 首次调用（失败）', (await pageA.eval(syncCount)) === 1, 'count=' + (await pageA.eval(syncCount)))
  // ② 失败消息留驻（>6s 不自动清）
  await sleep(7000)
  ok('④ 失败浮条 7s 后仍在（不随 6s 自动清）', (await pageA.eval(pageHas('✗ 切片同步失败'))) === true)
  // ③ 点击重试 → 成功
  await pageA.eval(clickText('重试同步', true))
  await evalUntil(pageA, pageHas('✓ 无设定变化'), (v) => v === true, 15000, '重试成功提示')
  ok('⑤ 重试成功出现「✓ 无设定变化」', true)
  await sleep(300)
  ok('⑥ 重试后「重试同步」按钮消失', (await pageA.eval(pageHas('重试同步'))) === false)
  ok('⑦ agentSync 第二次调用（成功）', (await pageA.eval(syncCount)) === 2, 'count=' + (await pageA.eval(syncCount)))
  pageA.close()

  // ══ Tab B：Outline 采纳失败 → toast action 重试成功 ══
  console.log('── Tab B：Outline 采纳失败→toast action 重试 ──')
  const tabB = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail=agentSync#/project/demo-aseya/outline')
  const pageB = await attach(tabB.webSocketDebuggerUrl)
  await evalUntil(pageB, pageHas('第1章 · 雾港'), (v) => v === true, 20000, 'Outline 章卡列表就绪')
  await pageB.eval(spyAgentSync)
  await pageB.eval(clickText('第1章 · 雾港'))
  await sleep(500)
  await pageB.eval(clickText('分幕生成'))
  await evalUntil(pageB, pageHas('采纳为正文'), (v) => v === true, 10000, '采纳按钮出现')
  await pageB.eval(clickText('采纳为正文'))
  await evalUntil(pageB, pageHas('再点一次确认采纳'), (v) => v === true, 6000, '确认文案出现')
  await pageB.eval(clickText('再点一次确认采纳'))
  // 一次性失败 → toast 失败 + action
  await evalUntil(pageB, pageHas('切片同步失败'), (v) => v === true, 15000, '失败 toast 出现')
  ok('⑧ Outline 采纳后失败 toast「切片同步失败」', true)
  await evalUntil(
    pageB,
    `[...document.querySelectorAll('.zj-toast button')].some((b) => (b.innerText || '').trim() === '重试同步')`,
    (v) => v === true,
    8000,
    'toast 内 action 按钮'
  )
  ok('⑨ 失败 toast 内含「重试同步」按钮', true)
  ok('⑩ agentSync 首次调用（失败）', (await pageB.eval(syncCount)) === 1, 'count=' + (await pageB.eval(syncCount)))
  // 点 toast 内重试 → 成功
  await pageB.eval(`[...document.querySelectorAll('.zj-toast button')].find((b) => (b.innerText || '').trim() === '重试同步').click()`)
  await evalUntil(pageB, pageHas('切片同步完成'), (v) => v === true, 15000, 'toast 更新为完成')
  ok('⑪ 重试后 toast 更新为「切片同步完成」', true)
  await sleep(300)
  ok('⑫ agentSync 第二次调用（成功）', (await pageB.eval(syncCount)) === 2, 'count=' + (await pageB.eval(syncCount)))
  pageB.close()

  console.log('── 全部通过：' + passed + '/12 ──')
} catch (e) {
  console.error('FAILED at step, passed=' + passed)
  throw e
}
