// ===== 织卷 · 时间线约定（shared 纯函数，2026-09-16 多时间线叙事） =====
// 权威口径：docs/多时间线叙事-设计文档-2026-09-16.md §4.1/§4.2（F-20260916-02）。
// 章头「时间线」字段（可选）→ 线名；缺省=「主线」（老项目/老章节零迁移）。
// 单一权威源：平台层透传（SliceEntry.line）、智能层审计线内判定、体验层线徽标都从这里取，
// 避免各层口径漂移（contextCaps 先例）。
import type { FrontMatter } from './fmatter'

/** 缺省时间线名（未写「时间线」字段的章 = 主线；老项目自然全部落主线） */
export const DEFAULT_LINE = '主线'

/** 约定头「时间线」→ 线名：trim 后为空 → 主线（设计文档 §4.2：缺省=主线） */
export function chapterLine(fm: FrontMatter | null): string {
  const v = fm?.['时间线']
  const s = typeof v === 'string' ? v.trim() : ''
  return s || DEFAULT_LINE
}

/** 线内前驱的章条目（调用方负责从章头解析章号与线名；file=相对 正文/ 的文件名，如 第03章_雾港.md） */
export interface LineEntryNode {
  file: string
  /** 章号；解析失败=null（排最后，不参与前驱选择） */
  no: number | null
  /** 线名（chapterLine 归一后） */
  line: string
}

/**
 * 线内前驱 = 「同一时间线、章号严格小于当前、且章号最大」的一章（设计文档 §4.5 上下文装配：
 * 「上一章尾部」= 同线内前驱；B 形态过去线/现在线交错时不得跨线误承接）。
 * 老项目全在「主线」→ 退化为全局按章号前驱（零回归）；同号并列按文件名序取后（稳定）。
 * 当前章不在 entries / 同线无更小章号 → null；当前章号解析失败时取同线最后一章（与旧全局序兜底同构）。
 */
export function linePredecessor(entries: LineEntryNode[], curFile: string): LineEntryNode | null {
  const cur = entries.find((e) => e.file === curFile)
  if (!cur) return null
  const curNo = cur.no ?? Number.MAX_SAFE_INTEGER
  const cands = entries
    .filter((e) => e.file !== curFile && e.line === cur.line && e.no !== null)
    .filter((e) => (e.no as number) < curNo)
    .sort((a, b) => (a.no as number) - (b.no as number) || a.file.localeCompare(b.file, 'zh'))
  return cands.length ? cands[cands.length - 1] : null
}
