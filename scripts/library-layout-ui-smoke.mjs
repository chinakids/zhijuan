// 素材库页信息架构冒烟（体验层 2026-09-20 11:15 轮，提交见迭代日志）
// 走查实缺修复：①「升格助手」独立行并入搜索行（不单独占行，F-20260917-07）②素材卡预览剥 `# ` 标记 ③任务 chip 时间戳秒级噪音→短日期
// 前置：npm run build；SPA server 8123（scripts/serve-renderer.mjs）
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8123'
const ID = 'libia' + Date.now()
const tab = await (await fetch(CDP + '/json/new?' + encodeURIComponent(BASE + '/?cb=' + ID), { method: 'PUT' })).json()
const ws = new WebSocket(tab.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function evalJs(expression) {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 600))
  return r.result?.value
}
await new Promise((r) => (ws.onopen = r))
await cmd('Page.enable')
await cmd('Page.navigate', { url: BASE + '/?cb=' + ID + '#/project/demo-aseya/library' })
await sleep(2600)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (cond ? '' : ' | ' + extra))
  if (!cond) bad++
}

// [1] 升格行说明文字已不在页面可见文本（移入按钮 title）
const bodyTxt = await evalJs(`document.body.innerText`)
check('升格行说明文字不再常驻可见', !bodyTxt.includes('正式类别下的素材可让写作引擎按语境归类'), '可见文本仍含说明')

// [2] 升格助手按钮存在，且与「新建素材」同处搜索行（同一父容器）
const btnInfo = await evalJs(`(() => {
  const up = document.querySelector('[data-testid="lib-triage-open"]')
  if (!up) return null
  const nw = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '新建素材' || (b.textContent || '').includes('新建素材'))
  return {
    sameParent: !!nw && nw.parentElement === up.parentElement,
    text: up.textContent.trim(),
    titleHasExplain: (up.title || '').includes('逐条判断') || (up.title || '').includes('语境归类')
  }
})()`)
check('升格助手按钮与「新建素材」同排（同一工具条容器）', !!btnInfo && btnInfo.sameParent, JSON.stringify(btnInfo))
check('升格助手按钮文字 + 说明入 title', !!btnInfo && btnInfo.text.includes('升格助手') && btnInfo.titleHasExplain, JSON.stringify(btnInfo))

// [3] 素材卡预览剥 `# ` 标记（点「环境」）
await evalJs(`[...document.querySelectorAll('[data-zj-libtree] button')].find((b) => b.textContent.includes('环境'))?.click(); 'ok'`)
await sleep(700)
const card = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('main button')].find((b) => (b.textContent || '').includes('采集_演示图书馆'))
  if (!btn) return { found: false }
  const t = btn.innerText
  return { found: true, noHash: !t.includes('#'), hasTitle: t.includes('校园老图书馆'), text: t.slice(0, 120) }
})()`)
check('素材卡预览显示干净题名（无 `# ` 标记）', card.found && card.noHash && card.hasTitle, JSON.stringify(card))

// [4] 任务 chip 时间短格式（无秒级 HH:MM:SS）
const chipTxt = await evalJs(`(() => {
  const chips = [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').includes('采集任务'))
  return chips.map((b) => b.innerText).join(' | ')
})()`)
check('任务 chip 无秒级时间戳（短日期）', !/\\d{2}:\\d{2}:\\d{2}/.test(chipTxt), chipTxt.slice(0, 200))

// [5] 点击升格助手 → TriageDrawer 打开
await evalJs(`document.querySelector('[data-testid="lib-triage-open"]')?.click(); 'ok'`)
await sleep(900)
const dlg = await evalJs(`document.querySelector('[role="dialog"]')?.innerText ?? ''`)
check('升格助手可打开 TriageDrawer', dlg.includes('素材 → 设定升格') || dlg.includes('素材升格'), dlg.slice(0, 120))
await evalJs(`(() => { const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }); document.dispatchEvent(esc); return 'ok' })()`)
await sleep(400)

// [6] 窄窗 1000×700：零横向溢出 + 搜索行不换行（工具条按钮同行单行）
await cmd('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false })
await sleep(800)
const narrow = await evalJs(`(() => {
  const de = document.documentElement
  const searchRow = document.querySelector('[data-testid="lib-search"]')?.parentElement
  const rowH = searchRow ? searchRow.getBoundingClientRect().height : -1
  return { overflow: de.scrollWidth > de.clientWidth, rowH, rowText: searchRow?.innerText ?? '' }
})()`)
check('窄窗 1000 零横向溢出', narrow.overflow === false, JSON.stringify(narrow))
check('搜索行单行（高度 ≈ 工具条行高，按钮不换行堆叠）', narrow.rowH > 0 && narrow.rowH < 60, JSON.stringify(narrow))

// [7] 900 假设域：零溢出（flex 收窄）
await cmd('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false })
await sleep(600)
const n900 = await evalJs(`document.documentElement.scrollWidth > document.documentElement.clientWidth`)
check('窄窗 900 零横向溢出', n900 === false, String(n900))

await fetch(CDP + '/json/close/' + tab.id)
ws.close()
process.exit(bad ? 1 : 0)
