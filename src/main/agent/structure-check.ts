// ===== 织卷 · 双线结构点巡检（检查类只读报告；创作层 2026-09-21 12:45 轮落地） =====
// 依据 Weiland 双时间线法则（docs/模块推进/02-创作层.md 2026-09-21 03:45/06:45/09:45 轮规格）：
// 每条线需要自己的 plot points（⑤每条线自己的 25/50/75% 结构点）、早线应在晚线高潮前收束 loose ends（⑥）。
// 输入=全书章卡（大纲/<章>.md）+ 导演板（大纲/<章>_导演.md），零新字段零新数据结构、不动正文；
// 输出=只读 JSON 报告（结构点分布 + 早线收束检查），走独立 session + 结构化 JSON（与导演兑现检查同构），
// 经 IPC 回 UI 展示；不落盘。载体=创作层（章卡/导演板=写作副产物域）。
// 材料预算（2026-09-21 09:45 轮真实档校准）：逐章「章卡 clip 600 + 导演板 clip 1100」（实测章卡
// 384-542、导演板 825-1044 非空白字符；>30 章再评估分批，登记不预做）。
import { readDoc, listChapters } from '../store'
import { registerCapability, runSubtask, stripFm, clip, type SubtaskDef } from './subtask'
import { listOutlineDocs } from './outline'
import { chapterLine, DEFAULT_LINE } from '../../shared/line'
import { parseOutlineCard } from '../../shared/outline'
import type { StructureCheckResult, StructureLinePoint } from '../../shared/types'

export type { StructureCheckResult }

const END_S = new Set(['settled', 'loose'])
const POINT_MAX = 8
const END_MAX = 4
const NOTE_MAX = 8

function checkSystem(lines: string[], noBoard: string[]): string {
  const lineList = lines.length ? lines.join('、') : DEFAULT_LINE
  return (
    '你是织卷的「结构点巡检员」。给你一部小说的全部章卡（每章「这一章在全书里干什么」）与导演板（戏剧任务/情绪弧/波峰/钩子），' +
    '每份都标注了它所属的时间线。\n' +
    '任务（按时间线分组，输出两份报告）：\n' +
    'A. 各线结构点分布：哪些章承载这条线的开局/转折/中点/高潮/收束。25%/50%/75% 是全书比例上的经典三幕位置，' +
    '只作参考线；节点身份=你的语义判断（哪个事件是转折点），不评好坏，只描述分布。\n' +
    'B. 早线收束检查（Weiland 双线法则⑥）：若存在两条以上时间线，检查早线（先收束/先结束的那条）的 loose ends ' +
    '是否在晚线高潮前收束——判 settled 必须有两端证据（章卡钩子已还或关键事件收束 + 导演板波峰所在章），' +
    '判 loose 要指明哪个钩子/情节仍悬着；章卡没写≠没收束，不得臆测正文。单线项目 ends 给空数组。\n' +
    `时间线清单（线名只能从这些里挑）：${lineList}\n` +
    (noBoard.length ? `以下章节没有导演板（结构点仅依据章卡判断）：${noBoard.join('、')}\n` : '') +
    '只依据给出的章卡与导演板判断，不要臆测正文、不要替作者补写。\n' +
    '整个回答只能是下面这个 JSON 对象，一个字都不要写在 JSON 之外（不要 markdown 围栏，不要任何前后缀文字）：\n' +
    '{\n' +
    '  "summary": "一段话：全书结构整体如何，最值得回头看的那处是什么（一句自然话）",\n' +
    '  "lines": [{"name":"线名（只能从时间线清单挑）","points":[{"chapter":"章号或题名","role":"开局|转折|中点|高潮|收束等","note":"一句"}],"pacingNote":"该线节奏/分布的一句话观察（可选）"}],\n' +
    '  "ends": [{"line":"早线名","status":"settled|loose","evidence":"两端证据：钩子/关键事件收束 + 波峰所在章","note":"一句建议（可选）"}],\n' +
    '  "notes": ["其他值得看的发现（一句）"]\n' +
    '}\n' +
    `要求：lines 每条线最多 ${POINT_MAX} 个点、最多列 4 条线；ends 最多 ${END_MAX} 条；notes 最多 ${NOTE_MAX} 条；` +
    '各字段用一句自然话说清，不要展开成段落；没有值得写的给空数组。'
  )
}

/** 从模型回复稳健提取结构点巡检结果（线名只在已知清单里留 + ends 状态白名单 + 条数上限 + 字段截断清洗） */
export function extractStructureCheck(text: string, knownLines?: ReadonlySet<string>): StructureCheckResult {
  let obj: any = null
  try {
    obj = JSON.parse(text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim())
  } catch {}
  if (!obj) {
    const a = text.indexOf('{')
    const b = text.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        obj = JSON.parse(text.slice(a, b + 1))
      } catch {}
    }
  }
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const known = knownLines?.size ? knownLines : null
  const pointOf = (x: any): StructureLinePoint => ({
    chapter: str(x?.chapter).slice(0, 80),
    role: str(x?.role).slice(0, 60),
    note: str(x?.note).slice(0, 140)
  })
  const lines: StructureCheckResult['lines'] = (Array.isArray(obj?.lines) ? obj.lines : [])
    .filter((x: any) => {
      const n = str(x?.name)
      return !!n && (!known || known.has(n))
    })
    .map((x: any) => {
      const pts = (Array.isArray(x?.points) ? x.points : []).map(pointOf).filter((p: StructureLinePoint) => !!p.chapter || !!p.role).slice(0, POINT_MAX)
      const entry: StructureLineReportIn = {
        name: str(x?.name),
        points: pts
      }
      const pn = str(x?.pacingNote).slice(0, 160)
      if (pn) entry.pacingNote = pn
      return entry
    })
    .slice(0, 4)
  const ends: StructureCheckResult['ends'] = (Array.isArray(obj?.ends) ? obj.ends : [])
    .filter((x: any) => {
      const n = str(x?.line)
      return !!n && (!known || known.has(n)) && END_S.has(str(x?.status))
    })
    .map((x: any) => {
      const e: any = { line: str(x?.line), status: str(x?.status), evidence: str(x?.evidence).slice(0, 300) }
      const nt = str(x?.note).slice(0, 160)
      if (nt) e.note = nt
      return e
    })
    .slice(0, END_MAX)
  const notes = (Array.isArray(obj?.notes) ? obj.notes : [])
    .map((x: unknown) => str(x).slice(0, 160))
    .filter(Boolean)
    .slice(0, NOTE_MAX)
  return {
    summary: str(obj?.summary).slice(0, 500),
    lines,
    ends,
    ...(notes.length ? { notes } : {})
  }
}
interface StructureLineReportIn {
  name: string
  points: StructureLinePoint[]
  pacingNote?: string
}

function collectCards(projectId: string): { names: string[]; cards: Map<string, { line: string; no?: number; title: string }> } {
  const names = listChapters(projectId).map((c) => c.name)
  const cards = new Map<string, { line: string; no?: number; title: string }>()
  const outlineSet = new Set(listOutlineDocs(projectId))
  for (const name of names) {
    const rel = '大纲/' + name + '.md'
    if (!outlineSet.has(rel)) continue
    const card = parseOutlineCard(readDoc(projectId, rel) ?? '', rel)
    if (!card) continue
    cards.set(name, { line: chapterLine({ 时间线: card.line }), no: card.no, title: card.title })
  }
  return { names, cards }
}

const structureCheckDef: SubtaskDef<StructureCheckResult> = {
  id: 'structure-check',
  title: '双线结构点巡检',
  description: '按时间线核对全书结构点分布与早线收束状态（只读报告，不动稿）',
  // 8min＝检查域主流档（audit/perspectives/chapterCheck/director-check 同档）：材料=全书章卡+导演板
  // （20 章≈3.2 万非空白字符）比 director-check 更重，但输出=结构点枚举+收束判定（检查类），
  // 慢车期间风险同章对齐；本轮按域内一致不单独分层（若慢车期仍不足再按 kind 分层，focus 先例）。
  maxMs: 8 * 60 * 1000,
  buildParts: (c) => {
    const { cards } = collectCards(c.projectId)
    if (!cards.size) throw new Error('大纲区还没有章卡。先在「大纲区」点「回建」生成章卡，再来做结构点巡检。')
    const lines = [...new Set([...cards.values()].map((x) => x.line))]
    if (!lines.includes(DEFAULT_LINE)) lines.unshift(DEFAULT_LINE)
    const noBoard: string[] = []
    const sorted = [...cards.entries()].sort((a, b) => (a[1].no ?? 0) - (b[1].no ?? 0))
    const parts: string[] = []
    for (const [name, info] of sorted) {
      const cardRaw = stripFm(readDoc(c.projectId, '大纲/' + name + '.md') ?? '')
      const boardRaw = stripFm(readDoc(c.projectId, '大纲/' + name + '_导演.md') ?? '')
      if (!boardRaw.trim()) noBoard.push(name)
      parts.push(
        `【第${info.no ?? '?'}章 · ${info.title}】（时间线：${info.line}）\n` +
          `▸ 章卡\n${clip(cardRaw, 600, 0)}\n` +
          `▸ 导演板\n${boardRaw.trim() ? clip(boardRaw, 1100, 0) : '（本章还没有导演板）'}`
      )
    }
    return [checkSystem(lines, noBoard), '【全书章节材料（按章序）】\n\n' + parts.join('\n\n'), '请给出结构点巡检的 JSON。']
  },
  parse: (text, c) => {
    const raw = (c.args ?? {}) as { lines?: unknown }
    const lineList = Array.isArray(raw.lines) ? (raw.lines as string[]).filter((x): x is string => typeof x === 'string') : []
    return extractStructureCheck(text, new Set(lineList))
  },
  retry: {
    check: (r) => !r.summary && !r.lines.length && !r.ends.length,
    prompt: '上次输出没有被解析成要求的 JSON。这次只输出一个 JSON 对象，先写左花括号 {，要求：summary 必有、lines/ends 按上面字段给（确实没有的给空数组），不要任何前后缀文字。'
  }
}
registerCapability(structureCheckDef as never)

/** 全书结构点巡检（结果只在内存返回给 UI，不落盘） */
export async function runStructureCheck(
  projectId: string
): Promise<{ ok: true; result: StructureCheckResult; lastRaw?: string } | { ok: false; error: string }> {
  const { names, cards } = collectCards(projectId)
  if (!names.length) return { ok: false, error: '项目里还没有章节。先在「正文」页新建章节，再来做结构点巡检。' }
  if (!cards.size) {
    return { ok: false, error: '大纲区还没有章卡。先在「大纲区」点「回建」生成章卡，再来做结构点巡检。' }
  }
  const lines = [...new Set([...cards.values()].map((x) => x.line))]
  if (!lines.includes(DEFAULT_LINE)) lines.unshift(DEFAULT_LINE)
  try {
    const out = await runSubtask(structureCheckDef as never, projectId, { lines, noBoard: [] } as unknown as Record<string, unknown>)
    if (!out.ok) return { ok: false, error: out.error }
    return { ok: true, result: out.result as StructureCheckResult, ...(out.lastRaw ? { lastRaw: out.lastRaw } : {}) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
  }
}
