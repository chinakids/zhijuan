// ===== 织卷 · 切片同步产物的路径/锚点归一化（纯逻辑，可单测）=====
// 背景：模块设计 §7/§8 约定——人物状态写「## 切片：<切片名>」小节（基础档案等长期小节只读），
// 世界状态写「世界观/切片_<切片名>.md」（每切片一个文件；总纲=长期不变项，不写切片状态）。
// 实测（2026-09-09 织卷smoke 数据审计）模型会：把 anchor 填成「基础档案」（→ 整节覆盖基础设定）、
// 或把世界状态指向「世界观/总纲.md」→ 这里做一层代码防线归一化，提示词同步加固。
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import type { ProposalItem } from '../../shared/types'
import { worldSliceFile } from '../../shared/paths'

function sliceAnchor(sliceName: string): string {
  return sliceName ? `切片：${sliceName}` : '切片状态'
}

/**
 * 把切片同步产物归一到模块设计 §7/§8 的唯一合法形态（2026-09-13 白名单制导）：
 * - 人物/*：anchor 一律「切片：<切片名>」——切片小节唯一合法；基础档案等长期小节只读；
 * - 世界观/*：target 一律 世界观/切片_<切片名>.md（总纲只读），anchor 同样归一。
 * 背景：2026-09-09 黑名单（RESERVED_ANCHORS）只兜「基础档案/总纲」等已知错法；实踩模型还会产出
 * 「无切片前缀」「带 # 号」「后缀废话」（如 切片：第一幕_夏夜（深夜续））、世界锚点写「总纲」等形态
 * ——黑名单枚举盖不住：任意异形锚点会让 applyAnchor 追加重复小节（人物文件堆积近重复切片小节、
 * 世界文件混入异号标题），破坏「一个切片一个小节」约定与注入端读取口径。白名单制导后
 * 只剩一种合法产物：错误写法无法越网（kind=append 不用 anchor，无影响）。
 */
export function normalizeSyncItems(items: ProposalItem[], sliceName: string): ProposalItem[] {
  const anchor = sliceAnchor(sliceName)
  const wf = sliceName ? worldSliceFile(sliceName) : ''
  return items.map((it) => {
    let target = it.target
    let a = it.anchor ?? ''
    if (target.startsWith('人物/')) {
      a = anchor
    } else if (target.startsWith('世界观/')) {
      if (sliceName) target = wf
      a = anchor
    }
    return { ...it, target, anchor: a }
  })
}

/** 确保世界切片文件存在（模块设计 §8：每个切片一个 切片_<切片名>.md）；返回相对项目根的路径；切片名为空返回 null */
export function ensureWorldSliceFile(root: string, sliceName: string): string | null {
  if (!sliceName) return null
  const rel = worldSliceFile(sliceName)
  const abs = join(root, rel)
  if (!existsSync(abs)) {
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(
      abs,
      `# 切片：${sliceName}\n\n> 本切片的世界状态（规则、事件、环境）。正文保存时的切片同步会把本切片的新状态写入这里；长期不变设定请放《总纲》。\n`,
      'utf-8'
    )
  }
  return rel
}

// ---------- 产物守卫（候选 2e：target 存在性防线，2026-09-13）----------
// 背景：结构化输出课已证模型会编造 target（如 人物/x.md 不存在），提示词给规则不给清单时
// syncSystem 只约束「只许用真实存在的文件」，构造出的 target 仍可能越网 → applyProposal
// 会用 after 直接新建残缺人物档案（无基础档案模板），污染人物列表、注入端读到残缺档。
// 解法（AEGIS pre-execution firewall 范式：执行前对照受控词汇表校验）：runSync 组装
// 「现有 人物/ 档案清单 + 本章涉及人物」，guard 对照校验——精确命中保留、近名唯一则纠正、
// 涉及人物未建档给出明确提示、再无可能则丢弃，全部记入 issues 供 UI 可见。

function normName(s: string): string {
  return s.replace(/[\s\u3000_]/g, '').toLowerCase()
}

/** 字符级编辑距离（Levenshtein），用于近名纠正的相似度度量 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = new Array<number>(n + 1).fill(0).map((_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1).fill(0)
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/**
 * 人物 target 存在性守卫：
 * - `人物/<名>.md` 且 <名> 在 knownFiles（现有档案）→ 保留；
 * - 不在 knownFiles 但在 chapterCast（本章涉及人物）→ 丢弃并说明「未建档」（作者先建档案，同步不替作者建档）；
 * - 都不在 → 唯一近名（编辑距离 ≤ max(1, floor(min(名长)/3))）自动纠正为 `人物/<最近名>.md`；无/多候选 → 丢弃。
 * 非人物 target（世界观/大纲/... ）一律不动。返回保留集 + issues（被纠正/被丢弃的原 target 与理由）。
 */
export function guardPersonTargets(
  items: ProposalItem[],
  opts: { knownFiles: string[]; chapterCast: string[] }
): { items: ProposalItem[]; issues: import('../../shared/types').SyncIssue[] } {
  const files = new Set(opts.knownFiles)
  const cast = new Set(opts.chapterCast)
  const issues: import('../../shared/types').SyncIssue[] = []
  const kept: ProposalItem[] = []
  for (const it of items) {
    if (!it.target.startsWith('人物/')) {
      kept.push(it)
      continue
    }
    const raw = it.target.slice('人物/'.length)
    const name = raw.replace(/\.md$/, '')
    if (files.has(name)) {
      kept.push(it)
      continue
    }
    if (cast.has(name)) {
      issues.push({
        target: it.target,
        action: 'dropped',
        reason: `本章「涉及人物」已列 ${name}，但 人物/${name}.md 尚未建档（作者未建档案，同步不替建，请先建档案）`
      })
      continue
    }
    const nn = normName(name)
    let best = ''
    let bestD = Number.MAX_SAFE_INTEGER
    let secondD = Number.MAX_SAFE_INTEGER
    for (const f of opts.knownFiles) {
      const d = editDistance(nn, normName(f))
      if (d < bestD) {
        secondD = bestD
        bestD = d
        best = f
      } else if (d >= bestD && d < secondD) {
        secondD = d
      }
    }
    const thresh = Math.max(1, Math.floor(Math.min(nn.length, normName(best).length) / 3))
    if (best && bestD <= thresh && secondD > bestD) {
      kept.push({ ...it, target: `人物/${best}.md` })
      issues.push({
        target: it.target,
        action: 'corrected',
        reason: `「${raw}」与现有档案近似，已纠正为 人物/${best}.md`
      })
    } else {
      issues.push({
        target: it.target,
        action: 'dropped',
        reason: `人物/${name}.md 不存在，且无唯一近名档案可纠正（模型编造或笔误）——已丢弃，请人工确认`
      })
    }
  }
  return { items: kept, issues }
}
