// 提案抽屉 HIG 走查冒烟（2026-09-21 14:15 体验层，候选 1=ProposalDrawer 整页走查）
// 落地：①done 分组组头「已处理 N 条」+分隔；②done 卡隐藏 disabled 接受/拒绝按钮；③将写入/原状
//      ReactMarkdown 渲染（与 AgentPanel prose 同口径）；④超长 after 限高内滚（VS Code/GitHub diff 先例）。
// 断言：A 四态种子+分组结构+组头顺序；B done 卡无处置按钮/pending 卡有；C diff markdown 渲染（h2 出现、
//      无字面 ##）且原状限高；D 超长将写入 max-h+内滚生效、展开后卡高不超视口 2 倍；E 接受按钮功能不回归
//      （接受一条→已处理计数+1）；F 零 JS 异常双通道。
// 用法：node scripts/proposal-drawer-hig-ui-smoke.mjs（先 npm run build + serve-renderer 8123 + CDP 9224）
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const PID = 'demo-aseya'
const page = await (await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(`${BASE}/?cb=${Date.now()}`), { method: 'PUT' })).json()
if (!page) { console.error('NO PAGE'); process.exit(1) }
const watchdog = setTimeout(() => { console.error('WATCHDOG TIMEOUT'); process.exit(2) }, 150000)
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.text ?? 'exception')
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push('console.error')
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT: ${method}`)) }, 8000)
    pending.set(id, (m) => { clearTimeout(to); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = async (expression) => {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result?.value
}
await new Promise((r) => (ws.onopen = r))
await cmd('Runtime.enable')
let pass = 0, fail = 0
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); cond ? pass++ : fail++ }

try {
  await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/${PID}/novel` })
  await sleep(3000)
  await ev(`window.dispatchEvent(new CustomEvent('zj:open-proposals'))`)
  await sleep(400)

  // ===== 种子四态：pending×2（含超长 after）+ stale×1 + accepted×1 + rejected×1 =====
  const seedRes = await ev(`(async () => {
    const P = window.zhijuan
    // P1 -> accepted：agent-chat upsert-section（applyAnchor 无锚点会文末追加=成功）
    const p1 = (await P.createProposals('${PID}', 'agent-chat', '第01章_雾港栈桥.md', '雾港夜', [{
      target: '人物/沈藏.md', anchor: '切片：雾港夜', kind: 'upsert-section', before: '',
      after: '## 切片：雾港夜\\n\\n（走查 HIG）守灯人把灯芯擦亮，潮声里有人唤阿七。',
      reason: '（走查）人物动态'
    }]))[0]
    // P2 -> pending 超长 after（40 条）
    const longAfter = '## 切片：雾港夜\\n\\n' + Array.from({length: 40}, (_, i) => '- 第' + (i + 1) + '条：沈藏与阿七第' + (i + 1) + '次相遇，潮声盖过心跳，堤岸灯影在浪里碎成一片一片。').join('\\n')
    const p2 = (await P.createProposals('${PID}', 'slice-sync', '第02章_铁锚与潮声.md', '雾港夜', [{
      target: '人物/沈藏.md', anchor: '切片：雾港夜', kind: 'upsert-section', before: '',
      after: longAfter, reason: '（走查）超长将写入内容'
    }]))[0]
    // P3 -> stale：第03章先建再同章重建
    const p3 = (await P.createProposals('${PID}', 'annotation-sync', '第03章_潮汐的岔路.md', '雾港夜', [{
      target: '正文/第03章_潮汐的岔路.md', anchor: '', kind: 'replace-text', before: '旧句', after: '新句',
      reason: '（走查）批注改写'
    }]))[0]
    const p4 = (await P.createProposals('${PID}', 'slice-sync', '第03章_潮汐的岔路.md', '雾港夜', [{
      target: '人物/沈藏.md', anchor: '切片：雾港夜', kind: 'upsert-section', before: '',
      after: '## 切片：雾港夜\\n\\n（走查 D）同一章的新提案。',
      reason: '（走查）同章第二条'
    }]))[0]
    // P5 -> rejected：agent-chat 第04章
    const p5 = (await P.createProposals('${PID}', 'agent-chat', '第04章_船影.md', '雾港夜', [{
      target: '世界观/总纲.md', anchor: '城名：雾港', kind: 'replace-text', before: '城名：雾港', after: '城名：雾港（旧称灯城）',
      reason: '（走查）世界观补旧称'
    }]))[0]
    const a1 = await P.applyProposal('${PID}', p1.id)
    const r5 = await P.rejectProposal('${PID}', p5.id)
    const ps = await P.listProposals('${PID}')
    const st = (id) => ps.find((x) => x.id === id)?.status
    return { p1: { id: p1.id, st: st(p1.id) }, p2: { id: p2.id, st: st(p2.id) }, p3: { id: p3.id, st: st(p3.id) }, p4: { id: p4.id, st: st(p4.id) }, p5: { id: p5.id, st: st(p5.id) }, a1, r5 }
  })()`)
  ok(seedRes.a1?.ok === true && seedRes.p1.st === 'accepted', `accepted 种子成功（${JSON.stringify(seedRes.p1)}）`)
  ok(seedRes.p2.st === 'pending', `pending 超长种子成功（${JSON.stringify(seedRes.p2.st)}）`)
  ok(seedRes.p3.st === 'stale' && seedRes.p4.st === 'pending', `stale 种子成功（p3=${seedRes.p3.st} p4=${seedRes.p4.st}）`)
  ok(seedRes.r5 === true && seedRes.p5.st === 'rejected', `rejected 种子成功（${JSON.stringify(seedRes.p5)}）`)

  // ===== 打开抽屉 =====
  await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.title && x.title.includes('查看/处理待确认'))
    if (!b) return 'NO_BTN'
    b.click()
    return 'CLICKED'
  })()`)
  await sleep(800)
  const opened = await ev(`!![...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案')`)
  ok(opened === true, '提案抽屉已打开')

  // ===== A. 分组结构与组头顺序 =====
  const g = await ev(`(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案')
    const text = dlg ? dlg.innerText : ''
    const idx = (s) => text.indexOf(s)
    return {
      pend: idx('待确认 2'), done: idx('已处理 2 条'), stale: idx('已过期 1 条'),
      order: idx('待确认 2') < idx('已处理 2 条') && idx('已处理 2 条') < idx('已过期 1 条'),
      hasH3: !!dlg.querySelector('h3')
    }
  })()`)
  ok(g.pend >= 0 && g.done >= 0 && g.stale >= 0, `三组头齐全（待确认 ${g.pend} / 已处理 ${g.done} / 已过期 ${g.stale}）`)
  ok(g.order === true && g.hasH3 === true, '组头序=待确认→已处理→已过期（HIG Lists grouped）')

  // ===== B. done 卡无处置按钮；pending 卡有 =====
  const btns = await ev(`(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案')
    const cards = [...dlg.querySelectorAll('[data-pid]')]
    const pendCards = cards.filter((c) => c.querySelector('[data-pid] :scope') === null)
    const grp = {}
    const info = { pendHas: false, doneHas: false, disabledInDone: false, doneBtnText: [] }
    for (const c of cards) {
      const t = c.innerText
      const btnTexts = [...c.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean)
      const hasApply = btnTexts.some((x) => x.startsWith('接受'))
      const hasRej = btnTexts.some((x) => x.startsWith('拒绝'))
      if (/待确认/.test(t)) {
        if (hasApply && hasRej) info.pendHas = true
      } else if (/已接受|已拒绝/.test(t)) {
        if (hasApply || hasRej) { info.doneHas = true; info.doneBtnText.push(JSON.stringify(btnTexts)) }
        const disabled = [...c.querySelectorAll('button')].filter((b) => b.disabled)
        if (disabled.length) info.disabledInDone = true
      }
    }
    return info
  })()`)
  ok(btns.pendHas === true, 'pending 卡保留「接受/拒绝」按钮')
  ok(btns.doneHas === false && btns.disabledInDone === false, `done 卡无处置按钮、无 disabled 死控件（${JSON.stringify(btns.doneBtnText)}）`)

  // ===== C/D. diff markdown 渲染 + 限高内滚（超长卡）=====
  const diff = await ev(`(async () => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案')
    const card = dlg?.querySelector('[data-pid="${seedRes.p2.id}"]')
    if (!card) return { noCard: true }
    ;[...card.querySelectorAll('button')].find((b) => b.innerText.includes('前后对照'))?.click()
    await new Promise((r) => setTimeout(r, 300))
    const proseAll = [...card.querySelectorAll('.prose')]
    const afterEl = proseAll[proseAll.length - 1]
    const beforeEl = proseAll[0]
    const cs = afterEl ? getComputedStyle(afterEl) : null
    const bcs = beforeEl ? getComputedStyle(beforeEl) : null
    return {
      h2Count: card.querySelectorAll('.prose h2').length,
      h2Text: card.querySelector('.prose h2')?.textContent || '',
      hasLiteralMd: card.innerText.includes('## '),
      afterClientH: afterEl?.clientHeight || 0, afterScrollH: afterEl?.scrollHeight || 0,
      overflowY: cs?.overflowY || '', overscrollY: cs?.overscrollBehaviorY || '',
      beforeClientH: beforeEl?.clientHeight || 0, beforeOverflow: bcs?.overflow || '',
      cardH: card.offsetHeight, vh: window.innerHeight
    }
  })()`)
  ok(!diff.noCard && diff.h2Count === 1 && diff.h2Text.includes('切片：雾港夜'), `将写入 ReactMarkdown 渲染（h2=${diff.h2Count}「${diff.h2Text}」）`)
  ok(diff.hasLiteralMd === false, 'diff 内无字面「## 」markdown 源码')
  ok(diff.afterClientH > 0 && diff.afterScrollH > diff.afterClientH && diff.afterClientH <= 500 && diff.overflowY === 'auto' && diff.overscrollY === 'contain', `超长将写入限高内滚（clientH=${diff.afterClientH} scrollH=${diff.afterScrollH} overflowY=${diff.overflowY}）`)
  ok(diff.beforeOverflow === 'hidden' && diff.beforeClientH <= 76, `原状摘要限高（clientH=${diff.beforeClientH} overflow=${diff.beforeOverflow}）`)
  ok(diff.cardH < diff.vh * 2, `超长卡展开后不超 2 倍视口（cardH=${diff.cardH} vh=${diff.vh}）`)

  // ===== E. 接受功能回归：接受 P4 → 已处理 3 条 =====
  const applyOne = await ev(`(async () => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案')
    const card = dlg?.querySelector('[data-pid="${seedRes.p4.id}"]')
    if (!card) return { noCard: true }
    ;[...card.querySelectorAll('button')].find((b) => b.innerText.trim() === '接受')?.click()
    await new Promise((r) => setTimeout(r, 600))
    return { text: dlg.innerText, n: (dlg.innerText.match(/已处理 \\d+ 条/) || [''])[0] }
  })()`)
  ok(!applyOne.noCard && applyOne.n.includes('已处理 3 条'), `接受后计数联动（${applyOne.n}）`)

  ok(errors.length === 0, `零 JS 异常（${errors.length}）`)
  console.log(`\n${pass} PASS / ${fail} FAIL`)
  process.exit(fail > 0 ? 1 : 0)
} catch (e) {
  console.error('FATAL', e)
  console.log(`\n${pass} PASS / ${fail} FAIL`)
  process.exit(1)
} finally {
  clearTimeout(watchdog)
  try { ws.close() } catch {}
}
