// 织卷 · 同步器产物守卫冒烟（候选 2e 验收；无 GUI / 无模型调用）
// 验证：runSync 接入的 guard 防线对「模型编造的人物 target」——精确命中保留 / 近名唯一纠正 /
// 涉及未建档明示 / 无可纠正丢弃，且 knownFiles 与真机 listDocs 同口径（剥 .md）。
// 用法：cd ~/Desktop/织卷 && node scripts/sync-guard-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-guard-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: join(tmp, 'lib') }), 'utf-8')

const lib = join(tmp, 'lib')
const pid = '守卫冒烟'
const P = (rel) => join(lib, pid, rel)
mkdirSync(P('人物'), { recursive: true })
mkdirSync(P('世界观'), { recursive: true })
mkdirSync(P('正文'), { recursive: true })
writeFileSync(P('人物/林晓.md'), '# 林晓\n\n## 基础档案\n\n- 年龄：19\n', 'utf-8')
writeFileSync(P('人物/陈默.md'), '# 陈默\n\n## 基础档案\n\n- 年龄：24\n', 'utf-8')
writeFileSync(
  P('正文/第01章_雾港.md'),
  ['---', '章号: 1', '题名: 雾港', '切片: 第一幕_雾港之夜', '涉及人物: [林晓, 陈默, 沈藏]', '---', '', '# 雾港', '', '正文一句。'].join('\n'),
  'utf-8'
)

// bundle 入口：真机 store.listDocs（剥 .md 口径）+ syncAnchor（normalize + guard）
writeFileSync(
  join(tmp, 'entry.ts'),
  [
    `export { listDocs } from '${root}/src/main/store'`,
    `export { normalizeSyncItems, guardPersonTargets } from '${root}/src/main/agent/syncAnchor'`
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

let fails = 0
const check = (name, cond) => {
  console.log((cond ? '[PASS] ' : '[FAIL] ') + name)
  if (!cond) fails++
}

const files = mod.listDocs(pid, '人物').map((d) => d.name)
check('knownFiles 与真机 listDocs 同口径（剥 .md、按 mtime 排序只是顺序无关）', files.includes('林晓') && files.includes('陈默') && files.length === 2)

const slice = '第一幕_雾港之夜'
const cast = ['林晓', '陈默', '沈藏'] // 与约定头「涉及人物」一致
const mk = (target) => ({ target, anchor: '切片：第一幕_雾港之夜', kind: 'upsert-section', before: '', after: '- 新状态', reason: 'r' })

// 场景 1：正常产物（命中既有档案 + 世界）→ 全保留零 issue
let items = mod.normalizeSyncItems([mk('人物/林晓.md'), mk('人物/陈默.md'), mk('世界观/切片_第一幕_雾港之夜.md')], slice)
let g = mod.guardPersonTargets(items, { knownFiles: files, chapterCast: cast })
check('场景1：命中档案与世界 target 全保留', g.items.length === 3 && g.issues.length === 0)
check('场景1：世界 target 未被误改', g.items[2].target === '世界观/切片_第一幕_雾港之夜.md')

// 场景 2：编造近名（林晚→林晓）→ 自动纠正
g = mod.guardPersonTargets([mk('人物/林晚.md')], { knownFiles: files, chapterCast: ['林晓', '陈默'] })
check('场景2：近名唯一纠正为 人物/林晓.md', g.items.length === 1 && g.items[0].target === '人物/林晓.md' && g.issues[0].action === 'corrected')

// 场景 3：编造且无近名 → 丢弃
g = mod.guardPersonTargets([mk('人物/顾清欢.md')], { knownFiles: files, chapterCast: ['林晓', '陈默'] })
check('场景3：无近名编造 → 丢弃并记 dropped', g.items.length === 0 && g.issues[0].action === 'dropped' && g.issues[0].reason.includes('不存在'))

// 场景 4：本章涉及人物但未建档（沈藏在涉及人物里、档案不存在）→ 丢弃并明示未建档
g = mod.guardPersonTargets([mk('人物/沈藏.md')], { knownFiles: files, chapterCast: cast })
check('场景4：涉及未建档 → 丢弃且明示「尚未建档」', g.items.length === 0 && g.issues[0].reason.includes('尚未建档'))

// 场景 5：多候选同距离不纠正（knownFiles 造两个同距离名）
const g5 = mod.guardPersonTargets([mk('人物/林如.md')], { knownFiles: ['林晓', '林晚'], chapterCast: [] })
check('场景5：多候选同距离 → 不纠正、丢弃', g5.items.length === 0 && g5.issues[0].action === 'dropped')

// 场景 6：normalize（先形态归一）与 guard 组合链路 = runSync 全程
const raw = [
  { target: '人物/林晚.md', anchor: '基础档案', kind: 'upsert-section', before: '', after: '- 新状态', reason: 'r' },
  { target: '世界观/总纲.md', anchor: '总纲', kind: 'upsert-section', before: '', after: '- 新状态', reason: 'r' }
]
items = mod.normalizeSyncItems(raw, slice)
g = mod.guardPersonTargets(items, { knownFiles: files, chapterCast: cast })
check('场景6：normalize+guard 链路——近名纠正、总纲改写归一切片文件，0 条越网', g.items.length === 2 && g.items[0].target === '人物/林晓.md' && g.items[0].anchor === '切片：第一幕_雾港之夜' && g.items[1].target === '世界观/切片_第一幕_雾港之夜.md' && g.issues.length === 1 && g.issues[0].action === 'corrected')

rmSync(tmp, { recursive: true, force: true })
console.log(fails === 0 ? 'SYNC-GUARD SMOKE OK' : 'SYNC-GUARD SMOKE FAILED: ' + fails)
process.exit(fails === 0 ? 0 : 1)
