// 织卷 · 增量 5「LLM 提炼草稿（为什么）」评估探针（2026-09-22 智能层轮）。
// 背景：写作习惯草稿一期=纯本地统计+模板直出（D-L-2）；二期候选=把统计材料喂模型写
//       「为什么」替代模板套话。本探针按 skill-creator 盲评协议（SOC 官方 agents/comparator.md）
//       对照「模板句 vs 提炼句」对模型续写的真实影响。
// 用法：cd ~/Desktop/织卷 && node scripts/draft-refine-probe.mjs
// 说明：① 规则样例=合成但真实的 4 条（织卷smoke 历史快照不足 2 份，无真实 versionRules；
//        样本即 4a 提取口径产出物，样例字段与 extractVersionRules 同构）；
//      ② 模型=本机 vLLM 127.0.0.1:8888 OpenAI 兼容直连；reasoning_effort=low（暂停档，读取快）；
//      ③ 盲评=评审只看到两篇续写 X/Y，看不到对应技能版本（skill-creator Blind Comparator 协议）。
// 判定：仅一次性证据（n=1 续写+1 盲评），用于「要不要立项 LLM 提炼」的定性参考，不作统计断言。
import { chatEndpoint } from './lib/probe-settings.mjs'
import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
import { build as esbuild } from 'esbuild'

const BASE = chatEndpoint()
const MODEL = 'deepseek-v4-flash-vision-exp-uncensored'

// 规则样例（=extractVersionRules 同构产物；before/after 为真实中文改法）
const RULES = [
  {
    kind: 'removed-phrase',
    subject: '一下',
    count: 6,
    before: '他鼓起勇气，一下推开了门。',
    after: '他鼓起勇气，推开了门。'
  },
  {
    kind: 'split-sentence',
    subject: '长句',
    count: 5,
    before: '她站在窗前看着外面渐渐亮起来的天色，心里那些乱糟糟的念头也跟着一点点安静了下来。',
    after: '她站在窗前。天色渐渐亮起来。心里那些乱糟糟的念头，一点点安静下来。'
  },
  {
    kind: 'merged-sentence',
    subject: '短句',
    count: 3,
    before: '他停下脚步。她转过身。',
    after: '他停下脚步，她转过身。'
  },
  {
    kind: 'shortened',
    subject: '篇幅',
    count: 4,
    before: '她不知道为什么心里忽然涌上一种说不清道不明的委屈，眼泪在眼眶里直打转。',
    after: '她忽然觉得委屈，眼泪在眼眶里打转。'
  }
]

async function callLLM(messages, opts = {}) {
  const body = {
    model: MODEL,
    messages,
    max_tokens: opts.maxTokens ?? 1024,
    ...(opts.effort ? { reasoning_effort: opts.effort } : {})
  }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 150000)
  try {
    const resp = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal
    })
    const j = await resp.json()
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(j).slice(0, 200)}`)
    return j.choices[0].message.content ?? ''
  } finally {
    clearTimeout(timer)
  }
}

function extractJSON(text) {
  const a = text.indexOf('[')
  const b = text.lastIndexOf(']')
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(text.slice(a, b + 1))
    } catch {
      /* fallthrough */
    }
  }
  return null
}

async function main() {
  console.log('=== 1/3 LLM 提炼「为什么」（基于真实证据） ===')
  const evidence = RULES.map((r, i) => ({
    id: i,
    kind: r.kind,
    observed: `${r.count} 次`,
    example: `${r.before} → ${r.after}`
  }))
  const refineOut = await callLLM(
    [
      {
        role: 'system',
        content:
          '你是写作技能作者。给定一位作者的真实改动证据（before→after 与统计次数），你要写一句「为什么」：' +
          '解释这位作者这么改背后的写作意图，让另一个模型理解后能泛化运用（theory of mind）。' +
          '要求：只依据给出的证据推理，禁止编造证据外的动机；不写套话（如「更有节奏」「更利落」这类通用审美口号）；' +
          '如果证据不足以推断动机，就只描述可观察的事实规律（如「多次把……改成……」）。一句话，中文。'
      },
      {
        role: 'user',
        content:
          `证据如下（JSON）：\n${JSON.stringify(evidence, null, 2)}\n\n` +
          '为每条规则输出一句「为什么」。整个回答只能是一个 JSON 数组，每个元素形如 {"kind":"split-sentence","why":"..."}，不要写数组以外的任何字。'
      }
    ],
    { effort: 'low', maxTokens: 1500 }
  )
  const parsed = extractJSON(refineOut)
  if (!parsed || parsed.length === 0) {
    console.log('REFINE_PARSE_FAIL raw=', refineOut.slice(0, 400))
    process.exit(2)
  }
  const whyByKind = Object.fromEntries(parsed.map((p) => [p.kind, p.why]))
  console.log('REFINE_OK kinds=', Object.keys(whyByKind).join(','))

  // 载入真实模板函数（与草稿同源，防漂移）
  const out = '/tmp/zj-draft-refine-probe.mjs'
  await esbuild({
    stdin: {
      contents: `export * from ${JSON.stringify(resolve(import.meta.dirname, '..', 'src/shared/writingInsights.ts'))};`,
      resolveDir: resolve(import.meta.dirname, '..'),
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: out,
    external: ['node:*'],
    logLevel: 'warning'
  })
  const { ruleLine } = await import(pathToFileURL(out).href)
  const evi = (c) => (c >= 5 ? '强' : c >= 2 ? '中' : '弱')
  const mkRule = (r) => ({ kind: r.kind, subject: r.subject, direction: 'prefers', count: r.count, files: [], examples: [{ before: r.before, after: r.after }] })
  const skillA = RULES.map((r) => ruleLine(mkRule(r)))
  const skillB = RULES.map((r) => ruleLine(mkRule(r), whyByKind[r.kind] ?? undefined))
  console.log('\n--- skillA（模板）---')
  skillA.forEach((l) => console.log(l))
  console.log('\n--- skillB（提炼）---')
  skillB.forEach((l) => console.log(l))

  console.log('\n=== 2/3 盲续写（同基座，X=模板版技能 / Y=提炼版技能） ===')
  const SCENE = '巷口路灯下，她蹲在便利店门口的台阶上。被雨淋过的塑料伞还在滴水。'
  const task =
    '你是一篇小说作者。请续写下面场景的下一段（约 100 字，中文，与场景情绪一致）。\n' +
    '创作时遵循下面的【我的写作习惯】（若与场景情绪冲突，以场景情绪为准）。\n\n'
  const habitBody = (lines) =>
    lines.length ? lines.join('\n') : '（暂无规则）'
  const promptFor = (lines) => `${task}【我的写作习惯】\n${habitBody(lines)}\n\n【场景】\n${SCENE}`
  const contA = await callLLM([{ role: 'user', content: promptFor(skillA) }], { effort: 'low', maxTokens: 700 })
  const contB = await callLLM([{ role: 'user', content: promptFor(skillB) }], { effort: 'low', maxTokens: 700 })
  console.log('X(模板):', contA.slice(0, 500))
  console.log('Y(提炼):', contB.slice(0, 500))

  console.log('\n=== 3/3 盲评（不知道 X/Y 来自哪个技能版本） ===')
  const judge = await callLLM(
    [
      {
        role: 'system',
        content:
          '你是盲评评审（Blind Comparator）。你只看到同一场景的两篇续写 X 和 Y，不知道它们分别由哪版写作技能生成。' +
          '请按给出的事实标准评哪篇续写更符合标准，再整体给可读性判断。输出只能是 JSON：' +
          '{"winner":"X"|"Y"|"TIE","adherenceX":1-5,"adherenceY":1-5,"readabilityX":1-5,"readabilityY":1-5,"reasons":"...（中文，≤120字）"}'
      },
      {
        role: 'user',
        content:
          `【事实标准】续写应尽量体现：①避免口语缀词（「一下」「点了点头」类拖沓）；②信息密集长句拆成短句；③表达利落，不堆砌修饰；④与场景情绪自然衔接。\n` +
          `【场景】${SCENE}\n【续写X】${contA}\n【续写Y】${contB}\n\n输出 JSON。`
      }
    ],
    { effort: 'low', maxTokens: 600 }
  )
  console.log('JUDGE_RAW:', judge.slice(0, 700))

  const report = [
    '=== 织卷 · 增量5 LLM 提炼草稿 探针报告（2026-09-22） ===',
    '模型：' + MODEL + '（reasoning_effort=low）',
    '',
    '【规则证据】',
    ...evidence.map((e) => `- ${e.kind} ×${e.observed}：${e.example}`),
    '',
    '【模板 why / 提炼 why】',
    ...RULES.map((r) => `- ${r.kind}: 模板="${(ruleLine(mkRule(r))).split('——')[1]?.split('；')[0]}" 提炼="${whyByKind[r.kind]}"`),
    '',
    '【续写 X（模板版技能）】' + contA,
    '【续写 Y（提炼版技能）】' + contB,
    '【盲评】' + judge,
    ''
  ].join('\n')
  writeFileSync('/tmp/zj-draft-refine-report.txt', report)
  console.log('\nREPORT saved /tmp/zj-draft-refine-report.txt')
}

main().catch((e) => {
  console.error('PROBE_ERR', e)
  process.exit(1)
})
