// 原子写落地冒烟（平台层 2026-09-21 14:00 轮）：真机 writeDoc / writeSnapshot / applyProposal 走
// writeFileAtomic（tmp+rename）后：内容正确、目录零 tmp 残留、提案 apply 目标文档原子更新。
// 用法：cd ~/Desktop/织卷 && node scripts/atomic-write-live.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-atomic'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
// 预写设置：库指向 /tmp（stub 无设置时回退真库 文档/织卷项目库——冒烟不得污染真库）
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(
  resolve(process.env.ZJ_USERDATA, 'zhijuan-settings.json'),
  JSON.stringify({ libraryRoot: '/tmp/zj-smoke-atomic-lib' }),
  'utf-8'
)
rmSync('/tmp/zj-smoke-atomic-lib', { recursive: true, force: true })
const out = '/tmp/atomic-bundle.mjs'

await esbuild({
  stdin: {
    contents: `export { createProject, writeDoc, projectDir, readDoc } from ${JSON.stringify(resolve(root, 'src/main/store.ts'))};
export { writeSnapshot } from ${JSON.stringify(resolve(root, 'src/main/history.ts'))};
export { createProposals, applyProposal, listProposals } from ${JSON.stringify(resolve(root, 'src/main/proposals.ts'))};`,
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

const mod = await import(pathToFileURL(out).href)
const { createProject, writeDoc, projectDir, readDoc, writeSnapshot, createProposals, applyProposal, listProposals } = mod

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}
const noTmp = (dir) => {
  const list = existsSync(dir) ? readdirSync(dir) : []
  return list.filter((n) => n.includes('.tmp')).length === 0
}

console.log('=== 原子写落地（真机 store/history/proposals）===')
const pid = 'atomic-smoke-' + Date.now().toString(36)
const sum = createProject(pid, '原子写冒烟')
if (!sum) throw new Error('createProject 失败（libraryRoot 定位异常？）')
const projDir = projectDir(pid)

const body = '# 雾港的夜\n\n旧文本行。\n'
writeDoc(pid, '正文/第01章_雾港.md', '---\n章号: 1\n题名: 雾港\n切片: 1\n---\n' + body)
const d1 = readDoc(pid, '正文/第01章_雾港.md')
assert('writeDoc 内容正确', d1 !== null && d1.includes('雾港的夜'))
assert('writeDoc 无 tmp 残留', noTmp(resolve(projDir, '正文')))

// 覆盖写（保存主路径反复写）
writeDoc(pid, '正文/第01章_雾港.md', '---\n章号: 1\n题名: 雾港\n切片: 1\n---\n改写后。\n')
const d2 = readDoc(pid, '正文/第01章_雾港.md')
assert('覆盖写内容为新值', d2 !== null && d2.includes('改写后。'))
assert('覆盖写仍无 tmp 残留', noTmp(resolve(projDir, '正文')))

const snap = writeSnapshot(projDir, '正文/第01章_雾港.md', '快照原文内容-xyz')
assert('历史快照落盘且内容正确', snap !== null && readFileSync(resolve(projDir, '.zhijuan/history/正文/第01章_雾港', snap), 'utf-8') === '快照原文内容-xyz')
assert('历史快照目录无 tmp 残留', noTmp(resolve(projDir, '.zhijuan/history/正文/第01章_雾港')))

// 提案 apply（目标文档原子写；proposals 函数首参=项目库根，target 必须显式）
const libRoot = '/tmp/zj-smoke-atomic-lib'
const created = createProposals(libRoot, pid, 'slice-sync', '正文/第01章_雾港.md', '1', [
  { kind: 'replace-text', target: '正文/第01章_雾港.md', before: '改写后。', after: '提案改写后。' }
])
assert('提案创建成功', created.length === 1)
const r = applyProposal(libRoot, pid, created[0].id)
assert('applyProposal ok', r.ok && r.errors.length === 0)
const d3 = readDoc(pid, '正文/第01章_雾港.md')
assert('提案目标文档已更新', d3 !== null && d3.includes('提案改写后。'))
assert('提案库无 tmp 残留', noTmp(resolve(libRoot, pid, '.zhijuan', 'proposals')))
assert('apply 后无 pending 残留', listProposals(libRoot, pid).filter((p) => p.status === 'pending').length === 0)

// 反证：.zhijuan 内部索引也走原子写（slices.json 由 writeDoc 后的同步触发——这里直接验目录态即可）
assert('项目根 .zhijuan 无 tmp 残留', noTmp(resolve(projDir, '.zhijuan')))

console.log(`PASS ${pass}/12`)
rmSync(projDir, { recursive: true, force: true })
process.exit(0)
