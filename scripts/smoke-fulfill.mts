// 临时冒烟：复刻主进程兑现检查的完整调用链（双通道 + 一次追问），验证本机模型能给出可解析的回报
import type { Project, Chapter } from '../src/shared/types.ts'
import { buildFulfillChecklist, segmentText, renderFulfillPrompt, parseFulfillReport, renderFulfillReport } from '../src/shared/fulfill.ts'

const baseUrl = 'http://127.0.0.1:8888/v1'
const model = 'deepseek-v4-flash-0731'
const apiKey = 'EMPTY'

const project: Project = {
  id: 'smoke', name: '冒烟测试作', description: '',
  worldview: { name: '', city: '', era: '', themes: [], rules: [], background: '' },
  characters: [], chapters: [], elements: [], records: [], foreshadows: [], sweepDrafts: [], updatedAt: 0
}
const chapter: Chapter = {
  id: 'c1', num: 1, title: '初遇', status: 'draft',
  elements: '', premise: '办公室初见，气氛微妙',
  curves: [
    { id: 'e1', kind: 'emotion', name: '整体张力', color: '#f55', points: [{ x: 0, y: 30 }, { x: 40, y: 45 }, { x: 60, y: 85 }, { x: 100, y: 20 }] }
  ],
  beats: [{ id: 'b1', at: 60, label: '灯灭', note: '整层楼跳闸，黑暗里她慌了' }],
  content: '林晚坐在工位上改方案，格子间的灯只亮着她头顶那一盏。脚步声由远及近，她没回头，肩膀先绷紧了。他在她椅背后面停住，一只手撑在桌面，俯身下来的影子把她整个人罩住。她低下头，耳根烧起来，声音细得像蚊子。他没有说话，只是又近了一点。突然整层楼跳闸，眼前一黑，她惊得座位都坐不稳，被他稳稳按住，黑暗里她仰头呼吸急促，手指下意识攥紧了他的袖口。灯又亮起来的瞬间，她别过脸，耳根通红。',
  updatedAt: 0
}

const cl = buildFulfillChecklist(chapter)
const blocks = segmentText(chapter.content)
const prompt = renderFulfillPrompt(project.name, chapter.num, chapter.title, cl, blocks)
console.log('checklist:', cl.items.length, '| blocks:', blocks.length)

async function call(messages: { role: string; content: string }[], maxTokens: number) {
  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你是一个严格照单执行格式要求的审稿工具。用户要你输出的东西必须原样按行输出，任何分析、解释都要排在回报行之后。先给完整回报行，别先自言自语。' },
        ...messages
      ],
      temperature: 0.1,
      max_tokens: maxTokens,
      stream: false
    }),
    signal: AbortSignal.timeout(600_000)
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const data = await res.json()
  const msg = data.choices?.[0]?.message
  return { content: msg?.content ?? '', reasoning: msg?.reasoning ?? '' }
}

const first = await call([{ role: 'user', content: prompt }], 16000)
console.log('first: contentLen=', first.content.length, 'reasoningLen=', first.reasoning.length)
let raw = first.content
let report = parseFulfillReport(raw, cl)
const scored = (r: { met: number; partial: number; miss: number }) => r.met + r.partial + r.miss
if (first.reasoning && scored(report) === 0) {
  const alt = parseFulfillReport(first.reasoning, cl)
  if (scored(alt) > scored(report)) { report = alt; raw = first.reasoning }
}
if (scored(report) === 0) {
  const second = await call([
    { role: 'user', content: prompt },
    { role: 'assistant', content: (first.content || first.reasoning || '(空)').slice(0, 3000) },
    { role: 'user', content: '刚才不是按格式返回的。现在只按格式输出各条目回报行：每一行一条“条目id: 已兑现/部分兑现/未兑现 — 块号: 理由”，不要任何其它文字。' }
  ], 4000)
  console.log('retry: contentLen=', second.content.length, 'reasoningLen=', second.reasoning.length)
  const alt = parseFulfillReport(second.content || second.reasoning, cl)
  if (scored(alt) > scored(report)) { report = alt; raw = second.content || second.reasoning }
}
console.log('parsed:', 'met=', report.met, 'partial=', report.partial, 'miss=', report.miss, 'unknown=', report.unknown)
console.log('--- raw head ---')
console.log(raw.slice(0, 800))
console.log('--- rendered ---')
console.log(renderFulfillReport(project.name, chapter, cl, report).slice(0, 1500))
