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
