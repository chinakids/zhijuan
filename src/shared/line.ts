// ===== 织卷 · 时间线约定（shared 纯函数，2026-09-16 多时间线叙事） =====
// 权威口径：docs/多时间线叙事-设计文档-2026-09-16.md §4.1/§4.2（F-20260916-02）。
// 章头「时间线」字段（可选）→ 线名；缺省=「主线」（老项目/老章节零迁移）。
// 单一权威源：平台层透传（SliceEntry.line）、智能层审计线内判定、体验层线徽标都从这里取，
// 避免各层口径漂移（contextCaps 先例）。
/** 缺省时间线名（未写「时间线」字段的章 = 主线；老项目自然全部落主线） */
export const DEFAULT_LINE = '主线'

/** chapterLine 只读「时间线」键——参数用最小结构接口，兼容 FrontMatter（index signature）与 ChapterFrontMatter（具名属性）双方调用 */
type Lineable = { 时间线?: unknown }

/** 约定头「时间线」→ 线名：trim 后为空 → 主线（设计文档 §4.2：缺省=主线） */
export function chapterLine(fm: Lineable | null): string {
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

/** 切片小节标题行识别（与 shared/sliceorder.ts scanSections 同口径：H2~H6 + 中英文冒号） */
const CHAR_SEC_RE = /^#{2,6}\s+切片\s*[:：]\s*(.+)$/

/**
 * 线 → 切片名集合（正文为源：entries 由 listChapters 产出且已解析约定头；设计文档 §4.4）。
 * 只收「时间线 === line 且切片名非空」章的切片名；供人物档案装配按线过滤（filterCharDocByLine）。
 * 切片名 trim 后入集合（与 audit/sliceorder 同口径）；跨线重名（R7）时同名自然出现在多条线的集合里。
 */
export function lineSliceNames(
  entries: { line: string; slice?: unknown }[],
  line: string
): Set<string> {
  const out = new Set<string>()
  for (const e of entries) {
    if (e.line !== line) continue
    const s = typeof e.slice === 'string' ? e.slice.trim() : ''
    if (s) out.add(s)
  }
  return out
}

export interface CharFilterResult {
  /** 过滤后的档案全文（保留行级原样拼接） */
  text: string
  /** 被剥除的切片小节名（仅属于其他线/无本线引用的小节） */
  omitted: string[]
}

/**
 * 人物档案按线过滤（设计文档 §4.4：「装配时按本章所属线取该线的状态下文」）。
 * 人物档结构：front matter + 长期小节（## 基础档案 等，作者手动维护，不随线分叉）+「## 切片：<名>」
 * 状态小节（syncAnchor 按写入顺序追加；切片名 → 章 → 线 可判归属；跨线重名按「有本线引用即保留」保守处理）。
 * 过滤只针对「## 切片：」小节：名 ∉ keepSlices 的整节剥除（含标题行）；H3~H6 视为小节内容不单独判界；
 * 其他 H1/H2 标题 = 切片小节边界（恢复保留）。无任何「## 切片：」小节 → 原样返回（旧格式/手工档不误伤）。
 */
export function filterCharDocByLine(text: string, keepSlices: ReadonlySet<string>): CharFilterResult {
  // 快速路径必须逐行判定（无 m 标志时 ^ 只匹配串首，文件以 front matter 开头会漏判）
  if (!text.split('\n').some((l) => CHAR_SEC_RE.test(l))) return { text, omitted: [] }
  const lines = text.split('\n')
  const out: string[] = []
  const omitted: string[] = []
  let keep = true
  for (const line of lines) {
    const sec = /^##\s+切片\s*[:：]\s*(.+)$/.exec(line)
    if (sec) {
      const name = sec[1].trim()
      keep = keepSlices.has(name)
      if (!keep) omitted.push(name)
      // 标题行随节保留/剥除（keep=false 时不入 out，即整节剥除）
      if (keep) out.push(line)
      continue
    }
    if (/^#{1,2}\s+/.test(line)) keep = true
    if (keep) out.push(line)
  }
  return { text: out.join('\n'), omitted }
}

/** 线枚举条目（.zhijuan/lines.json 与 slices.json 同构；正文为源，可重建） */
export interface LineInfo {
  /** 线名（chapterLine 归一后） */
  name: string
  /** 该线章节（切片）数 */
  chapters: number
}

/**
 * 从切片枚举提取线清单（正文为源：entries 由 listSliceEntries 产出，已按章号排序）。
 * 返回顺序=线在正文中的首次出现序（缺省「主线」若存在自然排最前）；只统计带切片的章（与枚举同口径）。
 */
export function listLinesFromEntries(entries: { line: string }[]): LineInfo[] {
  const count = new Map<string, number>()
  for (const e of entries) count.set(e.line, (count.get(e.line) ?? 0) + 1)
  return [...count.entries()].map(([name, chapters]) => ({ name, chapters }))
}
