// ===== 织卷 · 导演兑现检查（V1 兑现检查回接到 V2 导演板的第二步） =====
// 「先设定后成文」的闭环收尾：一章正文写出来后，用写作引擎对照本章导演板逐项核对——
// 情绪弧分段是否兑现、行为轴是否守位、红线有没有被破、钩子有没有还。
// 与导演板同素材（同为 V1 导演语汇），但**只读不写**：结果是给作者看的核对报告，
// 走独立 session + 结构化 JSON（与本章小环同构），经 IPC 回 UI 展示；导演板才是落盘副产物。
import { readDoc, listChapters } from '../store'
import { registerCapability, runSubtask, stripFm, clip, type SubtaskDef } from './subtask'
import { directorRel } from './director'
import type { ChapterEntry, DirectorCheckResult, DirectorCheckItem } from '../../shared/types'
import { extractFrontMatter } from '../../shared/fmatter'

export type { DirectorCheckResult }

const ARC_S = new Set(['done', 'partial', 'missed'])
const AXIS_S = new Set(['aligned', 'drifted', 'absent'])
const RED_S = new Set(['kept', 'broken'])
const HOOK_S = new Set(['paid', 'open', 'new'])

function checkSystem(cast: string[]): string {
  return (
    '你是织卷的「导演兑现检查员」。一章正文已经写出来了；动笔前曾为这一章导出一张导演板（情绪弧分段 + 每段戏剧任务 + 波峰 + 人物行为轴 + 写作红线 + 钩子）。\n' +
    '你现在对照导演板逐项核对这章正文到底兑现了几分，让导演承诺要么落地、要么被明确看出落差。\n' +
    '只依据下面给出的导演板与本章正文判断，不要臆测、不要替作者补写；每条的判据要能在正文里找到对应。\n' +
    (cast.length ? `axes 里的人物只能从本章涉事清单挑（每个涉事人物最多一条）：${cast.join('、')}\n` : '') +
    '\n整个回答只能是下面这个 JSON 对象，一个字都不要写在 JSON 之外（不要 markdown 围栏，不要任何前后缀文字）：\n' +
    '{\n' +
    '  "summary": "一段话：本章整体兑现得如何，最需要回头补的那一处是什么（一句自然话）",\n' +
    '  "arcs": [{"ref":"导演板里该段的一句话原文","status":"done|partial|missed","note":"对照正文哪里怎么判的（一句）"}],\n' +
    '  "axes": [{"character":"人物名（只能从涉事清单挑）","ref":"该人物行为轴的一句话原文","status":"aligned|drifted|absent","note":"对照正文哪里怎么判的（一句）"}],\n' +
    '  "redlines": [{"ref":"红线的一句话原文","status":"kept|broken","note":"对照正文哪里怎么判的（一句）"}],\n' +
    '  "hooks": [{"ref":"钩子的一句话原文","status":"paid|open|new","note":"对照正文哪里怎么判的（一句）"}]\n' +
    '}\n' +
    '要求：arcs 按导演板段落逐段给，最多 5 条；axes 最多 8 条；redlines 最多 5 条；hooks 最多 3 条；' +
    '各字段用一句自然话说清，不要展开成段落；正文确实没写到的段落如实给 missed / absent / open。'
  )
}

/** 从模型回复稳健提取兑现检查结果（各类状态白名单清洗 + 条数上限 + axes 人物只在涉事清单里留） */
export function extractDirectorCheck(text: string, cast?: string[]): DirectorCheckResult {
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
  const known = cast?.length ? new Set(cast) : null
  const common = (x: any) => ({ ref: str(x?.ref).slice(0, 120), status: str(x?.status), note: str(x?.note).slice(0, 140) })
  const pick = (v: unknown, avail: Set<string>, n: number, isAxis = false): DirectorCheckItem[] =>
    (Array.isArray(v) ? v : [])
      .filter((x) => str(x?.ref) && avail.has(str(x?.status)) && (!isAxis || !known || known.has(str(x?.character))))
      .map(common)
      .slice(0, n)
  return {
    summary: str(obj?.summary).slice(0, 500),
    arcs: pick(obj?.arcs, ARC_S, 5),
    axes: pick(obj?.axes, AXIS_S, 8, true),
    redlines: pick(obj?.redlines, RED_S, 5),
    hooks: pick(obj?.hooks, HOOK_S, 3)
  }
}

const directorCheckDef: SubtaskDef<DirectorCheckResult> = {
  id: 'director-check',
  title: '导演兑现检查',
  description: '动笔后对照导演板核对：情绪弧是否兑现、行为轴是否守位、红线有没有破、钩子有没有还',
  maxMs: 6 * 60 * 1000,
  buildParts: (c) => {
    const chapterRel = String(c.args?.chapterRel ?? '')
    const boardRel = String(c.args?.boardRel ?? '')
    const cast = Array.isArray(c.args?.cast) ? (c.args?.cast as string[]).filter(Boolean) : []
    const raw = readDoc(c.projectId, chapterRel) ?? ''
    const body = stripFm(raw)
    if (!body.trim()) throw new Error('当前章节还没有内容，先写一段再来做兑现检查。')
    const board = stripFm(readDoc(c.projectId, boardRel) ?? '')
    if (!board.trim()) throw new Error('本章还没有导演板，先点「导演本章」生成一张再来做兑现检查。')
    return [
      checkSystem(cast),
      `【本章导演板】\n${clip(board, 2000, 1000)}`,
      `【本章正文】（可能截取了首尾）\n${clip(body, 8000, 1500)}`,
      '请给出导演兑现检查的 JSON。'
    ]
  },
  parse: (text, c) => extractDirectorCheck(text, Array.isArray(c.args?.cast) ? (c.args?.cast as string[]) : []),
  retry: {
    check: (r) => !r.summary && !r.arcs.length && !r.redlines.length,
    prompt: '上次输出没有被解析成要求的 JSON。这次只输出一个 JSON 对象，先写左花括号 {，要求：summary 必有、各数组按导演板条目给（正文确实没写的如实标 missed / absent / open），不要任何前后缀文字。'
  }
}
registerCapability(directorCheckDef as never)

/** 对照本章导演板做一次兑现检查（结果只在内存返回给 UI，不落盘） */
export async function runDirectorCheck(
  projectId: string,
  chapterRel: string
): Promise<{ ok: true; result: DirectorCheckResult; lastRaw?: string } | { ok: false; error: string }> {
  const rel = chapterRel.replace(/^正文\//, '')
  const ch: ChapterEntry | undefined = listChapters(projectId).find((x) => x.file === rel)
  if (!ch) return { ok: false, error: '找不到该章节。' }
  const boardRaw = readDoc(projectId, directorRel(ch))
  if (!boardRaw?.trim()) {
    return { ok: false, error: '本章还没有导演板。先在「大纲区」点「导演本章」生成一张，再回来做兑现检查。' }
  }
  const fm = extractFrontMatter(readDoc(projectId, chapterRel) ?? '').fm as Record<string, unknown>
  const cast = Array.isArray(fm?.['涉及人物']) ? (fm?.['涉及人物'] as string[]) : []
  try {
    const out = await runSubtask(directorCheckDef as never, projectId, { chapterRel, boardRel: directorRel(ch), cast })
    if (!out.ok) return { ok: false, error: out.error }
    return { ok: true, result: out.result as DirectorCheckResult, ...(out.lastRaw ? { lastRaw: out.lastRaw } : {}) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
  }
}
