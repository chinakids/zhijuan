// 织卷无头冒烟 · 阴影层级统一（质感专项 G1/G2，2026-09-11 14:15 轮）
// 用法：node scripts/shadow-polish-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123（out/renderer 已 build）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 首页项目卡 className 含 hover:shadow-[var(--shadow)] 与 hover:border-hair-strong；
//         ② :root/App 上 --shadow token 计算值有效（含色相 alpha）；
//         ③ CDP 鼠标真实 hover 后卡片 box-shadow 变为 var(--shadow) 计算值（不再是 Tailwind 默认黑 shadow-lg 的 0 0 0 0.1 冷重）；
//         ④ 临时元素用 shadow-[var(--shadow)] 的 Tailwind 类被正确生成（抽屉/浮层同款类可用）；
//         ⑤ 页面无 JS 异常；三主题下 token 均有效（paper/dark/ink？——织卷主题为 light/dark/paper，此处核对 light 与 dark）。
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
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((res) => {
    ws.onopen = async () => {
      await cmd('Runtime.enable')
      res({
        cmd, errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
    }
  })
}

async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}

const ok = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ✓ ' + msg)
}

async function main() {
  const tab = await openTab(BASE + '/#/')
  const page = await attach(tab.webSocketDebuggerUrl)
  console.log('[*] opened', BASE + '/#/')

  await evalUntil(page, "typeof window.__ZJ_TEST !== 'undefined'", (v) => v === true, 20000, 'devShim ready')

  // ① 项目卡存在 + 类名
  const cardInfo = await evalUntil(
    page,
    `(() => {
      const c = document.querySelector('[data-zj-proj-card], .group.cursor-pointer')
      if (!c) return null
      return { cls: c.className, n: document.querySelectorAll('.group.cursor-pointer').length }
    })()`,
    (v) => v && v.n > 0,
    20000,
    'project card rendered'
  )
  ok(cardInfo.n > 0, `首页渲染出 ${cardInfo.n} 个项目卡`)
  ok(cardInfo.cls.includes('hover:shadow-[var(--shadow)]'), '卡片 hover 用语义 shadow token（shadow-[var(--shadow)]）')
  ok(cardInfo.cls.includes('hover:border-hair-strong'), '卡片 hover 边框用 hair-strong 发丝加深')

  // ② --shadow token 计算值
  const token = await page.eval(`getComputedStyle(document.documentElement).getPropertyValue('--shadow').trim()`)
  ok(token.includes('322e27') && token.includes(','), `light 下 --shadow token 有效: ${token.slice(0, 70)}…`)
  const darkToken = await page.eval(`(() => {
    document.documentElement.classList.add('dark')
    const v = getComputedStyle(document.documentElement).getPropertyValue('--shadow').trim()
    document.documentElement.classList.remove('dark')
    return v
  })()`)
  ok(darkToken.includes('000') && darkToken.includes(','), `dark 下 --shadow token 有效: ${darkToken.slice(0, 70)}…`)

  // ③ 真实 hover：鼠标移到卡片中心 → box-shadow 应为 var(--shadow) 计算值（含 6%/8% ink alpha，非 Tailwind 默认 shadow-lg 的 0 0 0/0.1 冷重）
  const rect = await page.eval(`(() => {
    const c = document.querySelector('.group.cursor-pointer')
    const r = c.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
  await sleep(600)
  const hoverCount = await page.eval(`document.querySelectorAll('.group.cursor-pointer:hover').length`)
  ok(hoverCount >= 1, `hover 伪类真实触发（${hoverCount} 卡）`)
  const hoverShadow = await page.eval(`getComputedStyle(document.querySelector('.group.cursor-pointer')).boxShadow`)
  ok(hoverShadow.includes('50, 46, 39') && /0\.0[68]/.test(hoverShadow), `hover 后 box-shadow 为语义 token 计算值（非默认冷重）: ${hoverShadow.slice(-110)}…`)
  const hoverBorder = await page.eval(`getComputedStyle(document.querySelector('.group.cursor-pointer')).borderColor`)
  ok(hoverBorder.includes('50, 46, 39') && hoverBorder.includes('0.22'), `hover 后 borderColor 为 hair-strong 加深（22% ink）: ${hoverBorder}`)

  // ④ 抽屉/浮层同款类 shadow-[var(--shadow)] 生成有效（直接注入临时元素）
  const tmp = await page.eval(`(() => {
    const d = document.createElement('div')
    d.className = 'shadow-[var(--shadow)]'
    d.style.width = '10px'; d.style.height = '10px'
    document.body.appendChild(d)
    const bs = getComputedStyle(d).boxShadow
    d.remove()
    return bs
  })()`)
  ok(tmp.includes('rgb') && !tmp.includes('none'), `shadow-[var(--shadow)] 类生成生效: ${tmp.slice(0, 60)}…`)

  // ⑤ JS 异常
  await sleep(300)
  ok(page.errors.length === 0, '无 JS 异常' + (page.errors.length ? '：' + page.errors.slice(0, 2).join(' | ') : ''))

  page.close()
  console.log('\nSHADOW-POLISH SMOKE PASS (5 组断言)')
  const con = await fetch(CDP + '/json/close/' + tab.id, { method: 'PUT' }).catch(() => null)
  void con
}

main().catch((e) => {
  console.error('\nSHADOW-POLISH SMOKE FAIL:', e.message)
  process.exit(1)
})
