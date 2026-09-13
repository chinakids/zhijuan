// ===== 织卷 · 正文缺段核查（本地规则层，零模型，2026-09-14） =====
// 机械层第五块：分幕草稿采纳为正文后若缺段，会在缺段处留下占位注释
// `<!-- 分幕草稿缺第 N 段：此处情节未写成，待补齐 -->`（actsSeg.actPlaceholder，2026-09-12 断链可见性）。
// 这些注释在编辑器可见、模型上下文剥离、字数不计——以「断链标记」形式留存；但作者可能忘记补齐。
// 本检查扫描全卷正文的占位注释，列出留茬的章节与缺段号（写完后应删注释，不该残留）。
// 与 presenceCheck / chapterOrderCheck 同构：纯函数、不读盘，输出 AuditResult（审计抽屉渲染）。
import { extractFrontMatter } from './fmatter'
import { matchActPlaceholders } from './actsSeg'
import type { AuditItem, AuditResult } from './types'

export interface ActGapsChapter {
  /** 相对项目根的路径，如 正文/第01章_雾港.md */
  file: string
  /** 全文（含 front matter） */
  raw: string
}

function titleOf(fm: Record<string, unknown> | null, file: string): string {
  if (fm && typeof fm['题名'] === 'string' && fm['题名']) return String(fm['题名'])
  return (file.split('/').pop() ?? file).replace(/\.md$/i, '')
}

/**
 * 正文缺段核查：输入全部章节（约定头 + 正文 raw），输出 AuditResult（与审计抽屉同构）。
 * 只报告确有依据的占位注释命中；默认注释（作者自定义 `<!-- … -->`）不参与，仅识别
 * actsSeg 生成的「分幕草稿缺第 N 段」占位（成对闭合、段号正整数）。
 */
export function actGapsCheck(opts: { chapters: ActGapsChapter[] }): AuditResult {
  const items: AuditItem[] = []
  for (const ch of opts.chapters) {
    const { fm, body } = extractFrontMatter(ch.raw)
    const nos = matchActPlaceholders(body)
    if (!nos.length) continue
    const title = titleOf(fm, ch.file)
    items.push({
      severity: 'medium',
      type: 'structure',
      where: `${title}（${ch.file}）`,
      what: `正文里残留分幕草稿缺段占位注释：缺第 ${nos.join('、')} 段（共 ${nos.length} 处）——该处情节未写成，采纳分幕时留下的断链标记。`,
      suggest: '请补写缺段后删除对应的占位注释；若确认该处本就留白（刻意留空），直接在编辑器里删掉注释即可。'
    })
  }
  const n = opts.chapters.length
  const count = items.length
  const summary = count
    ? `正文缺段核查（本地规则·零模型）：共 ${n} 章，${count} 章正文残留分幕缺段占位——断链标记会在编辑器里显示、被模型读取时剥离，残留说明缺段情节还没补齐。`
    : n
      ? `正文缺段核查（本地规则·零模型）：${n} 章正文均无分幕缺段占位注释，无断链残留。`
      : '正文缺段核查（本地规则·零模型）：项目里还没有正文章节。'
  return { summary, items }
}
