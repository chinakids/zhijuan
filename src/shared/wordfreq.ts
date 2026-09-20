// ===== 织卷 · 用词重复核查（本地规则层，零模型，2026-09-20） =====
// 调研结论（来源=Novelcrafter 官方，2026-09-20 直连抓取）：
//   Codex Features「Usage Frequency = Identify overused words, crutch phrases, and repetitive
//   metaphors」（novelcrafter.com/features/codex）；官方 FAQ「What are AI-isms? How can I record
//   them?」（novelcrafter.com/help/faq/ai-and-prompting/ai-isms，2025-06-13 更新）：
//   AI-isms 是训练数据造成的高频复用词/短语，频率不成比例、成为 AI 写作的 tells（例：palpable/
//   tangible/raced）；用户工作流=codex entry + aliases 高亮跟踪。
// 中文创作同理：口头禅/拐杖短语（一下/一点一点/小小的/整个人/慢慢地…）长文复用过多，读者出戏、
// 文风显单薄（2026-09-20 本机实测：都市短篇合集 19 章 16.3 万字「一下」643 次/4.0 每千字、
// 「一下一下」129 次、「小小的」217 次、「整个人」169 次——真实数据自证口头禅是真实存在面）。
// 本块=词表式频率报告：内置常见口头禅/AI 腔中文短语（可经 opts.dict 追加作者自定义词表），
// 扫全卷正文，报每短语总次数/每千字频率/出现章分布；只报告频次不判对错（作者自决处置），
// 但 severity 按频率分档（高频=疑口头禅，重点提示）。
// 与 presence/order/nameform 同构：纯函数、不读盘、输出 AuditItem[]、零模型秒级、可高频重跑。
// 承认局限（与称谓类同策略）：词表式只认「入表短语」，未入表的口头禅不报；词表可扩展（二期=设置页自定义）。
import { stripHtmlComments } from './comments'
import type { AuditItem } from './types'

/** 内置常见口头禅/AI 腔短语（初始版；词条按「作者一眼能认」的显式短语，不含单字虚词）
 *  注释标注来源类型：动作口头禅 / 副词口头禅 / AI 腔套语（各为常见复用面）。 */
export const BUILTIN_OVERUSE: string[] = [
  // 动作口头禅（网文高频复用）
  '点了点头', '摇了摇头', '皱了皱眉', '深吸一口气', '叹了口气', '微微一笑', '嘴角勾起',
  '轻声道', '低声道', '喃喃自语', '喃喃', '低垂眼帘', '眸色一暗', '眼底闪过一丝',
  '微微一怔', '心中一动', '心头一紧', '流露出', '转过身去', '转过身来',
  // 副词/状态口头禅
  '慢慢地', '轻轻地', '缓缓地', '微微', '悄悄地', '下意识地', '下意识', '不由自主',
  '不由得', '仿佛', '似乎', '恍然', '竟然', '居然', '忍不住', '久久', '深深',
  // 描摹套语（AI 腔高频）
  '一下', '一点一点', '一下一下', '一遍又一遍', '整个人', '小小的', '带着哭腔',
  '说不出话来', '若有所思', '意味深长', '欲言又止', '若有所思地', '空气仿佛凝固',
  '时间仿佛静止', '思绪万千', '涌上心头', '心底涌起', '泛起一丝', '勾勒出',
  '透着几分', '显得格外', '显得有几分'
]

/** 短语在单章内的出现次数（非重叠计数；只在「正文可见字符」上统计，含跨段） */
export function countPhraseInText(text: string, phrase: string): number {
  if (!phrase) return 0
  let n = 0
  let pos = 0
  while (true) {
    const i = text.indexOf(phrase, pos)
    if (i < 0) break
    n++
    pos = i + phrase.length
  }
  return n
}

/** 正文清洗：剥约定头（---…---）与 HTML 注释（与 countWords 同口径的可见文本）；
 *  markdown 行内符号剥掉（*_~# 等）以免隔断短语，换行保留（短语不跨段计）。 */
export function visibleBodyOf(raw: string): string {
  let t = stripHtmlComments(String(raw).replace(/^---\n[\s\S]*?\n---\s*(\n|$)/, ''))
  return t.replace(/[`*_~#>]/g, '').replace(/^[-+]\s+/gm, '')
}

export interface OveruseOpts {
  /** 只报出现次数 ≥ 此值的短语（防刷屏；默认 3） */
  minCount?: number
  /** 追加的自定义词表（与内置去重合并；二期=设置页） */
  dict?: string[]
  /** 正文可见字数（外部已算好则传入复用；缺省按输入自行累计） */
  totalChars?: number
}

export interface OveruseMention {
  file: string
  count: number
}

export interface OveruseEntry {
  phrase: string
  count: number
  perK: number
  chapters: OveruseMention[]
  severity: 'high' | 'medium' | 'low'
}

/** 词表式频率统计：chapters=[{file, raw}]（raw=含约定头的原样 md）。
 *  返回按 count 降序的条目（≥minCount 才报）；perK=次数÷(总可见字数/1000)。 */
export function overuseCheck(
  chapters: { file: string; raw: string }[],
  opts: OveruseOpts = {}
): OveruseEntry[] {
  const minCount = opts.minCount ?? 3
  const dict = [...new Set([...BUILTIN_OVERUSE, ...(opts.dict ?? [])])]
  const totalChars =
    opts.totalChars ?? chapters.reduce((s, c) => s + visibleBodyOf(c.raw).length, 0)
  const perKBase = totalChars > 0 ? totalChars / 1000 : 1
  const out: OveruseEntry[] = []
  for (const phrase of dict) {
    const mentions: OveruseMention[] = []
    let count = 0
    for (const c of chapters) {
      const n = countPhraseInText(visibleBodyOf(c.raw), phrase)
      if (n > 0) mentions.push({ file: c.file, count: n })
      count += n
    }
    if (count < minCount) continue
    const perK = count / perKBase
    // severity 只按绝对次数分档（perK 受文本长度影响，短样本会失真；展示层才用每千字）
    // 阈值取数依据：2026-09-20 真数据 19 章 16.3 万字实测——high 档容「一下 643/整个人 169/
    // 慢慢地 128」这类全书级口头禅，medium 容「带着哭腔 45/深深地 26」类情节性复用；勿凭直觉调。
    const severity: OveruseEntry['severity'] =
      count >= 50 ? 'high' : count >= 15 ? 'medium' : 'low'
    mentions.sort((a, b) => b.count - a.count)
    out.push({ phrase, count, perK, chapters: mentions, severity })
  }
  out.sort((a, b) => b.count - a.count)
  return out
}

/** 用词重复核查 → 审计条目（与 nameform 等本地规则同构的 AuditItem[]）。
 *  what 直接给频次与分布（top 三章），suggest 不武断、只提示审视。 */
export function overuseItems(
  chapters: { file: string; raw: string }[],
  opts: OveruseOpts = {}
): AuditItem[] {
  return overuseCheck(chapters, opts).map((e) => {
    const top = e.chapters.slice(0, 3)
    const dist = top.map((m) => `${m.file}×${m.count}`).join('、')
    const more = e.chapters.length > top.length ? `等${e.chapters.length}章` : ''
    return {
      severity: e.severity,
      type: 'overuse',
      where: dist + more,
      what: `「${e.phrase}」全卷出现 ${e.count} 次（每千字 ${e.perK.toFixed(1)} 次）`,
      suggest: '审视是否为口头禅复用；同段/相邻反复出现时建议改写其一，不必全部删除'
    }
  })
}
