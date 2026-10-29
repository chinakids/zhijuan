// 检查自动化 · 提案收口 数据层冒烟（主进程真实现 + 临时项目库，零模型）
// 背景（docs/检查自动化-提案收口-设计-2026-10-28.md §3.3）：auditAuto 只把**带 target 的条目**
// 转提案；本地 9 项里最高频的「人物在场核查」（约定头「涉及人物」vs 正文）原本没有 target →
// 命题箱永远 0 条（「检查完成」toast 永不出现）。2026-10-29 智能层轮为 missing/unlisted 补了
// 可执行 replace-text 提案（改本章约定头），本冒烟用**真读盘**验证到底：
//   ① 首次 runAuditAuto → 出 2 条提案（missing=移出、unlisted=补入），before/after 是约定头原文行；
//   ② 采纳（applyProposal）→ 盘上约定头真被改、正文一字不动；
//   ③ 重跑 → created=0（pending 去重，重复保存不刷屏）；
//   ④ 作者拒绝后重跑 → 仍 0（拒绝=已裁决，不再回魂；GitHub code scanning 同语义）；
//   ⑤ 单类上限 20 条生效（21 条候选只出 20 张卡）。
// 用法：cd ~/Desktop/织卷 && node scripts/audit-auto-proposals-smoke.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, readFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-auditauto-userdata'
const LIB = '/tmp/zj-smoke-auditauto-lib'
const UD = process.env.ZJ_USERDATA
rmSync(UD, { recursive: true, force: true })
rmSync(LIB, { recursive: true, force: true })
mkdirSync(LIB, { recursive: true })
mkdirSync(UD, { recursive: true })
writeProbeSettings({ libraryRoot: LIB }, UD)

const out = '/tmp/audit-auto-bundle.mjs'
await esbuild({
  stdin: {
    contents: `export { runAuditAuto } from ${JSON.stringify(resolve(root, 'src/main/agent/auditAuto.ts'))};
export { listProposals, applyProposal, rejectProposal } from ${JSON.stringify(resolve(root, 'src/main/proposals.ts'))};
export { createProject, writeDoc, readDoc } from ${JSON.stringify(resolve(root, 'src/main/store.ts'))};
export { libraryRoot } from ${JSON.stringify(resolve(root, 'src/main/settings.ts'))};`,
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

const { runAuditAuto, listProposals, applyProposal, rejectProposal, createProject, writeDoc, readDoc, libraryRoot } =
  await import(pathToFileURL(out).href)

let pass = 0
let failed = 0
const assert = (name, cond, extra) => {
  if (cond) {
    pass++
    console.log('  ✓ ' + name)
  } else {
    failed++
    console.log('  ✗ ' + name + (extra ? ' — ' + extra : ''))
  }
}

const chapterRaw = (no, cast, body) =>
  `---\n章号: ${no}\n题名: 第${no}章 雾港\n切片: 第一幕_夜\n涉及人物: [${cast.join(', ')}]\n---\n\n${body}\n`

try {
  console.log('=== 检查自动化 → 提案收口（真读盘） ===')
  const p = createProject('检查自动化冒烟', '数据层冒烟用（结束后清理）')
  if (!p) throw new Error('createProject 失败')
  const pid = p.id
  const rootDir = libraryRoot()

  // 人物档案：沈藏 / 阿七 / 林晓（只登记题名，不设别名 → 口径最简单）
  for (const name of ['沈藏', '阿七', '林晓']) {
    writeDoc(pid, `人物/${name}.md`, `---\n题名: ${name}\n身份: 测试\n---\n\n${name}的档案。\n`)
  }
  // 第01章：约定头列了 沈藏/阿七，正文只出现 阿七 + 林晓
  // → missing: 沈藏（列了没出场）；unlisted: 林晓（出场没列）
  writeDoc(pid, '正文/第01章_雾港.md', chapterRaw(1, ['沈藏', '阿七'], '阿七站在栈桥上。\n\n林晓从雾里走出来。'))

  // ① 首跑：同章两处不一致合并成**一张卡**（一行约定头 = 一个处置单元）
  const r1 = await runAuditAuto(pid, { kinds: ['presence'] })
  assert('首跑 created=1（同章增删合并一张卡）', r1.created === 1, `created=${r1.created}`)
  const list1 = listProposals(rootDir, pid).filter((x) => x.status === 'pending')
  assert('磁盘上 pending=1', list1.length === 1, `len=${list1.length}`)
  const card = list1[0]
  assert('合并卡 after=移出沈藏 + 补入林晓', card?.items[0]?.after === '涉及人物: [阿七, 林晓]', card?.items[0]?.after)
  assert('提案 target=正文章节文件', card?.items[0]?.target === '正文/第01章_雾港.md', card?.items[0]?.target)
  assert('提案 kind=replace-text（可执行，不是建议文本）', card?.items[0]?.kind === 'replace-text', card?.items[0]?.kind)
  assert('before=约定头原文行（apply 用精确匹配）', card?.items[0]?.before === '涉及人物: [沈藏, 阿七]', card?.items[0]?.before)
  assert('理由写明移出/补入（作者一眼看懂）', /移出「沈藏」/.test(card?.items[0]?.reason ?? '') && /补入「林晓」/.test(card?.items[0]?.reason ?? ''), card?.items[0]?.reason)
  assert('来源标 source=audit', card?.source === 'audit', card?.source)

  // ② 采纳 → 约定头真改、正文不动
  const ap = applyProposal(rootDir, pid, card.id)
  assert('采纳合并卡成功', ap.ok === true, JSON.stringify(ap.errors))
  const afterRaw = readDoc(pid, '正文/第01章_雾港.md') ?? ''
  assert('约定头已改 涉及人物: [阿七, 林晓]', afterRaw.includes('涉及人物: [阿七, 林晓]'), afterRaw.split('\n')[1])
  assert('正文内容原样保留', afterRaw.includes('阿七站在栈桥上。') && afterRaw.includes('林晓从雾里走出来。'))
  assert('约定头其他字段未动', afterRaw.includes('切片: 第一幕_夜') && afterRaw.includes('章号: 1'))

  // ③ 重跑：问题都已解决 → 0 条
  const r2 = await runAuditAuto(pid, { kinds: ['presence'] })
  assert('重跑 created=0（问题已解决）', r2.created === 0, `created=${r2.created}`)

  // ④ 作者拒绝 → 再跑仍 0（拒绝=已裁决，同一问题不回魂）
  writeDoc(pid, '正文/第04章_回魂.md', chapterRaw(4, ['阿七'], '沈藏一个人坐在码头。'))
  const r3 = await runAuditAuto(pid, { kinds: ['presence'] })
  assert('第04章 不一致 → created=1', r3.created === 1, `created=${r3.created}`)
  const card4 = listProposals(rootDir, pid).find((x) => x.status === 'pending' && x.items[0]?.target === '正文/第04章_回魂.md')
  assert('第04章 卡存在', !!card4)
  const r3b = await runAuditAuto(pid, { kinds: ['presence'] })
  assert('pending 去重：重复保存不刷屏（created=0）', r3b.created === 0, `created=${r3b.created}`)
  rejectProposal(rootDir, pid, card4.id)
  const rejected = listProposals(rootDir, pid).find((x) => x.id === card4.id)
  assert('拒绝后状态=rejected', rejected?.status === 'rejected', rejected?.status)
  const r3c = await runAuditAuto(pid, { kinds: ['presence'] })
  assert('拒绝后重跑 created=0（同一问题不再回魂）', r3c.created === 0, `created=${r3c.created}`)

  // ⑤ 单类上限：21 个「列了没出场」（分 21 章，避免按章合并）→ 只出 20 张卡
  const many = Array.from({ length: 21 }, (_, i) => `测试人物${String(i + 1).padStart(2, '0')}`)
  for (const name of many) writeDoc(pid, `人物/${name}.md`, `---\n题名: ${name}\n身份: 测试\n---\n\n档案。\n`)
  many.forEach((name, i) => {
    writeDoc(pid, `正文/第${10 + i}章_上限.md`, chapterRaw(10 + i, [name], '（本章无任何署名。）'))
  })
  const r4 = await runAuditAuto(pid, { kinds: ['presence'] })
  assert('21 条候选只出 20 张卡（单类上限）', r4.created === 20, `created=${r4.created}`)

  // 清单移空形态：约定头只剩一个人且被移出 → 整行删除、不留空行
  writeDoc(pid, '正文/第03章_清空.md', chapterRaw(3, ['沈藏'], '（本章无署名。）'))
  const r5 = await runAuditAuto(pid, { kinds: ['presence'] })
  assert('第03章 也出了移出卡', r5.created >= 1, `created=${r5.created}`)
  const emptyCard = listProposals(rootDir, pid).find(
    (x) => x.status === 'pending' && x.items[0]?.target === '正文/第03章_清空.md'
  )
  assert('清单移空卡 before 带换行（整行删除）', !!emptyCard && emptyCard.items[0].before.endsWith('\n'), JSON.stringify(emptyCard?.items[0]))
  const ap2 = applyProposal(rootDir, pid, emptyCard.id)
  const raw3 = readDoc(pid, '正文/第03章_清空.md') ?? ''
  assert('移空后整行消失', ap2.ok && !raw3.includes('涉及人物'), raw3.split('\n').slice(0, 6).join(' | '))
  assert('移空后约定头仍闭合（无空行碎片）', !raw3.includes('---\n\n---') && raw3.startsWith('---\n章号: 3'))
} catch (e) {
  failed++
  console.log('  ✗ 异常：' + (e?.stack ?? e))
}

console.log(`\n结果：${pass} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)