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
