// 织卷无头冒烟 · 采集表单「需求描述」长度提示——体验层 2026-10-08（04-体验层.md 五候选 1②）
// 背景：长需求填完不可见长度（10-07 观察①转正）；HIG macOS Text fields/Text views 均无字符计数
//       条款（CDP 实抓存档 /tmp/hig-textfields.txt、/tmp/hig-textviews.txt），但 macOS 写作工具
//       同族（TextEdit 状态栏字符统计 / Pages 字数统计）为同类先例 → 小步落地：Label 行右侧
//       「N 字」11px/ink-3（贴字段、不占新行），计数=项目统一 countWords 口径。
// 断言：A 空需求无计数；B 输入中文+标点显示正确计数（countWords 口径）；C 追加更新；D 清空消失；
//       E 计数不挡提交（提交按钮仍可用）；F 零 JS 异常。
// 用法：node scripts/collect-demand-count-ui-smoke.mjs（先 npm run build + serve-renderer + CDP 9224）
const base = 'http://127.0.0.1:9224'
const APP = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8899'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
function ok(name, cond, extra) {
  if (cond) console.log('  ✓', name)
  else { console.log('  ✗', name, extra ?? ''); fails++ }
}
async function newTab(u) {
  const r = await fetch(`${base}/json/new?${encodeURIComponent(u)}`, { method: 'PUT' })
  if (!r.ok) throw new Error('new failed ' + r.status)
  return r.json()
}
function makeConn(tab) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  const exceptions = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') exceptions.push('console.error: ' + (m.params.args[0]?.value ?? ''))
  }
  function cmd(method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  }
  return { ws, cmd, exceptions }
}
async function drive(tab) {
  const { ws, cmd, exceptions } = makeConn(tab)
  await new Promise((r) => (ws.onopen = r))
  await cmd('Page.enable')
  await cmd('Runtime.enable')
  const ev = async (expression) => {
    const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails))
    return r.result?.value
  }
  return { ws, cmd, ev, exceptions }
}

const tab = await newTab(`${APP}/?cb=${Date.now()}#/project/demo-aseya/library`)
const { ws, cmd, ev, exceptions } = await drive(tab)
await sleep(2000)

console.log('场景 0：打开「发起采集」表单')
const openRes = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('发起采集'))
  if (!b) return 'NO_BTN'
  b.click()
  return 'ok'
})()`)
ok('「发起采集」按钮可点', openRes === 'ok', openRes)
await sleep(800)
const hasForm = await ev(`!!document.querySelector('textarea#collect-demand')`)
ok('采集表单已打开', hasForm === true)

// React 受控 textarea：用原生 setter + input 事件驱动
const setVal = async (v) => {
  await ev(`(() => {
    const ta = document.querySelector('textarea#collect-demand')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(v)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(300)
}
const cnt = async () => {
  const r = await ev(`(() => {
    const ta = document.querySelector('textarea#collect-demand')
    const row = ta?.previousElementSibling
    const s = row ? [...row.querySelectorAll('span')].map((x) => x.textContent).join('') : ''
    return { val: ta?.value ?? '', span: s, submitDisabled: [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('提交任务'))?.disabled ?? null }
  })()`)
  return r
}

console.log('场景 A：空需求无计数')
const a = await cnt()
ok('空需求无「N 字」计数', a.span === '', JSON.stringify(a))

console.log('场景 B：输入中文+标点 → countWords 口径计数')
await setVal('校园图书馆的——旧细节')
const b = await cnt()
ok('计数显示「11 字」', b.span.includes('11 字'), JSON.stringify(b))

console.log('场景 C：追加文本 → 计数更新')
await setVal('校园图书馆的——旧细节。补充阅览室')
const c = await cnt()
ok('计数更新为「17 字」', c.span.includes('17 字'), JSON.stringify(c))

console.log('场景 D：清空 → 计数消失')
await setVal('')
const d = await cnt()
ok('清空后无计数', d.span === '', JSON.stringify(d))

console.log('场景 E：计数不挡提交')
await setVal('校园图书馆的——旧细节')
const e = await cnt()
ok('提交按钮可用（不 disabled）', e.submitDisabled === false, String(e.submitDisabled))

// 截图
try {
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  fs.writeFileSync('/Users/chinakids/Pictures/zhijuan/collect-demand-count-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png', Buffer.from(shot.data, 'base64'))
  console.log('  📸 截图已存')
} catch (e) { console.log('  (截图失败)', e.message) }

console.log('场景 F：零 JS 异常')
ok('页面无未捕获异常/console.error', exceptions.length === 0, exceptions.slice(0, 3).join(' | '))

console.log(fails === 0 ? 'ALL PASS' : 'FAIL ' + fails)
await fetch(`${base}/json/close/${tab.id}`, { method: 'PUT' }).catch(() => {})
ws.close()
process.exit(fails === 0 ? 0 : 1)
