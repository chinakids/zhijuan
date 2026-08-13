// 临时冒烟：真实调用本地 LLM 验证 fulfill 行式协议可被遵循，随后删除
import type { Project, Chapter } from '../src/shared/types.ts'
import { buildFulfillChecklist, segmentText, renderFulfillPrompt, parseFulfillReport, renderFulfillReport } from '../src/shared/fulfill.ts'

const baseUrl = 'http://127.0.0.1:8888/v1'
const model = 'deepseek-v4-flash-0731'

const project: Project = {
  id: 'smoke',
  name: '冒烟测试作',
  description: '',
  worldview: { name: '', city: '', era: '', themes: [], rules: [], background: '' },
  characters: [],
  chapters: [],
  elements: [],
  records: [],
  foreshadows: [],
  sweepDrafts: [],
  updatedAt: 0
}

const chapter: Chapter = {
  id: 'c1',
  num: 1,
  title: '初夜',
  status: 'draft',
  elements: '她进门就被按住',
  premise: '办公室独处，气氛渐渐升温',
  curves: [
    { id: 'e1', kind: 'emotion', name: '整体张力', color: '#f55', points: [{ x: 0, y: 35 }, { x: 40, y: 45 }, { x: 60, y: 92 }, { x: 100, y: 20 }] },
    { id: 'c1', kind: 'character', name: '林晚·防线', color: '#f80', points: [{ x: 0, y: 20 }, { x: 55, y: 15 }, { x: 70, y: 95 }, { x: 100, y: 30 }], axis: 'shyness' }
  ],
  beats: [{ id: 'b1', at: 62, label: '他推门进来', note: '直接走廊带进来，门在身后关上' }],
  content: '林晚坐在工位上改方案，格子间的灯只亮着她头顶那一盏。身后传来脚步声，她没回头，肩膀却先绷紧了。他不紧不慢地走到她椅背后面，一只手撑在桌上，俯身下来的影子把她整个人罩住。她低下头，耳根一下子烧起来，声音细得像蚊子：“……你、你干嘛。”他没有说话，只是又近了一点，呼吸落在她发顶。她攥紧手里的笔，指节发白，可身体却一点点往后靠，直到后背抵上他的胸膛。他顺势把她从椅子上带起来，转了个身按在桌沿，门在他身后无声合上。她仰头看他，眼尾泛着水光，羞涩地咬住下唇，却还是抬手勾住了他的脖子。',
  updatedAt: 0
}

const cl = buildFulfillChecklist(chapter)
const blocks = segmentText(chapter.content)
const prompt = renderFulfillPrompt(project.name, chapter.num, chapter.title, cl, blocks)
console.log('checklist items:', cl.items.length, '| blocks:', blocks.length, '| content chars:', chapter.content.length)

const res = await fetch(baseUrl + '/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer EMPTY' },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 4000, stream: false })
})
console.log('HTTP', res.status)
const data = await res.json()
const msg = data.choices?.[0]?.message
console.log('--- msg keys:', Object.keys(msg ?? {}))
console.log('--- content len:', (msg?.content ?? '').length, '| reasoning len:', (msg?.reasoning ?? '').length)
const raw = msg?.content ?? msg?.reasoning ?? ''
console.log('--- content tail: ---\n' + (msg?.content ?? '(none)').slice(-1200))
console.log('--- reasoning tail ---\n' + (msg?.reasoning ?? '(none)').slice(-1600))
const report = parseFulfillReport(raw, cl)
console.log('--- parsed ---')
console.log('met:', report.met, 'partial:', report.partial, 'miss:', report.miss, 'unknown:', report.unknown)
const md = renderFulfillReport(project.name, chapter, cl, report)
console.log('--- rendered (first 1200) ---\n' + md.slice(0, 1200))
