// 织卷 · 数据层冒烟——上下文预算截断可见性（2026-09-13 智能层「上下文注入审计第二轮」收口）
// 场景：章卡(≤2000)/导演板(≤2500)/素材索引(≤1200)/作品总纲(≤3000)/世界观总纲(≤2000) 超预算时
//       装配保头 + 注明「已超/已省略/可现读」（修复前：静默截断，模型会把被截块当完整内容）。
//       未超预算块零提示零回归。
// 用法：cd ~/Desktop/织卷 && node scripts/context-budget-smoke.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-budget-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeProbeSettings({ libraryRoot: join(tmp, 'lib') })

const lib = join(tmp, 'lib')
const pid = '预算走查'
const P = (rel) => join(lib, pid, rel)
mkdirSync(P('正文'), { recursive: true })
mkdirSync(P('大纲'), { recursive: true })
mkdirSync(P('素材库'), { recursive: true })
mkdirSync(P('世界观'), { recursive: true })

const FM = ['---', '章号: 1', '题名: 预算', '切片: 第一幕', '涉及人物: []', '---', '', '第一章正文。'].join('\n') + '\n'
writeFileSync(P('正文/第01章_预算.md'), FM, 'utf-8')
// ① 章卡超预算（2200 > 2000）：开头标记必须保留、尾部标记必须被裁且注明省略
writeFileSync(P('大纲/第01章_预算.md'), '【卡首标记】' + '卡'.repeat(2200) + '【卡尾标记】', 'utf-8')
// ② 导演板超预算（2600 > 2500）
writeFileSync(P('大纲/第01章_预算_导演.md'), '【板首标记】' + '板'.repeat(2600) + '【板尾标记】', 'utf-8')
// ③ 素材库路标超预算（20 个素材 ≈1500+ > 1200；2026-09-18 改动态路标——素材文件为权威，索引.md 不再是信号源）
mkdirSync(P('素材库/桥段'), { recursive: true })
mkdirSync(P('素材库/环境'), { recursive: true })
for (let i = 1; i <= 20; i++) {
  const cat = i % 2 ? '桥段' : '环境'
  writeFileSync(
    P(`素材库/${cat}/素材${String(i).padStart(2, '0')}.md`),
    `---\n标签: [${cat}, 标签${i}]\n---\n\n# 素材${String(i).padStart(2, '0')}\n\n` + `索${i}`.repeat(30),
    'utf-8'
  )
}
// 采集池任务卡 + 索引.md 存在但不得进路标（判据 isMaterialCard）
writeFileSync(P('素材库/索引.md'), '【索首标记】' + '索'.repeat(1500) + '【索尾标记】', 'utf-8')
mkdirSync(P('素材库/采集池'), { recursive: true })
writeFileSync(P('素材库/采集池/任务_1.md'), 'status: pending', 'utf-8')
// ④ 项目总纲/世界观总纲超预算（buildProjectContext）
writeFileSync(P('project.md'), '【纲首标记】' + '纲'.repeat(3200) + '【纲尾标记】', 'utf-8')
writeFileSync(P('世界观/总纲.md'), '【世首标记】' + '世'.repeat(2300) + '【世尾标记】', 'utf-8')
writeFileSync(P('世界观/切片_第一幕.md'), '本切片状态：无特别。', 'utf-8')

// bundle 主进程 context（electron → stub）
const out = join(tmp, 'ctx.mjs')
await esbuild({
  entryPoints: [resolve(root, 'src/main/agent/context.ts')],
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

let fail = 0
const ok = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) fail++
}

// ⑤ buildWritingContext：三个超限块
const ctx = await mod.buildWritingContext(pid, '正文/第01章_预算.md')
const all = ctx.blocks.join('\n')
const card = ctx.blocks.find((b) => b.includes('本章章卡')) ?? ''
const board = ctx.blocks.find((b) => b.includes('本章导演板')) ?? ''
const idx = ctx.blocks.find((b) => b.includes('素材库索引')) ?? ''
ok('章卡超限标记存在', card.includes('【卡首标记】'))
ok('章卡超限尾部被裁', !card.includes('【卡尾标记】'))
ok('章卡超限注明预算+省略+现读', card.includes('已超 2000 字符预算') && card.includes('已省略') && card.includes('zj_read_doc'))
ok('导演板超限注明', board.includes('已超 2500 字符预算') && board.includes('已省略') && board.includes('【板首标记】') && !board.includes('【板尾标记】'))
ok('素材库路标超限注明', idx.includes('素材库共 20 篇') && idx.includes('超 1200 字符预算') && idx.includes('zj_search 搜索（dir=素材库）') && idx.includes('素材01') && !idx.includes('素材20'))
ok('素材路标不含索引.md/采集池', !idx.includes('【索首标记】') && !idx.includes('任务_1'))
const chapter = ctx.blocks.find((b) => b.includes('当前章节')) ?? ''
const slice = ctx.blocks.find((b) => b.includes('当前切片设定')) ?? ''
ok('正文/切片未超限零提示', !chapter.includes('已超') && !slice.includes('已超'))

// ⑥ buildProjectContext：两个总纲超限注明
const pctx = await mod.buildProjectContext(pid)
const pall = pctx.blocks.join('\n')
const dlist = pctx.blocks.find((b) => b.includes('文档清单')) ?? ''
ok('作品总纲超限注明', pall.includes('已超 3000 字符预算') && pall.includes('【纲首标记】') && !pall.includes('【纲尾标记】'))
ok('世界观总纲超限注明', pall.includes('已超 2000 字符预算') && pall.includes('【世首标记】') && !pall.includes('【世尾标记】'))
ok('文档清单路标仍全量', dlist.includes('正文/') && dlist.includes('素材库/'))

rmSync(tmp, { recursive: true, force: true })
if (fail) {
  console.error(`\n${fail} 项失败`)
  process.exit(1)
}
console.log('\n全部通过（context-budget）')
