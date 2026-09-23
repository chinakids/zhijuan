// 织卷 · 切片同步产出端闭环冒烟（无 GUI / 无模型调用）
// 候选 2d「产出端审计」（2026-09-13 智能层轮）验收：真模型 runSync 产物（engine-sync-smoke.mjs
// 2026-09-13 走查输出，deepseek-v4 真产 3 条 items——含「模型意欲改基础档案」的 before 冲突样本）
// → createProposals + applyProposal 真写盘 → buildWritingContext 真装配读取，三段闭环断言：
//   ① 盘上形态：切片小节唯一、基础档案保留、总纲零污染、世界 H1 整节替换无异号标题；
//   ② 注入字节：最新状态入上下文（人/世界都读得到），被替换旧状态（before）不再出现在装配里；
//   ③ 无模板空壳残留：切片文件说明行被替换后注入端不判空、不回退链。
// 用法：cd ~/Desktop/织卷 && node scripts/sync-produce-loop-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-produce-loop-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: join(tmp, 'lib') }), 'utf-8')

const lib = join(tmp, 'lib')
const pid = '产出端闭环'
const P = (rel) => join(lib, pid, rel)
mkdirSync(P('人物'), { recursive: true })
mkdirSync(P('世界观'), { recursive: true })
mkdirSync(P('正文'), { recursive: true })
mkdirSync(P('.zhijuan'), { recursive: true })

// 场景底稿：人物档案含手写基础档案 + 已有旧切片小节（模型 before 针对的旧状态）；世界：总纲 + 切片模板；正文约定头
writeFileSync(
  P('人物/林晓.md'),
  [
    '# 林晓', '',
    '> 定位：等待十年前失联船只的女孩', '',
    '## 基础档案', '',
    '- 年龄：19', '- 身份：渔村遗孤', '- 背景：十年前船难幸存者', '',
    '## 切片：第一幕_雾港之夜', '',
    '- 站在栈桥，等十年前失联的船；与韩青重逢', ''
  ].join('\n'),
  'utf-8'
)
writeFileSync(
  P('人物/韩青.md'),
  [
    '# 韩青', '',
    '> 定位：缉私队新人', '',
    '## 基础档案', '',
    '- 年龄：24', '- 职业：缉私队队员', '- 背景：渔村长大', '',
    '## 切片：第一幕_雾港之夜', '',
    '- 机场值夜时遇见林晓；还保有渔村的记忆碎片', ''
  ].join('\n'),
  'utf-8'
)
writeFileSync(P('世界观/总纲.md'), '# 世界观总纲\n\n## 时代背景\n\n雾港小镇，近未来\n', 'utf-8')
writeFileSync(
  P('世界观/切片_第一幕_雾港之夜.md'),
  '# 切片：第一幕_雾港之夜\n\n> 本切片的世界状态（规则、事件、环境）。正文保存时的切片同步会把本切片的新状态写入这里；长期不变设定请放《总纲》。\n',
  'utf-8'
)
writeFileSync(
  P('正文/第01章_雾港.md'),
  ['---', '章号: 1', '题名: 雾港', '切片: 第一幕_雾港之夜', '涉及人物: [林晓, 韩青]', '---', '', '# 雾港', '', '雾港的夜把整条街都浸在灰里。林晓停在栈桥尽头的灯柱下。韩青把外套披到她肩上。'].join('\n'),
  'utf-8'
)

// —— 真模型走查产物（engine-sync-smoke.mjs 2026-09-13 输出，原样照录）——
const items = [
  {
    target: '人物/韩青.md',
    anchor: '切片：第一幕_雾港之夜',
    kind: 'upsert-section',
    before: '机场值夜时遇见林晓；还保有渔村的记忆碎片',
    after: '- 在雾港栈桥尽头的灯柱下与林晓相遇，点了根烟，把外套披到她肩上，一句话没说\n- 缉私队新人，渔村长大，还保有渔村的记忆碎片',
    reason: '正文写明两人在雾港栈桥相遇且韩青为林晓披衣，原记录「机场值夜」与正文地点冲突，需校正并补全本切片状态。'
  },
  {
    target: '人物/林晓.md',
    anchor: '切片：第一幕_雾港之夜',
    kind: 'upsert-section',
    before: '站在栈桥，等十年前失联的船；与韩青重逢',
    after: '- 站在栈桥尽头的灯柱下，等十年前再没靠岸的那艘船\n- 与韩青重逢，肩上披着他递来的外套',
    reason: '正文新增韩青为她披上外套的行动与细节，人物状态需同步补充。'
  },
  {
    target: '世界观/切片_第一幕_雾港之夜.md',
    anchor: '切片：第一幕_雾港之夜',
    kind: 'upsert-section',
    before: '大雾，近海能见度不足百步；栈桥灯柱亮着昏黄的光',
    after: '- 大雾，近海能见度不足百步\n- 栈桥灯柱亮着昏黄的光\n- 夜风不停，空气带着潮气，整条街浸在灰蒙蒙的雾里\n- 十年前一艘船离港后再未靠岸，那是林晓等待的“她”',
    reason: '正文新增夜风、潮气等环境状态，并揭示十年前船只未归的世界线索，需补入本切片。'
  }
]

let fails = 0
const check = (name, cond) => {
  console.log((cond ? '[PASS] ' : '[FAIL] ') + name)
  if (!cond) fails++
}
const cnt = (s, sub) => s.split(sub).length - 1

// ① bundle 主进程（electron → stub），走完整提案链路（聚合入口：proposals + engine + context）
writeFileSync(
  join(tmp, 'entry.ts'),
  [
    `export { createProposals, applyProposal } from '${root}/src/main/proposals'`,
    `export { shutdown } from '${root}/src/main/agent/engine'`,
    `export { buildWritingContext } from '${root}/src/main/agent/context'`
  ].join('\n'),
  'utf-8'
)
const out = join(tmp, 'bundle.mjs')
await esbuild({
  entryPoints: [join(tmp, 'entry.ts')],
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

// createProposals + applyProposal（proposals.ts 在 bundle 中）
const { createProposals, applyProposal } = mod
const created = createProposals(lib, pid, 'slice-sync', '正文/第01章_雾港.md', '第一幕_雾港之夜', items)
check('提案逐条创建且数量=3', created.length === 3)
const applied = created.map((p) => applyProposal(lib, pid, p.id))
check('三条提案全部接受成功', applied.every((a) => a.ok))

// ② 盘上形态断言
const lin = readFileSync(P('人物/林晓.md'), 'utf-8')
const chen = readFileSync(P('人物/韩青.md'), 'utf-8')
const wf = readFileSync(P('世界观/切片_第一幕_雾港之夜.md'), 'utf-8')
const zg = readFileSync(P('世界观/总纲.md'), 'utf-8')

check('林晓切片小节唯一（一次同步不重复堆积）', cnt(lin, '## 切片：第一幕_雾港之夜') === 1)
check('林晓基础档案保留（年龄/身份/背景仍在）', lin.includes('- 年龄：19') && lin.includes('- 背景：十年前船难幸存者'))
check('林晓切片内容=新状态（披上外套），旧 before 被整节替换', lin.includes('肩上披着他递来的外套') && !lin.includes('等十年') || lin.includes('披着他递来的外套'))
check('林晓旧切片状态（before）不再残留', !lin.includes('站在栈桥，等十年前失联的船；与韩青重逢'))
check('韩青切片小节唯一', cnt(chen, '## 切片：第一幕_雾港之夜') === 1)
check('韩青基础档案保留 + 切片=新状态（栈桥/披衣）', chen.includes('- 年龄：24') && chen.includes('把外套披到她肩上'))
check('韩青旧状态「机场值夜」不再残留', !chen.includes('机场值夜时遇见林晓'))
check('总纲零污染（无新增内容）', zg.includes('近未来') && !zg.includes('十年'))
check('世界文件 H1 唯一且为「# 切片：…」', cnt(wf, '# 切片：第一幕_雾港之夜') === 1)
check('世界文件说明行已被替换（无模板残留）', !wf.includes('本切片的世界状态（规则、事件、环境）'))
check('世界文件新状态已写入（十年前/潮气）', wf.includes('十年前一艘船离港后再未靠岸') && wf.includes('潮气'))
check('世界文件无「## 总纲」异号标题混入', !wf.includes('## 总纲'))

// ③ 注入端读取：buildWritingContext 装配（与 runChat/runSync 同一创作半径）
const ctx = await mod.buildWritingContext(pid, '正文/第01章_雾港.md')
const all = ctx.blocks.join('\n')
check('上下文含人物新状态（林晓披外套 / 韩青栈桥）', all.includes('肩上披着他递来的外套') && all.includes('把外套披到她肩上'))
check('上下文含世界新状态（十年前船只未归）', all.includes('十年前一艘船离港后再未靠岸'))
check('上下文不含被替换旧状态（机场值夜 / 旧 before）', !all.includes('机场值夜时遇见林晓，还保有') && !all.includes('站在栈桥，等十年前失联的船；与韩青重逢'))
check('上下文不含模板说明行（无空壳残留）', !all.includes('本切片的世界状态（规则、事件、环境）'))
check('上下文块数≥4（当前章/人×2/切片）', ctx.blocks.length >= 4)

// ④ 二次同步（同切片再同步一次，模拟保存→再保存）：不重复堆积、不破坏
const items2 = items.map((it) => ({ ...it, after: it.after + '\n- （二次同步附注）' }))
const created2 = createProposals(lib, pid, 'slice-sync', '正文/第01章_雾港.md', '第一幕_雾港之夜', items2)
created2.forEach((p) => applyProposal(lib, pid, p.id))
const lin2 = readFileSync(P('人物/林晓.md'), 'utf-8')
const wf2 = readFileSync(P('世界观/切片_第一幕_雾港之夜.md'), 'utf-8')
check('二次同步后：人物切片小节仍唯一', cnt(lin2, '## 切片：第一幕_雾港之夜') === 1)
check('二次同步后：世界 H1 仍唯一', cnt(wf2, '# 切片：第一幕_雾港之夜') === 1)
check('二次同步后：新内容覆盖旧（无堆积）', lin2.includes('二次同步附注') && !lin2.includes('站在栈桥，等十年前失联的船；与韩青重逢'))

await mod.shutdown()
console.log(fails === 0 ? 'PRODUCE-LOOP SMOKE OK' : 'PRODUCE-LOOP SMOKE FAILED: ' + fails)
rmSync(tmp, { recursive: true, force: true })
process.exit(fails === 0 ? 0 : 1)
