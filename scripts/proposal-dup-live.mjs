// 织卷 · 切片同步「重复提案」数据层真验证（2026-09-20 创作层，候选 3 收口）
// bundle 真机 proposals.ts（纯 fs/shared，无 electron 依赖）+ 真实临时库，钉死 createSliceProposals：
//   A 拒绝后同款再同步 → suppressed=1/零新提案（核心承诺）
//   B after 真变化（微差）→ 不抑制（防误杀）
//   C accepted 同款不抑制（已应用后回滚/新发生应重提，GitHub 同构）
//   D 同款全部被抑制时，同章旧 pending 仍置 stale（createProposals 既有语义不受影响）
//   E 跨章同款也抑制（切片设定=项目级进度）
// 用法：cd ~/Desktop/织卷 && node scripts/proposal-dup-live.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdirSync, rmSync, mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-dup-live-'))
const out = join(tmp, 'bundle.mjs')
await esbuild({
  entryPoints: [resolve(root, 'src/main/proposals.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  external: ['node:*'],
  logLevel: 'warning'
})
const mod = await import(pathToFileURL(out).href)
const { createProposals, createSliceProposals, rejectProposal, applyProposal, listProposals, staleSliceSyncByChapter } = mod

const lib = join(tmp, 'lib')
mkdirSync(join(lib, 'demo'), { recursive: true })
let checks = 0
let fails = 0
function ok(cond, msg) {
  checks++
  if (cond) console.log('  OK', msg)
  else {
    fails++
    console.log('  FAIL', msg)
  }
}
const itemSame = (over) => ({
  target: '人物/沈藏.md',
  anchor: '切片：雾港夜',
  kind: 'upsert-section',
  before: '',
  after: '## 切片：雾港夜\n\n- 沈藏开始密切来往',
  reason: '动向',
  ...over
})
const countFiles = () => readdirSync(join(lib, 'demo', '.zhijuan', 'proposals')).filter((f) => f.endsWith('.json')).length

// 真 target 文件（供 applyProposal 的 accepted 场景走真实写盘）
mkdirSync(join(lib, 'demo', '人物'), { recursive: true })
writeFileSync(
  join(lib, 'demo', '人物', '沈藏.md'),
  ['# 沈藏', '', '## 基础档案', '', '- 身份：守夜人', '', '## 切片：雾港夜', '', '- 往常只在楼顶看灯'].join('\n'),
  'utf-8'
)

console.log('A 拒绝后同款再同步 → 抑制')
{
  const r1 = createSliceProposals(lib, 'demo', '正文/第01章_雾港.md', '雾港夜', [itemSame()])
  ok(r1.created.length === 1 && r1.suppressed === 0, '首次同款：created=1/suppressed=0')
  const pid = r1.created[0].id
  ok(rejectProposal(lib, 'demo', pid), '拒绝已生成提案')
  const r2 = createSliceProposals(lib, 'demo', '正文/第01章_雾港.md', '雾港夜', [itemSame()])
  ok(r2.created.length === 0 && r2.suppressed === 1, '再次同款：created=0/suppressed=1（核心承诺）')
  ok(countFiles() === 1, '提案文件数=1（无重复提案落盘）')
}

console.log('B after 真变化（微差）→ 不抑制')
{
  const r = createSliceProposals(lib, 'demo', '正文/第01章_雾港.md', '雾港夜', [
    itemSame({ after: '## 切片：雾港夜\n\n- 沈藏开始密切来往（第二夜）' })
  ])
  ok(r.created.length === 1 && r.suppressed === 0, 'after 微差：created=1/suppressed=0（不误杀）')
}

console.log('C accepted 同款不抑制（回滚/新发生应重提）')
{
  // 专用 base（独立人物/独立文本，避免与 A/B/D 的沈藏 rejected/pending 记录互扰）
  const baseC = () =>
    itemSame({
      target: '人物/阿七.md',
      after: '## 切片：雾港夜\n\n- 阿七开始改变：不再回避夜场的灯。'
    })
  mkdirSync(join(lib, 'demo', '人物'), { recursive: true })
  writeFileSync(
    join(lib, 'demo', '人物', '阿七.md'),
    ['# 阿七', '', '## 基础档案', '', '- 身份：雾港夜场歌手', '', '## 切片：雾港夜', '', '- 常态回避'].join('\n'),
    'utf-8'
  )
  const r1 = createSliceProposals(lib, 'demo', '正文/第01章_雾港.md', '雾港夜', [baseC()])
  ok(r1.created.length === 1, '预置同款 pending')
  const pid = r1.created[0].id
  const ap = applyProposal(lib, 'demo', pid)
  ok(ap.ok && listProposals(lib, 'demo').find((p) => p.id === pid)?.status === 'accepted', '提案已应用 accepted')
  const r2 = createSliceProposals(lib, 'demo', '正文/第01章_雾港.md', '雾港夜', [baseC()])
  ok(r2.created.length === 1 && r2.suppressed === 0, 'accepted 同款：created=1/suppressed=0（不抑制）')
  // 清理：把这条 accepted 从库中移除，避免影响后续场景（不删文件则后续场景 D/E 不涉阿七，可留）
}

console.log('D 同款全抑制时同章旧 pending 仍置 stale')
{
  const r = createProposals(lib, 'demo', 'slice-sync', '正文/第02章_灯塔.md', '雾港夜', [itemSame()])
  ok(r.length === 1, '预置 pending')
  const r2 = createSliceProposals(lib, 'demo', '正文/第02章_灯塔.md', '雾港夜', [itemSame()])
  ok(r2.created.length === 0 && r2.suppressed === 1, '同款被抑制')
  const st = listProposals(lib, 'demo').find((p) => p.id === r[0].id)?.status
  ok(st === 'stale', '旧 pending 已置 stale（createProposals 语义不受影响）')
}

console.log('E 跨章同款也抑制')
{
  const r = createSliceProposals(lib, 'demo', '正文/第03章_码头.md', '雾港夜', [itemSame()])
  ok(r.created.length === 0 && r.suppressed === 1, '另一章同步同款：suppressed=1（切片设定项目级）')
}

console.log('F 同章同款 pending 未处置 → 复用旧卡（不置 stale 不新建）')
{
  const fItem = () => itemSame({ target: '人物/阿四.md', after: '## 切片：雾港夜\n\n- 阿四开始回望灯楼' })
  const p1 = createProposals(lib, 'demo', 'slice-sync', '正文/第04章_溯流.md', '雾港夜', [fItem()])
  ok(p1.length === 1, '预置同款 pending')
  const before = countFiles()
  const r = createSliceProposals(lib, 'demo', '正文/第04章_溯流.md', '雾港夜', [fItem()])
  ok(r.created.length === 0 && r.suppressed === 0 && r.kept === 1, '同款再次同步：created=0/kept=1（复用旧卡核心承诺）')
  ok(countFiles() === before, '提案文件数不变（未新建）')
  ok(listProposals(lib, 'demo').find((p) => p.id === p1[0].id)?.status === 'pending', '旧卡仍 pending（未被置 stale）')
}

console.log('G 同章同款 stale（技术性过期）→ 恢复为 pending 复用旧卡')
{
  const gItem = () => itemSame({ target: '人物/阿五.md', after: '## 切片：雾港夜\n\n- 阿五接手夜巡' })
  const p1 = createProposals(lib, 'demo', 'slice-sync', '正文/第05章_夜巡.md', '雾港夜', [gItem()])
  ok(p1.length === 1, '预置同款 pending')
  const staled = staleSliceSyncByChapter(lib, 'demo', '正文/第05章_夜巡.md')
  ok(staled === 1, 'staleSliceSyncByChapter 置 stale（模拟「同章再保存旧卡过期」）')
  const before = countFiles()
  const r = createSliceProposals(lib, 'demo', '正文/第05章_夜巡.md', '雾港夜', [gItem()])
  ok(r.created.length === 0 && r.kept === 1, '同款 stale 再次同步：created=0/kept=1（恢复核心承诺）')
  ok(countFiles() === before, '提案文件数不变（复用旧卡未新建）')
  ok(listProposals(lib, 'demo').find((p) => p.id === p1[0].id)?.status === 'pending', 'stale 卡已恢复为 pending')
}

console.log('H 同款 pending + 另一不同款 → 同款复用、不同款照建（旧 pending 置 stale 语义保留）')
{
  const hSame = () => itemSame({ target: '人物/阿六.md', after: '## 切片：雾港夜\n\n- 阿六登上栈桥' })
  const hOther = () => itemSame({ target: '人物/阿六.md', after: '## 切片：雾港夜\n\n- 阿六登灯：新动向不同款' })
  const p1 = createProposals(lib, 'demo', 'slice-sync', '正文/第06章_登灯.md', '雾港夜', [hSame()])
  ok(p1.length === 1, '预置同款 pending')
  const before = countFiles()
  const r = createSliceProposals(lib, 'demo', '正文/第06章_登灯.md', '雾港夜', [hSame(), hOther()])
  ok(r.created.length === 1 && r.kept === 1 && r.suppressed === 0, '同款复用(kept=1)+不同款新建(created=1)')
  ok(listProposals(lib, 'demo').find((p) => p.id === p1[0].id)?.status === 'pending', '同款旧卡仍 pending')
  ok(countFiles() === before + 1, '仅不同款新建 1 条')
}

rmSync(tmp, { recursive: true, force: true })
console.log(`\nPROPOSAL-DUP LIVE ${fails === 0 ? 'OK' : 'FAIL'} (${checks} checks, ${fails} fails)`)
process.exit(fails === 0 ? 0 : 1)
