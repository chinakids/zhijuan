// 织卷 · 数据层冒烟——上下文注入一致性审计第三轮（2026-09-13 智能层）
// 主题：切片同步产物「写入形态」与 buildWritingContext「读取口径」闭合配对
//   A. 人物切片小节追写（normalize 归一 → applyAnchor 追加「## 切片：<名>」到文件末尾）→ 注入保尾必须命中
//   B. 世界状态：归一 target→切片_<名>.md、anchor→「切片：<名>」→ applyAnchor H1 整节替换（说明行被清）→ 注入含状态、不含模板说明行
//   C. 旧无前缀名模板空壳（只有标题+说明行）→ 应按注释语义继续回退链（修复前：被当设定注入并挡回退——本轮实锤并修复）
//   D. 新名模板空壳 + 旧名有事实 → 回看旧名（既有行为回归）
//   E. 人物档案超限保尾：切片小节（最新状态）在文件末尾，超限时注入仍须命中
// 用法：cd ~/Desktop/织卷 && node scripts/context-consistency-smoke.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, readFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-consist-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeProbeSettings({ libraryRoot: join(tmp, 'lib') })

const lib = join(tmp, 'lib')
const pid = '一致性审计'
const P = (rel) => join(lib, pid, rel)
mkdirSync(P('正文'), { recursive: true })
mkdirSync(P('人物'), { recursive: true })
mkdirSync(P('世界观'), { recursive: true })

const EMPTY_SHELL = (name) =>
  `# 切片：${name}\n\n> 本切片的世界状态（规则、事件、环境）。正文保存时的切片同步会把本切片的新状态写入这里；长期不变设定请放《总纲》。\n`

// 第00章（上一章）与第01章（当前章）
writeFileSync(
  P('正文/第00章_引子.md'),
  ['---', '章号: 0', '题名: 引子', '切片: 序幕_冷江', '涉及人物: []', '---', '', '冷江入秋，江水漫过旧堤。', ''].join('\n'),
  'utf-8'
)
writeFileSync(
  P('正文/第01章_雾港.md'),
  ['---', '章号: 1', '题名: 雾港', '切片: 第一幕_雾港', '涉及人物: [沈藏]', '---', '', '沈藏走进调度室，灯管闪了一下。', ''].join('\n'),
  'utf-8'
)
// 人物档案：无切片小节（引导模板形态）
writeFileSync(
  P('人物/沈藏.md'),
  '# 沈藏\n\n<!-- 本档案由项目引导创建：基础设定为长时间不变项，切片小节由切片同步按章节追加。 -->\n\n## 基础设定（不变项）\n\n姓名：沈藏\n身份：冷江港调度\n',
  'utf-8'
)
// 总纲（长期事实）
writeFileSync(P('世界观/总纲.md'), '# 世界观总纲\n\n- 冷江流域每年秋汛，港区堤防按百年一遇设防。\n', 'utf-8')
// 旧无前缀名：模板空壳（模拟早期切片文件残留；本场景刻意让新名不存在 → 走旧名兼容分支）
writeFileSync(P('世界观/第一幕_雾港.md'), EMPTY_SHELL('第一幕_雾港'), 'utf-8')

// bundle 三个主进程模块（electron → stub）
const bundle = async (entry, out) => {
  await esbuild({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: out,
    alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
    external: ['node:*'],
    logLevel: 'warning'
  })
  return await import(pathToFileURL(out).href)
}
const ctxMod = await bundle('src/main/agent/context.ts', join(tmp, 'ctx.mjs'))
const syncMod = await bundle('src/main/agent/syncAnchor.ts', join(tmp, 'sync.mjs'))
const propsMod = await bundle('src/main/proposals.ts', join(tmp, 'props.mjs'))

let fail = 0
const ok = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) fail++
}
const read = (rel) => (existsSync(P(rel)) ? readFileSync(P(rel), 'utf-8') : '')

// ===== 链路 1：人物切片小节追写（模型乱填 anchor，「基础设定」属长期小节 → 归一为「切片：<名>」） =====
const items = syncMod.normalizeSyncItems(
  [
    { target: '人物/沈藏.md', anchor: '基础设定', kind: 'upsert-section', before: '', after: '沈藏当晚值夜班，盯着雷达屏幕到凌晨。', reason: '' },
    { target: '世界观/总纲.md', anchor: '切片：第一幕_雾港', kind: 'upsert-section', before: '', after: '水面浮起一层薄雾，能见度不足两百米。', reason: '' }
  ],
  '第一幕_雾港'
)
ok('A1 人物 anchor 归一为切片小节', items[0].anchor === '切片：第一幕_雾港' && items[0].target === '人物/沈藏.md')
ok('A2 世界 target 归一为切片文件', items[1].target === '世界观/切片_第一幕_雾港.md' && items[1].anchor === '切片：第一幕_雾港')
// 写盘：ensureWorldSliceFile 建模板 → applyAnchor 逐条
const wf = syncMod.ensureWorldSliceFile(join(lib, pid), '第一幕_雾港')
ok('A3 切片文件模板已建', wf === '世界观/切片_第一幕_雾港.md')
let personText = read('人物/沈藏.md')
let worldText = read('世界观/切片_第一幕_雾港.md')
const r1 = propsMod.applyAnchor(personText, items[0])
ok('A4 人物写入成功', r1.ok)
personText = r1.out
const r2 = propsMod.applyAnchor(worldText, items[1])
ok('A5 世界写入成功', r2.ok)
worldText = r2.out
ok('A6 世界写盘后说明行已被替换', !worldText.includes('> 本切片的世界状态') && worldText.includes('能见度不足两百米'))
writeFileSync(P('人物/沈藏.md'), personText, 'utf-8')
writeFileSync(P('世界观/切片_第一幕_雾港.md'), worldText, 'utf-8')

// ===== 链路 2：写入后的注入配对 =====
let ctx = await ctxMod.buildWritingContext(pid, '正文/第01章_雾港.md')
let all = ctx.blocks.join('\n')
const personBlock = ctx.blocks.find((b) => b.includes('人物档案')) ?? ''
const worldBlock = ctx.blocks.find((b) => b.includes('当前切片设定')) ?? ''
ok('B1 人物注入含切片小节状态（最新在尾部）', personBlock.includes('夜班') && personBlock.includes('雷达'))
ok('B2 人物注入无 HTML 注释', !personBlock.includes('<!--'))
ok('B3 世界注入含状态', worldBlock.includes('能见度不足两百米'))
ok('B4 世界注入无模板说明行', !worldBlock.includes('> 本切片的世界状态') && !worldBlock.includes('请放《总纲》'))
ok('B5 世界 sources 报切片文件', ctx.sources.includes('世界观/切片_第一幕_雾港.md'))

// ===== 链路 3：旧无前缀名=模板空壳（新名不存在）→ 必须继续回退链（修复点） =====
rmSync(P('世界观/切片_第一幕_雾港.md'), { force: true })
writeFileSync(P('世界观/第一幕_雾港.md'), EMPTY_SHELL('第一幕_雾港'), 'utf-8') // 还原成纯空壳
ctx = await ctxMod.buildWritingContext(pid, '正文/第01章_雾港.md')
all = ctx.blocks.join('\n')
const worldBlock2 = ctx.blocks.find((b) => b.includes('切片设定')) ?? ''
const totalBlock = ctx.blocks.find((b) => b.includes('世界观总纲')) ?? ''
ok('C1 旧名空壳不再注入说明行', !worldBlock2.includes('> 本切片的世界状态'))
ok('C2 回退链到达总纲（以长期设定为基准）', totalBlock.includes('百年一遇设防') && (totalBlock.includes('总纲') || totalBlock.includes('长期设定')))
ok('C3 回退链不再出现【当前切片设定：第一幕_雾港】', !all.includes('【当前切片设定：第一幕_雾港】'))

// ===== 链路 4：新名空壳 + 旧名有事实（既有行为回归：回看旧名） =====
writeFileSync(P('世界观/切片_第一幕_雾港.md'), EMPTY_SHELL('第一幕_雾港'), 'utf-8')
writeFileSync(P('世界观/第一幕_雾港.md'), '# 切片：第一幕_雾港\n\n- 旧名事实：雾从江面漫进调度室。\n', 'utf-8')
ctx = await ctxMod.buildWritingContext(pid, '正文/第01章_雾港.md')
const worldBlock3 = ctx.blocks.find((b) => b.includes('切片设定')) ?? ''
ok('D1 新名空壳回看旧名事实', worldBlock3.includes('旧名事实：雾从江面漫进调度室'))
ok('D2 旧名事实注入时无说明行', !worldBlock3.includes('> 本切片的世界状态'))
ctx = await ctxMod.buildWritingContext(pid, '正文/第01章_雾港.md') // 保持一次真实调用

// ===== 链路 5：人物档案超限保尾须命中切片小节 =====
writeFileSync(
  P('人物/沈藏.md'),
  '# 沈藏\n\n<!-- 基础设定 -->\n\n## 基础设定（不变项）\n\n【档案头】' + '基'.repeat(5600) + '\n\n## 切片：第一幕_雾港\n\n沈藏当晚值夜班，盯着雷达屏幕到凌晨。\n',
  'utf-8'
)
ctx = await ctxMod.buildWritingContext(pid, '正文/第01章_雾港.md')
const personBlock2 = ctx.blocks.find((b) => b.includes('人物档案')) ?? ''
ok('E1 超限人物注入含切片小节（保尾命中）', personBlock2.includes('雷达屏幕'))
ok('E2 超限人物注明省略+可现读', personBlock2.includes('已超 4000 字符预算') && personBlock2.includes('zj_read_doc'))
ok('E3 超限人物不注入基础档案头', !personBlock2.includes('【档案头】'))

rmSync(tmp, { recursive: true, force: true })
if (fail) {
  console.error(`\n${fail} 项失败`)
  process.exit(1)
}
console.log('\n全部通过（context-consistency）')
