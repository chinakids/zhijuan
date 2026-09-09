// 织卷无头冒烟 · 分幕「采纳为正文」后自动触发切片同步（devShim 演示数据）
// 用法：node scripts/acts-adopt-ui-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer（或任意本地服务出 out/renderer）
//       本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 选中第1章后「分幕生成」mock 出草稿；②「采纳为正文」两击；
//         ③ 采纳成功后 msg 出现「切片同步」结果（runSliceSync 真的被调用——修复点）；
//         ④ 演示项目正文被替换成分幕草稿内容（org 读回验证）。
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

function clickByText(text, exact = true) {
  const js = `(() => {
    const btns = [...document.querySelectorAll('button')]
    const hit = btns.find((b) => ${exact ? `b.textContent.trim() === ${JSON.stringify(text)}` : `b.textContent.includes(${JSON.stringify(text)})`})
    if (!hit) return 'NOT_FOUND'
    hit.click()
    return 'CLICKED:' + hit.textContent.trim().slice(0, 30)
  })()`
  return js
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/outline')
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  // 等页面与演示数据就绪
  await evalUntil(page, `document.body.innerText.includes('第1章') && document.body.innerText.includes('第2章')`, (v) => v === true, 20000, '列表就绪')
  console.log('OK 页面就绪（章卡列表可见）')

  // ① 选中第1章
  console.log('点击:', await page.eval(clickByText('第1章 · 雾港')))
  await sleep(400)
  // ② 分幕生成（mock 立即写草稿）
  console.log('分幕生成:', await page.eval(clickByText('分幕生成')))
  await evalUntil(page, `document.body.innerText.includes('采纳为正文')`, (v) => v === true, 8000, '出现采纳按钮')
  console.log('OK 分幕草稿已生成，「采纳为正文」按钮出现')

  // ③ 两击采纳
  console.log('采纳(1):', await page.eval(clickByText('采纳为正文')))
  await evalUntil(page, `document.body.innerText.includes('再点一次确认采纳')`, (v) => v === true, 5000, '出现确认文案')
  console.log('采纳(2 确认):', await page.eval(clickByText('再点一次确认采纳')))
  await evalUntil(
    page,
    `document.body.innerText.includes('切片同步')`,
    (v) => v === true,
    15000,
    'msg 出现切片同步结果'
  )
  const msg = await page.eval(
    `(() => { const s = [...document.querySelectorAll('span')].map((x) => x.textContent).find((t) => t.includes('切片同步') || t.includes('已替换正文')); return s ?? '' })()`
  )
  console.log('OK msg:', msg)
  if (!msg.includes('无设定变化') && !msg.includes('条切片提案')) throw new Error('msg 未包含同步成功结果: ' + msg)

  // ④ 读回正文验证
  const body = await page.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')`)
  if (!body || !body.includes('锈钥匙')) throw new Error('正文未被分幕草稿替换')
  console.log('OK 正文已替换（含分幕内容）')

  console.log('\\nPASS: 采纳分幕→自动切片同步 链路 OK')
} finally {
  await fetch(CDP + '/json/close/' + tab.id)
  page.close()
}
