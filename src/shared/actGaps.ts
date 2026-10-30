// ===== 织卷 · 正文缺段核查（本地规则层，零模型，2026-09-14） =====
// 机械层第五块：分幕草稿采纳为正文后若缺段，会在缺段处留下占位注释
// `<!-- 分幕草稿缺第 N 段：此处情节未写成，待补齐 -->`（actsSeg.actPlaceholder，2026-09-12 断链可见性）。
// 这些注释在编辑器可见、模型上下文剥离、字数不计——以「断链标记」形式留存；但作者可能忘记补齐。
// 本检查扫描全卷正文的占位注释，列出留茬的章节与缺段号（写完后应删注释，不该残留）。
// 与 presenceCheck / chapterOrderCheck 同构：纯函数、不读盘，输出 AuditResult（审计抽屉渲染）。
// 2026-10-30 智能层：补**可执行落点**——每条命中的占位注释自带一张「删除该注释」的
// replace-text 提案（before=注释原文，after=''）。理由与 Vale action 系统同哲学
// （vale.sh/docs/topics/styles/#actions）：能确定替换/删除的才给 quick fix，
// 需要作者判断的（时序重号、切片倒流）仍只出建议卡。缺段「补写情节」无法机械完成，
// 但「确认此处留白 → 删标记」是确定动作，作者一键即可让断链从体检里清零。
// 逐处一条（而非按章合并）：一个缺段＝一个决策（补写 or 删标记），合并成一条时
// 作者只能看到「缺 1、3 段」却只能一键处理第一处。
import { extractFrontMatter } from './fmatter'
import { matchActPlaceholderMarks } from './actsSeg'
import type { AuditItem, AuditResult, ProposalItem } from './types'

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
 * 「删除这条缺段占位注释」的可执行提案。
 * before 取原文精确串（连同两侧换行，删掉不留空行）；作者已手改/删过该注释 → apply 如实报漂移。
 */
function removalOf(raw: string, file: string, text: string, no: number): ProposalItem | undefined {
  const before = raw.includes('\n' + text + '\n')
    ? '\n' + text + '\n'
    : raw.includes(text + '\n')
      ? text + '\n'
      : raw.includes(text)
        ? text
        : ''
  if (!before) return undefined
  return {
    target: file,
    anchor: '',
    kind: 'replace-text',
    before,
    after: '',
    reason: `检查 · 缺段核查：删除第 ${no} 段占位注释（确认此处留白）`
  }
}

/**
 * 正文缺段核查：输入全部章节（约定头 + 正文 raw），输出 AuditResult（与审计抽屉同构）。
 * 只报告确有依据的占位注释命中；默认注释（作者自定义 `<!-- … -->`）不参与，仅识别
 * actsSeg 生成的「分幕草稿缺第 N 段」占位（成对闭合、段号正整数）。
 */
export function actGapsCheck(opts: { chapters: ActGapsChapter[] }): AuditResult {
  const items: AuditItem[] = []
  const hitChapters = new Set<string>()
  for (const ch of opts.chapters) {
    const { fm, body } = extractFrontMatter(ch.raw)
    const marks = matchActPlaceholderMarks(body)
    if (!marks.length) continue
    const title = titleOf(fm, ch.file)
    const where = `${title}（${ch.file}）`
    hitChapters.add(ch.file)
    for (const mark of marks) {
      const proposal = removalOf(ch.raw, ch.file, mark.text, mark.no)
      items.push({
        severity: 'medium',
        type: 'structure',
        where: `${where} · 缺第 ${mark.no} 段`,
        what: `正文里残留分幕草稿缺段占位注释：缺第 ${mark.no} 段（本章共 ${marks.length} 处）——该处情节未写成，采纳分幕时留下的断链标记。`,
        suggest: '请补写缺段后删除这条占位注释；若确认该处本就留白（刻意留空），采纳「删除占位注释」提案即可。',
        ...(proposal ? { proposal } : {})
      })
    }
  }
  const n = opts.chapters.length
  const count = hitChapters.size
  const summary = items.length
    ? `正文缺段核查（本地规则·零模型）：共 ${n} 章，${count} 章正文残留分幕缺段占位（${items.length} 处）——断链标记会在编辑器里显示、被模型读取时剥离，残留说明缺段情节还没补齐。`
    : n
      ? `正文缺段核查（本地规则·零模型）：${n} 章正文均无分幕缺段占位注释，无断链残留。`
      : '正文缺段核查（本地规则·零模型）：项目里还没有正文章节。'
  return { summary, items }
}
