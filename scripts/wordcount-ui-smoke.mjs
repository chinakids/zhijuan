// 编辑器实时字数 · 无头 UI 冒烟（2026-09-23 创作层：编辑器状态条「约 N 字」）
// 断言：① 打开 demo-aseya 选中第1章 → 状态条出现「约 N 字」（N>0，countWords 口径）；
//       ② 向编辑器插入中文文本 → 字数实时 +4；③ 读取失败态不显示字数（?zj-fail=readDoc）。
// 用法：node scripts/wordcount-ui-smoke.mjs  （先 npm run build + node scripts/serve-renderer.mjs 8123，CDP 9224 在跑）
// 注：注入表达式内正则一律用 [0-9] 字符类（无转义），勿写 \\d（两层传输会把 \\d 打平成字面反斜杠——health-bar 同坑）。
//
// 2026-10-28 全量冒烟实踩后改为「每个 URL 各开一个新 tab」：
//   ① 原先「复用已有 page tab」在并发/残留 tab 环境下会挑到被别处驱动的 tab；
//   ② 更关键：对已存在的 tab 发 `Page.navigate`（跨文档导航）在本机 9224 无头实例上会把该 target 变成 CDP 黑洞
//      （导航其实生效了，但之后 Page/Runtime 全无回包 → 整支 150s 超时、看不出卡点；已用最小脚本复现）。
//   现做法：tab 建出来就直接落在目标 URL（含 hash），不再导航；顺带给 cmd 加 30s 兜底，卡住即显式报错。
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function openPage(url) {
  const tab = await (await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json()
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      const t = setTimeout(() => { pending.delete(id); rej(new Error('CDP TIMEOUT ' + method)) }, 30000)
      pending.set(id, (m) => { clearTimeout(t); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) })
      ws.send(JSON.stringify({ id, method, params }))
    })
  await new Promise((r) => (ws.onopen = r))
  await cmd('Runtime.enable')
  const ev = async (expression) => {
    const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result?.value
  }
  return { cmd, ev, errors, close: () => { try { ws.close() } catch { /* ignore */ } } }
}

const pickCh1 = `(() => {
  const btn = [...document.querySelectorAll('aside button, [data-testid="chapter-sidebar"] button')].find((b) => (b.innerText || '').includes('第1章') && (b.innerText || '').includes('雾港'))
  if (!btn) return false
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  btn.click()
  return true
})()`
const readCount = async (page) => {
  const t = await page.ev(`(() => {
    const els = [...document.querySelectorAll('span')].filter((e) => /约 [0-9]+ 字/.test(e.textContent || ''))
    return els.length ? els[0].textContent : null
  })()`)
  if (!t) return null
  const m = /约 ([0-9]+) 字/.exec(t)
  return m ? parseInt(m[1], 10) : null
}
let pass = 0
let fail = 0
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); cond ? pass++ : fail++ }

// ---- ①② 正常读取：状态条字数 + 输入实时更新 ----
const p1 = await openPage(`${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel`)
let n = null
let n2 = null
try {
  await sleep(3500)
  await p1.ev(pickCh1)
  await sleep(2500)
  for (let i = 0; i < 20; i++) {
    n = await readCount(p1)
    if (n !== null) break
    await sleep(500)
  }
  ok(n !== null && n > 0, `① 状态条显示实时字数（实际 ${n}）`)

  await p1.ev(`(() => { const ed = document.querySelector('.zj-md .ProseMirror'); if (!ed) return false; ed.focus(); return true })()`)
  await sleep(300)
  await p1.cmd('Input.insertText', { text: '测试文字' })
  await sleep(800)
  n2 = await readCount(p1)
  ok(n2 !== null && n2 === (n ?? 0) + 4, `② 输入后字数实时更新（${n} → ${n2}）`)
} catch (e) {
  ok(false, '①② 场景异常：' + String(e).slice(0, 160))
} finally {
  p1.close()
}

// ---- ③ 读取失败态不显示字数（独立 tab，直接落在 zj-fail URL）----
const p2 = await openPage(`${BASE}/?cb=${Date.now()}&zj-fail=readDoc#/project/demo-aseya/novel`)
try {
  await sleep(3500)
  await p2.ev(pickCh1)
  await sleep(2500)
  const n3 = await readCount(p2)
  const errCard = await p2.ev(`!!document.body.innerText.includes('读取文档失败')`)
  ok(n3 === null && errCard, `③ 读取失败态不显示字数（字数=${n3}，失败卡=${errCard}）`)
} catch (e) {
  ok(false, '③ 场景异常：' + String(e).slice(0, 160))
} finally {
  p2.close()
}

const allErrors = [...p1.errors, ...p2.errors]
if (allErrors.length) { console.log('⚠️ JS 异常：' + allErrors.join(' | ')); fail++ }
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)