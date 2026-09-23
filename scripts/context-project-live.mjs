// 织卷 · 真模型项目级装配探针——buildProjectContext（未打开章节场景）全要素走查（候选 2「项目级上下文全要素探针」）
// 场景：临时项目，chapterRel=null（未打开章节）；三块独家事实：①作品总纲 project.md ②世界观总纲 世界观/总纲.md
// ③【文档清单】路标（正文/人物/素材库文档名，正文必须按章号升序、全量可见——第03章 mtime 最新，若按 mtime 降序则顺序=03,02,01）。
// 断言：数据层块序/块数/独家事实/正文路标章号升序全量 + 真模型一次 runChat（无章）只凭【项目概览】答出全部且零工具读盘。
// 用法：cd ~/Desktop/织卷 && node scripts/context-project-live.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-projctx-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: join(tmp, 'lib') }), 'utf-8')

const lib = join(tmp, 'lib')
const pid = '项目级探针'
const P = (rel) => join(lib, pid, rel)
for (const d of ['人物', '世界观', '正文', '素材库']) mkdirSync(P(d), { recursive: true })

// ---- 场景文件（每个独家事实只存在于一处）----
writeFileSync(
  P('project.md'),
  [
    '# 雾渡',
    '',
    '三幕式结构：第一幕 雾港 → 第二幕 灯会 → 第三幕 灯塔。',
    '主角陈默的终极目标：找到十年前在渡灯会上失踪的妹妹陈曦。',
    ''
  ].join('\n'),
  'utf-8'
)
writeFileSync(
  P('世界观/总纲.md'),
  [
    '# 世界观总纲',
    '',
    '- 渡灯会：每年冬至夜举行，灯船只能由孤儿点燃。',
    '- 鬼市：每年农历三月初三深夜在雾港西码头开市。',
    ''
  ].join('\n'),
  'utf-8'
)
// 三章正文：mtime 控制——第03章最新（模拟「最近在写第3章」），第02章次之，第01章最旧。
// 若文档清单按 mtime 降序，路标顺序会变成 03,02,01（与章号升序相反）。
const chs = [
  ['第01章_雾港.md', ['---', '章号: 1', '题名: 雾港', '切片: 第一幕_雾港', '涉及人物: []', '---', '', '雾港的雾从江面爬上来。', ''].join('\n')],
  ['第02章_灯会.md', ['---', '章号: 2', '题名: 灯会', '切片: 第二幕_灯会', '涉及人物: []', '---', '', '冬至前三天，街口挂起了红灯笼。', ''].join('\n')],
  ['第03章_灯塔.md', ['---', '章号: 3', '题名: 灯塔', '切片: 第三幕_灯塔', '涉及人物: []', '---', '', '灯塔的灯坏了一夜。', ''].join('\n')]
]
const base = Date.now()
chs.forEach(([name, body], i) => {
  const p = P('正文/' + name)
  writeFileSync(p, body, 'utf-8')
  // mtime：第01章=base-2000，第02章=base-1000，第03章=base（最新）
  const t = new Date(base - (chs.length - 1 - i) * 1000)
  utimesSync(p, t, t)
})
writeFileSync(P('人物/陈默.md'), ['# 陈默', '', '档案：灯塔看守人。', ''].join('\n'), 'utf-8')
writeFileSync(P('人物/林晓.md'), ['# 林晓', '', '档案：渡口杂货店老板。', ''].join('\n'), 'utf-8')
writeFileSync(P('素材库/桥段_墙上的钟.md'), ['# 桥段：墙上的钟', '', '追忆型开头参考。', ''].join('\n'), 'utf-8')
writeFileSync(P('素材库/场景_渡口清晨.md'), ['# 场景：渡口清晨', '', '雾气散去的时刻。', ''].join('\n'), 'utf-8')

// ---- 第一段：数据层（bundle context.ts，验证块序/块数/独家事实/路标顺序）----
const ctxOut = join(tmp, 'ctx-bundle.mjs')
await esbuild({
  entryPoints: [resolve(root, 'src/main/agent/context.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: ctxOut,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})
const ctxMod = await import(pathToFileURL(ctxOut).href)
const pctx = await ctxMod.buildProjectContext(pid)
console.log('=== 数据层：buildProjectContext 块序 ===')
pctx.blocks.forEach((b, i) => {
  const head = b.split('\n').find((l) => l.startsWith('【')) ?? b.slice(0, 40)
  console.log(`[${i + 1}] ${head}`)
})
console.log('sources:', JSON.stringify(pctx.sources))
const TITLES = pctx.blocks.map((b) => b.split('\n').find((l) => l.startsWith('【')) ?? '')
const expectOrder = ['【作品总纲', '【世界观总纲', '【文档清单']
const orderOk = TITLES.length === expectOrder.length && expectOrder.every((t, i) => TITLES[i].startsWith(t))
const all = pctx.blocks.join('\n')
const hasName = all.includes('雾渡') && all.includes('三幕式')
const hasRule = all.includes('孤儿点燃')
const listBlock = pctx.blocks.find((b) => b.startsWith('【文档清单】')) ?? ''
const chNames = ['第01章_雾港', '第02章_灯会', '第03章_灯塔']
const allChs = chNames.every((n) => listBlock.includes(n))
// 正文路标必须按章号升序且全量：03 在 02 之后、02 在 01 之后
const i01 = listBlock.indexOf('第01章_雾港')
const i02 = listBlock.indexOf('第02章_灯会')
const i03 = listBlock.indexOf('第03章_灯塔')
const chOrderOk = i01 >= 0 && i02 > i01 && i03 > i02
const hasChars = listBlock.includes('陈默') && listBlock.includes('林晓')
const hasMaterial = listBlock.includes('墙上的钟') && listBlock.includes('渡口清晨')
console.log('块序=' + orderOk + ' 总纲事实=' + hasName + ' 世界观事实=' + hasRule + ' 正文全量=' + allChs + ' 正文升序=' + chOrderOk + ' 人物路标=' + hasChars + ' 素材路标=' + hasMaterial)
const dataPass = orderOk && hasName && hasRule && allChs && chOrderOk && hasChars && hasMaterial
console.log(dataPass ? 'PROJCTX DATA OK' : 'PROJCTX DATA FAILED')

// ---- 第二段：真模型（bundle engine.ts，一次 runChat chapterRel=null）----
const out = join(tmp, 'bundle.mjs')
await esbuild({
  entryPoints: [resolve(root, 'src/main/agent/engine.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})
const mod = await import(pathToFileURL(out).href)
const events = []
console.log('\n=== 开始 runChat（项目级探针 chapterRel=null）：', new Date().toISOString())
await mod.runChat(
  {
    requestId: 'projctx-' + Date.now(),
    projectId: pid,
    chapterRel: null,
    chapterTitle: '',
    prompt:
      '请只依据上面【项目概览】里的内容回答下面 4 个问题，不要调用任何工具读文件，也不要凭常识脑补：\n' +
      '1. 这个作品叫什么名字？分几幕？（依据【作品总纲】）\n' +
      '2. 渡灯会的灯船由谁点燃？（依据【世界观总纲】）\n' +
      '3. 正文目前共有几章？按章号从小到大列出章节名（如 第01章_xxx）。\n' +
      '4. 素材库里有哪些文档？至少列出两篇文档名。\n' +
      '逐题回答，每题一行，格式「N. 答案」。',
    quote: null
  },
  (e) => {
    events.push(e)
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'meta') console.log('\n[工具]', e.tool)
    else if (e.type === 'meta-done') console.log('[工具完成]', (e.message ?? '').slice(0, 60))
    else if (e.type === 'error') console.error('\n[错误]', e.message)
  }
)
console.log('\n=== 完成，事件数:', events.length)
await mod.shutdown()

const final = events.filter((e) => e.type === 'final').map((e) => e.text).join('\n')
console.log('\n[最终回复]\n' + final)
const tools = events.filter((e) => e.type === 'meta').map((e) => e.tool)
console.log('\n调用工具:', JSON.stringify(tools))

// ---- 断言：四问全命中 + 零工具读盘（证明来自【项目概览】注入而非现读）----
const checks = [
  ['书名与幕数', (t) => t.includes('雾渡') && (t.includes('三幕') || t.includes('3 幕') || t.includes('三幕式'))],
  ['渡灯会规则', (t) => t.includes('孤儿')],
  ['正文章序', (t) => t.includes('第01章') && t.includes('第02章') && t.includes('第03章')],
  ['素材文档', (t) => t.includes('墙上的钟') || t.includes('渡口清晨')]
]
const misses = checks.filter(([n, f]) => !f(final)).map(([n]) => n)
const docRead = tools.some((t) => t === 'zj_read_doc' || t === 'zj_search')
console.log('\n未命中:', JSON.stringify(misses), ' 工具读了盘:', docRead)
const livePass = misses.length === 0 && !docRead
console.log('\n' + (dataPass && livePass ? 'PROJCTX LIVE OK' : 'PROJCTX LIVE FAILED'))
rmSync(tmp, { recursive: true, force: true })
process.exit(dataPass && livePass ? 0 : 1)
