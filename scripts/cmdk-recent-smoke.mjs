// 织卷无头冒烟 · ⌘K 命令面板「最近素材 + 命中类别路径」（平台层 2026-09-11）
// 用法：node scripts/cmdk-recent-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 项目内 ⌘K，空输入出现「最近素材」组（最近修改 5 条内，排除采集池）；
//         ② 条目显示「类别/文件名」+ 相对时间（devShim mtime=now → 刚刚）；
//         ③ 点击最近条目 → library?doc= 打开对应素材（__ZJ_DOC.rel 实锤）；
//         ④ 输入关键词 → 全文搜索组仍显示，命中行带「类别/」前缀；⑤ 无 JS 异常。
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
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    }
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
        cmd,
        errors,
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

const keyK = async (page, mod) => {
  await page.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75, modifiers: mod })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75, modifiers: mod })
}

async function openPalette(page) {
  await keyK(page, 4)
  await evalUntil(page, `!!document.querySelector('[cmdk-root]')`, (v) => v === true, 8000, '面板出现')
  await page.eval(`document.querySelector('[cmdk-input]').focus()`)
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

try {
  // ① 正文页就绪
  await evalUntil(page, `document.body.innerText.includes('第1章') && document.body.innerText.includes('Agent')`, (v) => v === true, 20000, '正文页就绪')
  ok('正文页就绪', true)

  // ② ⌘K 开面板：空输入出现「最近素材」组
  await openPalette(page)
  await evalUntil(page, `[...document.querySelectorAll('[cmdk-group-heading]')].some((g) => g.innerText.includes('最近素材'))`, (v) => v === true, 10000, '最近素材组出现')
  const groups = await page.eval(`[...document.querySelectorAll('[cmdk-group-heading]')].map((g) => g.innerText)`)
  ok('空输入显示最近素材组', groups.includes('最近素材'), 'groups=' + JSON.stringify(groups))
  ok('页面/打开章节/打开项目三组仍在', groups.includes('页面') && groups.includes('打开章节') && groups.includes('打开项目'))

  // ③ 最近条目显示「类别/文件名」+ 相对时间；采集池任务卡不入列
  await sleep(500)
  const recentTexts = await page.eval(`[...document.querySelectorAll('[cmdk-group-heading]')].find((g) => g.innerText.includes('最近素材'))?.parentElement?.querySelectorAll('[cmdk-item]') ? [...document.querySelectorAll('[cmdk-item]')].filter((i) => !i.hasAttribute('hidden') && i.closest('[cmdk-group]')?.querySelector('[cmdk-group-heading]')?.innerText.includes('最近素材')).map((i) => i.innerText) : []`)
  ok('最近素材有条目', recentTexts.length >= 3, 'n=' + recentTexts.length + ' items=' + JSON.stringify(recentTexts.slice(0, 2)))
  ok('条目带类别前缀（人物/）', recentTexts.some((t) => t.includes('人物/')), JSON.stringify(recentTexts))
  ok('条目带相对时间（刚刚）', recentTexts.some((t) => t.includes('刚刚')), JSON.stringify(recentTexts))
  ok('采集池任务卡未入列', !recentTexts.some((t) => t.includes('任务_演示')), JSON.stringify(recentTexts))

  // ④ 点击第一条（devShim mtime 相同 → 按 file 拼音序稳定；动态解析条目路径后断言打开文件）
  const firstText = await page.eval(`(() => { const it = [...document.querySelectorAll('[cmdk-item]')].find((i) => !i.hasAttribute('hidden') && i.closest('[cmdk-group]')?.querySelector('[cmdk-group-heading]')?.innerText.includes('最近素材')); return it ? it.innerText.split(String.fromCharCode(10))[0] : '' })()`)
  ok('最近第一条路径可解析', /^[\u4e00-\u9fa5A-Za-z0-9]+\/.+$/.test(firstText), 'first=' + JSON.stringify(firstText))
  const clicked = await page.eval(`(() => { const it = [...document.querySelectorAll('[cmdk-item]')].find((i) => !i.hasAttribute('hidden') && i.closest('[cmdk-group]')?.querySelector('[cmdk-group-heading]')?.innerText.includes('最近素材')); return it ? (it.click(), 'CLICKED') : 'NOT_FOUND' })()`)
  ok('点击最近素材条目', clicked === 'CLICKED', clicked)
  const expectRel = '素材库/' + firstText + '.md'
  await evalUntil(page, `window.__ZJ_DOC && window.__ZJ_DOC.rel === ${JSON.stringify(expectRel)}`, (v) => v === true, 15000, '素材编辑器打开')
  const docRel = await page.eval(`window.__ZJ_DOC ? window.__ZJ_DOC.rel : null`)
  ok('点击最近条目打开对应素材', docRel === expectRel, 'rel=' + docRel + ' expect=' + expectRel)
  const hashOk = await page.eval(`location.hash.includes('library')`)
  ok('已跳素材库页', hashOk)

  // ⑤ 再开面板：全文搜索命中行带「桥段/」类别前缀（回归搜索能力）
  await openPalette(page)
  await page.cmd('Input.insertText', { text: '旧物' })
  await evalUntil(
    page,
    `[...document.querySelectorAll('[cmdk-item]')].some((i) => !i.hasAttribute('hidden') && i.innerText.includes('追忆型开头'))`,
    (v) => v === true,
    10000,
    '命中项出现'
  )
  const hitTexts = await page.eval(`[...document.querySelectorAll('[cmdk-item]')].filter((i) => !i.hasAttribute('hidden') && i.innerText.includes('追忆型开头')).map((i) => i.innerText)`)
  ok('搜「旧物」命中「追忆型开头」', hitTexts.length > 0, JSON.stringify(hitTexts))
  ok('命中行显示类别前缀（桥段/）', hitTexts.some((t) => t.includes('桥段/')), JSON.stringify(hitTexts))
  ok('命中方式徽章仍显示', hitTexts.some((t) => t.includes('正文')), JSON.stringify(hitTexts))

  // ⑥ 无 JS 异常
  await sleep(800)
  const errs = page.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e))
  ok('无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))
} catch (e) {
  console.error('FATAL ' + e.message)
  fails++
} finally {
  page.close()
  console.log(fails === 0 ? 'CMDK RECENT SMOKE PASS' : 'CMDK RECENT SMOKE FAIL (' + fails + ')')
  process.exit(fails === 0 ? 0 : 1)
}
