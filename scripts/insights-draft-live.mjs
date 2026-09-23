// 织卷 · 「写作习惯草稿注入行为面」真模型探针（2026-09-22 智能层轮，候选 1）
// 背景：增量 4（学习→草稿→转正→注入）数据链与 UI 已闭环（05ff704/2041486/cee0dd1/3328b29），
//      但「草稿内容（模板规则+为什么+示例）注入后模型行为是否可测改变」从未真模型验证：
//      skill-live 证的是注入通道（A/C PASS）；draft-refine-probe 证的是模板 vs 提炼（盲评无差异）。
// 本探针=skill-live 先例 + 无技能基线对照，分两段：
//   【数据段】草稿=draftSkillFromStats 真实产出（合成规则样例经 buildSignals 真生成，防漂移）
//            → parseSkillFile/listSkills/matchSkillForInput/resolveSkillInjection 全链断言
//            （=「转正启用草稿可被注入面命中」通道验证）。
//   【行为段】内容效能 A/B：同一 prompt（措辞完全相同，均含「按我的写作习惯」），唯一变量=
//            是否在用户消息后注入【技能：writing-habits】块（块=resolveSkillInjection 真实产出，
//            与 engine.ts parts 装配同构：技能块+用户消息）；直连本机 vLLM（draft-refine-probe 同款）。
// 判据（行为面，n=2×2 采样聚合）：①「一下」裸计数（剥 「一下」 引号引用形式）②平均句长（规则=长句拆短）。
//      PASS=注入版「一下」<基线 或 注入版平均句长 ≤ 基线×0.92；否则=行为零差异
//      （样本 n=2×2）→ 按候选 1 口径登记观察「模板草稿效能存疑」并汇报主人。
// 版本与教训：v1（runChat 全链）实测发现模型必带元说明（「未使用『一下』」类自述），引号引用+说明
//      长句严重污染测量（首轮「注入 4 vs 基线 0」=4 次全是元说明里的引号引用；注入版正文 0 个「一下」）
//      → v2 改纯续写直连（prompt 强制「只输出正文，不要任何说明」）+ 剥离引号引用（双保险）。
// 用法：cd ~/Desktop/织卷 && node scripts/insights-draft-live.mjs
//      INSIGHT_STAGE=data  只跑数据层（快，几十秒）；live=只跑行为段（慢，数分钟；建议后台+notify）
// 说明：规则样例=合成但真实（织卷smoke 历史快照不足 2 份无真实 versionRules；draft-refine-probe 同况），
//      样例字段与 extractVersionRules 同构、经由 buildSignals 真生成草稿文案（防漂移）。
import { writeProbeSettings, chatEndpoint } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const stage = (process.env.INSIGHT_STAGE || 'all').toLowerCase()
const tmp = mkdtempSync(join(tmpdir(), 'zj-insdraft-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
const ws = join(tmp, 'ws')
const lib = join(tmp, 'lib')
writeProbeSettings({ libraryRoot: lib, workspace: ws })

// =====================================================================
// ① 合成信号 → 真实草稿生成链（buildSignals→draftSkillFromStats），防漂移
// =====================================================================
const FM = '---\n章号: 1\n题名: 夜航\n切片: 第一幕\n涉及人物: []\n---\n'
const F = '正文/第01章_夜航.md'
const C = (before, after) => ({ file: F, before: FM + '\n' + before + '\n', after: FM + '\n' + after + '\n' })
// removed-phrase「一下」×5（→规则 count 5 证据「强」）
const yixia = [
  ['他鼓起勇气，一下推开了门。', '他鼓起勇气，推开了门。'],
  ['她把信纸一下拍在桌上。', '她把信纸拍在桌上。'],
  ['门在风里一下撞出声响。', '门在风里撞出声响。'],
  ['他一下愣在原地。', '他愣在原地。'],
  ['她把背包一下甩到肩上。', '她把背包甩到肩上。']
].map((a) => C(a[0], a[1]))
// split-sentence「长句」×5（before 1 长句 ≥25 字 → after ≥2 句）
const split = [
  ['她站在窗前看着外面渐渐亮起来的天色，心里那些乱糟糟的念头也跟着一点点安静了下来。', '她站在窗前。天色渐渐亮起来。心里那些乱糟糟的念头，一点点安静下来。'],
  ['雨下了整整一夜，他在候车厅的椅子上坐着，看着玻璃上的水痕慢慢滑下去。', '雨下了整整一夜。他在候车厅的椅子上坐着。玻璃上的水痕慢慢滑下去。'],
  ['他把那封信从头到尾看了三遍，终于认出寄信人的笔迹，是他多年没见的老同学。', '他把那封信从头到尾看了三遍。他终于认出寄信人的笔迹。是他多年没见的老同学。'],
  ['她沿着河堤走了很久，路灯一盏接一盏亮起来，她的影子在脚下一点点变长。', '她沿着河堤走了很久。路灯一盏接一盏亮起来。她的影子在脚下一点点变长。'],
  ['火车进站的时候天已经黑透了，他拖着行李箱穿过地道，检票口只剩下一个阿姨。', '火车进站的时候天已经黑透了。他拖着行李箱穿过地道。检票口只剩下一个阿姨。']
].map((a) => C(a[0], a[1]))
// merged-sentence「短句」×3（≥2 短句 <20 字 → 1 句 ≥30 字）
const merged = [
  ['雨停了。灯灭了。街上没有一个人影。', '雨停了，灯灭了，街上没有一个人影，只有远处传来一声模糊的犬吠。'],
  ['他抬起头。她别过脸。谁都没有先开口。', '他抬起头，她别过脸，谁都没有先开口，只有吊灯在天花板下轻轻晃。'],
  ['天亮了。雾散了。站台空了下来。', '天亮了，雾散了，站台空了下来，只有一只塑料袋贴着地面打着旋。']
].map((a) => C(a[0], a[1]))
// shortened「篇幅」×4（±8 字符以上）
const short = [
  ['她不知道为什么心里忽然涌上一种说不清道不明的委屈，眼泪在眼眶里直打转。', '她忽然觉得委屈，眼泪在眼眶里打转。'],
  ['他把手机从口袋里掏出来，屏幕亮起的瞬间，看到上面有一串未接来电。', '他掏出手机，屏幕上有一串未接来电。'],
  ['她站在门口迟疑了很久，最后还是伸手按下了门铃。', '她迟疑片刻，按下了门铃。'],
  ['房间里只剩下他一个人，窗外的雨声显得格外清晰，他忽然想喝一杯热水。', '房间里只剩他一个人。雨声清晰。他想喝一杯热水。']
].map((a) => C(a[0], a[1]))

async function bundleShared() {
  const out = join(tmp, 'writingInsights-bundle.mjs')
  await esbuild({
    entryPoints: [resolve(root, 'src/shared/writingInsights.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: out,
    external: ['node:*'],
    logLevel: 'warning'
  })
  return import(pathToFileURL(out).href)
}
async function bundleSkillsShared() {
  const out = join(tmp, 'skillsShared-bundle.mjs')
  await esbuild({
    entryPoints: [resolve(root, 'src/shared/skills.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: out,
    external: ['node:*'],
    logLevel: 'warning'
  })
  return import(pathToFileURL(out).href)
}
async function bundleMainSkills() {
  const out = join(tmp, 'mainSkills-bundle.mjs')
  await esbuild({
    entryPoints: [resolve(root, 'src/main/skills.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: out,
    alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
    external: ['node:*'],
    logLevel: 'warning'
  })
  return import(pathToFileURL(out).href)
}

const wi = await bundleShared()
const sk = await bundleSkillsShared()

// 合成 chapters（topPhrases 样本：让草稿「用词与句法现状」非空且真实）
const chapterText =
  '她整个人都缩在伞下面，心里有点乱。她慢慢地蹲下来，把行李箱拉上台阶。' +
  '窗外的灯一盏一盏亮起来，她整个人都愣在那里。她慢慢地叠好信纸，放回信封。' +
  '她小小的手在风里缩了一下。她小小的肩膀抖了抖，还是没有抬头。'
const signals = wi.buildSignals({
  changes: [...yixia, ...split, ...merged, ...short],
  proposals: [],
  chapters: [{ file: F, raw: FM + '\n' + chapterText + '\n' }]
})
const draftText = wi.draftSkillFromStats(signals, { generatedAt: new Date('2026-09-22T18:00:00+08:00') })
const draftMeta = sk.parseSkillFile(draftText)
const enabledText = draftText.replace('disabled: true', 'disabled: false')
const enabledMeta = sk.parseSkillFile(enabledText)

const dataChecks = {
  '草稿可解析(name=writing-habits)': !!draftMeta && draftMeta.name === 'writing-habits',
  '草稿默认禁用 disabled=true': !!draftMeta && draftMeta.disabled === true,
  '草稿规则含「回避一下」': (draftMeta?.body ?? '').includes('作者回避「一下」'),
  '草稿规则含「长句拆成短句」': (draftMeta?.body ?? '').includes('把长句拆成短句'),
  '草稿含示例(→)对': /示例：「.+」→「.+」/.test(draftMeta?.body ?? ''),
  '草稿含高频词(每千字)行': (draftMeta?.body ?? '').includes('每千字'),
  '草稿含短句合并规则': (draftMeta?.body ?? '').includes('短句合并'),
  '草稿含精简规则': (draftMeta?.body ?? '').includes('精简篇幅'),
  '禁用态不参与匹配': sk.matchSkillForInput('请按我的写作习惯续写', [draftMeta]).length === 0,
  '启用态触发词命中': sk.matchSkillForInput('请按我的写作习惯续写', [enabledMeta]).some((s) => s.name === 'writing-habits')
}
let dataPass = true
for (const [k, v] of Object.entries(dataChecks)) {
  console.log(`断言 ${k}: ${v ? 'OK' : 'FAIL'}`)
  if (!v) dataPass = false
}
if (dataPass) console.log('INSIGHTS-DRAFT-DATA OK')
else {
  console.log('INSIGHTS-DRAFT-DATA FAILED')
  process.exit(1)
}

// 写盘（启用态）供 listSkills 断言（模拟「转正后设置页启用」的磁盘形态）
const skillRel = join(ws, 'skills/writing-habits')
const writeSkill = () => {
  mkdirSync(skillRel, { recursive: true })
  writeFileSync(join(skillRel, 'SKILL.md'), enabledText, 'utf-8')
}
writeSkill()
const ms = await bundleMainSkills()
const listed = ms.listSkills()
const byName = Object.fromEntries(listed.map((s) => [s.name, s]))
const listChecks = {
  'listSkills 扫到 writing-habits': !!byName['writing-habits'],
  'listSkills 解析 disabled=false': byName['writing-habits']?.disabled === false,
  'listSkills 正文含规则': (byName['writing-habits']?.body ?? '').includes('作者回避「一下」')
}
let listPass = true
for (const [k, v] of Object.entries(listChecks)) {
  console.log(`断言 ${k}: ${v ? 'OK' : 'FAIL'}`)
  if (!v) listPass = false
}
if (!listPass) {
  console.log('INSIGHTS-DRAFT-LISTFAIL')
  process.exit(1)
}

if (stage === 'data') {
  console.log('INSIGHTS-DRAFT-DATA 段完成（行为段未跑，用 INSIGHT_STAGE=live）')
  rmSync(tmp, { recursive: true, force: true })
  process.exit(0)
}

// =====================================================================
// ② 行为段：内容效能 A/B（纯续写直连；通道面已由数据段 resolveSkillInjection 断言覆盖）
// =====================================================================
const BASE = chatEndpoint()
const MODEL = 'deepseek-v4-flash-vision-exp-uncensored'

async function callLLM(messages, opts = {}) {
  const body = {
    model: MODEL,
    messages,
    max_tokens: opts.maxTokens ?? 1200,
    ...(opts.effort !== undefined ? { reasoning_effort: opts.effort } : { reasoning_effort: 'low' })
  }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 300000)
  try {
    const resp = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal
    })
    const j = await resp.json()
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(j).slice(0, 200)}`)
    const c = j.choices?.[0]
    if (opts.verbose) console.log('  [finish_reason=' + (c?.finish_reason || '?') + ' content_len=' + ((c?.message?.content ?? '').length) + ']')
    return c?.message?.content ?? ''
  } finally {
    clearTimeout(timer)
  }
}

const SCENE =
  '凌晨一点的便利店门口，她蹲在台阶上，手里攥着一把滴水的伞。塑料袋里装着两盒酸奶和一卷纸巾，' +
  '都是临走前塞进去的。'
const PROMPT =
  '你是一篇小说作者。请按我的写作习惯，续写下面场景的下一段（约 120 字，中文）。' +
  '只输出正文本身，不要任何说明、解释、标记、建议或前后缀。\n\n【场景】\n' + SCENE

// 注入块=真实注入面产出（与 engine.ts parts 组装同构：技能块 + 用户消息）
const inj = sk.resolveSkillInjection([enabledMeta], PROMPT, null)
if (inj.blocks.length !== 1) {
  console.log('RESOLVE_INJECT_FAIL blocks=', inj.blocks.length)
  process.exit(1)
}
const skillBlock = inj.blocks[0]
console.log('注入块预览（前 260 字符）：\n' + skillBlock.slice(0, 260))

async function runOne(tag, prompt) {
  console.log(`\n=== ${tag} 开始：`, new Date().toISOString())
  const text = await callLLM([{ role: 'user', content: prompt }], { verbose: true })
  console.log(`=== ${tag} 完成：\n` + text)
  return text
}

// 只统计裸「一下」（剥离 「一下」/“一下”/“一下” 引号引用形式，防元说明污染；本轮 prompt 已禁说明，双保险）
const countBare = (text, p) => (text ?? '').replace(/「[^」]*」|“[^”]*”|"[^"]*"/g, '').split(p).length - 1
const statsOf = (text) => {
  const sents = wi.splitSentences(text ?? '')
  const lens = sents.map((s) => s.length)
  const avg = lens.length ? Math.round((lens.reduce((a, b) => a + b, 0) / lens.length) * 10) / 10 : 0
  return {
    chars: (text ?? '').length,
    yixia: countBare(text, '一下'),
    sentences: lens.length,
    avgSent: avg,
    shortPct: lens.length ? Math.round((lens.filter((n) => n <= 14).length / lens.length) * 100) : 0
  }
}

console.log('\n=== 基线段（无技能注入） ===')
const baseTexts = [await runOne('基线#1(无技能)', PROMPT), await runOne('基线#2(无技能)', PROMPT)]
console.log('\n=== 注入段（写作习惯草稿已注入） ===')
const injTexts = [
  await runOne('注入#1(有技能)', PROMPT + '\n\n' + skillBlock),
  await runOne('注入#2(有技能)', PROMPT + '\n\n' + skillBlock)
]

const bStats = baseTexts.map(statsOf)
const iStats = injTexts.map(statsOf)
const agg = (xs) => ({
  yixia: xs.reduce((a, x) => a + x.yixia, 0),
  avgSent: xs.reduce((a, x) => a + x.avgSent, 0) / xs.length,
  shortPct: xs.reduce((a, x) => a + x.shortPct, 0) / xs.length,
  chars: xs.reduce((a, x) => a + x.chars, 0)
})
const B = agg(bStats)
const I = agg(iStats)
console.log('\n=== 指标对比（n=2/场景） ===')
console.log('基线：' + JSON.stringify(B))
console.log('注入：' + JSON.stringify(I))
console.log('\n【基线全文】\n' + baseTexts.join('\n\n----\n\n'))
console.log('\n【注入全文】\n' + injTexts.join('\n\n----\n\n'))

const pass1 = I.yixia < B.yixia
const pass2 = I.avgSent <= B.avgSent * 0.92
const sampleOk = B.chars > 0 && I.chars > 0
const verdict = sampleOk && (pass1 || pass2)
console.log(`\n判据①「一下」裸计数更少：注入 ${I.yixia} vs 基线 ${B.yixia} → ${pass1 ? 'OK' : 'FAIL'}`)
console.log(`判据②平均句长≤基线×0.92：注入 ${I.avgSent} vs 基线 ${B.avgSent}（阈值 ${(B.avgSent * 0.92).toFixed(1)}）→ ${pass2 ? 'OK' : 'FAIL'}`)
console.log(`有效样本（两版非空）：${sampleOk ? 'OK' : 'FAIL（空响应→计数为无效样本）'}`)
console.log(verdict ? 'INSIGHTS-DRAFT-LIVE OK（注入后行为可测改变）' : 'INSIGHTS-DRAFT-LIVE ZERO-DIFF（行为零差异/无效样本→登记观察「模板草稿效能存疑」）')

const report = [
  '=== 织卷 · 写作习惯草稿注入行为面探针报告（2026-09-22 智能层轮） ===',
  '模型：本机 vLLM（纯续写直连；注入块=resolveSkillInjection 真实产出）',
  '',
  '【草稿规则（draftSkillFromStats 真实产出）】',
  ...(draftMeta?.body ?? '').split('\n').filter((l) => l.startsWith('- [')).map((l) => l),
  '',
  '【判据①「一下」裸计数】基线=' + B.yixia + ' 注入=' + I.yixia + ' → ' + (pass1 ? 'OK' : 'FAIL'),
  '【判据②平均句长】基线=' + B.avgSent + ' 注入=' + I.avgSent + '（≤基线×0.92=' + (B.avgSent * 0.92).toFixed(1) + '）→ ' + (pass2 ? 'OK' : 'FAIL'),
  '【短句(≤14字)占比】基线=' + B.shortPct.toFixed(1) + '% 注入=' + I.shortPct.toFixed(1) + '%',
  '',
  '【基线全文】' + baseTexts.join('\n\n----\n\n'),
  '【注入全文】' + injTexts.join('\n\n----\n\n'),
  '',
  '结论：' + (verdict ? '草稿注入后行为可测改变（PASS）' : '行为零差异或无效样本（n=2×2）→ 登记观察「模板草稿效能存疑」')
].join('\n')
writeFileSync('/tmp/zj-insights-draft-report.txt', report)
console.log('\nREPORT saved /tmp/zj-insights-draft-report.txt')
rmSync(tmp, { recursive: true, force: true })
process.exit(verdict ? 0 : 2)
