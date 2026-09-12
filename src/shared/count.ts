// ===== 织卷 · 正文字数（真实成形） =====
// 去掉 front matter 与 Markdown 语义标记（标题#、引用>、列表、围栏、行内标记、链接标注），
// 只计「可见字符」数。各端的章节列表、章卡、检查都用这里，保证口径一致。
// HTML 注释（`<!-- … -->`＝元信息/占位提示，2026-09-11 comments 语义）不在正文里「可见」，不计入。
import { stripHtmlComments } from './comments'

export function countWords(text: string): number {
  const body = stripHtmlComments(String(text).replace(/^---\n[\s\S]*?\n---\s*(\n|$)/, ''))
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
