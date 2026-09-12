// ===== 织卷 · 分幕生成（V1 M2.2「逐幕生成」在 V2 的落点，M6 导演引擎回接的收笔一步） =====
// 「先设定后成文」的收笔：有了导演板后，把全章按导演板情绪弧分段**逐段**交给写作引擎成文——
// 一段一个独立请求（真正的外部续写上下文），本段的戏剧任务是硬指令，段尾文末承接下一段，
// 最后把各段拼成本章**定稿草稿**落 大纲/<章>_分幕.md（与章卡/导演板同约定：写作副产物·直写）。
// 草稿不进正文：正文仍是作者的地盘，改正文始终走 zj_edit_doc → EditCard 的采纳口径，「采纳为正文」也已接上（doc:adoptActs）。
// 请求小而准：每段材料只有 本段指令＋全章红线＋前段末文（或板子上下文）＋**首段另带上一章结尾**，不叠 buildWritingContext。
import { readDoc, listChapters, writeDoc } from '../store'
import { registerCapability, runOnceInner, subtaskBlocked, type SubtaskDef } from './subtask'
import { directorRel } from './director'
import { parseDirectorSheet } from '../../shared/boardParse'
import { extractFrontMatter, serializeFrontMatter } from '../../shared/fmatter'
import { countWords } from '../../shared/count'
import { renderActsSegs, splitActsBody, parseActsWarn, type ActSeg } from '../../shared/actsSeg'
import type { ChapterEntry } from '../../shared/types'

/** 分幕草稿落盘位置：大纲/<章名>_分幕.md（与章卡、导演板平级，写作副产物） */
export function actsRel(c: ChapterEntry): string {
  return '大纲/' + c.name + '_分幕.md'
}

export type ActsResult =
  | { ok: true; written: string; acts: number; words: number; failed?: number[]; /** 诊断：失败段的模型原始回复（段号→原文） */ failedRaw?: Record<number, string> }
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

/** 分幕运行选项：only 指定只重写这几个段号；onlyFailed 从现有草稿读缺段警示自动重写失败段。
 *  两者都要求草稿已按段标记（## 第 N 段）写出——旧版无标记草稿会提示重跑全量。 */
export interface ActsRunOpts {
  only?: number[]
  onlyFailed?: boolean
}

/** 按导演板情绪弧分段逐段起草整章，拼成定稿草稿落 大纲/<章>_分幕.md；maxActs 仅供调试/冒烟限段；
 *  onPrompt 是只读观测钩子（冒烟/排障用）：每段请求拼好提示词后回调（index 从 1 起），不参与流程。 */
export async function runActs(
  projectId: string,
  chapterRel: string,
  maxActs?: number,
  onPrompt?: (index: number, prompt: string) => void,
  opts?: ActsRunOpts
): Promise<ActsResult> {
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
    const isRepair = !!(opts?.only || opts?.onlyFailed)

    // 上一章结尾（剥约定头后取末 TAIL 字）：首段唯一没有自带承接的位置，非首章冷启动从这里接上气
    let prevChTail = ''
    const chNo = Number(ch.fm?.['章号'])
    if (Number.isFinite(chNo)) {
      const prev = listChapters(projectId)
        .filter((x) => x.file !== ch.file && (x.fm?.['章号'] ?? Number.MAX_SAFE_INTEGER) < chNo)
        .sort((a, b) => (b.fm?.['章号'] ?? 0) - (a.fm?.['章号'] ?? 0))[0]
      if (prev) {
        const rawPrev = readDoc(projectId, '正文/' + prev.file) ?? ''
        prevChTail = (extractFrontMatter(rawPrev).body ?? '').trim().slice(-TAIL)
      }
    }

    /** 单段生成：拼指令→驱动→清洗；达到 MIN_ACT 才算写成，否则返回 null 并附原始回复（诊断失败原因用） */
    const genSeg = async (index: number, prevTail: string): Promise<{ t: string | null; raw: string }> => {
      const arg: ActArg = {
        index,
        total: arcs.length,
        arc: arcs[index - 1],
        redlines,
        premise: sheet.premise,
        atClimax: sheet.climax.at === index,
        prevTail
      }
      onPrompt?.(index, actPrompt(arg))
      const out = await runOnceInner<string>(actDef, {
        projectId,
        args: arg as unknown as Record<string, unknown>,
        seq: actsSeq++
      })
      let t = (out.value ?? '').trim()
      // 模型偶尔还是会带标题行或围栏，清掉再拼
      t = t.replace(/^```(?:markdown)?\s*$/gm, '').replace(/^```\s*$/gm, '').replace(/^#+\s+.*$/gm, '').trim()
      return { t: t.length >= MIN_ACT ? t : null, raw: out.lastRaw }
    }

    let finalSegs: ActSeg[] = []
    const failed: number[] = []
    const failedRaw: Record<number, string> = {}

    if (isRepair) {
      // ── 补写缺段/重写指定段：只动目标段，已写成的段原样保留（每段生成约一轮完整请求，重跑全量太浪费） ──
      // 只重写是「在现有草稿上动刀」：没有草稿、或草稿是旧格式（无分段标记无法定位）都直接报错，
      // 绝不静默地用只含目标段的空草稿把原稿盖掉。
      const draftRaw = readDoc(projectId, actsRel(ch)) ?? ''
      if (!draftRaw.trim()) {
        return { ok: false, error: '本章还没有分幕草稿：先点「分幕生成」写出一版，再来只重写指定段。' }
      }
      const existing = splitActsBody(extractFrontMatter(draftRaw).body ?? '')
      if (!existing.size) {
        return { ok: false, error: '这份分幕草稿是旧格式（没有分段标记），无法只补/重写指定段：请重新「分幕生成」。' }
      }
      const warnMissing = opts?.onlyFailed ? parseActsWarn(draftRaw) : []
      const targets = (opts?.only ?? warnMissing)
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= arcs.length)
        .sort((a, b) => a - b)
      if (!targets.length) {
        return { ok: false, error: '没有缺段可补：草稿完整，或不是「分幕生成」产出的缺段草稿。' }
      }
      const segMap = new Map(existing)
      const stillFailed: number[] = []
      for (const idx of targets) {
        // 承接：前一个已存在（或本批刚写好）且编号更小的段末文；重写首段则用上一章结尾
        let pt = ''
        if (idx === 1) {
          pt = prevChTail
        } else {
          for (let j = idx - 1; j >= 1; j--) {
            const s = segMap.get(j)
            if (s) {
              pt = s.slice(-TAIL)
              break
            }
          }
        }
        const seg = await genSeg(idx, pt)
        if (seg.t) segMap.set(idx, seg.t)
        else {
          stillFailed.push(idx)
          failedRaw[idx] = seg.raw
        }
      }
      finalSegs = [...segMap.entries()]
        .filter(([idx]) => idx >= 1 && idx <= arcs.length)
        .map(([index, text]) => ({ index, text: text.trim() }))
        .sort((a, b) => a.index - b.index)
      failed.push(...stillFailed)
    } else {
      // ── 全量分幕：按板子弧数逐段起草 ──
      let prevTail = prevChTail
      for (let i = 0; i < arcs.length; i++) {
        const seg = await genSeg(i + 1, prevTail)
        if (seg.t) {
          finalSegs.push({ index: i + 1, text: seg.t })
          prevTail = seg.t.slice(-TAIL)
        } else {
          failed.push(i + 1)
          failedRaw[i + 1] = seg.raw
        }
      }
    }

    if (!finalSegs.length)
      return { ok: false, error: `各段都没有写成内容（第 ${failed.join('、')} 段失败），换个模型或再试一次。` }
    const body = renderActsSegs(finalSegs)
    const src = readDoc(projectId, chapterRel) ?? ''
    const fm = extractFrontMatter(src).fm ?? {}
    const draft = buildActsDoc(ch, finalSegs, fm, failed.length ? failedNote(failed, arcs.length) : '')
    const written = actsRel(ch)
    writeDoc(projectId, written, draft)
    // 字数口径只计段文本本身（段标记「第 N 段」不是正文，不计入）
    const words = finalSegs.reduce((a, s) => a + countWords(s.text), 0)
    return failed.length
      ? { ok: true, written, acts: finalSegs.length, words, failed, failedRaw }
      : { ok: true, written, acts: finalSegs.length, words }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
  }
}

/** 缺段警示注记：写进草稿开头，让「有洞的草稿」在文件里就被看见，而不是靠人记。 */
export function failedNote(failed: number[], total: number): string {
  return `> ⚠️ 第 ${failed.join('、')} 段未按导演板写成，草稿只含 ${total - failed.length}/${total} 段（缺段处情节会断）。请勿直接采纳：先点「补写缺段」只重写失败段，或手动补齐缺段。`
}

/** 草稿文档：沿用原章约定头（可直接当正文用），正文前带一行来源注记；warn 非空时加一行缺段警示；
 *  正文按「## 第 N 段」标记渲染（actsSeg 约定），可反解析供「补写缺段」定位。 */
export function buildActsDoc(
  c: ChapterEntry,
  segs: ActSeg[],
  fm: Record<string, unknown>,
  warn = ''
): string {
  const fmOut: Record<string, unknown> = {
    ...fm,
    状态: '分幕草稿'
  }
  const title = (fm['题名'] as string) ?? c.name
  return (
    serializeFrontMatter(fmOut) +
    '\n' +
    `# ${title}（分幕草稿）\n\n` +
    '> 由「分幕生成」按导演板情绪弧分段逐段写出。确认后把下面的正文部分搬进正文文件即可。\n' +
    (warn ? warn + '\n' : '') +
    '\n' +
    renderActsSegs(segs) +
    '\n'
  )
}
