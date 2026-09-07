// ===== 织卷 · 分幕生成（V1 M2.2「逐幕生成」在 V2 的落点，M6 导演引擎回接的收笔一步） =====
// 「先设定后成文」的收笔：有了导演板后，把全章按导演板情绪弧分段**逐段**交给写作引擎成文——
// 一段一个独立请求（真正的外部续写上下文），本段的戏剧任务是硬指令，段尾文末承接下一段，
// 最后把各段拼成本章**定稿草稿**落 大纲/<章>_分幕.md（与章卡/导演板同约定：写作副产物·直写）。
// 草稿不进正文：正文仍是作者的地盘，改正文始终走 zj_edit_doc → EditCard 的采纳口径，「采纳为正文」也已接上（doc:adoptActs）。
// 请求小而准：每段材料只有 本段指令＋全章红线＋前段末文（或板子上下文）＋**首段另带上一章结尾**，不叠 buildWritingContext。
import { readDoc, listChapters, writeDoc } from '../store'
import { registerCapability, runOnce, subtaskBlocked, type SubtaskDef } from './subtask'
import { directorRel } from './director'
import { parseDirectorSheet } from '../../shared/boardParse'
import { extractFrontMatter, serializeFrontMatter } from '../../shared/fmatter'
import { countWords } from '../../shared/count'
import type { ChapterEntry } from '../../shared/types'

/** 分幕草稿落盘位置：大纲/<章名>_分幕.md（与章卡、导演板平级，写作副产物） */
export function actsRel(c: ChapterEntry): string {
  return '大纲/' + c.name + '_分幕.md'
}

export type ActsResult =
  | { ok: true; written: string; acts: number; words: number }
  | { ok: false; error: string }

export interface ActArg {
  index: number // 第几段（从 1 起）
  total: number
  arc: { task: string; goal: string }
  redlines: string[]
  premise: string
  atClimax: boolean
  prevTail: string
}

const MAX_ACTS = 5
const TAIL = 900 // 每段文末带进下一段作为承接的字数
const MIN_ACT = 120 // 一段写得比这还短就当没写好，重试一次

function actSystem(): string {
  return (
    '你是织卷的「执笔人」。现在要把一章正文**按导演板的情绪弧分段逐段写出来**——每一段就是一个独立的\n' +
    '写作任务，本段只写本段，前面已经写过的内容不要重复，后面还没轮到的段落不要提前写。\n' +
    '每一段都要写成**成型的具体正文**：有明确的动作、有对话、有事件推进，用场面写，不要用“她意识到……”' +
    '式的概括句；段尾留一个情绪或事态的承接点，方便下一段接着写。'
  )
}

export function actPrompt(a: ActArg): string {
  const lines: string[] = []
  lines.push(`【本段戏剧任务】第 ${a.index} / ${a.total} 段：**${a.arc.task}**。本段要走到：${a.arc.goal}`)
  if (a.atClimax) lines.push('本段是全章的波峰段：必须在段内把波峰事件写出来并写实，正面给到，别绕开、别抽象带过。')
  if (a.redlines.length) {
    lines.push('【全章写作红线（本段也要守）】' + a.redlines.map((r) => `\n- ${r}`).join(''))
  }
  if (a.index === 1) {
    if (a.premise) lines.push(`【章节前情】本章戏剧任务一句话：${a.premise}`)
    if (a.prevTail) {
      lines.push(
        `【上一章结尾】(上一章的结尾约 ${TAIL} 字。本章从它接着往下写：延续上一章末尾的情景、在场与情绪继续推进，别把上一章发生过的事当背景重新叙述，也别从更早的时间点重新开场)\n${a.prevTail}`
      )
    }
  } else if (a.prevTail) {
    lines.push(`【前文承接】（上一段的结尾约 ${TAIL} 字，从它接着往后写，别重复前面的内容）\n${a.prevTail}`)
  }
  lines.push('只输出这一段要写的正文 markdown 本身：不要输出任何标题、编号、任务说明或解释；不要用 markdown 围栏。')
  return lines.join('\n\n')
}

/** 单段任务：分幕生成的整段开关走「分幕生成」一个（能力注册在底部） */
const actDef: SubtaskDef<string> = {
  id: 'acts',
  title: '分幕生成',
  description: '按导演板情绪弧分段逐段起草整章正文，拼成定稿草稿落 大纲/<章>_分幕.md',
  maxMs: 8 * 60 * 1000,
  buildParts: (c) => [actSystem(), actPrompt(c.args as unknown as ActArg)],
  parse: (text) => (text ? text.trim() : ''),
  retry: {
    check: (r) => (r ? r.length < MIN_ACT : true),
    prompt:
      '刚才那一段的正文写得太短了。重新把这一段写成一段完整的成型正文（要有具体的动作、对话与事件推进），只输出正文本身。'
  }
}
registerCapability(actDef as never)

let actsSeq = 0

/** 按导演板情绪弧分段逐段起草整章，拼成定稿草稿落 大纲/<章>_分幕.md；maxActs 仅供调试/冒烟限段 */
export async function runActs(projectId: string, chapterRel: string, maxActs?: number): Promise<ActsResult> {
  try {
    const blocked = subtaskBlocked('acts', '分幕生成')
    if (blocked) return { ok: false, error: blocked }
    const rel = chapterRel.replace(/^正文\//, '')
    const ch = listChapters(projectId).find((x) => x.file === rel)
    if (!ch) return { ok: false, error: '找不到该章节。' }
    const boardRaw = readDoc(projectId, directorRel(ch))
    if (!boardRaw?.trim()) {
      return { ok: false, error: '本章还没有导演板。先在「大纲区」点「导演本章」生成一张，再回来分幕生成。' }
    }
    const sheet = parseDirectorSheet(boardRaw)
    if (!sheet.arcs.length) return { ok: false, error: '导演板里没有可用分段的情绪弧，先重新「导演本章」。' }
    const arcs = sheet.arcs.slice(0, Math.min(MAX_ACTS, maxActs && maxActs > 0 ? maxActs : MAX_ACTS))
    const redlines = sheet.redlines
    const segs: string[] = []
    // 首段是分段链里唯一没有自带承接的位置：其余各段都有前段末文，首段若只给一句话前情，非首章会冷启动接不上气。
    // 因此首段的 prevTail 用**上一章的结尾**（剥约定头后取末 TAIL 字），让「先设定后成文」从上一章末尾真正续写下去；
    // 写段循环里每段写完会把 prevTail 换成自己末文，接续自然移交。
    let prevTail = ''
    const chNo = ch.fm?.['章号']
    if (typeof chNo === 'number') {
      const prev = listChapters(projectId)
        .filter((x) => x.file !== ch.file && (x.fm?.['章号'] ?? Number.MAX_SAFE_INTEGER) < chNo)
        .sort((a, b) => (b.fm?.['章号'] ?? 0) - (a.fm?.['章号'] ?? 0))[0]
      if (prev) {
        const rawPrev = readDoc(projectId, '正文/' + prev.file) ?? ''
        prevTail = (extractFrontMatter(rawPrev).body ?? '').trim().slice(-TAIL)
      }
    }
    for (let i = 0; i < arcs.length; i++) {
      const seg = await runOnce<string>(actDef, {
        projectId,
        args: {
          index: i + 1,
          total: arcs.length,
          arc: arcs[i],
          redlines,
          premise: sheet.premise,
          atClimax: sheet.climax.at === i + 1,
          prevTail
        } as unknown as Record<string, unknown>,
        seq: actsSeq++
      })
      let t = (seg ?? '').trim()
      // 模型偶尔还是会带标题行或围栏，清掉再拼
      t = t.replace(/^```(?:markdown)?\s*$/gm, '').replace(/^```\s*$/gm, '').replace(/^#+\s+.*$/gm, '').trim()
      if (t) {
        segs.push(t)
        prevTail = t.slice(-TAIL)
      }
    }
    if (!segs.length) return { ok: false, error: '各段都没有写成内容，换个模型或再试一次。' }
    const body = segs.join('\n\n')
    const src = readDoc(projectId, chapterRel) ?? ''
    const fm = extractFrontMatter(src).fm ?? {}
    const draft = buildActsDoc(ch, body, fm)
    const written = actsRel(ch)
    writeDoc(projectId, written, draft)
    return { ok: true, written, acts: segs.length, words: countWords(body) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
  }
}

/** 草稿文档：沿用原章约定头（可直接当正文用），正文前带一行来源注记 */
export function buildActsDoc(c: ChapterEntry, body: string, fm: Record<string, unknown>): string {
  const fmOut: Record<string, unknown> = {
    ...fm,
    状态: '分幕草稿'
  }
  const title = (fm['题名'] as string) ?? c.name
  return (
    serializeFrontMatter(fmOut) +
    '\n' +
    `# ${title}（分幕草稿）\n\n` +
    '> 由「分幕生成」按导演板情绪弧分段逐段写出。确认后把下面的正文部分搬进正文文件即可。\n\n' +
    body +
    '\n'
  )
}
