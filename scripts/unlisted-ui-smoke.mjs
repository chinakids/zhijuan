// 织卷无头冒烟 · 保存前置「名单外出场」提示：正文用了档案别名但约定头未列 → 提示卡 → 一键补入
// 用法：node scripts/unlisted-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 打开演示项目正文页、进入第3章（正文含「沈爷」但约定头只列阿七）；
//         ② 编辑→保存后出现提示卡（含「沈爷＝沈藏 的登记别名」）与两个处置按钮；
//         ③ 点「补入涉及人物」→ 文档约定头变为 [阿七, 沈藏]，卡片消失。
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

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  // ① 正文页就绪：章节列表出现第3章
  await evalUntil(page, `document.body.innerText.includes('第3章') && document.body.innerText.includes('码头')`, (v) => v === true, 20000, '正文页就绪（第3章出现）')
  console.log('OK 正文页就绪')

  // 进入第3章
  await page.eval(`(() => {
    const btns = [...document.querySelectorAll('button')]
    const hit = btns.find((b) => (b.innerText || '').includes('第3章'))
    if (!hit) return 'NOT_FOUND'
    hit.click()
    return 'CLICKED'
  })()`)
  await evalUntil(page, `document.body.innerText.includes('阿七在码头等船')`, (v) => v === true, 10000, '第3章正文加载')
  console.log('OK 已选中第3章（正文含「阿七在码头等船」）')

  // ② 在编辑器里输入一个字使其变脏 → 点「保存」
  await page.cmd('DOM.enable')
  const doc = await page.cmd('DOM.getDocument')
  const { nodeId } = await page.cmd('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.milkdown .ProseMirror.editor' })
  if (!nodeId) throw new Error('没找到 .milkdown 编辑器根（.ProseMirror.editor）')
  await page.cmd('DOM.focus', { nodeId })
  await page.cmd('Input.insertText', { text: '。' })
  await sleep(300)
  const savedBtn = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('保存'))
    if (!b) return 'NOT_FOUND'
    const disabled = b.disabled
    b.click()
    return disabled ? 'DISABLED' : 'CLICKED'
  })()`)
  if (savedBtn === 'DISABLED') throw new Error('保存按钮未激活（输入未触发 dirty）')
  console.log('OK 已触发保存（按钮:' + savedBtn + '）')

  // 提示卡出现：含「出场了却未列入」与「沈爷」「沈藏」
  await evalUntil(page, `document.body.innerText.includes('出场了却未列入')`, (v) => v === true, 12000, '提示卡出现')
  const cardText = await page.eval(`document.body.innerText.includes('沈爷') && document.body.innerText.includes('沈藏') && document.body.innerText.includes('补入涉及人物')`)
  if (!cardText) throw new Error('提示卡内容不全（缺 沈爷/沈藏/补入涉及人物）')
  console.log('OK 提示卡出现（含「沈爷」＝沈藏 登记别名 + 补入/忽略按钮）')

  // ③ 点「补入涉及人物」→ 约定头写回 [阿七, 沈藏]，卡片消失
  await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '补入涉及人物')
    if (!b) return 'NOT_FOUND'
    b.click()
    return 'CLICKED'
  })()`)
  await sleep(800)
  const raw = await page.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第03章_码头.md')`)
  if (!raw || !raw.includes('涉及人物: [阿七, 沈藏]')) throw new Error('补入未落盘: ' + String(raw).slice(0, 120))
  const cardGone = await page.eval(`!document.body.innerText.includes('出场了却未列入')`)
  if (!cardGone) throw new Error('补入后提示卡未消失')
  console.log('OK 补入落盘：' + String(raw).split('\n').find((l) => l.startsWith('涉及人物')))

  console.log('\nPASS: 保存前置「名单外出场」提示（检测 → 提示卡 → 一键补入涉及人物）链路 OK')
} finally {
  await fetch(CDP + '/json/close/' + tab.id)
  page.close()
}
