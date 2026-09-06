// ===== 织卷 · 分幕草稿 → 正文（采纳）纯函数 =====
// 「分幕生成」的草稿（大纲/<章>_分幕.md）要采纳为本章正文时，把草稿的正文段提出来：
// 剥约定头、剥草稿自己的「（分幕草稿）」标题行、剥来源注记（> 由「分幕生成」…）；
// 采纳时保留本章原有约定头与题名标题，只换正文主体（草稿本身保留，可再改再采纳）。
import { extractFrontMatter, serializeFrontMatter } from './fmatter'

/** 从分幕草稿里提出纯正文段（剥约定头＋「（分幕草稿）」题名行＋来源注记） */
export function extractActsBody(draft: string): string {
  const { body } = extractFrontMatter(draft)
  const lines = body.split('\n')
  const out: string[] = []
  let droppedTitle = false
  for (const line of lines) {
    // 剥草稿自己的题名行（首个一级标题）
    if (!droppedTitle && /^#\s/.test(line)) {
      droppedTitle = true
      continue
    }
    // 剥来源注记（> 由「分幕生成」…）；正文里如果恰好有 > 引用（对话等）不会误删
    if (/^>\s*由「分幕生成」/.test(line)) continue
    out.push(line)
  }
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
