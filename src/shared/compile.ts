// ===== 织卷 V2 · 作品编译（整书合并导出 Markdown，模块设计 §四 A 扩展） =====
// 产品：正文以「章 md + front matter」存储，作者完成长篇后需要单文件成品（发 beta 读者 /
// 编辑 / 投稿）——Scrivener Compile 官方范式「项目（继续写作）vs 成品（对外交付）」
// 同构（产品调研见 docs/模块推进/03-平台层.md 2026-09-22 22:30 轮）。v1 零依赖纯拼接：
// 剥 front matter（织卷内部半结构化元数据不入成品，与 chapter:export 单章导出同口径）
// ＋ 剥 HTML 注释（分幕缺段占位注释不入成品）＋ 章号/题名作一级标题 ＋ 多线注记。
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
