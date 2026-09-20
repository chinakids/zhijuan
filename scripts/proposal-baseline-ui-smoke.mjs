// 织卷无头冒烟 · 提案「接受时一致性校验」（创作层 2026-09-20 21:45 轮，候选 3 收口）
// 背景：upsert-section 原先只做锚点查找（命中即整节替换、未命中即文末追加），提案生成后被
//       作者手写/其他提案更新过的节会被静默覆盖（人物/世界观档无版本历史可回滚）。
// 落地：生成端（createSliceProposals）由代码提取生成时刻小节完整内容写 beforeExact 基线；
//       applyAnchor 见基线（beforeExact!==undefined）时做一致性校验——漂移→拒绝+提示
//       （与 replace-text before 校验同语义，内容校验失败→rejected 不可重试）；无基线
//       （旧档/agent-chat 转提案）维持旧行为。devShim 同口径。
// 断言：A1 保存→「已生成 1 条切片提案」（注入链路 intact）
//       A2 数据层：pending 提案 items[0].beforeExact=生成时刻节内容（代码提取，非模型一句话要点）
//       A3 作者后写该节 → 抽屉「前后对照」原状区显示的是生成时基线（非当前被改内容）
//       A4 点「接受」→ rejected + 卡片红字「已被修改」+ toast「提案未应用」
//       A5 人物档保留作者后写内容（未被旧提案覆盖）
//       B1 无基线兼容：直建提案（无 beforeExact）apply 成功（旧行为零回归）
//       E  全程零 JS 异常
// 用法：node scripts/proposal-baseline-ui-smoke.mjs（先 npm run build + serve-renderer 8123 + CDP 9224）
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const PID = 'demo-aseya'
const page = await (await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(`${BASE}/?cb=${Date.now()}&zj-sync-items=1`), { method: 'PUT' })).json()
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
const findFloat = async (substr) => ev(`(() => {
  const els = [...document.querySelectorAll('div, span, p')].map((d) => (d.innerText || d.textContent || ''))
  const hit = els.filter((t) => t.includes(${JSON.stringify(substr)}))
  return hit.sort((a, b) => a.length - b.length)[0] ?? null
})()`)
const pathOf = (extra) => `${process.env.HOME}/Pictures/zhijuan/${extra}`
const shot = async (name) => {
  try {
    const s = await cmd('Page.captureScreenshot', { format: 'png' })
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(pathOf(''), { recursive: true })
    const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
    const file = pathOf(`${name}-${hhmm}.png`)
    writeFileSync(file, Buffer.from(s.data, 'base64'))
    console.log('📸 截图已存', file)
  } catch (e) { console.log('截图失败（不阻塞）：', String(e)) }
}

try {
  // ===== 0. 打开 Novel 页并选中第1章 =====
  await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}&zj-sync-items=1#/project/${PID}/novel` })
  await sleep(3000)
  await ev(`(() => {
    const btn = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes('第1章'))
    if (!btn) return false
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    btn.click()
    return true
  })()`)
  await sleep(2500)
  ok(await ev(`!!(window.__ZJ_EDITORS && window.__ZJ_EDITORS.length)`), '编辑器实例已挂载')

  // ===== 1. 预置人物档切片节（模拟作者已维护该节）→ 保存生成提案（基线=预置内容） =====
  const preset = await ev(`(async () => {
    const cur = (await window.zhijuan.readDoc('${PID}', '人物/沈藏.md')) ?? ''
    const next = cur.replace(/\\n*$/, '') + '\\n\\n## 切片：雾港夜\\n\\n- 预置：守灯待机\\n'
    await window.zhijuan.writeDoc('${PID}', '人物/沈藏.md', next)
    return (await window.zhijuan.readDoc('${PID}', '人物/沈藏.md')).includes('预置：守灯待机')
  })()`)
  ok(preset === true, '已预置「切片：雾港夜」节（作者已维护态）')
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
  await sleep(2500)
  const f1 = await findFloat('已生成 1 条切片提案')
  ok(!!f1, `浮条出现「已生成 1 条切片提案」（${JSON.stringify((f1 || '').slice(0, 60))}）`)

  // ===== A2. 数据层：beforeExact=生成时刻节内容（代码提取） =====
  const base = await ev(`(async () => {
    const ps = await window.zhijuan.listProposals('${PID}')
    const p = ps.find((x) => x.status === 'pending')
    if (!p) return null
    return { id: p.id, be: p.items[0]?.beforeExact, kind: p.items[0]?.kind }
  })()`)
  ok(!!base && base.kind === 'upsert-section' && typeof base.be === 'string' && base.be.includes('预置：守灯待机'), `beforeExact 基线=生成时刻节内容（${JSON.stringify(base)}）`)

  // ===== 2. 作者后写该节（提案生成之后、接受之前） =====
  const rewrote = await ev(`(async () => {
    const cur = (await window.zhijuan.readDoc('${PID}', '人物/沈藏.md')) ?? ''
    if (!cur.includes('预置：守灯待机')) return 'NO_SECTION'
    const next = cur.replace('- 预置：守灯待机', '- 预置：守灯待机\\n- 作者后写：海况自查')
    await window.zhijuan.writeDoc('${PID}', '人物/沈藏.md', next)
    return true
  })()`)
  ok(rewrote === true, '作者后写该节（追加「作者后写：海况自查」）')

  // ===== 3. 打开提案抽屉 → 展开「前后对照」= 原状区显示生成时基线（非当前被改内容） =====
  await ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('查看/处理待确认') || (b.innerText || '').trim() === '待确认提案' || (b.innerText || '').includes('待确认提案'))
    if (btn) btn.click()
    return !!btn
  })()`)
  await sleep(800)
  ok(await ev(`document.body.innerText.includes('提案') && !!document.body.innerText.match(/待确认\\s*1/)`), '提案抽屉已打开（待确认 1）')
  await ev(`(() => {
    const card = document.querySelector('[data-pid]')
    if (!card) return false
    const b = [...card.querySelectorAll('button')].find((x) => (x.innerText || '').includes('前后对照'))
    if (b) b.click()
    return !!b
  })()`)
  await sleep(600)
  const diffText = await ev(`(() => {
    const card = document.querySelector('[data-pid]')
    if (!card) return ''
    const boxes = [...card.querySelectorAll('div')].filter((d) => (d.innerText || '').includes('预置：守灯待机'))
    return boxes.sort((a, b) => a.innerText.length - b.innerText.length)[0]?.innerText ?? ''
  })()`)
  ok(diffText.includes('预置：守灯待机') && !diffText.includes('作者后写'), `前后对照「原状」=生成时基线（非当前改后内容）：${JSON.stringify(diffText.slice(0, 60))}`)
  await shot('proposal-baseline-diff')

  // ===== A4. 点「接受」→ 拒绝 + 红字 + toast =====
  await ev(`(() => {
    const card = document.querySelector('[data-pid]')
    if (!card) return false
    const b = [...card.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '接受')
    if (b) b.click()
    return !!b
  })()`)
  await sleep(1500)
  const after = await ev(`(async () => {
    const ps = await window.zhijuan.listProposals('${PID}')
    const p = ps.find((x) => x.status === 'rejected')
    const doc = (await window.zhijuan.readDoc('${PID}', '人物/沈藏.md')) ?? ''
    const card = document.querySelector('[data-pid]')
    return { rejected: !!p, docKept: doc.includes('作者后写：海况自查'), cardErr: card?.innerText.includes('已被修改') ?? false, toast: document.body.innerText.includes('提案未应用') }
  })()`)
  ok(after.rejected, '漂移提案已 rejected（内容校验失败，与 replace-text 同处置）')
  ok(after.cardErr, '卡片红字「已被修改」可见（errMap 换组保留）')
  ok(after.toast, `toast「提案未应用」可见`)
  await shot('proposal-baseline-rejected')

  // ===== A5. 人物档保留作者后写内容（未被旧提案覆盖） =====
  ok(after.docKept, '人物档保留作者后写内容（覆盖被拦截）')

  // ===== B1. 无基线兼容：直建提案（无 beforeExact）→ apply 成功（旧行为零回归） =====
  const b1 = await ev(`(async () => {
    const created = await window.zhijuan.createProposals('${PID}', 'slice-sync', '正文/第01章_雾港.md', '雾港夜', [{
      target: '人物/沈藏.md', anchor: '切片：雾港夜', kind: 'upsert-section', before: '一句话要点', after: '(B1) 无基线兼容写入。', reason: 'B1 兼容'
    }])
    const p = created?.[0]
    if (!p) return null
    const r = await window.zhijuan.applyProposal('${PID}', p.id)
    const doc = (await window.zhijuan.readDoc('${PID}', '人物/沈藏.md')) ?? ''
    return { ok: r.ok, status: p.status, written: doc.includes('(B1) 无基线兼容写入。') }
  })()`)
  ok(b1 && b1.ok === true && b1.status === 'accepted' && b1.written, `无基线（旧档/agent-chat 转提案）维持旧行为：接受成功并写入（${JSON.stringify(b1)}）`)
} catch (e) {
  fail++
  console.log('❌ EXCEPTION:', String(e))
}
try { await fetch('http://127.0.0.1:9224/json/close/' + page.id) } catch { /* 忽略 */ }
clearTimeout(watchdog)
ok(errors.length === 0, `全程零 JS 异常（${errors.length ? errors.join('; ') : '无'}）`)
console.log(`\nPROPOSAL-BASELINE UI SMOKE ${fail === 0 ? 'PASS' : 'FAIL'} (${pass}/${pass + fail})`)
process.exit(fail === 0 ? 0 : 1)
