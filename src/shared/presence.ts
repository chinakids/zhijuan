// ===== 织卷 · 人物在场与称谓核查（本地规则层，零模型，2026-09-09） =====
// 调研结论（docs/agent-调研与优化-日志.md）：Novel Crafter 把「Review」做成 Appearance Heatmap /
// Characters per Scene 这类**确定性统计审查**，与 LLM 审查分层；织卷此前只有 LLM 审计（几分钟 + token），
// 缺低成本、秒级、可重复的机械层。本模块做第一块机械审查：逐章对照约定头「涉及人物」与正文实际署名出现，
// 盯两类漂移——清单里的人物没出场（missing）、出场了却不在清单（unlisted）。
// 2026-09-10 升级（机械层第三块·称谓一致性第一批）：人物档案 front matter 可选择登记「别名: [a, b]」
// （与「涉及人物」同语法），别名参与匹配——missing 判定时别名出现=在场（免误报）；unlisted 判定时别名出现=命中；
// 同一别名被两个及以上人物登记 = 数据冲突（medium）。单字名/未登记别称/指代仍不参与（机械层承认局限）。
// 纯函数、不读盘，OCR 无关。
import { extractFrontMatter } from './fmatter'
import type { AuditItem, AuditResult, UnlistedHit } from './types'

export interface PresenceChapter {
  /** 相对项目根的路径，如 正文/第01章_雾港.md */
  file: string
  /** 全文（含 front matter） */
  raw: string
}

/** 从约定头里取「涉及人物」（字符串或数组两种写法都收；无则 []） */
export function listedFrom(fm: Record<string, unknown>): string[] {
  const v = fm['涉及人物']
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') {
    const arr = v.match(/^\[(.*)\]$/)
    if (arr) return arr[1].split(',').map((s) => s.trim()).filter(Boolean)
    return v.trim() ? [v.trim()] : []
  }
  return []
}

/** 从人物档案约定头里取「别名」（与「涉及人物」同语法；无则 []） */
export function parseAliases(fm: Record<string, unknown> | null): string[] {
  if (!fm) return []
  const v = fm['别名']
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') {
    const arr = v.match(/^\[(.*)\]$/)
    if (arr) return arr[1].split(',').map((s) => s.trim()).filter(Boolean)
    return v.trim() ? [v.trim()] : []
  }
  return []
}

const NAME_MIN = 2 // 单字名（姓氏/代号）不做机械匹配，避免全篇误报

/** 别名冲突集合：同一别名被两个及以上人物登记 → 该别名不得用于 unlisted 判定（歧义不误报） */
export function conflictedAliases(aliasMap: Record<string, string[]>): Set<string> {
  const owners = new Map<string, string[]>()
  for (const [name, al] of Object.entries(aliasMap)) {
    for (const a of al) {
      const arr = owners.get(a) ?? []
      arr.push(name)
      owners.set(a, arr)
    }
  }
  const conflicted = new Set<string>()
  for (const [alias, list] of owners) {
    if (list.length >= 2) conflicted.add(alias)
  }
  return conflicted
}

/**
 * 单章「名单外出场」检测（保存正文前置提示复用 presence 同一口径）：
 * 正文出现档案人物本名或登记别名、但本章约定头「涉及人物」未列 → 逐人命中。
 * 别名命中的条目带 alias（正文只出现别名、未出现本名时）。损坏别名/单字名不参与。
 */
export function unlistedInBody(opts: {
  body: string
  /** 本章约定头「涉及人物」 */
  listed: string[]
  /** 人物档案题名单（knownChars） */
  knownChars: string[]
  aliasMap?: Record<string, string[]>
  /** 可选：提前算好的冲突别名集合（省一次扫描） */
  conflicted?: Set<string>
}): UnlistedHit[] {
  const known = new Set(opts.knownChars)
  const aliasMap = opts.aliasMap ?? {}
  const conflicted = opts.conflicted ?? conflictedAliases(aliasMap)
  const out: UnlistedHit[] = []
  for (const n of known) {
    if (n.length < NAME_MIN) continue
    const aliases = aliasMap[n] ?? []
    const byAlias = aliases.find((a) => !conflicted.has(a) && opts.body.includes(a))
    const byName = opts.body.includes(n)
    if ((byName || byAlias) && !opts.listed.includes(n)) {
      out.push({ name: n, ...(byAlias && !byName ? { alias: byAlias } : {}) })
    }
  }
  return out
}

function titleOf(fm: Record<string, unknown> | null, file: string): string {
  if (fm && typeof fm['题名'] === 'string' && fm['题名']) return String(fm['题名'])
  return (file.split('/').pop() ?? file).replace(/\.md$/i, '')
}

/**
 * 人物在场与称谓核查：输入全部章节（约定头 + 正文）、人物档案题名清单（knownChars）与
 * 档案登记的别名表（aliasMap: 本名 → 别名数组），输出 AuditResult（与审计抽屉同构）。
 * - missing：约定头「涉及人物」列了、但正文既无本名也无登记别名 → medium
 * - unlisted：正文出现本名或登记别名、但约定头未列 → low
 * - conflict（别名冲突）：同一别名被两个及以上人物登记 → medium（与章无关，一次检查）
 */
export function presenceCheck(opts: { knownChars: string[]; chapters: PresenceChapter[]; aliasMap?: Record<string, string[]> }): AuditResult {
  const aliasMap = opts.aliasMap ?? {}
  const items: AuditItem[] = []
  let touched = 0
  let missCount = 0
  let unCount = 0
  let conflictCount = 0
  // 别名冲突（与章无关，一次检查）：同一别名被两个及以上人物登记 → medium；冲突别名不参与 unlisted 判定
  const conflicted = conflictedAliases(aliasMap)
  const owners = new Map<string, string[]>()
  for (const [name, al] of Object.entries(aliasMap)) {
    for (const a of al) {
      const arr = owners.get(a) ?? []
      arr.push(name)
      owners.set(a, arr)
    }
  }
  for (const [alias, list] of owners) {
    if (list.length >= 2) {
      conflictCount++
      items.push({
        severity: 'medium',
        type: 'character',
        where: `人物档案：${list.join('、')}`,
        what: `「别名「${alias}」被两个及以上人物档案登记（${list.join('、')}）——称谓一致性检查无法判断它指谁。`,
        suggest: `只保留一个拥有人：给其他人物改别名，或删除该别名（在对应 人物/<名字>.md 的约定头「别名: [...]」里改）。`
      })
    }
  }
  for (const ch of opts.chapters) {
    const { fm, body } = extractFrontMatter(ch.raw)
    const listed = listedFrom(fm ?? {})
    const title = titleOf(fm, ch.file)
    const where = `${title}（${ch.file}）`
    for (const n of listed) {
      if (n.length < NAME_MIN) continue
      const aliases = aliasMap[n] ?? []
      // missing 豁免：本名未出现但任一登记别名（含歧义别名）出现 = 词确实在正文，算在场，交由冲突条目处理归属
      const byAlias = aliases.find((a) => body.includes(a))
      if (!body.includes(n) && !byAlias) {
        missCount++
        touched++
        items.push({
          severity: 'medium',
          type: 'character',
          where,
          what: `「涉及人物」列了「${n}」，但本章正文未出现 TA 的署名或登记的别名（${aliases.length ? aliases.join('、') + ' 均未出现' : '档案未登记别名'}）——可能已删戏，或用了未登记的别称/指代。`,
          suggest: `确认本章是否真需要「${n}」出场：需要则在正文补写该角色，不需要就把 TA 移出本章约定头的「涉及人物」。`
        })
      }
    }
    for (const hit of unlistedInBody({ body, listed, knownChars: opts.knownChars, aliasMap, conflicted })) {
      unCount++
      touched++
      items.push({
        severity: 'low',
        type: 'character',
        where,
        what: hit.alias
          ? `正文出现了「${hit.alias}」——这是「${hit.name}」档案登记的别名，但本章约定头「涉及人物」没有列 TA。`
          : `正文出现了「${hit.name}」的署名，但本章约定头「涉及人物」没有列 TA。`,
        suggest: `若「${hit.name}」确实在这一章出场，把 TA 加进本章约定头的「涉及人物」；若只是回忆/提及一笔，保留现状即可。`
      })
    }
  }
  const n = opts.chapters.length
  const summary = touched || conflictCount
    ? `人物在场与称谓核查（本地规则·零模型）：共 ${n} 章，${touched} 章与「涉及人物」不一致——清单列了却未署名出场 ${missCount} 处、出场却未列入 ${unCount} 处${conflictCount ? `、别名冲突 ${conflictCount} 处` : ''}。口径：2 字及以上署名与档案登记的别名参与匹配，单字名/未登记别称/指代不参与；无问题的章未列出。`
    : n
      ? `人物在场与称谓核查（本地规则·零模型）：${n} 章全部与约定头「涉及人物」一致。`
      : '人物在场与称谓核查（本地规则·零模型）：项目里还没有正文章节。'
  return { summary, items }
}
