// 织卷 · 称谓混用（mixform）条目「让 agent 改」真模型质量体检（智能层 2026-09-15 15:00 轮）
// 体检对象：auditItemToAgentPrompt（现象+建议+关联档案）对模型的引导准确度——
//   A（刻意场景）：同章「街坊眼里/他自己」分节视角交替→应保留（或不改正文、或登记别名），不该机械统一；
//   B（无意场景）：无视角标记的单一叙述段乱换→应统一（zj_edit_doc 出修改卡），并可登记别名。
// 链路：真引擎（dsh 边车 + 真 vLLM 127.0.0.1:8888）runChat + 真 zj_* 工具读文件/出修改卡。
// 另外验证：mixform 条目现在自带可执行「别名登记」提案（新处置方式，数据层）。
// 用法：cd ~/Desktop/织卷 && node scripts/mixform-toagent-live.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-mixtoa-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeProbeSettings({ libraryRoot: join(tmp, 'lib') })

const lib = join(tmp, 'lib')
const pid = 'mixform体检'
const P = (rel) => join(lib, pid, rel)
mkdirSync(P('正文'), { recursive: true })
mkdirSync(P('人物'), { recursive: true })
mkdirSync(P('世界观'), { recursive: true })

const PERSON = (name) => `---\n姓名: ${name}\n身份: 本地体检人物\n---\n\n# ${name}\n\n- 外貌：无\n- 性格：无\n`
const FM = (no, title) => `---\n章号: ${no}\n题名: ${title}\n切片: 第一幕\n涉及人物: [陈默]\n---\n`
writeFileSync(P('人物/陈默.md'), PERSON('陈默'), 'utf-8')
// A：刻意交替（`## 白天·街坊眼里`＝街坊视角 → 陈师傅/老陈；`## 夜里·他自己`＝本名段 → 陈默）
writeFileSync(
  P('正文/第01章_街坊.md'),
  FM(1, '街坊') + '\n## 白天·街坊眼里\n陈师傅搬来梯子。老陈在底下扶着。陈师傅踩了上去，把屋檐的瓦片换好。\n\n## 夜里·他自己\n陈默收工。陈默把扳手擦干净放回工具箱。陈默关了灯，在黑暗里坐了一会儿。\n',
  'utf-8'
)
// B：无视角标记的单一叙述段乱换
writeFileSync(
  P('正文/第02章_茶馆.md'),
  FM(2, '茶馆') + '\n## 午后\n陈默走进茶馆。陈师傅点了一壶茶。老陈坐下来。陈默看着窗外。陈师傅忽然开口。\n',
  'utf-8'
)
writeFileSync(P('世界观/切片_第一幕.md'), '---\n切片: 第一幕\n时间: 初秋\n---\n\n# 切片：第一幕\n\n## 环境状态\n雾港近期持续南风。\n', 'utf-8')

const out = join(tmp, 'bundle.mjs')
await esbuild({
  stdin: {
    contents:
      `export { runChat, shutdown } from ${JSON.stringify(resolve(root, 'src/main/agent/engine.ts'))};\n` +
      `export { runNameMix } from ${JSON.stringify(resolve(root, 'src/main/agent/audit.ts'))};\n` +
      `export { auditItemToAgentPrompt } from ${JSON.stringify(resolve(root, 'src/shared/auditToAgent.ts'))};`,
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

let pass = 0
let total = 0
const verdict = (name, ok, extra = '') => {
  total++
  console.log((ok ? '  ✓' : '  ✗') + ' ' + name + (extra ? ' —— ' + extra : ''))
  if (ok) pass++
}
const collect = () => {
  const calls = []
  const edits = []
  const finals = []
  const errs = []
  const rec = (e) => {
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'meta') {
      calls.push({ tool: e.tool, args: e.args ?? '' })
      console.log('\n[工具]', e.tool, e.args ?? '')
    } else if (e.type === 'meta-done') console.log('[工具完成]', (e.message ?? '').slice(0, 50).replace(/\n/g, '⏎'))
    else if (e.type === 'edit') {
      edits.push({ file: e.file, edits: e.edits })
      console.log('\n[修改卡]', e.file, JSON.stringify(e.edits ?? []).slice(0, 200))
    } else if (e.type === 'final') finals.push(e.text)
    else if (e.type === 'error') errs.push(e.message)
  }
  return { rec, calls, edits, finals, errs }
}

try {
  // ---- 0. 规则层 + 新处置方式（数据层，零模型） ----
  const mix = mod.runNameMix(pid)
  if (!mix.ok) throw new Error('runNameMix: ' + mix.error)
  const items = mix.result.items
  console.log('=== 0. 规则层：应报 ' + items.length + ' 条 ===')
  const aItem = items.find((i) => i.where.includes('第01章'))
  const bItem = items.find((i) => i.where.includes('第02章'))
  verdict('A/B 两条应报且 target=人物/陈默.md', !!aItem && !!bItem && aItem.target === '人物/陈默.md' && bItem.target === '人物/陈默.md')
  verdict('条目自带可执行「别名登记」提案（kind=replace-text）', aItem && bItem && aItem.proposal?.kind === 'replace-text' && bItem.proposal?.kind === 'replace-text', JSON.stringify(aItem?.aliasCandidates) + ' / ' + JSON.stringify(bItem?.aliasCandidates))

  // ---- 1. 真模型「让 agent 改」· A（刻意，应保留） ----
  const promptA = mod.auditItemToAgentPrompt(aItem)
  console.log('\n=== 1. 真模型「让 agent 改」· 场景 A（刻意交替，应保留） ===')
  const ra = collect()
  await mod.runChat(
    { requestId: 'mx-a', projectId: pid, chapterRel: '正文/第01章_街坊.md', chapterTitle: '街坊', prompt: promptA, quote: null },
    ra.rec
  )
  const finalA = ra.finals.join('\n')
  const bodyEditA = ra.edits.filter((e) => e.file.includes('正文/'))
  const aliasRegA = ra.edits.filter((e) => e.file.includes('人物/') && (e.edits ?? []).some((x) => x.replace?.includes('别名')))
  // 好：不改正文（说明保留）或只登记别名；坏：正文被机械统一（find 含 陈师傅/老陈 且 replace 只剩单称）
  const unifiedA = bodyEditA.some((e) => (e.edits ?? []).some((x) => /陈师傅|老陈/.test(x.find ?? '') && !/陈师傅|老陈/.test(x.replace ?? '')))
  const preserveA = !unifiedA || aliasRegA.length > 0
  verdict(
    'A：未机械统一正文（刻意视角保留）',
    preserveA,
    '正文修改卡=' + bodyEditA.length + ' 别名登记=' + aliasRegA.length + (ra.errs.length ? ' 错误:' + ra.errs[0] : '')
  )
  if (!finalA.trim() && ra.errs.length) console.log('  ⚠ A 引擎错误：' + ra.errs[0])

  // ---- 2. 真模型「让 agent 改」· B（无意，应统一） ----
  const promptB = mod.auditItemToAgentPrompt(bItem)
  console.log('\n=== 2. 真模型「让 agent 改」· 场景 B（无意乱换，应统一） ===')
  const rb = collect()
  await mod.runChat(
    { requestId: 'mx-b', projectId: pid, chapterRel: '正文/第02章_茶馆.md', chapterTitle: '茶馆', prompt: promptB, quote: null, focus: true },
    rb.rec
  )
  const bodyEditB = rb.edits.filter((e) => e.file.includes('正文/'))
  const unifiedB = bodyEditB.some((e) => (e.edits ?? []).some((x) => /陈师傅|老陈/.test(x.find ?? '') && !/陈师傅|老陈/.test(x.replace ?? '')))
  verdict('B：正文出统一修改卡（乱换被修）', unifiedB, '正文修改卡=' + bodyEditB.length + ' 错误=' + (rb.errs[0] ?? '无'))
  // 2026-09-15 21:00 轮：focus 预算（12min）验收——B 不再被 8min 截断：无驱动超时错误 + 有收尾 final
  verdict('B：focus 预算下无驱动超时错误', rb.errs.length === 0, rb.errs[0] ?? 'errs 为空')
  verdict('B：focus 预算下完成收尾（final 存在）', rb.finals.join('').trim().length > 0, 'final 长度=' + rb.finals.join('').length)

  await mod.shutdown()
  console.log('\n' + (pass === total ? `MIXFORM-TOAGENT LIVE OK（${pass}/${total}）` : `MIXFORM-TOAGENT LIVE 部分通过（${pass}/${total}）`))
  process.exit(pass === total ? 0 : 1)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
