// ===== 织卷 · 档案切片核查（本地规则层，零模型，2026-09-14） =====
// 机械层第六块：人物档「## 切片：<名>」小节的出现顺序 vs 该切片对应章序（最小章号）。
// 背景：切片同步的落盘语义是「锚点命中替换 / 未命中文末追加」（proposals.applyAnchor），
// 即人物档内小节顺序 = 同步发生顺序，不是故事时间顺序——先写后章再补前章时（如先写第5章
// 再补第2章），「切片：第二夜」会被追加在「切片：第五夜」之后。人物档全文件随 agent 上下文
// 注入（buildWritingContext），小节倒序会让模型读到的状态流与故事时间相反，作者逐字读档案
// 也难以沿时间追踪人物变化；异形锚点时代还曾堆积「近重复切片小节」（syncAnchor 注释）。
// 与 presence / order / unused / actgaps 同构：纯函数、不读盘，输出 AuditResult（审计抽屉渲染）。
// 线内判定（2026-09-16 多时间线叙事）：切片 → 章号按**所属时间线内**的最小章号（章节声明了
// 「时间线」字段；缺省=主线）；同一切片名被多条线共用时（跨线重名，约定不推荐、chapterorder R7
// 会提示）顺序比较失去确定性 → 跳过比较（不误报），残留判定仍按全卷切片名集合。
import { extractFrontMatter } from './fmatter'
import { chapterLine } from './line'
import type { AuditItem, AuditResult } from './types'

export interface SliceOrderChar {
  /** 相对项目根的路径，如 人物/林西.md */
  file: string
  /** 全文（含 front matter） */
  raw: string
}

export interface SliceOrderChapter {
  /** 相对项目根的路径，如 正文/第01章_雾港.md */
  file: string
  /** 全文（含 front matter） */
  raw: string
}

/** 约定头「章号」→ 正整数；缺失/非正整数返回 null（与 chapterorder.ts 同口径） */
function fmNo(fm: Record<string, unknown> | null): number | null {
  const v = fm?.['章号']
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  return Number.isInteger(n) && n > 0 ? n : null
}

/** 文件名（正文/第01章_雾港.md）里的章号（与 chapterorder.ts 同口径） */
function fileNo(file: string): number | null {
  const m = file.match(/第\s*(\d+)\s*章/)
  return m ? parseInt(m[1], 10) : null
}

interface CharSec {
  /** 小节名（「切片：<名>」里的 <名>，去首尾空白） */
  name: string
  /** 该切片对应的最小章号；全集无此切片（残留）或章节章号不可解析 → null */
  no: number | null
}

/** 扫人物档全部「## 切片：<名>」小节（H2~H6，H1 是文档题名，不参与） */
function scanSections(raw: string): CharSec[] {
  const out: CharSec[] = []
  for (const line of raw.split('\n')) {
    const m = /^#{2,6}\s+切片\s*[:：]\s*(.+)$/.exec(line)
    if (m) out.push({ name: m[1].trim(), no: null })
  }
  return out
}

/**
 * 档案切片核查：输入全部人物档案 + 全部章节（约定头 + 正文 raw），输出 AuditResult（与审计抽屉同构）。
 * - 顺序倒挂（medium）：相邻小节都有可解析章号、但后一小节章号更早——同步追加顺序 ≠ 故事顺序；
 * - 同名小节重复（medium）：同一档案内「切片：<名>」出现 ≥2 次——锚点只替换首个命中，多余是残留；
 * - 全集不存在（low）：小节切片名在全卷章节约定头里找不到——切片改名/章节删除后的残留。
 * 口径：切片→章号取「**该切片所属时间线内**出现该切片的章节的最小章号（约定头优先，其次文件名编号）」，
 * 都无则跳过比较；同一线内切片被多章共用（闪回）不会误报，因为按最小章号只参与一次；
 * 同一切片名被多条线共用（跨线重名）时不参与顺序比较（顺序失去确定性，避免误报）。
 */
export function sliceSectionOrderCheck(opts: {
  characters: SliceOrderChar[]
  chapters: SliceOrderChapter[]
}): AuditResult {
  const items: AuditItem[] = []

  // 切片名集合（含无法解析章号的，供「残留」判定）；切片 → 所属线 → 线内最小章号（同线内多章共用取最小）
  const sliceNames = new Set<string>()
  const sliceLinesOf = new Map<string, Set<string>>() // 切片名 → 出现过的线
  const sliceNoByLine = new Map<string, Map<string, number>>() // 线 → (切片名 → 最小章号)
  for (const ch of opts.chapters) {
    const { fm } = extractFrontMatter(ch.raw)
    const name = String(fm?.['切片'] ?? '').trim()
    if (!name) continue
    sliceNames.add(name)
    const line = chapterLine(fm)
    let lines = sliceLinesOf.get(name)
    if (!lines) {
      lines = new Set<string>()
      sliceLinesOf.set(name, lines)
    }
    lines.add(line)
    const no = fmNo(fm) ?? fileNo(ch.file)
    if (no === null) continue
    let m = sliceNoByLine.get(line)
    if (!m) {
      m = new Map<string, number>()
      sliceNoByLine.set(line, m)
    }
    const cur = m.get(name)
    if (cur === undefined || no < cur) m.set(name, no)
  }

  let charCount = 0
  for (const c of opts.characters) {
    const secs = scanSections(c.raw)
    if (!secs.length) continue
    charCount++
    // 回声填 no（切片所在线内最小章号；跨线重名或章号不可解析 → no=null 跳过比较；全集不存在 → 残留）
    for (const s of secs) {
      const lines = sliceLinesOf.get(s.name)
      if (lines && lines.size > 1) continue // 跨线重名：顺序比较失去确定性，跳过（误报风险 > 漏报价值）
      const line = lines ? [...lines][0] : null
      s.no = (line ? sliceNoByLine.get(line)?.get(s.name) : undefined) ?? null
    }

    // 同名小节重复（同步残留：锚点只命中第一个）
    const seen = new Map<string, number>()
    for (const s of secs) seen.set(s.name, (seen.get(s.name) ?? 0) + 1)
    for (const [name, n] of seen) {
      if (n <= 1) continue
      items.push({
        severity: 'medium',
        type: 'structure',
        where: c.file,
        what: `档案里「切片：${name}」小节出现 ${n} 次——切片同步按锚点替换只命中第一个，多余小节是历史残留（异形锚点时代追加的重复节），agent 上下文会读到两遍这份状态。`,
        suggest: `保留内容最全的一段「切片：${name}」，删除其余同名小节（删前先确认内容没有差异）。`
      })
    }

    // 序号倒挂：相邻小节都有章号，但后一个更早
    for (let i = 1; i < secs.length; i++) {
      const a = secs[i - 1]
      const b = secs[i]
      if (a.no === null || b.no === null) continue
      if (b.no < a.no) {
        items.push({
          severity: 'medium',
          type: 'timeline',
          where: c.file,
          what: `切片小节顺序与故事时间相反：「切片：${a.name}」（第 ${a.no} 章）排在「切片：${b.name}」（第 ${b.no} 章）之前——人物状态流按文件顺序读是倒着走的（同步按追加顺序落盘，不等于故事顺序）。`,
          suggest: `把「切片：${b.name}」整节剪切到「切片：${a.name}」之前，按章号从小到大的顺序重排本档案各切片小节。`
        })
      }
    }

    // 全集不存在（残留小节：切片改名/章节删除后留下）
    for (const s of secs) {
      if (sliceNames.has(s.name)) continue
      items.push({
        severity: 'low',
        type: 'setting',
        where: c.file,
        what: `档案里有「切片：${s.name}」小节，但全卷没有任何章节使用切片「${s.name}」——切片名可能改过、或对应章节已删除，这一节已脱离故事时间线。`,
        suggest: '检查该小节内容还有没有价值：有用就并入主题相近的切片小节（或新建对应切片），没有就删除。'
      })
    }
  }

  const n = opts.characters.length
  const count = items.length
  const summary = !n
    ? '档案切片核查（本地规则·零模型）：项目里还没有人物档案。'
    : !charCount
      ? `档案切片核查（本地规则·零模型）：共扫描 ${n} 个人物档案，都没有「切片」小节（还没写过切片状态），无需复核。`
      : `档案切片核查（本地规则·零模型）：共扫描 ${n} 个人物档案（${charCount} 个含切片小节），${count} 条需复核（切片小节顺序 / 重复 / 残留）。`
  const caveat =
    '口径：人物档「## 切片：<名>」小节顺序应与该切片首次出现的章号一致（切片同步按「命中替换／未命中文末追加」落盘，追加顺序≠故事顺序）；同一切片被多章共用不误报；乱序/重复/残留可能是历史同步残留，按建议人工整理（检查不落盘）。'
  return { summary: summary + caveat, items }
}
