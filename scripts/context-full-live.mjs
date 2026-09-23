// 织卷 · 真模型全要素装配探针——buildWritingContext 八块一次走查（候选 2「上下文注入全链路审计复测」）
// 场景：临时项目第 2 章（切片=第二幕_夜航，无设定文件 → 走回退链读第一幕_旧港），涉及人物 5 位（仅前 2 位建档）。
// 八个独家事实分别只存在于：①当前章正文 ②上一章尾部 ③人物档案·陈默 ④人物档案·林晓 ⑤回退切片设定
// ⑥本章章卡 ⑦本章导演板 ⑧素材库索引；【涉及人物补充】含全 5 位名单（周守/顾知远/苏禾未建档，只能来自该块）。
// 断言：数据层块序与块数齐备 + 真模型一次 runChat 只凭【当前创作上下文】答出全部事实且零工具读盘。
// 用法：cd ~/Desktop/织卷 && node scripts/context-full-live.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-fullctx-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeProbeSettings({ libraryRoot: join(tmp, 'lib') })

const lib = join(tmp, 'lib')
const pid = '全要素探针'
const P = (rel) => join(lib, pid, rel)
for (const d of ['人物', '世界观', '正文', '大纲', '素材库']) mkdirSync(P(d), { recursive: true })

// ---- 场景文件（每个独家事实只存在于一处）----
writeFileSync(
  P('正文/第01章_旧港.md'),
  [
    '---', '章号: 1', '题名: 旧港', '切片: 第一幕_旧港', '涉及人物: [陈默]', '---', '',
    '旧港的夜总是醒着。卸货的工人在灯下抽烟，影子被拉得很长。（此处为上一章正文，不含任何被问事实。）',
    '陈默沿着栈桥走了一圈，没有遇见任何人。他在渔火里把缆绳数了三遍，才转身离开。', ''
  ].join('\n'),
  'utf-8'
)
writeFileSync(
  P('正文/第02章_夜航.md'),
  [
    '---', '章号: 2', '题名: 夜航', '切片: 第二幕_夜航', '涉及人物: [陈默, 林晓, 周守, 顾知远, 苏禾]', '---', '',
    '凌晨的码头没有一丝风，栈桥另一头黑黢黢的。陈默站在灯下等，听见远处传来脚步声。', ''
  ].join('\n'),
  'utf-8'
)
writeFileSync(
  P('人物/陈默.md'),
  ['# 陈默', '', '档案：码头值夜人。左肩有一道月牙形的旧疤。', ''].join('\n'),
  'utf-8'
)
writeFileSync(
  P('人物/林晓.md'),
  ['# 林晓', '', '档案：渔家女儿，脖子上挂着一枚铜哨。', ''].join('\n'),
  'utf-8'
)
writeFileSync(
  P('世界观/切片_第一幕_旧港.md'),
  ['# 切片：第一幕_旧港', '', '- 雾港的钟楼指针永远慢七分钟', '- 码头凌晨常有浓雾', ''].join('\n'),
  'utf-8'
)
writeFileSync(
  P('大纲/第02章_夜航.md'),
  ['# 第02章 夜航', '', '> 一句话定位：承诺与落空。', '> 钩子：本章结尾必须让林晓看到一只搁浅的旧舢板。', ''].join('\n'),
  'utf-8'
)
writeFileSync(
  P('大纲/第02章_夜航_导演.md'),
  ['# 导演板：第02章 夜航', '', '## 写作红线', '- 陈默在本章不许笑（红线）。', '', '## 情绪弧', '- 低谷 → 白热化 → 收束。', ''].join('\n'),
  'utf-8'
)
// ⑧ 素材库（2026-09-18：动态路标——素材文件为权威，索引.md 不再是信号源；素材=文件、索引=预览路标）
mkdirSync(P('素材库/环境'), { recursive: true })
mkdirSync(P('素材库/桥段'), { recursive: true })
writeFileSync(
  P('素材库/环境/雾中航标.md'),
  ['---', '标签: [环境, 灯塔, 雾]', '---', '', '# 雾中航标', '', '孤悬海上的灯塔，守塔人每天点灯，雾夜从不间断。', ''].join('\n'),
  'utf-8'
)
writeFileSync(
  P('素材库/桥段/潮汐笔记.md'),
  ['---', '标签: [桥段, 港口, 风俗]', '---', '', '# 潮汐笔记', '', '老渔民看潮汐定归期：潮水涨到第三块青石板，船该回来了。', ''].join('\n'),
  'utf-8'
)
writeFileSync(P('素材库/索引.md'), '# 素材库索引\n\n（模板占位：不再是模型信号源，2026-09-18）\n', 'utf-8')

// ---- 第一段：数据层（bundle context.ts，验证块序与块数）----
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
const ctx = await ctxMod.buildWritingContext(pid, '正文/第02章_夜航.md')
console.log('=== 数据层：buildWritingContext 块序 ===')
ctx.blocks.forEach((b, i) => {
  const head = b.split('\n').find((l) => l.startsWith('【')) ?? b.slice(0, 40)
  console.log(`[${i + 1}] ${head}`)
})
console.log('sources:', JSON.stringify(ctx.sources))
const TITLES = ctx.blocks.map((b) => b.split('\n').find((l) => l.startsWith('【')) ?? '')
const expectOrder = ['【当前章节', '【上一章尾部', '【人物档案：陈默', '【人物档案：林晓', '【涉及人物补充', '【上一切片设定', '【本章章卡', '【本章导演板', '【素材库索引']
const orderOk = TITLES.length === expectOrder.length && expectOrder.every((t, i) => TITLES[i].startsWith(t))
const hasFullCast = ctx.blocks.some((b) => b.includes('共 5 位') && b.includes('周守'))
console.log('块数=' + TITLES.length + ' 顺序正确=' + orderOk + ' 补充块含全名单=' + hasFullCast)
const dataPass = orderOk && hasFullCast
console.log(dataPass ? 'FULLCTX DATA OK' : 'FULLCTX DATA FAILED')

// ---- 第二段：真模型（bundle engine.ts，一次 runChat 全要素问答）----
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
console.log('=== 开始 runChat（全要素探针）：', new Date().toISOString())
await mod.runChat(
  {
    requestId: 'fullctx-' + Date.now(),
    projectId: pid,
    chapterRel: '正文/第02章_夜航.md',
    chapterTitle: '第2章',
    prompt:
      '请只依据上面【当前创作上下文】里的内容回答下面 9 个问题，不要调用任何工具读文件，也不要用常识脑补：\n' +
      '1. 当前章（第02章）正文开头描写的是什么场景（一句话概括）？\n' +
      '2. 上一章结尾陈默做了什么（具体动作）？\n' +
      '3. 陈默的左肩有什么特殊旧伤？\n' +
      '4. 林晓脖子上挂着什么？\n' +
      '5. 雾港的钟楼有什么异样？\n' +
      '6. 本章导演板给陈默立的红线是什么？\n' +
      '7. 本章章卡要求结尾必须写到什么（谁看到什么）？\n' +
      '8. 素材库索引里收录了哪些素材（至少列一篇标题）？\n' +
      '9. 本章涉及人物共几位？请列出全部名单，并指出哪几位没有附档案。\n' +
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

// ---- 断言：九事实全命中 + 零工具读盘（证明来自注入而非现读）----
const checks = [
  ['当前章场景', (t) => t.includes('码头') || t.includes('栈桥')],
  ['上一章动作', (t) => t.includes('缆绳') && (t.includes('三遍') || t.includes('数'))],
  ['陈默旧伤', (t) => t.includes('月牙')],
  ['林晓铜哨', (t) => t.includes('铜哨')],
  ['钟楼异样', (t) => t.includes('七分钟')],
  ['导演红线', (t) => t.includes('笑')],
  ['章卡旧舢板', (t) => t.includes('旧舢板')],
  ['素材索引', (t) => t.includes('雾中航标')],
  ['全名单5位', (t) => t.includes('周守') && t.includes('顾知远') && t.includes('苏禾')],
  ['未附档案提示', (t) => t.includes('未附') || t.includes('没有附档案') || t.includes('没附')]
]
const misses = checks.filter(([n, f]) => !f(final)).map(([n]) => n)
const docRead = tools.some((t) => t === 'zj_read_doc' || t === 'zj_search')
console.log('\n未命中:', JSON.stringify(misses), ' 工具读了盘:', docRead)
const livePass = misses.length === 0 && !docRead
console.log('\n' + (dataPass && livePass ? 'FULLCTX LIVE OK' : 'FULLCTX LIVE FAILED'))
rmSync(tmp, { recursive: true, force: true })
process.exit(dataPass && livePass ? 0 : 1)
