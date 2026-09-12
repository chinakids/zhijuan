// ===== 织卷 · 分幕草稿 → 正文（采纳）纯函数 =====
// 「分幕生成」的草稿（大纲/<章>_分幕.md）要采纳为本章正文时，把草稿的正文段提出来：
// 剥约定头、剥草稿自己的「（分幕草稿）」标题行、剥来源注记（> 由「分幕生成」…）；
// 采纳时保留本章原有约定头与题名标题，只换正文主体（草稿本身保留，可再改再采纳）。
// 断链可见性（2026-09-12）：草稿有缺段（> ⚠️ 警示）而仍硬采时，缺段的段号会以占位注释
// 留在正文对应位置（段 n+1 标记行前 / 缺段为末段则正文末尾）——正文为源下断链不再无声。
import { extractFrontMatter, serializeFrontMatter } from './fmatter'
import { ACT_WARN_LINE, ACT_SEG_TITLE_CAP, parseActsWarn, actPlaceholder } from './actsSeg'

/** 从分幕草稿里提出纯正文段（剥约定头＋「（分幕草稿）」题名行＋来源注记/缺段警示＋「## 第 N 段」段标记；
 *  有缺段警示时在缺段处补占位注释（actPlaceholder），无警示保持旧行为（零回归） */
export function extractActsBody(draft: string): string {
  const { body } = extractFrontMatter(draft)
  const missing = [...new Set(parseActsWarn(draft))].sort((a, b) => a - b)
  const lines = body.split('\n')
  const out: string[] = []
  let droppedTitle = false
  let curSeg = 0 // 已见到的最后一个段号（成功段）
  // 在段标记行前补 (curSeg, upTo) 区间内缺失段的占位注释
  const flushMissing = (upTo: number) => {
    for (const n of missing) if (n > curSeg && n < upTo) out.push(actPlaceholder(n))
  }
  for (const line of lines) {
    // 剥草稿自己的题名行（首个一级标题）
    if (!droppedTitle && /^#\s/.test(line)) {
      droppedTitle = true
      continue
    }
    // 剥来源注记（> 由「分幕生成」…）与缺段警示（> ⚠️ …）；正文里如果恰好有 > 引用（对话等）不会误删
    if (/^>\s*由「分幕生成」/.test(line) || ACT_WARN_LINE.test(line)) continue
    // 段标记「## 第 N 段」：采纳进正文不带分幕痕迹；剥标题前在此处补缺段占位
    const segM = ACT_SEG_TITLE_CAP.exec(line)
    if (segM) {
      flushMissing(Number(segM[1]))
      curSeg = Number(segM[1])
      continue
    }
    out.push(line)
  }
  // 缺段号大于所有已见段（末段失败）→ 正文末尾补占位
  for (const n of missing) if (n > curSeg) out.push(actPlaceholder(n))
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export type AdoptResult = { next: string; body: string } | { error: string }

/** 把草稿正文采纳进本章：保留本章约定头与题名（无约定头时只输出题名＋正文），返回可直写的整份文档 */
export function adoptActsChapter(chapterRaw: string, draft: string, fallbackTitle: string): AdoptResult {
  const body = extractActsBody(draft)
  if (!body) return { error: '分幕草稿里没有可用的正文内容' }
  const fm = extractFrontMatter(chapterRaw).fm
  const title = (fm?.['题名'] as string) || fallbackTitle
  const next = (fm ? serializeFrontMatter(fm) : '') + `# ${title}\n\n` + body + '\n'
  return { next, body }
}
