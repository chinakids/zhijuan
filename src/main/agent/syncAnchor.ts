// ===== 织卷 · 切片同步产物的路径/锚点归一化（纯逻辑，可单测）=====
// 背景：模块设计 §7/§8 约定——人物状态写「## 切片：<切片名>」小节（基础档案等长期小节只读），
// 世界状态写「世界观/切片_<切片名>.md」（每切片一个文件；总纲=长期不变项，不写切片状态）。
// 实测（2026-09-09 织卷smoke 数据审计）模型会：把 anchor 填成「基础档案」（→ 整节覆盖基础设定）、
// 或把世界状态指向「世界观/总纲.md」→ 这里做一层代码防线归一化，提示词同步加固。
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import type { ProposalItem } from '../../shared/types'
import { worldSliceFile } from '../../shared/paths'

/** 长期小节（只读，禁止作为「切片状态」写入锚点）；命中时归一化到「切片：<切片名>」 */
const RESERVED_ANCHORS = [
  '基础档案',
  '基础设定',
  '成长轨迹',
  '成长轨迹（按时间切片）',
  '切片状态',
  '定位',
  '关键特征',
  '姓名',
  '身份'
]

function isReserved(a: string): boolean {
  const s = (a ?? '').replace(/^#+\s*/, '').trim()
  if (!s) return true
  return RESERVED_ANCHORS.some((r) => s === r || s.startsWith(r))
}

function sliceAnchor(sliceName: string): string {
  return sliceName ? `切片：${sliceName}` : '切片状态'
}

/**
 * 把切片同步产物归一到模块设计约定：
 * - 人物/* 的目标：anchor 为空或指向长期小节 → 归一为「切片：<切片名>」（新增/替换切片小节，绝不动基础档案）；
 * - 世界观/* 的目标：只要切片名非空就指向 世界观/切片_<切片名>.md（总纲等长期文件只读）；anchor 同样归一。
 * 其余（target 不在两目录内）不动，交给后续校验。
 */
export function normalizeSyncItems(items: ProposalItem[], sliceName: string): ProposalItem[] {
  const anchor = sliceAnchor(sliceName)
  const wf = sliceName ? worldSliceFile(sliceName) : ''
  return items.map((it) => {
    let target = it.target
    let a = it.anchor ?? ''
    if (target.startsWith('人物/')) {
      if (isReserved(a)) a = anchor
    } else if (target.startsWith('世界观/')) {
      if (sliceName && target !== wf) target = wf
      if (isReserved(a)) a = anchor
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
