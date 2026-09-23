// 写作习惯学习 · IPC 数据链冒烟（增量 4c，2026-09-22 智能层）
// 验证：runWritingInsights（手动触发）/ insight 门控 reason / listDrafts / promoteDraft（含重名备份+disabled 保真）
//       / deleteDraft / 路径穿越防护 / promote 后 listSkills 可见（转正参与注入面）/ IPC 通道名双端一致。
// 用法：cd ~/Desktop/织卷 && node scripts/insights-ipc-smoke.mjs
// （仓库标准模式：esbuild bundle → node 直跑；隔离环境=临时 userData/工作区/项目库，零污染真实库）
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { readFileSync, readdirSync, existsSync, rmSync, mkdirSync, writeFileSync, cpSync } from 'fs'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import { build as esbuild } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const PJ = process.env.ZJ_PJ || '/Users/USER/Documents/织卷项目库/织卷smoke'
if (!existsSync(PJ)) {
  console.error(`✗ 测试项目不存在：${PJ}（可 ZJ_PJ=<项目路径> 指定）`)
  process.exit(1)
}

// ---- 隔离环境（先写设置盘，模块加载时 readSettings 读它） ----
const UD = '/tmp/zj-ipc-smoke-insights'
const WS = UD + '/ws'
const LIB = UD + '/lib'
rmSync(UD, { recursive: true, force: true })
mkdirSync(UD, { recursive: true })
writeProbeSettings({ workspace: WS, libraryRoot: LIB, writingInsightsEnabled: true }, UD)
process.env.ZJ_USERDATA = UD
cpSync(PJ, join(LIB, '织卷smoke'), { recursive: true })

const out = '/tmp/zj-insights-ipc-bundle.mjs'
await esbuild({
  stdin: {
    contents: [
      `export { runWritingInsights, gatherSignals, readInsightsState, listDrafts, promoteDraft, deleteDraft, draftsDir, insightDateStamp } from ${JSON.stringify(resolve(root, 'src/main/writingInsights.ts'))};`,
      `export { listSkills } from ${JSON.stringify(resolve(root, 'src/main/skills.ts'))};`
    ].join('\n'),
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})
const m = await import(pathToFileURL(out).href)

let pass = 0
const fail = (name) => {
  console.error('  ✗ 断言失败: ' + name)
  process.exit(1)
}
const assert = (name, cond) => {
  if (!cond) fail(name)
  pass++
  console.log('  ✓ ' + name)
}
const D = () => m.draftsDir()

console.log('=== ① runWritingInsights 手动触发（隔离项目副本） ===')
const r1 = m.runWritingInsights('织卷smoke')
assert('首次触发 ok:true', r1.ok === true)
assert('draftFile 落在 _drafts/', typeof r1.draftFile === 'string' && r1.draftFile.includes('_drafts'))
assert('reportFile 落在 _drafts/', typeof r1.reportFile === 'string' && r1.reportFile.includes('_drafts'))
assert('state 记账完整', r1.state.lastRunAt > 0 && r1.state.lastDraft.endsWith('写作习惯.md'))
assert('草稿真实落盘', existsSync(r1.draftFile))
assert('报告真实落盘', existsSync(r1.reportFile))

console.log('=== ② listDrafts 草稿区清单 ===')
const d1 = m.listDrafts()
assert('清单含草稿+报告 2 条', d1.length === 2)
assert('kind 判定正确', d1.some((x) => x.kind === 'draft') && d1.some((x) => x.kind === 'report'))
assert('mtimeMs 数值有效', d1.every((x) => typeof x.mtimeMs === 'number' && x.mtimeMs > 0))

console.log('=== ③ 门控：距上次 <7 天 → recent ===')
const r2 = m.runWritingInsights('织卷smoke')
assert('二次触发被门控', r2.ok === false && r2.reason === 'recent')

console.log('=== ④ promoteDraft（转正 → 技能目录；重名备份） ===')
const draftName = r1.state.lastDraft
assert('转正前 _drafts 不参与技能清单', !m.listSkills().some((s) => s.name === 'writing-habits'))
const promote = m.promoteDraft(draftName)
assert('转正 ok:true', promote.ok === true)
const skillDir = join(WS, 'skills', 'writing-habits')
assert('技能目录落盘 SKILL.md', existsSync(join(skillDir, 'SKILL.md')))
const skillRaw = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')
assert('转正原文保真（disabled:true 保留）', skillRaw.includes('disabled: true'))
assert('草稿源文件已随转正移除', !existsSync(join(D(), draftName)))
// 重名备份：同内容再转正一次（现同名技能存在 → 备份旧目录后覆盖）
m.deleteDraft(r1.state.lastDraft) // 恢复草稿文件？——下面造第二条草稿再测重名
const draft2Name = '2026-09-22-写作习惯.md'
const draft2 = join(D(), draft2Name)
writeFileSync(draft2, skillRaw, 'utf-8')
const promote2 = m.promoteDraft(draft2Name)
assert('重名转正 ok:true（先备份旧技能）', promote2.ok === true)
const bak = readdirSync(join(WS, 'skills', '_backups')).filter((n) => n.startsWith('writing-habits.bak-'))
assert('旧技能目录已备份保留（_backups/ 下）', bak.length === 1 && existsSync(join(WS, 'skills', '_backups', bak[0], 'SKILL.md')))
assert('备份不入技能清单（无幽灵条目）', !m.listSkills().some((s) => s.invalid))

console.log('=== ⑤ promote 后 listSkills 可见（转正即参与注入面） ===')
const skills = m.listSkills()
assert('转正技能出现在清单', skills.some((s) => s.name === 'writing-habits'))

console.log('=== ⑥ deleteDraft（删除报告；不存在→error） ===')
const reportName = r1.reportFile.split(/[\\/]/).pop()
const del = m.deleteDraft(reportName)
assert('删除报告 ok:true', del.ok === true)
assert('清单剩 0 条', m.listDrafts().length === 0)
const del2 = m.deleteDraft(reportName)
assert('删除不存在→error', del2.ok === false && /不存在/.test(del2.error))

console.log('=== ⑦ 路径穿越/非法名防护 ===')
assert('../x.md 被拒', m.promoteDraft('../x.md').ok === false)
assert('隐藏文件被拒', m.promoteDraft('.hidden.md').ok === false)
assert('非 .md 被拒', m.promoteDraft('foo.txt').ok === false)

console.log('=== ⑧ IPC 通道名双端一致（preload ↔ agent/ipc） ===')
const preload = readFileSync(join(root, 'src/preload/index.ts'), 'utf-8')
const agentIpc = readFileSync(join(root, 'src/main/agent/ipc.ts'), 'utf-8')
for (const ch of ['insights:run', 'insights:status', 'drafts:list', 'drafts:promote', 'drafts:delete']) {
  assert(`「${ch}」在 preload 与主进程两侧出现`, preload.includes(`'${ch}'`) && agentIpc.includes(`'${ch}'`))
}

console.log(`\n=== insights-ipc-smoke: ${pass} 断言全过 ===`)
