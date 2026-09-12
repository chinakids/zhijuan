// 审读存档版本化 · 数据层冒烟（真读盘，不依赖模型；2026-09-12 智能层轮）
// 验证：writeDoc 对 大纲/审读_* 入史（内容变化才快照旧版、同内容不增版）、正文行为回归、副产物/自然页不入史、裁剪生效。
// 用法：cd ~/Desktop/织卷 && node scripts/audit-history-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, existsSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
// 坑（2026-09-11）：冒烟环境 userData 若有残留 zhijuan-settings.json（libraryRoot 指向已删除目录）
// 会让 libraryRoot() 定位到空路径 → readDoc 全 null。显式用干净 userData + 显式临时库根。
process.env.ZJ_USERDATA = '/tmp/zj-smoke-audithistory'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const libRoot = '/tmp/zj-smoke-audithistory/lib'
rmSync(libRoot, { recursive: true, force: true })
const out = '/tmp/audit-history-bundle.mjs'

await esbuild({
  stdin: {
    contents: `
export { createProject, writeDoc, projectDir } from ${JSON.stringify(resolve(root, 'src/main/store.ts'))};
export { setSettings } from ${JSON.stringify(resolve(root, 'src/main/settings.ts'))};
export { listSnapshots, readSnapshot } from ${JSON.stringify(resolve(root, 'src/main/history.ts'))};
`,
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

const { createProject, writeDoc, projectDir, setSettings, listSnapshots, readSnapshot } = await import(pathToFileURL(out).href)

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

console.log('=== 审读存档版本化（真 fs 数据层）===')
setSettings({ workspace: '/tmp/zj-smoke-audithistory/ws', libraryRoot: libRoot })
const p = createProject('审读史冒烟', '')
if (!p) throw new Error('createProject 返回 null')
const pid = p.id
const relAudit = '大纲/审读_一致性巡查.md'
const relNovel = '正文/第01章_雾港.md'
const relPerson = '人物/林晚.md'

// 1) 首写：无旧内容 → 不产生快照
writeDoc(pid, relAudit, '# 审读报告 · 一致性巡查\n\n## 一句话结论\n\n结论 v1')
assert('审读报告首写不产生快照', listSnapshots(projectDir(pid), relAudit).length === 0)

// 2) 内容有变的重跑：旧版入史
writeDoc(pid, relAudit, '# 审读报告 · 一致性巡查\n\n## 一句话结论\n\n结论 v2')
let snaps = listSnapshots(projectDir(pid), relAudit)
assert('重跑后产生 1 版快照', snaps.length === 1)
assert('快照内容 = 上一版（结论 v1）', readSnapshot(projectDir(pid), relAudit, snaps[0].name).includes('结论 v1'))
assert('快照落在 .zhijuan/history/大纲/审读_一致性巡查/', existsSync('/tmp/zj-smoke-audithistory/lib/' + pid + '/.zhijuan/history/大纲/审读_一致性巡查'))

// 3) 同内容重跑：不增版
writeDoc(pid, relAudit, '# 审读报告 · 一致性巡查\n\n## 一句话结论\n\n结论 v2')
assert('同内容重跑不增版', listSnapshots(projectDir(pid), relAudit).length === 1)

// 4) 正文回归：行为不变
writeDoc(pid, relNovel, '---\n章号: 1\n题名: 雾港\n---\n\nv1')
writeDoc(pid, relNovel, '---\n章号: 1\n题名: 雾港\n---\n\nv2')
assert('正文第二次写仍触发快照', listSnapshots(projectDir(pid), relNovel).length === 1)

// 5) 人物/自然页：不入史
writeDoc(pid, relPerson, '# 林晚\n\n档案 v1')
writeDoc(pid, relPerson, '# 林晚\n\n档案 v2')
assert('人物档案不入史', listSnapshots(projectDir(pid), relPerson).length === 0)

// 6) 裁剪：写 54 次不同内容 → 保留最新 50 版
for (let i = 3; i <= 54; i++) {
  writeDoc(pid, relAudit, `# 审读报告 · 一致性巡查\n\n## 一句话结论\n\n结论 v${i}`)
}
snaps = listSnapshots(projectDir(pid), relAudit)
assert('54 次重跑后裁剪为 50 版', snaps.length === 50)
assert('裁剪后最新版 = 第 53 次写入内容', readSnapshot(projectDir(pid), relAudit, snaps[0].name).includes('结论 v53'))
assert('最旧保留 = 写 v5 时快照的 v4（v1-v3 被删）', readSnapshot(projectDir(pid), relAudit, snaps.at(-1).name).includes('结论 v4'))

console.log(`\n=== 结果: ${pass} 断言全过 ===`)
process.exit(0)
