// 织卷 · 真模型「素材使用侧」探针（2026-09-18 12:00 智能层轮；09:00 轮观察项①：素材「路标→现读→用于创作」链路）
// 背景：素材注入链路已审计修复（d4dd488：模型侧素材块=素材文件动态路标、索引.md 回归作者侧目录文档；
//       context-full-live 题 8 已证「路标可见」（模型答出素材名）、context-tools-live 已证「现读可达」）。
//       缺的是作者真实创作场景的行为面：模型看到素材路标（名称/标签/预览）后，会不会主动检索素材文件、
//       并把素材内容真正用于正文创作（而非只复述）——这是「采集→素材→注入→创作可用」的最后一环。
// 场景（贴真实采集卡形态：文件名=采集_<任务名>.md、H1=内容题名（采集草稿）、tags 在 front matter）：
//   素材① 采集_雾港.md：核心意象（金色光晕/旧绸缎）在文件【中段】，首段中性引子 → 装配路标零泄底
//          （与 context-tools-live 同保真设计：路标若含意象，模型可凭装配作答，验证失真）；
//   素材② 采集_雨夜重逢.md：干扰项（蓝丝线/白伞），模型不应取用；
//   + 采集池/任务卡 + 索引.md + 隐藏文件：isMaterialCard 过滤反例（路标不含）。
// 流程：① 数据层白盒——素材块含两素材+标签、不含核心意象/任务卡/索引文字（路标零泄底）；
//       ② 真模型 runChat——作者口吻「夜景不够生动，素材库里有没有能用的？读了帮我改」；
// 判据：②模型轨迹含素材库检索/读取（zj_search dir=素材库 或 zj_read_doc 路径含 素材库/）；
//       ③最终回复含素材①核心意象且不含素材②意象（用对素材、零编造）；④给出改写（zj_edit_doc 或正文建议）。
// 用法：cd ~/Desktop/织卷 && node scripts/material-use-live.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-matuse-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeProbeSettings({ libraryRoot: join(tmp, 'lib') })

const lib = join(tmp, 'lib')
const pid = '素材使用探针'
const P = (rel) => join(lib, pid, rel)
mkdirSync(P('正文'), { recursive: true })
mkdirSync(P('素材库/环境'), { recursive: true })
mkdirSync(P('素材库/桥段'), { recursive: true })
mkdirSync(P('素材库/采集池'), { recursive: true })

// 当前章正文：夜景且在结尾留一句待丰富；不含任何素材意象（防模型凭装配作答）
writeFileSync(
  P('正文/第01章_夜航.md'),
  ['---', '章号: 1', '题名: 夜航', '切片: 第一幕', '涉及人物: []', '---', '',
    '轮船靠岸的时候已经是后半夜。他沿着栈桥往码头深处走，浪声很大。', '',
    '他靠在小艇上，望着港口。', ''].join('\n'),
  'utf-8'
)
// 素材①：核心意象在中段；首行=中性引子（预览不泄底）；H1=内容题名≠文件名（采集回填形态）
writeFileSync(
  P('素材库/环境/采集_雾港.md'),
  ['---', '标签: [夜景, 海港, 氛围]', '---', '', '# 雾港夜航笔记（采集草稿）', '',
    '老港的灯年年照常亮着。', '',
    '他后来常想起那一夜：航标灯亮起来的时候，海上竟然没有一丝风，灯芯的金色光晕在水面铺开，像一层薄薄的旧绸缎。', '',
    '打更的老人说，那样的夜里，船自己会认路回家。', ''].join('\n'),
  'utf-8'
)
// 素材②：干扰项——同一场景话题但意象完全不同（模型若取错=未区分）
writeFileSync(
  P('素材库/桥段/采集_雨夜重逢.md'),
  ['---', '标签: [重逢, 夜雨, 伞]', '---', '', '# 雨夜重逢桥段（采集草稿）', '',
    '雨停的时候，他在便利店门口站了很久。', '',
    '她撑着一把烧了边的白伞走来，伞骨上缠着褪色的蓝丝线，在他面前停住。', ''].join('\n'),
  'utf-8'
)
// 反例：索引.md（目录文档，不是信号源）、采集池任务卡、隐藏文件——路标都不应含
writeFileSync(P('素材库/索引.md'), '# 素材库索引\n\n- 环境/采集_雾港.md —— 雾港夜航笔记\n', 'utf-8')
writeFileSync(P('素材库/采集池/任务_1.md'), ['---', 'status: done', '类别: 环境', '---', '', '（任务卡）'].join('\n'), 'utf-8')
writeFileSync(P('素材库/.hidden.md'), '# 隐藏', '', '（隐藏文件）', 'utf-8')

// ---- 第一段：数据层白盒（bundle context.ts）----
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
const ctx = await ctxMod.buildWritingContext(pid, '正文/第01章_夜航.md')
const all = ctx.blocks.join('\n')
const matBlock = ctx.blocks.find((b) => b.startsWith('【素材库索引')) ?? ''
console.log('=== 数据层：素材块 ===')
console.log(matBlock)
const leakKeys = ['金色光晕', '旧绸缎', '蓝丝线', '白伞', '任务卡', '索引.md', '隐藏']
const leaks = leakKeys.filter((k) => all.includes(k))
const matChecks = {
  '素材块存在': matBlock.length > 0,
  '含素材①(采集_雾港)': matBlock.includes('采集_雾港'),
  '含素材②(采集_雨夜重逢)': matBlock.includes('采集_雨夜重逢'),
  '含标签①(夜景)': matBlock.includes('夜景'),
  '含标签②(重逢)': matBlock.includes('重逢'),
  // 2026-09-18：路径行必须含「素材库/」前缀=项目根相对路径（模型照抄即可 zj_read_doc）——
  // 首版库内相对路径（- 环境/…）被真模型首调照抄读失败、自纠后才成功（本探针首跑实证）。
  '路标行含项目根前缀(素材库/)': matBlock.includes('- 素材库/环境/采集_雾港') && matBlock.includes('- 素材库/桥段/采集_雨夜重逢'),
  '路标零泄底(无核心/干扰意象/任务卡/索引/隐藏)': leaks.length === 0
}
for (const [k, v] of Object.entries(matChecks)) console.log(`断言 ${k}: ${v ? 'OK' : 'FAIL'}`)
const dataPass = Object.values(matChecks).every(Boolean)
console.log(dataPass ? 'MATERIAL-USE DATA OK' : 'MATERIAL-USE DATA FAILED' + ' 泄露=' + JSON.stringify(leaks))

// ---- 第二段：真模型使用侧（bundle engine.ts）----
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
console.log('\n=== 开始 runChat（素材使用侧）：', new Date().toISOString())
await mod.runChat(
  {
    requestId: 'matuse-' + Date.now(),
    projectId: pid,
    chapterRel: '正文/第01章_夜航.md',
    chapterTitle: '第1章',
    prompt:
      '我现在写的这一章结尾是：「他靠在小艇上，望着港口。」我感觉这句夜景不够生动，想改得更有画面感。\n' +
      '请你先看看素材库里有没有能用来丰富这段夜景的素材（在【素材库索引】里找线索，需要细节就用 zj_search 或 zj_read_doc 去读素材文件），如果有合适的，读出来，然后把「他靠在小艇上，望着港口。」这句话改写成一个 3-5 句的具体场景（可以直接用 zj_edit_doc 改正文，或者直接给我改写后的文本）。没有合适的素材就说没有，不要编造。',
    quote: null
  },
  (e) => {
    events.push(e)
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'meta') console.log('\n[工具]', e.tool, JSON.stringify(e.args ?? '').slice(0, 80))
    else if (e.type === 'meta-done') console.log('[工具完成]', (e.message ?? '').slice(0, 60))
    else if (e.type === 'error') console.error('\n[错误]', e.message)
  }
)
console.log('\n=== 完成，事件数:', events.length)
await mod.shutdown()

const final = events.filter((e) => e.type === 'final').map((e) => e.text).join('\n')
console.log('\n[最终回复]\n' + final)
const tools = events.filter((e) => e.type === 'meta').map((e) => e.tool + ' ' + (e.args ?? ''))
console.log('\n调用工具:', JSON.stringify(tools, null, 1))
// 软观察（不参与 FAIL）：模型若读过干扰素材，看是否明确说明为何不用（读了≠用且主动解释=更优行为；
// 措辞多变（没有采用/没有使用/不符/不搭…），不作为硬判据——硬判据=用了对的+改写没混入错的）
if (tools.some((t) => t.includes('zj_read_doc') && !t.includes('正文'))) {
  const excl = /没有采用|没有使用|不搭|不符|用不上/.test(final)
  console.log(`[软观察] 读过素材文件；排除说明=${excl ? '有' : '无'}（无说明不判 FAIL）`)
}

const matTool = tools.some((t) => t.includes('zj_search') || (t.includes('zj_read_doc') && t.includes('素材库')))
const rewrites = events.filter((e) => e.type === 'edit' || (e.type === 'meta' && e.tool === 'zj_edit_doc')).length
// 改写正文=最终回复里的引用引文块（「> 」行）。模型可能在说明里点名干扰素材的意象（「白伞…没有使用」）
// ——这是排除性说明（读了≠用，且主动解释），不是混用；判据只看改写正文本身。
const rewriteQuote = (final.match(/^> .+$/gm) ?? []).join('\n')
const checks = [
  ['检索/读取了素材库', matTool],
  ['最终回复含素材①意象(金色光晕/旧绸缎/航标灯)', (t) => t.includes('光晕') || t.includes('绸缎') || t.includes('航标')],
  ['改写正文未混入素材②意象(蓝丝线/白伞/便利店)', (t) => !/(蓝丝线|白伞|便利店)/.test(rewriteQuote)],
  ['给出改写(修改卡或正文文本)', (t) => rewrites > 0 || (/小艇|港口/.test(t) && t.length > 60)],
  ['未声称没有素材', (t) => !/没有合适|没有素材/.test(t)]
]
let livePass = true
for (const [name, f] of checks) {
  const ok = typeof f === 'function' ? f(final) : f
  console.log(`断言 ${name}: ${ok ? 'OK' : 'FAIL'}`)
  if (!ok) livePass = false
}
console.log('\n' + (dataPass && livePass ? 'MATERIAL-USE LIVE OK' : 'MATERIAL-USE LIVE FAILED'))
rmSync(tmp, { recursive: true, force: true })
process.exit(dataPass && livePass ? 0 : 1)
