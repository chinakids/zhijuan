// 织卷 · 候选2（切片名修改→切片同步）真模型端到端验收（2026-09-14 创作层 00:45 轮）
// 场景：章节切片「第一幕_烧杯」→「第二幕_暴风」。
//   runSync#1（旧名，真模型）→ createProposals → applyProposal（模拟用户接受落盘）；
//   editChapterSlice 改名（约定头改写 + 旧文件历史保留）；
//   再保存正文（写新事实）→ runSync#2（真模型）必须按新名装配/归一——不按旧名组包、无陈旧缓存；
//   旧世界切片文件保留为历史且不入新上下文；人物档新旧切片小节并存（§8.4 已知口径）。
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/slice-rename-live.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdirSync, readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-slicerename-'))
process.env.ZJ_APP_PATH = root
// 干净 userData：防 /tmp/zj-smoke-* 残留 settings 把 libraryRoot 指到已删目录（2026-09-11 坑）
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: join(tmp, 'lib') }), 'utf-8')

const lib = join(tmp, 'lib')
const pid = '切片更名真链'
const P = (rel) => join(lib, pid, rel)
const A = '第一幕_烧杯'
const B = '第二幕_暴风'
const REL = '正文/第01章_初夜.md'
mkdirSync(P('人物'), { recursive: true })
mkdirSync(P('正文'), { recursive: true })

// 人物档：只有基础档案（无切片小节——切片小节由同步产出）
writeFileSync(
  P('人物/林晓.md'),
  ['# 林晓', '', '> 定位：研究院实习生', '', '## 基础档案', '', '- 年龄：22', '- 身份：旧理化楼 3 号实验室助手', ''].join('\n'),
  'utf-8'
)
const fm = (slice) => ['---', '章号: 1', '题名: 初夜', `切片: ${slice}`, '涉及人物: [林晓]', '---', ''].join('\n') + '\n'
const body1 = '# 初夜\n\n旧理化楼 3 号实验室的灯还亮着。林晓一个人值夜，白色实验服上沾着洗不掉的试液味。午夜 12 点整，她往烧杯里加了一撮白色粉末，蓝色液体开始翻腾。'
writeFileSync(P('正文/第01章_初夜.md'), fm(A) + body1, 'utf-8')

// 单 bundle：引擎 + store + proposals + context 一次打包（同一模块实例去重，真机口径）
const out = join(tmp, 'bundle.mjs')
await esbuild({
  stdin: {
    contents: [
      `export { runSync, shutdown } from ${JSON.stringify(resolve(root, 'src/main/agent/engine.ts'))};`,
      `export { editChapterSlice, readDoc, writeDoc } from ${JSON.stringify(resolve(root, 'src/main/store.ts'))};`,
      `export { createProposals, applyProposal } from ${JSON.stringify(resolve(root, 'src/main/proposals.ts'))};`,
      `export { buildWritingContext } from ${JSON.stringify(resolve(root, 'src/main/agent/context.ts'))};`
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
const M = await import(pathToFileURL(out).href)

let fails = 0
const check = (name, cond, extra = '') => {
  console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (cond ? '' : (extra ? '  ← ' + extra : '')))
  if (!cond) fails++
}
const sliceFieldsOk = (items, slice, label) => {
  const wrong = items.filter(
    (it) =>
      (it.target.startsWith('人物/') && it.anchor !== `切片：${slice}`) ||
      (it.target.startsWith('世界观/') && (it.target !== `世界观/切片_${slice}.md` || it.anchor !== `切片：${slice}`))
  )
  check(`${label}：人物锚点=「切片：${slice}」、世界 target=切片_${slice}.md 且锚点同（归一化生效）`, wrong.length === 0, JSON.stringify(wrong))
}

try {
  // ===== runSync #1（旧名，真模型）=====
  console.log('=== runSync #1（切片=' + A + '）:', new Date().toISOString())
  const r1 = await M.runSync(pid, REL)
  check('runSync#1 成功 (ok=true)', r1.ok === true, JSON.stringify(r1).slice(0, 300))
  if (r1.ok) {
    check('runSync#1 产出 ≥1 条', r1.items.length >= 1, 'items=' + r1.items.length)
    sliceFieldsOk(r1.items, A, 'runSync#1')
  }

  // 提案 #1 → 接受（模拟用户接受，正文为源的产物落盘）
  const props1 = M.createProposals(lib, pid, 'slice-sync', REL, A, (r1.items ?? []))
  const applied1 = props1.map((p) => M.applyProposal(lib, pid, p.id))
  check('提案#1 全部接受成功', props1.length > 0 && applied1.every((a) => a.ok), JSON.stringify(applied1))
  const person1 = M.readDoc(pid, '人物/林晓.md') ?? ''
  check('人物档已落「## 切片：' + A + '」小节', person1.includes(`## 切片：${A}`))
  const worldA = P(`世界观/切片_${A}.md`)
  const worldAText = existsSync(worldA) ? readFileSync(worldA, 'utf-8') : ''
  check('世界文件 切片_' + A + '.md 已创建', existsSync(worldA))

  // ===== 切片改名（editChapterSlice）=====
  console.log('=== editChapterSlice:', A, '→', B, new Date().toISOString())
  const es = M.editChapterSlice(pid, REL, B)
  check('editChapterSlice 成功且 old/new 正确', es.ok === true && es.oldSlice === A && es.newSlice === B, JSON.stringify(es))
  const cur1 = M.readDoc(pid, REL) ?? ''
  check('约定头「切片」已改且无旧名残留', cur1.includes(`切片: ${B}`) && !cur1.includes(`切片: ${A}`), cur1.split('\n').slice(0, 6).join(' | '))
  check('改名后 切片_' + A + '.md 仍在（历史保留）', existsSync(worldA))
  const personAfterEdit = M.readDoc(pid, '人物/林晓.md') ?? ''
  check('改名后人物档旧「切片：' + A + '」小节保留', personAfterEdit.includes(`## 切片：${A}`))

  // ===== 再保存正文（新事实）→ runSync #2（真模型，新名）=====
  const cur2 = M.readDoc(pid, REL) ?? ''
  M.writeDoc(pid, REL, cur2.replace(/\n$/, '') + '\n\n凌晨两点，暴雨劈头盖脸砸在实验室的窗上。保安老周在门外敲了三下，喊她注意用电。')
  console.log('=== runSync #2（切片=' + B + '）:', new Date().toISOString())
  const r2 = await M.runSync(pid, REL)
  check('runSync#2 成功 (ok=true)', r2.ok === true, JSON.stringify(r2).slice(0, 300))
  if (r2.ok) {
    check('runSync#2 产出 ≥1 条', r2.items.length >= 1, 'items=' + r2.items.length)
    sliceFieldsOk(r2.items, B, 'runSync#2')
    const staleRefs = r2.items.filter((it) => it.target.includes(`切片_${A}`) || it.anchor.includes(`切片：${A}`))
    check('runSync#2 产物无旧名 target/anchor（无陈旧缓存）', staleRefs.length === 0, JSON.stringify(staleRefs))
  }

  // 提案 #2 → 接受 → 落盘断言
  const props2 = M.createProposals(lib, pid, 'slice-sync', REL, B, (r2.items ?? []))
  check('提案#2 均 pending 且 slice 字段=B', props2.every((p) => p.status === 'pending' && p.slice === B), JSON.stringify(props2.map((p) => ({ s: p.status, sl: p.slice }))))
  const applied2 = props2.map((p) => M.applyProposal(lib, pid, p.id))
  check('提案#2 全部接受成功', applied2.every((a) => a.ok), JSON.stringify(applied2))
  const person2 = M.readDoc(pid, '人物/林晓.md') ?? ''
  check('人物档新旧切片小节并存（历史+新）', person2.includes(`## 切片：${A}`) && person2.includes(`## 切片：${B}`))
  const worldB = P(`世界观/切片_${B}.md`)
  const worldBText = existsSync(worldB) ? readFileSync(worldB, 'utf-8') : ''
  check('世界文件 切片_' + B + '.md 已创建', existsSync(worldB))
  const worldABack = existsSync(worldA) ? readFileSync(worldA, 'utf-8') : ''
  check('旧世界文件内容未被改写（历史照原样）', worldABack === worldAText)
  console.log('[INFO] 切片_' + B + ' 内容长度=' + worldBText.length + '（>模板则含模型事实）')

  // ===== 上下文装配：新切片世界状态入、旧切片世界文件不注入 =====
  const ctx = await M.buildWritingContext(pid, REL)
  const srcs = ctx.sources ?? []
  check('上下文注入人物档案', srcs.includes('人物/林晓.md'), JSON.stringify(srcs))
  check('上下文世界状态=切片_' + B, srcs.includes(`世界观/切片_${B}.md`), JSON.stringify(srcs))
  check('旧 切片_' + A + ' 世界文件不入新上下文', !srcs.includes(`世界观/切片_${A}.md`), JSON.stringify(srcs))
} finally {
  await M.shutdown().catch(() => {})
  // 保留 tmp 目录便于排查（成功也留，删太干净没现场）
  console.log('=== 现场保留:', tmp)
}

console.log(fails === 0 ? 'SLICE-RENAME LIVE OK' : `SLICE-RENAME LIVE FAILED: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
