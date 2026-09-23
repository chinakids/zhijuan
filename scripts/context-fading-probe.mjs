// 织卷 · 候选 1 评估探针：50 章+ 作品「前文承接衰减」可达性实证（2026-09-17 智能层）
// 问题：buildWritingContext 的「前情」只装配【上一同线章尾部 ≤3000 字符】，长作品（50 章+）里
//       更早的前文（第 8 章独家事实）不在注入内——模型能否经 zj_search/zj_read_doc 自行找回？
//       若找回=现状链通（检索增强兜底），找不回/编造=前文衰减缺口实锤（需评估「前文衰减摘要」）。
// 场景：临时项目 60 章正文（每章 ~700 字），人物 2 档/切片 6 个/章卡导演板正常；
//       独家事实「红丝带许愿」只存在于 第08章 正文；第60章 正文含「老槐树」回忆引子（线索驱动）。
// 输出：数据层白盒（装配不含事实=衰减场景成立）+ 真模型 runChat 两问（允许工具、诚实不编造）+
//       工具轨迹 + VERDICT 判定行（评估用，非 PASS/FAIL 门）。
// 用法：cd ~/Desktop/织卷 && node scripts/context-fading-probe.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-fading-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeProbeSettings({ libraryRoot: join(tmp, 'lib') })

const lib = join(tmp, 'lib')
const pid = '衰减探针'
const P = (rel) => join(lib, pid, rel)
for (const d of ['人物', '世界观', '正文', '大纲', '素材库']) mkdirSync(P(d), { recursive: true })

// ---- 场景文件：60 章正文；独家事实只在 第08章 ----
const mkChapter = (no, title, slice, cast, bodyLines) => {
  const pad = String(no).padStart(2, '0')
  return [
    '---', `章号: ${no}`, `题名: ${title}`, `切片: ${slice}`, `涉及人物: [${cast}]`, '---', '',
    ...bodyLines, ''
  ].join('\n')
}
// 6 个切片（每 10 章一幕）
const slices = ['第一幕_小镇', '第二幕_河岸', '第三幕_集市', '第四幕_山间', '第五幕_码头', '第六幕_归途']
const sliceOf = (no) => slices[Math.min(5, Math.floor((no - 1) / 10))]
const fillLines = (no, seedWords) => [
  `第${no}章的开头，沈知微沿着${seedWords[0]}慢慢走。`,
  '风从远处来，吹得街角的布幌子啪啪作响。',
  `陆行之在${seedWords[1]}等她，见面只说了一句：「今天的事，你打算怎么办？」`,
  '沈知微没有立刻回答。她把目光放远，看着天边压下来的云层。',
  `她想起${seedWords[2]}，心里那点犹豫忽然定了下来。`,
  '「先吃饭。」她笑了一下，「天大的事，也得先把肚子填饱。」',
  '两个人并肩走进巷子深处，脚步声混进嘈杂的人声里。'
]
for (let no = 1; no <= 60; no++) {
  let lines
  if (no === 8) {
    // 独家事实（只在此处出现「红丝带」「许愿」字样）
    lines = [
      '那天傍晚，沈知微一个人去了城东的老槐树。',
      '树干上系着许多褪色的红丝带，都是镇上人许愿留下的。',
      '沈知微从袖口里摸出一直藏着的那条红丝带，踮脚系在最粗的枝桠上。',
      '她在心里默默许愿：希望哥哥能找到回家的路。',
      '许完愿她退后两步，仰头看了那棵老槐树很久，才转身回镇。',
      '这件事她没有告诉任何人，连陆行之也不知道。'
    ]
  } else if (no === 59) {
    lines = [
      '夜里的码头安静得能听见水声。',
      '沈知微在栈桥尽头站了一会儿，月亮从云后露出来，把水面照成一片碎银。',
      '陆行之提着灯走过来，把灯放在她脚边：「看够了就回去，明天还有明天的活。」',
      '她点点头，弯腰把灯提起来，转身往回走。',
      '灯影摇晃，两个影子在木板上拉得很长。'
    ]
  } else if (no === 60) {
    // 回忆引子（「老槐树」线索），但不重述事实
    lines = [
      '清晨的镇口，薄雾还没散尽。',
      '沈知微站在树下，忽然又想起城东那棵老槐树。',
      '有些念头就是这样奇怪，明明过去了很久，偏偏在某个平常的早晨，毫无征兆地浮上来。',
      '「发什么呆？」陆行之从后面拍了她一下。',
      '她回过神：「没什么，走吧。」',
      '两个人沿着石板路往外走，雾气在身后一点点散开。'
    ]
  } else {
    const pools = [
      ['镇口的老街', '桥头', '昨晚那个人', '雨'],
      ['河岸边的柳树', '渡口', '那封没写完的信', '雾'],
      ['集市的人群', '布庄门口', '母亲的话', '喧闹'],
      ['山道上的石阶', '半山亭', '那场争执', '蝉鸣'],
      ['码头的货堆', '灯塔脚下', '去年的冬天', '潮声'],
      ['镇东的晒场', '祠堂门口', '外婆的叮嘱', '炊烟']
    ]
    const p = pools[Math.min(5, Math.floor((no - 1) / 10))]
    lines = fillLines(no, p)
  }
  writeFileSync(P(`正文/第${String(no).padStart(2, '0')}章_章${String(no).padStart(2, '0')}.md`), mkChapter(no, `章${String(no).padStart(2, '0')}`, sliceOf(no), '沈知微, 陆行之', lines), 'utf-8')
}
// 人物档案（不含红丝带/许愿）
writeFileSync(P('人物/沈知微.md'), ['# 沈知微', '', '- 小镇姑娘，灯笼铺帮工。', '- 有一个离家多年的哥哥。', ''].join('\n'), 'utf-8')
writeFileSync(P('人物/陆行之.md'), ['# 陆行之', '', '- 沈知微的青梅竹马，跑船人。', ''].join('\n'), 'utf-8')
// 切片（只给第六幕与总纲；不含事实）
writeFileSync(P('世界观/总纲.md'), ['# 世界观总纲', '', '- 故事发生在江边小镇。', '- 每十年发一次大水。', ''].join('\n'), 'utf-8')
writeFileSync(P('世界观/切片_第六幕_归途.md'), ['# 切片：第六幕_归途', '', '- 秋天的镇子，薄雾清晨。', ''].join('\n'), 'utf-8')
// 第60章章卡/导演板（常规，不含事实）
writeFileSync(P('大纲/第60章_章60.md'), ['# 第60章 章60', '', '> 一句话定位：清晨的出发。', '> 钩子：本章结尾她决定去找那棵树。', ''].join('\n'), 'utf-8')
writeFileSync(P('大纲/第60章_章60_导演.md'), ['# 导演板：第60章 章60', '', '## 情绪弧', '- 平静 → 回忆 → 决定。', '', '## 写作红线', '- 本章不写对话之外的情节跳跃。', ''].join('\n'), 'utf-8')
writeFileSync(P('素材库/索引.md'), ['# 素材库索引', '', '- 桥段：清晨出发', ''].join('\n'), 'utf-8')

// ---- 第一段：数据层白盒（装配不含事实=衰减场景成立）----
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
const ctx = await ctxMod.buildWritingContext(pid, '正文/第60章_章60.md')
console.log('=== 数据层：buildWritingContext 块 ===')
ctx.blocks.forEach((b, i) => {
  const head = b.split('\n').find((l) => l.startsWith('【')) ?? b.slice(0, 40)
  console.log(`[${i + 1}] ${head}`)
})
const all = ctx.blocks.join('\n')
const hasPrev59 = ctx.blocks.some((b) => b.startsWith('【上一章尾部') && b.includes('第59章'))
const curIs60 = ctx.blocks.some((b) => b.startsWith('【当前章节') && b.includes('第60章'))
const factAbsent = !all.includes('红丝带') && !all.includes('许愿')
const clueInjected = all.includes('老槐树')
console.log('\n【上一章尾部】=第59章=' + hasPrev59 + '  【当前章节】=第60章=' + curIs60)
console.log('事实(红丝带/许愿)在注入内=' + !factAbsent + '（false=前文已衰减出视野）  线索(老槐树)在注入内=' + clueInjected)
console.log(factAbsent && hasPrev59 && curIs60 ? 'FADING DATA OK（衰减场景成立：事实不在注入，线索在）' : 'FADING DATA FAILED')

// ---- 第二段：真模型（bundle engine.ts，第60章打开，两问）----
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
console.log('\n=== 开始 runChat（第60章，两问前文承接）：', new Date().toISOString())
const t0 = Date.now()
await mod.runChat(
  {
    requestId: 'fading-' + Date.now(),
    projectId: pid,
    chapterRel: '正文/第60章_章60.md',
    chapterTitle: '章60',
    prompt:
      '我正在写第60章，正文里她「忽然又想起城东那棵老槐树」。请帮我确认两件事；需要资料就用 zj_* 工具自己去查，不确定时诚实说「不确定」，绝对不要编造：\n' +
      '1. 她想起的那棵老槐树有什么来历？她曾在那棵树下做过什么？\n' +
      '2. 第八章（第08章）里，她做过一件与哥哥有关的事，是什么事？',
    quote: null
  },
  (e) => {
    events.push(e)
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'meta') console.log('\n[工具]', e.tool, JSON.stringify(e.argsJson ?? '').slice(0, 140))
    else if (e.type === 'meta-done') console.log('[工具完成]', (e.message ?? '').slice(0, 70))
    else if (e.type === 'error') console.error('\n[错误]', e.message)
  }
)
console.log('\n=== 完成，用时', ((Date.now() - t0) / 1000).toFixed(1) + 's，事件数:', events.length)
await mod.shutdown()

const final = events.filter((e) => e.type === 'final').map((e) => e.text).join('\n')
console.log('\n[最终回复]\n' + final)
const meta = events.filter((e) => e.type === 'meta')
const tools = meta.map((m) => m.tool)
console.log('\n工具轨迹:', JSON.stringify(tools))

// ---- 判定记录（评估用）----
const hitRibbon = final.includes('红丝带') || final.includes('许愿')
const hitEight = /第\s*8\s*章|第\s*八\s*章/.test(final)
const hitBrother = final.includes('哥哥')
const discovered = meta.some((m, i) => {
  const args = JSON.stringify(m.argsJson ?? '')
  return (m.tool === 'zj_search' && (args.includes('红丝带') || args.includes('许愿') || args.includes('老槐树') || args.includes('哥哥'))) ||
    (m.tool === 'zj_read_doc' && (args.includes('第08') || args.includes('第8')))
})
const honestUnknown = /不确定|不知道|没有找到|没找到|查不到/.test(final) && !hitRibbon
console.log('\n===== 评估判定 =====')
console.log('Q1(许愿事实)命中=' + hitRibbon + '  Q2(第八章)命中=' + (hitEight && hitRibbon) + '  线索检索(zj_search含关键词)=' + discovered)
console.log('检索类工具=' + tools.filter((t) => ['zj_search', 'zj_read_doc', 'zj_workspace', 'zj_list_docs'].includes(t)).length + ' 次；编造风险=命中且无任何检索工具=' + (hitRibbon && tools.filter((t) => t.startsWith('zj_')).length === 0))
if (hitRibbon && discovered) console.log('FADING VERDICT: 线索驱动检索可达——模型经 zj_search/zj_read_doc 找回第8章事实（链通），前文衰减摘要非必需')
else if (hitRibbon && !discovered) console.log('FADING VERDICT: 答对但无检索工具痕迹——判读：可能是上下文/记忆覆盖，需人工核查（疑与 DATA OK 冲突）')
else if (!hitRibbon && honestUnknown) console.log('FADING VERDICT: 诚实答不出——模型不主动检索/检索失败，前文衰减缺口实锤（值得评估摘要资产）')
else if (!hitRibbon) console.log('FADING VERDICT: 未能答对且非诚实未知——编造或答非所问，需人工判读最终回复')
else console.log('FADING VERDICT: 其他情形——需人工判读')
rmSync(tmp, { recursive: true, force: true })
