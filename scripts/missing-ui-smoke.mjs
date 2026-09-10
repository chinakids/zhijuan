// 织卷无头冒烟 · 保存前置「列入未出场」提示：约定头列了阿七/沈藏但本章正文（≥字数阈值）未出现 → 提示卡（missing 节）→ 一键移出涉及人物
// 用法：node scripts/missing-ui-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 打开演示项目正文页、进入第4章（约定头 [阿七, 沈藏]，正文仅码头空镜无二人署名）；
//         ② 编辑→保存后出现提示卡（含「列入了却未出场」与阿七/沈藏、移出涉及人物按钮）；卡中无「出场了却未列入」节；
//         ③ 点「移出涉及人物」→ 约定头「涉及人物」行被删（移空），卡片消失。
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

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  // ① 正文页就绪：章节列表出现第4章
  await evalUntil(page, `document.body.innerText.includes('第4章') && document.body.innerText.includes('雾夜')`, (v) => v === true, 20000, '正文页就绪（第4章出现）')
  console.log('OK 正文页就绪')

  // 进入第4章
  await page.eval(`(() => {
    const btns = [...document.querySelectorAll('button')]
    const hit = btns.find((b) => (b.innerText || '').includes('第4章'))
    if (!hit) return 'NOT_FOUND'
    hit.click()
    return 'CLICKED'
  })()`)
  await evalUntil(page, `document.body.innerText.includes('码头的雾比昨夜更浓')`, (v) => v === true, 10000, '第4章正文加载')
  console.log('OK 已选中第4章（正文含码头空镜段落）')

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

  // 提示卡出现：含「列入了却未出场」与阿七/沈藏 + 移出涉及人物按钮；且无「出场了却未列入」节
  await evalUntil(page, `document.body.innerText.includes('列入了却未出场')`, (v) => v === true, 12000, '提示卡出现')
  const cardText = await page.eval(`document.body.innerText.includes('阿七') && document.body.innerText.includes('沈藏') && document.body.innerText.includes('移出涉及人物') && !document.body.innerText.includes('出场了却未列入')`)
  if (!cardText) throw new Error('提示卡内容不全（缺 阿七/沈藏/移出涉及人物 或错出 unlisted 节）')
  console.log('OK 提示卡出现（missing 节含阿七/沈藏，无 unlisted 节）')

  // ③ 点「移出涉及人物」→ 约定头「涉及人物」行被删（两人都被移出），卡片消失
  await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '移出涉及人物')
    if (!b) return 'NOT_FOUND'
    b.click()
    return 'CLICKED'
  })()`)
  await sleep(800)
  const raw = await page.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第04章_雾夜.md')`)
  const fmHead = String(raw).split('\n').find((l) => l.startsWith('涉及人物'))
  if (raw && raw.includes('涉及人物')) throw new Error('移出未落盘（涉及人物行仍在）: ' + String(raw).slice(0, 120))
  if (!raw || !raw.includes('章号: 4')) throw new Error('文档异常: ' + String(raw).slice(0, 80))
  const cardGone = await page.eval(`!document.body.innerText.includes('列入了却未出场')`)
  if (!cardGone) throw new Error('移出后提示卡未消失')
  console.log('OK 移出落盘（涉及人物行已删）：' + JSON.stringify(String(raw).split('\n').slice(0, 6)))

  console.log('\nPASS: 保存前置「列入未出场」提示（检测 → 提示卡 → 一键移出涉及人物）链路 OK')
} finally {
  await fetch(CDP + '/json/close/' + tab.id)
  page.close()
}
