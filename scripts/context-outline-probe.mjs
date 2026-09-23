// 织卷 · 候选 2 评估探针：未开章场景「大纲」路标可达性实证
// 问题：buildProjectContext 的【文档清单】不含 大纲/ 目录（章卡/导演板/分幕路标缺席）。
//       未开章（chapterRel=null）时模型能否自己发现大纲目录并现读？还是不知道存在/编造？
// 场景：临时项目，含 project.md/世界观/正文 3 章/人物/素材库 + 大纲/章卡 + 大纲/导演板（独家事实）。
// 输出：数据层白盒（清单确证不含大纲）+ 真模型 runChat 两问（领域词提问，不禁止工具）+
//       工具轨迹 + 判定行（发现路径通畅 / 编造风险 / 答不出）。
// 用法：cd ~/Desktop/织卷 && node scripts/context-outline-probe.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-outline-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: join(tmp, 'lib') }), 'utf-8')

const lib = join(tmp, 'lib')
const pid = '大纲探针'
const P = (rel) => join(lib, pid, rel)
for (const d of ['人物', '世界观', '正文', '素材库', '大纲']) mkdirSync(P(d), { recursive: true })

// ---- 场景文件：独家事实（问什么 只有 大纲/ 里有答案）----
writeFileSync(
  P('project.md'),
  ['# 灯塔之夜', '', '三章结构：第一幕 雾港 → 第二幕 灯会 → 第三幕 灯塔。', '主角陈默在追查妹妹失踪的真相。', ''].join('\n'),
  'utf-8'
)
writeFileSync(P('世界观/总纲.md'), ['# 世界观总纲', '', '- 灯会每年冬至夜举行。', ''].join('\n'), 'utf-8')
const chs = [
  ['第01章_雾港.md', ['---', '章号: 1', '题名: 雾港', '切片: 第一幕_雾港', '涉及人物: []', '---', '', '雾从江面爬上来。', ''].join('\n')],
  ['第02章_灯会.md', ['---', '章号: 2', '题名: 灯会', '切片: 第二幕_灯会', '涉及人物: []', '---', '', '街口挂起了红灯笼。', ''].join('\n')],
  ['第03章_灯塔.md', ['---', '章号: 3', '题名: 灯塔', '切片: 第三幕_灯塔', '涉及人物: []', '---', '', '灯塔的灯坏了一夜。', ''].join('\n')]
]
for (const [name, body] of chs) writeFileSync(P('正文/' + name), body, 'utf-8')
writeFileSync(P('人物/陈默.md'), ['# 陈默', '', '档案：灯塔看守人。', ''].join('\n'), 'utf-8')
writeFileSync(P('素材库/桥段_钟.md'), ['# 桥段：钟', '', '追忆型开头参考。', ''].join('\n'), 'utf-8')
// 大纲/章卡（共享 shared/outline.ts 的章卡格式：约定头 + 要素块）
writeFileSync(
  P('大纲/第02章_灯会.md'),
  ['---', '章号: 2', '题名: 灯会', '切片: 第二幕_灯会', '涉及人物: []', '---', '', '## 要素', '', '- 目标：陈默想在灯会上打听到妹妹的下落。', '- 冲突：面具摊主认出他是拆灯塔的人，拒绝透露。', '- 关键事件：陈默在人群里看到一张酷似妹妹的脸。', ''].join('\n'),
  'utf-8'
)
// 大纲/导演板（director.ts 直写形态的近似：情绪弧/戏剧任务/钩子）
writeFileSync(
  P('大纲/第03章_灯塔_导演.md'),
  ['# 第03章 导演板', '', '## 情绪弧', '- 压抑 → 濒临放弃 → 顿悟', '', '## 戏剧任务', '- 第一段（推进）：灯塔检修的夜晚，雷雨。', '- 高潮（白热化）：灯突然亮起，照亮码头一个人影。', '', '## 钩子', '- 灯塔灯亮起的瞬间，照亮了码头那个人的脸——与妹妹一模一样。', ''].join('\n'),
  'utf-8'
)

// ---- 第一段：数据层白盒（确证【文档清单】不含大纲）----
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
console.log('=== 数据层：buildProjectContext 块 ===')
pctx.blocks.forEach((b, i) => {
  const head = b.split('\n').find((l) => l.startsWith('【')) ?? b.slice(0, 40)
  console.log(`[${i + 1}] ${head}`)
})
const listBlock = pctx.blocks.find((b) => b.startsWith('【文档清单】')) ?? ''
console.log('\n【文档清单】全文：\n' + listBlock)
const all = pctx.blocks.join('\n')
const outlineAbsent = !all.includes('大纲/')
console.log('\n清单含「大纲/」路标=' + !outlineAbsent + '（false=路标缺席实锤）')
console.log(outlineAbsent ? 'OUTLINE DATA: 路标缺席确认' : 'OUTLINE DATA: 路标已在（评估前提不成立）')

// ---- 第二段：真模型（bundle engine.ts，chapterRel=null，两问）----
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
console.log('\n=== 开始 runChat（未开章，两问大纲）：', new Date().toISOString())
await mod.runChat(
  {
    requestId: 'outline-' + Date.now(),
    projectId: pid,
    chapterRel: null,
    chapterTitle: '',
    prompt:
      '我有两个问题，请尽量帮忙找到答案；作品数据都在工作区里，需要就调用工具自己找。不确定时诚实说「不确定」，不要编造：\n' +
      '1. 大纲目录下有哪些文档？第二章的章卡里记录的目标和冲突是什么？\n' +
      '2. 第三章的导演板里写了什么情绪弧和钩子？',
    quote: null
  },
  (e) => {
    events.push(e)
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'meta') console.log('\n[工具]', e.tool, JSON.stringify(e.argsJson ?? '').slice(0, 120))
    else if (e.type === 'meta-done') console.log('[工具完成]', (e.message ?? '').slice(0, 80))
    else if (e.type === 'error') console.error('\n[错误]', e.message)
  }
)
console.log('\n=== 完成，事件数:', events.length)
await mod.shutdown()

const final = events.filter((e) => e.type === 'final').map((e) => e.text).join('\n')
console.log('\n[最终回复]\n' + final)
const meta = events.filter((e) => e.type === 'meta')
const tools = meta.map((m) => m.tool)
console.log('\n工具轨迹:', JSON.stringify(tools))

// ---- 判定记录（评估用，非 PASS/FAIL 门）----
const hit1 = final.includes('面具摊主') || final.includes('打听到妹妹') || final.includes('酷似妹妹')
const hit2 = final.includes('顿悟') || final.includes('照亮码头') || final.includes('一模一样的脸')
const usedDiscovery = tools.some((t) => ['zj_workspace', 'zj_list_docs', 'zj_search'].includes(t))
const readOutline = meta.some((m, i) => {
  if (m.tool !== 'zj_read_doc') return false
  const args = JSON.stringify(m.argsJson ?? '')
  return args.includes('大纲')
})
const honestUnknown = /不确定|不知道|没有找到|没找到/.test(final) && !hit1 && !hit2
console.log('\n===== 评估判定 =====')
console.log('Q1 章卡(目标/冲突)命中=' + hit1 + '  Q2 导演板(情绪弧/钩子)命中=' + hit2 + '  诚实答不出=' + honestUnknown)
console.log('发现类工具(workspace/list/search)=' + usedDiscovery + '  直接读大纲文件=' + readOutline)
if (hit1 && hit2) console.log('OUTLINE VERDICT: 模型自行发现并答出——现状可达（链通），路标可暂不加')
else if (hit1 || hit2) console.log('OUTLINE VERDICT: 部分可达——存在缺口，视缺口内容决定')
else if (honestUnknown) console.log('OUTLINE VERDICT: 模型不知道大纲存在/读不到——值得加路标（一行成本）')
else console.log('OUTLINE VERDICT: 未能作答且非诚实未知——需人工判读')
rmSync(tmp, { recursive: true, force: true })
