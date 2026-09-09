// 织卷无头冒烟 · 兑现检查「没兑现/部分兑现」→「重写第 N 段」（只重写该分幕段，其余段保留）
// 用法：node scripts/acts-rewrite-ui-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer（或任意本地服务出 out/renderer）
//       本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 选中第1章 → 分幕生成（mock 草稿，含 第1/2 段）；
//         ② 兑现检查抽屉出现（mock 报告：第 2 段「部分兑现」）；
//         ③ 点「重写第 2 段」→ agentActs 走 { only:[2] }（devShim 同语义 mock）；
//         ④ 草稿里第 2 段带「已重写」标记、第 1 段原文原样保留；顶部 msg 报成功。
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
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
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
  // 页面与演示数据就绪
  await evalUntil(page, `document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '列表就绪')
  console.log('OK 页面就绪（章卡列表可见）')

  // ① 选中第1章
  console.log('点击:', await page.eval(clickByText('第1章 · 雾港')))
  await sleep(400)
  // 生成分幕草稿
  console.log('分幕生成:', await page.eval(clickByText('分幕生成')))
  await evalUntil(page, `document.body.innerText.includes('采纳为正文')`, (v) => v === true, 8000, '分幕草稿已生成')
  console.log('OK 分幕草稿已生成')

  // ② 打开兑现检查抽屉
  console.log('兑现检查:', await page.eval(clickByText('兑现检查')))
  await evalUntil(page, `document.body.innerText.includes('部分兑现')`, (v) => v === true, 15000, '兑现检查报告出现')
  await evalUntil(page, `document.body.innerText.includes('重写第 2 段')`, (v) => v === true, 8000, '重写按钮出现')
  console.log('OK 兑现检查抽屉出现，「重写第 2 段」按钮可见')

  // ③ 点「重写第 2 段」（mock：只重写该段并加演示标记）
  console.log('重写第 2 段:', await page.eval(clickByText('重写第 2 段')))
  await evalUntil(page, `document.body.innerText.includes('已重写')`, (v) => v === true, 15000, 'msg 报重写成功')
  const msg = await page.eval(
    `(() => { const s = [...document.querySelectorAll('span')].map((x) => x.textContent).find((t) => t.includes('已重写')); return s ?? '' })()`
  )
  console.log('OK msg:', msg)
  if (!msg.includes('已重写「第01章_雾港」第 2 段')) throw new Error('msg 不符合预期: ' + msg)

  // ④ 读回草稿验证：第 2 段带重写标记、第 1 段原文保留
  const body = await page.eval(`window.zhijuan.readDoc('demo-aseya', '大纲/第01章_雾港_分幕.md')`)
  if (!body) throw new Error('草稿读取失败')
  if (!body.includes('【演示：第 2 段已重写】')) throw new Error('第 2 段未被重写（缺标记）')
  if (!body.includes('候船厅的灯慢慢暗下来')) throw new Error('第 1 段原文被破坏（不应重写）')
  if (body.includes('【演示：第 1 段已重写】')) throw new Error('第 1 段被误重写')
  console.log('OK 草稿：第 2 段已重写、第 1 段保留')

  console.log('\nPASS: 兑现检查 → 重写第 N 段 链路 OK')
} finally {
  await fetch(CDP + '/json/close/' + tab.id)
  page.close()
}
