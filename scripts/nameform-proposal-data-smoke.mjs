// 织卷 · 称谓类转提案「可执行别名登记」数据层冒烟（智能层 2026-09-15 15:00 轮）
// 验证：runNameMix/runNameForms 条目带 aliasCandidates+proposal（kind=replace-text）→
// applyProposal 落盘后约定头 别名 精确并入、正文/档案其余内容零污染（不再有「建议文本+依据」）。
// 用法：cd ~/Desktop/织卷 && node scripts/nameform-proposal-data-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-aliasprop-userdata'
const LIB = '/tmp/zj-smoke-aliasprop-lib'
const UD = process.env.ZJ_USERDATA
rmSync(UD, { recursive: true, force: true })
rmSync(LIB, { recursive: true, force: true })
mkdirSync(LIB, { recursive: true })
mkdirSync(UD, { recursive: true })
writeFileSync(resolve(UD, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: LIB }))

const out = '/tmp/aliasprop-bundle.mjs'
await esbuild({
  stdin: {
    contents:
      `export { runNameMix, runNameForms } from ${JSON.stringify(resolve(root, 'src/main/agent/audit.ts'))};\n` +
      `export { applyProposal, createProposals } from ${JSON.stringify(resolve(root, 'src/main/proposals.ts'))};\n` +
      `export { createProject, writeDoc, readDoc } from ${JSON.stringify(resolve(root, 'src/main/store.ts'))};\n` +
      `export { libraryRoot } from ${JSON.stringify(resolve(root, 'src/main/settings.ts'))};`,
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

const { runNameMix, runNameForms, applyProposal, createProposals, createProject, writeDoc, readDoc, libraryRoot } =
  await import(pathToFileURL(out).href)

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

const FM = (no, title) => `---\n章号: ${no}\n题名: ${title}\n切片: 第${no}幕\n涉及人物: [陈默]\n---\n`
const PERSON = (name, alias) => `---\n姓名: ${name}\n身份: 本地冒烟人物\n${alias ? `别名: [${alias.join(', ')}]\n` : ''}---\n\n# ${name}\n\n- 外貌：无\n- 性格：无\n`

try {
  console.log('=== 称谓类转提案 · 可执行别名登记 ===')
  const p = createProject('aliasprop冒烟', '数据层冒烟用（结束后清理）')
  if (!p) throw new Error('createProject 失败')
  const libRoot = libraryRoot()

  // 陈默：无别名行（走「姓名行后插入」）；沈藏：已有别名 [沈爷]（走「合并」）
  writeDoc(p.id, '人物/陈默.md', PERSON('陈默'))
  writeDoc(p.id, '人物/沈藏.md', PERSON('沈藏', ['沈爷']))

  // 混用：陈默 第1章（陈师傅/老陈/陈默 交替）、沈藏 第2章（沈藏/沈爷 交替）
  writeDoc(p.id, '正文/第01章_街坊.md', FM(1, '街坊') + '陈师傅搬来梯子。老陈在底下扶着。陈师傅踩了上去。陈默收工。陈默关门。陈默熄灯。\n')
  writeDoc(p.id, '正文/第02章_码头.md', FM(2, '码头') + '沈藏站在船头。沈爷在码头喊他。沈藏没回头。沈爷又喊。沈藏才应了一声。\n')

  const mix = runNameMix(p.id)
  assert('runNameMix ok', mix.ok === true)
  const mixItems = mix.ok ? mix.result.items : []
  assert('mixform 报 2 条', mixItems.length === 2)

  const chen = mixItems.find((i) => i.target === '人物/陈默.md')
  assert('陈默条目：aliasCandidates=[陈师傅,老陈]', chen && JSON.stringify(chen.aliasCandidates) === JSON.stringify(['陈师傅', '老陈']))
  assert('陈默条目：proposal kind=replace-text 且 before=姓名行', chen && chen.proposal && chen.proposal.kind === 'replace-text' && chen.proposal.before === '姓名: 陈默')
  assert('陈默条目：proposal.after 只含别名行（无建议文本/依据）', chen && chen.proposal && chen.proposal.after === '姓名: 陈默\n别名: [陈师傅, 老陈]' && !chen.proposal.after.includes('若几种称呼') && !chen.proposal.after.includes('> 依据：'))

  const shen = mixItems.find((i) => i.target === '人物/沈藏.md')
  assert('沈藏条目：变体全已登记 → 无可登记别名 → 不构造 proposal（回退旧行为）', shen && Array.isArray(shen.aliasCandidates) && shen.aliasCandidates.length === 0 && shen.proposal === undefined)

  // 称谓发现核查：陈默 未登记「陈师傅」也应带可执行提案
  writeDoc(p.id, '正文/第03章_茶馆.md', FM(3, '茶馆') + '陈师傅走进茶馆。陈师傅点了一壶茶。\n')
  const form = runNameForms(p.id)
  assert('runNameForms ok', form.ok === true)
  const formItem = (form.ok ? form.result.items : []).find((i) => i.target === '人物/陈默.md')
  assert('nameform 条目：aliasCandidates=[陈师傅] + proposal 构造成功', formItem && JSON.stringify(formItem.aliasCandidates) === JSON.stringify(['陈师傅']) && formItem.proposal && formItem.proposal.before === '姓名: 陈默')

  // 应用提案：陈默（replace-text 姓名行）→ 落盘后别名并入、档案其余零污染
  const propChen = chen.proposal
  const created = createProposals(libRoot, p.id, 'agent-chat', '', '', [propChen])
  assert('createProposals 建成 1 条', created.length === 1)
  const apply = applyProposal(libRoot, p.id, created[0].id)
  assert('applyProposal ok', apply && apply.ok === true)
  const afterRaw = readDoc(p.id, '人物/陈默.md') ?? ''
  assert('落盘：约定头含「别名: [陈师傅, 老陈]」', afterRaw.includes('别名: [陈师傅, 老陈]'))
  assert('落盘：无「若几种称呼」建议文本、无「> 依据：」', !afterRaw.includes('若几种称呼') && !afterRaw.includes('> 依据：'))
  assert('落盘：正文部分未被改动（# 陈默 标题与列表仍在）', afterRaw.includes('# 陈默') && afterRaw.includes('- 性格：无'))

  console.log(`\n全部通过：${pass} 断言`)
} finally {
  rmSync(UD, { recursive: true, force: true })
  rmSync(LIB, { recursive: true, force: true })
}
