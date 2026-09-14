// 织卷无头冒烟 · 切片同步失败→就地重试闭环（03:45 观察② → 06:45 候选 2 → 09:45 候选 2 续：收口三入口）
// Tab A（Novel）：保存正文→agentSync 一次性失败→失败浮条「✗ 切片同步失败」+「重试同步」按钮
//                →留驻不自动清除→点击重试→成功提示（✓ 无设定变化）+ 按钮消失 + agentSync 被调 2 次
// Tab B（Outline）：分幕采纳→agentSync 一次性失败→toast「切片同步失败」+ action「重试同步」
//                →点击重试→toast 更新「切片同步完成」；带 action 的失败 toast 常驻不自动消失（创作层 2026-09-14 候选 2）
// Tab C（EditCard 采纳，创作层 2026-09-14）：agent 演示修改卡→采纳并写入→同步失败→卡内「重试同步」→成功
// Tab D（HistoryDrawer 恢复，创作层 2026-09-14）：造历史→恢复此版本→同步失败→抽屉内「重试同步」→成功
// Tab E（批注提案接受，创作层 2026-09-14）：批注定时优化首扫生成提案→接受→toast 失败+action→重试成功
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
  // 带 action 的失败 toast 常驻：远超 error 默认 10s 仍在（VS Code「带 action 的通知不自动关闭」口径）
  await sleep(10500)
  ok(
    '⑩b 失败 toast 10.5s 后仍在（带 action 常驻，不自动消失）',
    (await pageB.eval(`[...document.querySelectorAll('.zj-toast')].some((t) => (t.innerText || '').includes('切片同步失败'))`)) === true
  )
  // 点 toast 内重试 → 成功
  await pageB.eval(`[...document.querySelectorAll('.zj-toast button')].find((b) => (b.innerText || '').trim() === '重试同步').click()`)
  await evalUntil(pageB, pageHas('切片同步完成'), (v) => v === true, 15000, 'toast 更新为完成')
  ok('⑪ 重试后 toast 更新为「切片同步完成」', true)
  await sleep(300)
  ok('⑫ agentSync 第二次调用（成功）', (await pageB.eval(syncCount)) === 2, 'count=' + (await pageB.eval(syncCount)))
  pageB.close()

  // ══ Tab C：EditCard 采纳失败 → 卡内重试成功 ══
  console.log('── Tab C：EditCard 采纳失败→卡内重试 ──')
  const tabC = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail=agentSync#/project/demo-aseya/novel')
  const pageC = await attach(tabC.webSocketDebuggerUrl)
  await evalUntil(
    pageC,
    `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`,
    (v) => v === true,
    20000,
    '正文页 Agent 输入框就绪'
  )
  await pageC.eval(spyAgentSync)
  // 输入含「改」触发 devShim 正文修改演示卡
  await pageC.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
    setter.call(ta, '把这段改一下')
    ta.setSelectionRange(ta.value.length, ta.value.length)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)
  await evalUntil(pageC, pageHas('采纳并写入'), (v) => v === true, 20000, 'EditCard 出现')
  ok('⑬ Agent 演示修改卡出现（EditCard）', true)
  await pageC.eval(clickText('采纳并写入'))
  await evalUntil(pageC, pageHas('✗ 切片同步失败'), (v) => v === true, 15000, '卡内失败提示')
  ok('⑭ EditCard 采纳后「✗ 切片同步失败」出现', true)
  ok('⑮ EditCard 内「重试同步」按钮出现', (await pageC.eval(pageHas('重试同步'))) === true)
  ok('⑯ agentSync 首次调用（失败）', (await pageC.eval(syncCount)) === 1, 'count=' + (await pageC.eval(syncCount)))
  await pageC.eval(clickText('重试同步', true))
  await evalUntil(pageC, pageHas('✓ 切片同步：无设定变化'), (v) => v === true, 15000, '卡内重试成功')
  ok('⑰ 重试后卡内「✓ 切片同步：无设定变化」', true)
  await sleep(300)
  ok('⑱ 重试后按钮消失', (await pageC.eval(pageHas('重试同步'))) === false)
  ok('⑲ agentSync 第二次调用（成功）', (await pageC.eval(syncCount)) === 2, 'count=' + (await pageC.eval(syncCount)))
  pageC.close()

  // ══ Tab D：HistoryDrawer 恢复失败 → 抽屉内重试成功 ══
  console.log('── Tab D：历史恢复失败→抽屉内重试 ──')
  const tabD = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail=agentSync#/project/demo-aseya/novel')
  const pageD = await attach(tabD.webSocketDebuggerUrl)
  await evalUntil(pageD, pageHas('第1章 · 雾港'), (v) => v === true, 20000, 'Novel 章节列表就绪')
  await pageD.eval(spyAgentSync)
  await pageD.eval(clickText('第1章 · 雾港'))
  await evalUntil(pageD, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, (v) => v === true, 20000, '编辑器挂载')
  // 造历史：writeDoc 变一下正文 → devShim 入史一版（不触发 agentSync，保留首次失败给恢复）
  // 顶层 await 在 Runtime.evaluate 不可用（被当普通标识符）→ 先读后写，内容用 JSON.stringify 安全嵌入
  const curMd = await pageD.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')`)
  await pageD.eval(
    `window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', ${JSON.stringify((curMd || '') + '\n\n> 冒烟：造一版历史。')}).then(() => true)`
  )
  await sleep(800)
  await pageD.eval(clickText('历史', true))
  await evalUntil(pageD, pageHas('版本历史'), (v) => v === true, 10000, '历史抽屉出现')
  ok('⑳ 历史抽屉打开且含版本条目', (await pageD.eval(pageHas('最新'))) === true)
  await pageD.eval(clickText('恢复此版本'))
  await evalUntil(pageD, pageHas('再次点击确认恢复'), (v) => v === true, 6000, '确认文案出现')
  await pageD.eval(clickText('再次点击确认恢复'))
  await evalUntil(pageD, pageHas('✓ 已恢复；切片同步失败'), (v) => v === true, 15000, '恢复后同步失败提示')
  ok('㉑ 恢复后「✓ 已恢复；切片同步失败」出现', true)
  ok('㉒ 抽屉内「重试同步」按钮出现', (await pageD.eval(pageHas('重试同步'))) === true)
  ok('㉓ agentSync 首次调用（失败）', (await pageD.eval(syncCount)) === 1, 'count=' + (await pageD.eval(syncCount)))
  await pageD.eval(clickText('重试同步', true))
  await evalUntil(pageD, pageHas('✓ 已恢复；切片同步无设定变化'), (v) => v === true, 15000, '抽屉重试成功')
  ok('㉔ 重试后「✓ 已恢复；切片同步无设定变化」', true)
  await sleep(300)
  ok('㉕ 重试后按钮消失', (await pageD.eval(pageHas('重试同步'))) === false)
  ok('㉖ agentSync 第二次调用（成功）', (await pageD.eval(syncCount)) === 2, 'count=' + (await pageD.eval(syncCount)))
  pageD.close()

  // ══ Tab E：批注提案接受失败 → toast action 重试成功 ══
  console.log('── Tab E：批注提案接受失败→toast action 重试 ──')
  const tabE = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail=agentSync#/project/demo-aseya/settings')
  const pageE = await attach(tabE.webSocketDebuggerUrl)
  await evalUntil(pageE, pageHas('外观与数据'), (v) => v === true, 20000, '设置页加载')
  await pageE.eval(clickText('外观与数据'))
  await evalUntil(pageE, pageHas('批注定时优化'), (v) => v === true, 10000, '批注开关')
  await pageE.eval(`(() => {
    const rows = [...document.querySelectorAll('div')].filter((d) => d.textContent && d.textContent.includes('批注定时优化') && d.querySelector('button[role="switch"]'))
    const row = rows[rows.length - 1]
    const s = row && row.querySelector('button[role="switch"]')
    if (!s) return 'NO_SWITCH'
    if (s.getAttribute('aria-checked') !== 'true') s.click()
    return 'OK'
  })()`)
  await pageE.eval(clickText('保存设置', true))
  await sleep(600)
  await pageE.eval(`(() => { location.hash = '#/project/demo-aseya/novel'; return 1 })()`)
  await evalUntil(pageE, pageHas('第1章 · 雾港'), (v) => v === true, 20000, '正文载入')
  await pageE.eval(spyAgentSync)
  // 打开项目 10s 自动首扫 → 生成批注提案 → 顶栏「待确认提案」入口
  await evalUntil(pageE, pageHas('待确认提案'), (v) => v === true, 25000, '批注提案入口出现')
  ok('㉗ 批注首扫生成提案，顶栏「待确认提案」出现', true)
  await pageE.eval(clickText('待确认提案'))
  await evalUntil(pageE, pageHas('来自：批注同步'), (v) => v === true, 10000, '抽屉批注提案')
  ok('㉘ 抽屉含「来自：批注同步」提案', true)
  await pageE.eval(clickText('接受'))
  // 一次性失败 → toast 失败 + action（toast title「切片同步」，失败描述为具体错误）
  await evalUntil(
    pageE,
    `[...document.querySelectorAll('.zj-toast')].some((t) => (t.innerText || '').includes('切片同步'))`,
    (v) => v === true,
    15000,
    '失败 toast 出现'
  )
  ok('㉙ 接受批注提案后出现「切片同步」结果 toast', true)
  await evalUntil(
    pageE,
    `[...document.querySelectorAll('.zj-toast button')].some((b) => (b.innerText || '').trim() === '重试同步')`,
    (v) => v === true,
    8000,
    'toast action'
  )
  ok('㉚ 失败 toast 内含「重试同步」action', true)
  ok('㉛ agentSync 首次调用（失败）', (await pageE.eval(syncCount)) === 1, 'count=' + (await pageE.eval(syncCount)))
  // 带 action 的失败 toast 常驻：远超 warning 默认 8s 仍在
  await sleep(8500)
  ok(
    '㉛b 失败 toast 8.5s 后仍在（带 action 常驻，不自动消失）',
    (await pageE.eval(`[...document.querySelectorAll('.zj-toast')].some((t) => (t.innerText || '').includes('切片同步'))`)) === true
  )
  await pageE.eval(`[...document.querySelectorAll('.zj-toast button')].find((b) => (b.innerText || '').trim() === '重试同步').click()`)
  await evalUntil(pageE, pageHas('切片同步无设定变化'), (v) => v === true, 15000, 'toast 更新为成功')
  ok('㉜ 重试后 toast 更新「正文已改写，切片同步无设定变化」', true)
  await sleep(300)
  ok('㉝ agentSync 第二次调用（成功）', (await pageE.eval(syncCount)) === 2, 'count=' + (await pageE.eval(syncCount)))
  pageE.close()

  console.log('── 全部通过：' + passed + '/35 ──')
} catch (e) {
  console.error('FAILED at step, passed=' + passed)
  throw e
}
