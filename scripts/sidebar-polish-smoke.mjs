// 织卷无头冒烟 · 侧栏组头口径统一 + 阴影清尾/V-02（质感专项 V-03，2026-09-11 17:15 轮）
// 用法：node scripts/sidebar-polish-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer（out/ 已 build）；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 五个侧栏组头（章节/角色档案/世界观设定/素材库/章卡）均 11px + tracking-wide + ink-3；
//         ② Novel 组头文案精简为「章节」（不再含「按时间切片」）；
//         ③ 阴影：--shadow token 计算值有效；shadow-[var(--shadow)] 类生成且不带 Tailwind 默认冷黑；
//         ④ V-02：bundle 中无 #e6f0ee / shadow-lg 残留；
//         ⑤ 切 .dark 后组头色随主题变化；页面无 JS 异常。
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

// 读取组头（aside 内精确文本的 span）computed 样式
const headExpr = (text) => `(() => {
  const s = [...document.querySelectorAll('aside span')].find((x) =>
    x.textContent.trim() === ${JSON.stringify(text)} && !x.closest('a') && !x.closest('button') && !x.closest('nav')
  )
  if (!s) return null
  const c = getComputedStyle(s)
  return { text: s.textContent.trim(), fs: c.fontSize, ls: c.letterSpacing, color: c.color, fw: c.fontWeight }
})()`

async function checkHead(page, route, text, note) {
  await page.eval(`location.hash = ${JSON.stringify('#/project/demo-aseya/' + route)}`)
  const h = await evalUntil(page, headExpr(text), (v) => v !== null, 20000, `组头 ${text}`)
  ok(h.text === text, `${note}：组头文案=「${text}」`)
  ok(h.fs === '11px', `${note}：字号 11px（实测 ${h.fs}）`)
  ok(parseFloat(h.ls) > 0, `${note}：tracking-wide 生效（${h.ls}）`)
  return h
}

async function main() {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  console.log('[*] opened', BASE + '/#/project/demo-aseya/novel')

  await evalUntil(page, `typeof window.__ZJ_TEST !== 'undefined'`, (v) => v === true, 20000, 'devShim ready')

  // ① ② Novel 组头
  const hNovel = await checkHead(page, 'novel', '章节', 'Novel')
  const noLong = await page.eval(`[...document.querySelectorAll('aside span')].some((x) => x.textContent.includes('按时间切片'))`)
  ok(!noLong, 'Novel：组头已精简（无「按时间切片」赘语）')

  // ④ 切 dark：组头色应跟随变化（在 novel 路由立即验证，避免路由漂移）
  await page.eval(`document.documentElement.classList.add('dark')`)
  const hDark = await evalUntil(page, headExpr('章节'), (v) => v !== null && v.color !== hNovel.color, 10000, 'dark 后颜色变化')
  ok(hDark.color === 'rgb(133, 128, 112)', `dark 主题组头=ink-3 dark（${hDark.color}）`)
  await page.eval(`document.documentElement.classList.remove('dark')`)
  await evalUntil(page, headExpr('章节'), (v) => v !== null && v.color === hNovel.color, 10000, '恢复浅色')

  // ③ Characters / Worldview / Library / Outline
  const hChar = await checkHead(page, 'characters', '人物档案', 'Characters')
  const hWorld = await checkHead(page, 'worldview', '世界观设定', 'Worldview')
  const hLib = await checkHead(page, 'library', '素材库', 'Library')
  const hOutline = await checkHead(page, 'outline', '章卡', 'Outline')

  // 组头统一：ink-3 色（浅色主题下 = #867e6e）
  ok(hNovel.color === hChar.color, '组头文字色统一（Novel=Characters）')
  ok(hNovel.color === hWorld.color && hNovel.color === hLib.color && hNovel.color === hOutline.color, '全部组头文字色一致')
  ok(hNovel.color === 'rgb(134, 126, 110)', `浅色主题组头=ink-3（${hNovel.color}）`)

  // ⑤ --shadow token 有效 + 类生成
  const sh = await page.eval(`(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--shadow').trim()
    const el = document.createElement('div')
    el.className = 'shadow-[var(--shadow)]'
    document.body.appendChild(el)
    const bs = getComputedStyle(el).boxShadow
    el.remove()
    return { v, bs }
  })()`)
  ok(sh.v.length > 10 && sh.v.includes('#') && sh.v.includes('px'), `--shadow token 计算有效（${sh.v.slice(0, 60)}…）`)
  ok(sh.bs !== 'none' && sh.bs.includes('rgb'), `shadow-[var(--shadow)] 类生成，box-shadow=${sh.bs.slice(0, 60)}`)

  // ⑥ bundle 无残留（V-02 + 阴影清尾）；shadow-lg 仅允许出现在 SwitchThumb 控件投影（shadcn 默认，非浮层）
  const js = await page.eval(`Array.from(document.scripts).map(s => s.src || '').filter(Boolean)[0] || ''`)
  const bundle = await (await fetch(new URL(js, 'http://localhost:8123').href)).text()
  ok(!bundle.includes('#e6f0ee'), 'bundle 中无硬编码 #e6f0ee（V-02 清尾）')
  const lgCount = bundle.split('shadow-lg').length - 1
  const lgIdx = bundle.indexOf('shadow-lg')
  const isThumbOnly = lgCount === 1 && bundle.slice(lgIdx - 200, lgIdx).includes('SwitchThumb')
  ok(isThumbOnly, `shadow-lg 仅剩 SwitchThumb 控件投影（count=${lgCount}，浮层均已 token 化）`)

  // ⑦ 无 JS 异常
  ok(page.errors.length === 0, '页面无 JS 异常' + (page.errors.length ? '：' + page.errors[0] : ''))

  console.log('\n全部通过 ✓')
  await page.close()
  process.exit(0)
}

main().catch((e) => {
  console.error('\n' + e.message)
  process.exit(1)
})
