// ===== 织卷 · 分幕草稿「段标记」约定（shared 纯逻辑） =====
// 分幕草稿（大纲/<章>_分幕.md）里每段以「## 第 N 段」标题开头：
// 1) 人审读时能看清段边界（哪段缺了一目了然）；
// 2) 程序可按标题切回各段原文——「补写缺段」只重写失败段、原样保留成功段；
// 3) 采纳为正文时（actsAdopt.extractActsBody）剥掉这些标题行，正文不带标记。
// 注意：这是文档内部结构约定（与约定头 front matter 同理），不引入任何结构化存储。

/** 段标题行（顶格「## 第 N 段」），整行匹配用 */
export const ACT_SEG_TITLE = /^##\s*第\s*\d+\s*段\s*$/

/** 段标题行带段号捕获（split 用） */
export const ACT_SEG_TITLE_CAP = /^##\s*第\s*(\d+)\s*段\s*$/

/**
 * 缺段占位注释：分幕草稿有缺段而「采纳为正文」（整章替换）后，
 * 草稿头的缺段警示会被剥掉——缺段处必须留下可检索的痕迹（断链可见性，2026-09-12）。
 * 语义沿用 comments.ts：`<!-- … -->`＝元信息/占位提示，编辑器可见（Milkdown html 节点显示原文）、
 * 模型上下文装配剥离、字数不计；模型需知缺段可 zj_read_doc 现读。
 */
export function actPlaceholder(n: number): string {
  return `<!-- 分幕草稿缺第 ${n} 段：此处情节未写成，待补齐 -->`
}

/** 匹配正文中的缺段占位注释（与 actPlaceholder 生成格式一致，捕获段号；仅成对闭合注释） */
const ACT_PLACEHOLDER = /<!--\s*分幕草稿缺第\s*(\d+)\s*段[^>]*?-->/g

/**
 * 从正文全文识别缺段占位注释，返回缺段号（升序去重）。
 * 补齐闭环第一步（2026-09-12）：占位注释被 stripHtmlComments 剥掉后模型看不到「缺第 N 段」——
 * 上下文装配前先识别，把「正文断链」显式告知模型；作者自定义注释/未闭合注释不误伤。
 */
export function matchActPlaceholders(text: string): number[] {
  const out = new Set<number>()
  for (const m of text.matchAll(ACT_PLACEHOLDER)) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0) out.add(n)
  }
  return [...out].sort((a, b) => a - b)
}

/** 缺段警示行开头（草稿头部 `> ⚠️ 第 X 段未按导演板写成…`），采纳/解析共用 */
const ACT_WARN_LINE = /^>\s*⚠️/

/** 从警示行里抽失败段号：'第 1、3 段未按导演板写成' → [1,3] */
const ACT_WARN_CAP = /第\s*([\d、\s]+?)\s*段\s*未按导演板写成/

export interface ActSeg {
  index: number
  text: string
}

/** 把分段结果渲染成草稿正文（按 index 升序，每段前加「## 第 N 段」标题） */
export function renderActsSegs(segs: ActSeg[]): string {
  const sorted = [...segs].sort((a, b) => a.index - b.index)
  return sorted
    .map((s) => `## 第 ${s.index} 段\n\n${s.text.trim()}`)
    .join('\n\n')
}

/** 从草稿正文反解析分段：按「## 第 N 段」标题切，段号 → 段文本（不含标题，trim） */
export function splitActsBody(body: string): Map<number, string> {
  const out = new Map<number, string>()
  const lines = body.split('\n')
  let cur: number | null = null
  const buf: string[] = []
  const flush = () => {
    if (cur != null) {
      const t = buf.join('\n').trim()
      if (t) out.set(cur, t)
    }
    buf.length = 0
  }
  for (const line of lines) {
    const m = ACT_SEG_TITLE_CAP.exec(line)
    if (m) {
      flush()
      cur = Number(m[1])
    } else if (cur != null) {
      buf.push(line)
    }
  }
  flush()
  return out
}

/** 草稿文档是否为按段标记写的分幕草稿（存在至少一个「第 N 段」标题） */
export function isActsDraft(body: string): boolean {
  return ACT_SEG_TITLE_CAP.test(body)
}

/** 从分幕草稿全文（含约定头）里抽「未写成」的段号；没有缺段警示 → 空数组 */
export function parseActsWarn(draft: string): number[] {
  const m = ACT_WARN_CAP.exec(draft)
  if (!m) return []
  return m[1]
    .split(/[、\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
}

/** 判定草稿正文里某段是否存在（补写前确认） */
export function hasActSeg(body: string, index: number): boolean {
  return splitActsBody(body).has(index)
}

export { ACT_WARN_LINE }
