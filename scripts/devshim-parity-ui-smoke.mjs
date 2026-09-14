// devShim 与真机口径一次性体检（2026-09-12 第 19 轮）——页面直调 window.zhijuan 断言：
// listChapters/listSlices 走 shared 纯函数（只认约定头块/剥注释/空数组无键/按文件名章号排序/时间字段）；
// getPaths 走 legacy 决策链；createLibraryCategory sanitize；deleteDoc 路径校验；
// writeDoc 版本化含 大纲/审读_*；searchDocs/listDocs mtime 与 docsOf 特判同口径。
// 用法：node scripts/devshim-parity-ui-smoke.mjs（前置：node scripts/serve-renderer.mjs；CDP 127.0.0.1:9224）
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
let pass = 0
let fail = 0
async function step(name, fn) {
  try {
    await fn()
    pass++
    console.log('PASS', name)
  } catch (e) {
    fail++
    console.log('FAIL', name, '-', e.message)
  }
}
const eq = (a, b) => expectEq(a, b)
function expectEq(a, b) {
  const sa = JSON.stringify(a)
  const sb = JSON.stringify(b)
  if (sa !== sb) throw new Error(`expected ${sb}, got ${sa}`)
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya')
const page = await attach(tab.webSocketDebuggerUrl)
// 等 devShim 挂载
await sleep(1200)
const zj = `window.zhijuan`

await step('listChapters：只认约定头块——正文含「章号: 9」但无 front matter → fm=null（旧正则版会误解析）', async () => {
  await page.eval(`${zj}.writeDoc('demo-aseya','正文/第30章_无头.md','# 试写\\n\\n章号: 9\\n这一段没有约定头。')`)
  const r = await page.eval(`(async () => { const rows = await ${zj}.listChapters('demo-aseya'); const row = rows.find((x) => x.file === '第30章_无头.md'); return { fm: row ? row.fm : 'MISSING', ok: !!row } })()`)
  eq(r.ok, true)
  eq(r.fm, null)
})

await step('listChapters：剥行尾 # 注释、涉及人物: [] 不产生键（与真机 extractFrontMatter 同口径）', async () => {
  await page.eval(`${zj}.writeDoc('demo-aseya','正文/第31章_注释.md','---\\n章号: 31\\n题名: 雾灯 # 备选\\n涉及人物: []\\n---\\n正文。')`)
  const r = await page.eval(`(async () => { const rows = await ${zj}.listChapters('demo-aseya'); const row = rows.find((x) => x.file === '第31章_注释.md'); return { fm: row ? row.fm : null, ok: !!row } })()`)
  eq(r.ok, true)
  eq(r.fm['题名'], '雾灯')
  eq('涉及人物' in r.fm, false)
  eq(typeof r.fm['章号'], 'number')
})

await step('listChapters：排序按文件名章号数值（新写入的第31章应排在第02章之后）', async () => {
  const order = await page.eval(`(async () => { const rows = await ${zj}.listChapters('demo-aseya'); return rows.map((x) => x.file) })()`)
  eq(order.indexOf('第31章_注释.md') > order.indexOf('第02章_灯塔.md'), true)
})

await step('listSlices：支持「时间」字段（旧 mock 缺失）；无切片字段跳过', async () => {
  await page.eval(`${zj}.writeDoc('demo-aseya','正文/第32章_时.md','---\\n章号: 32\\n题名: 时\\n切片: 第9幕_时\\n时间: 深夜\\n涉及人物: [阿七]\\n---\\n正文。')`)
  await page.eval(`${zj}.writeDoc('demo-aseya','正文/第33章_无切片.md','---\\n章号: 33\\n题名: 无\\n---\\n正文。')`)
  const r = await page.eval(`(async () => { const rows = await ${zj}.listSlices('demo-aseya'); const row = rows.find((x) => x.chapter === '第32章_时'); return { found: !!row, row: row ?? null, count: rows.length } })()`)
  eq(r.found, true)
  eq(r.row.time, '深夜')
  eq(r.row.chars, ['阿七'])
  eq(r.count, 5) // 种子 4 切片（第1~4章）+ 新增第32章；第33章无切片被跳过
})

await step('getPaths：默认走老默认位（legacy 分支与真机 libraryRoot 同口径）', async () => {
  await page.eval(`${zj}.setSettings({ libraryRoot: '' })`)
  const p = await page.eval(`${zj}.getPaths()`)
  eq(p.documents, '~/Documents/织卷项目库')
})

await step('getPaths：设置库根后生效值跟随（清空回 legacy）', async () => {
  await page.eval(`${zj}.setSettings({ libraryRoot: '/tmp/zj-lib-parity' })`)
  let p = await page.eval(`${zj}.getPaths()`)
  eq(p.documents, '/tmp/zj-lib-parity')
  await page.eval(`${zj}.setSettings({ libraryRoot: '' })`)
  p = await page.eval(`${zj}.getPaths()`)
  eq(p.documents, '~/Documents/织卷项目库')
})

await step('createLibraryCategory：sanitizeFile 同口径（非法字符清洗 + 已存在检测）', async () => {
  const r1 = await page.eval(`${zj}.createLibraryCategory('demo-aseya', '素材 A/B')`)
  eq(r1.ok, true)
  const r2 = await page.eval(`${zj}.createLibraryCategory('demo-aseya', '素材 A_B')`)
  eq(r2.ok, false)
  eq(r2.error, '类别「素材 A_B」已存在')
  const cats = await page.eval(`${zj}.listLibraryCategories('demo-aseya')`)
  eq(cats.some((c) => c.name === '素材 A_B'), true)
})

await step('deleteDoc：拒绝非法路径（.md 之外/绝对/.. 穿越）', async () => {
  const r1 = await page.eval(`${zj}.deleteDoc('demo-aseya', '正文/../../逃逸.md')`)
  eq(r1.ok, false)
  eq(r1.error, '路径不合法')
  const r2 = await page.eval(`${zj}.deleteDoc('demo-aseya', '正文/不存在.md')`)
  eq(r2.ok, false)
  eq(r2.error, '文档不存在')
})

await step('writeDoc 版本化：大纲/审读_* 也建档（与真机 isVersionedRel 同口径）', async () => {
  await page.eval(`${zj}.writeDoc('demo-aseya', '大纲/审读_校验.md', '第一版')`)
  await page.eval(`${zj}.writeDoc('demo-aseya', '大纲/审读_校验.md', '第二版')`)
  const h = await page.eval(`${zj}.listHistory('demo-aseya', '大纲/审读_校验.md')`)
  eq(Array.isArray(h) && h.length, 1)
  eq(h[0].name.endsWith('.md'), true)
})

await step('searchDocs/listDocs：mtime 与 docsOf 特判同口径（导演板模拟一天前）', async () => {
  const hits = await page.eval(`${zj}.searchDocs('demo-aseya', '大纲', '导演板')`)
  const h = hits.find((x) => x.file.endsWith('_导演.md'))
  eq(!!h, true)
  eq(!!h && h.mtime < Date.now() - 20 * 3600_000, true) // ≈一天前；旧实现 mtime=now 会挂
  const docs = await page.eval(`${zj}.listDocs('demo-aseya', '大纲')`)
  eq(docs[docs.length - 1].file, '第01章_雾港_导演.md') // mtime 最旧 → 排最后
})

await step('listDocs：name 剥 .md 且按 mtime 新→旧排序', async () => {
  const docs = await page.eval(`${zj}.listDocs('demo-aseya', '正文')`)
  eq(docs.every((d) => !d.name.endsWith('.md')), true)
  for (let i = 1; i < docs.length; i++) eq(docs[i - 1].mtime >= docs[i].mtime, true)
})

page.close()
console.log('---')
console.log(`SMOKE ${pass}/${pass + fail}${fail ? ' FAILED' : ' ALL PASS'}`)
process.exit(fail ? 1 : 0)
