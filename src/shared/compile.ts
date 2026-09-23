// ===== 织卷 V2 · 作品编译（整书合并导出 Markdown，模块设计 §四 A 扩展） =====
// 产品：正文以「章 md + front matter」存储，作者完成长篇后需要单文件成品（发 beta 读者 /
// 编辑 / 投稿）——Scrivener Compile 官方范式「项目（继续写作）vs 成品（对外交付）」
// 同构（产品调研见 docs/模块推进/03-平台层.md 2026-09-22 22:30 轮）。v1 零依赖纯拼接：
// 剥 front matter（织卷内部半结构化元数据不入成品，与 chapter:export 单章导出同口径）
// ＋ 剥 HTML 注释（分幕缺段占位注释不入成品）＋ 章号/题名作一级标题 ＋ 多线注记。
// v1.1（2026-09-24）：新增 mdToHtml 纯函数＝「导出作品（Word）」的零依赖转换层
// （mac 系统 textutil html→docx 已实证，见 docs/模块推进/03-平台层.md 2026-09-24 01:30 轮；
// 旧结论「docx 需 pandoc=不引」随之修正——textutil 是 mac 内置零依赖路径，win 优雅回退）。
// 约定：调用方负责收集与线名归一（chapterLine，shared/line.ts 单一权威源），本函数只做拼装。

import { extractFrontMatter } from './fmatter'
import { stripHtmlComments } from './comments'
import { DEFAULT_LINE } from './line'

export interface CompileChapterInput {
  /** 显示名（去 .md，如 第01章_雾港栈桥） */
  name: string
  /** 全文（含 front matter） */
  text: string
  /** 归一后的线名（shared/line.ts chapterLine；缺省=主线） */
  line: string
}

export interface CompileOptions {
  /** 非主线章在标题行加「（线：X）」注记（默认 true；多线作品成品里保留归属线索，读者/编辑友好） */
  annotateLines?: boolean
}

/** 章标题：`# 第N章 题名`；无章号 → `# 题名`；题名缺失 → 回退显示名。
 * 非主线且开启注记时标题尾加「（线：X）」。 */
function chapterHeading(name: string, fm: Record<string, unknown> | null, line: string, annotate: boolean): string {
  let head = ''
  const no = fm?.['章号'] != null ? String(fm['章号']).trim() : ''
  const title = fm?.['题名'] != null ? String(fm['题名']).trim() : ''
  const base = title || name
  head = no ? `第${no}章 ${base}` : base
  if (annotate && line && line !== DEFAULT_LINE) head += `（线：${line}）`
  return head
}

/**
 * 章正文（成品形态）：剥 front matter + stripHtmlComments 后 trim。
 * 判定「空章」（跳过别占位）与 main 侧统计一律走这里，保证与 compileNovel 实际产出同口径。
 */
export function chapterBodyOf(text: string): string {
  const { body } = extractFrontMatter(text)
  return stripHtmlComments(body).trim()
}

/**
 * 把整卷章节拼成单文件 Markdown 成品。
 * - 按给定顺序拼接（调用方 = store.listChapters 同口径，文件名「第N章」序）；
 * - 每章剥 front matter + stripHtmlComments 后 trim；空章（剥后无内容）跳过不占位；
 * - 章间空一行；无任何章节 → 空串（调用方按「没有可导出的正文」提示）。
 */
export function compileNovel(chapters: CompileChapterInput[], opts: CompileOptions = {}): string {
  const annotate = opts.annotateLines !== false
  const parts: string[] = []
  for (const c of chapters) {
    const { fm } = extractFrontMatter(c.text)
    const clean = chapterBodyOf(c.text)
    if (!clean) continue
    parts.push(`# ${chapterHeading(c.name, fm, c.line, annotate)}\n\n${clean}`)
  }
  return parts.length ? parts.join('\n\n') + '\n' : ''
}

/** 行内标记：& < > 引号转义后，按 **加粗** → `<strong>`、`代码` → `<code>`、*斜体* → `<em>` 顺序替换。
 * 转义先于强调：插入的标签含 `<` 但已无 `*` 冲突（强调符非 `<>`）。 */
function inlineMd(s: string): string {
  let t = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  t = t.replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/`([^`\n]+?)`/g, '<code>$1</code>')
  t = t.replace(/\*([^\n*]+?)\*/g, '<em>$1</em>')
  return t
}

/**
 * 极简 Markdown→HTML（零依赖；「导出作品（Word）」经 mac 系统 textutil 走 html→docx 的转换层）。
 * 只覆盖小说成品常见标记：标题（#…######，块内只取首行）、段落（空行分隔）、
 * 无序列表（- / *）、引用（>）、分割线（---）、**加粗**、*斜体*、`代码`；
 * 其余按纯文本输出（代码块/表格/链接等成品导出不需要，不铺张；确定性、可单测）。
 * 输出带完整 html 骨架（charset utf-8）——textutil 直接吃此文件。
 */
export function mdToHtml(md: string): string {
  if (!md) return ''
  const blocks = md.replace(/\r\n?/g, '\n').split(/\n{2,}/)
  const out: string[] = []
  for (const raw of blocks) {
    const lines = raw.split('\n').map((l) => l.trimEnd())
    const first = lines[0] ?? ''
    const h = /^(#{1,6})\s+(.+)$/.exec(first)
    if (h) {
      out.push(`<h${h[1].length}>${inlineMd(first.slice(h[1].length + 1))}</h${h[1].length}>`)
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(first.trim())) {
      out.push('<hr/>')
      continue
    }
    if (/^\s*[-*]\s+/.test(first)) {
      const items = lines
        .filter((l) => /^\s*[-*]\s+/.test(l))
        .map((l) => `<li>${inlineMd(l.replace(/^\s*[-*]\s+/, ''))}</li>`)
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }
    if (/^>\s?/.test(first)) {
      out.push(`<blockquote>${lines.map((l) => inlineMd(l.replace(/^>\s?/, ''))).join('<br/>')}</blockquote>`)
      continue
    }
    out.push(`<p>${lines.map((l) => inlineMd(l)).join('\n')}</p>`)
  }
  return `<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"/></head>\n<body>\n${out.join('\n')}\n</body>\n</html>\n`
}
