// ===== 织卷 · 正文字数（真实成形） =====
// 去掉 front matter、章首「本章故事要素」指引块与 Markdown 语义标记（标题#、引用>、列表、围栏、
// 行内标记、链接标注），只计「可见字符」数。各端的章节列表、章卡、检查都用这里，保证口径一致。
// HTML 注释（`<!-- … -->`＝元信息/占位提示，2026-09-11 comments 语义）不在正文里「可见」，不计入。
import { stripHtmlComments } from './comments'

const FRONT_MATTER = /^---\n[\s\S]*?\n---\s*(\n|$)/
/** 建章写入的「本章故事要素」指引块首行（Novel.createChapter，D-V2-7）。
 *  容忍 Milkdown 序列化后的转义形态：编辑器回写会把 `==` 存成 `\==`（`> \== 本章故事要素 ==`），
 *  所以 `=` 前的反斜杠可选——不认这个形态，「保存一次后字数又虚高」（实踩）。 */
const GUIDE_HEAD = /^\s*>\s*\\?==\s*本章故事要素/

/**
 * 剥约定头 + 正文体首部的「本章故事要素」引用块，返回纯正文体文本。
 *
 * 为什么剥（F-20261027-02，2026-10-28 创作层）：建章时写入的
 * `> == 本章故事要素 ==`（目标/核心冲突/关键事件/前情呼应 + 一行写作指引）是**写作指引**，
 * 不是成品故事正文；不剥会让新建章未动笔就显示「58 字」，中篇写到二十章虚高近千字，
 * 按字数推进的写作节奏与全书进度就失真了。
 *
 * 只认「正文体首个非空行就是要素块首行」这一形态（建章产出）：剥到该引用块结束后的首个
 * 非引用行为止。正文中间的引用块、作者改写成别的块形一律不动——非该形态零影响。
 */
export function stripChapterGuideBlock(text: string): string {
  const body = String(text).replace(FRONT_MATTER, '')
  const lines = body.split('\n')
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  if (i >= lines.length || !GUIDE_HEAD.test(lines[i])) return body
  let j = i
  while (j < lines.length && /^\s*>/.test(lines[j])) j++
  while (j < lines.length && lines[j].trim() === '') j++
  return lines.slice(j).join('\n')
}

export function countWords(text: string): number {
  const body = stripHtmlComments(stripChapterGuideBlock(text))
  let n = 0
  for (let line of body.split('\n')) {
    line = line.replace(/^\s*#{1,6}\s*/, '')
    line = line.replace(/^\s*>+\s?/, '')
    line = line.replace(/^\s*[-*+]\s+/, '')
    line = line.replace(/^\s*\d+\.\s+/, '')
    line = line.replace(/^\s*```.*/, '')
    line = line.replace(/(^|\s)```.*/, '')
    line = line.replace(/[`*_~]/g, '')
    line = line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // 中文与标点按“字”，连续西文字母数字按“一个词”计（写作软件通行的正文字数口径）
    line = line.replace(/[A-Za-z0-9][A-Za-z0-9\-_.]*/g, 'a')
    line = line.replace(/\s+/g, '')
    n += line.length
  }
  return n
}