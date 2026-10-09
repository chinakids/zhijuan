// ===== 织卷 · 章节重排（上移/下移）纯函数（2026-10-09 创作层） =====
// 语义：章节顺序 = 列表显示序（文件名「第N章」前缀，shared/chapters 排序口径）；「上移/下移」=
// 与相邻章交换章号（文件名前缀 + 约定头 章号 值）。纯函数只做规划（换谁的号、新文件名是什么），
// 文件系统执行在 main/store.reorderChapter，devShim 也复用本模块（无头冒烟同口径）。
// 注：与 shared/chapterorder（切片时序核查 R1-R7）只差大小写——macOS 不区分大小写，勿合并/勿改名互撞。
import { sanitizeFile } from './paths'

export interface ReorderEntry {
  /** 正文内文件名（含 .md），如 第01章_雾港.md */
  file: string
  /** 约定头题名（fm['题名']），仅当文件名不规范（无 _ 后缀）时用于生成新文件名 */
  title?: string
}

export type ReorderPlan =
  | { ok: false; error: string }
  | {
      ok: true
      /** 移动章旧文件名（含 .md） */
      a: string
      /** 相邻章旧文件名（含 .md） */
      b: string
      /** 移动章的新章号（= 相邻章旧文件名章号） */
      aNum: number
      /** 相邻章的新章号（= 移动章旧文件名章号） */
      bNum: number
      /** 移动章新文件名（含 .md） */
      aNew: string
      /** 相邻章新文件名（含 .md） */
      bNew: string
    }

/** 文件名章号：^第(\d+)章；不匹配返回 null（列表序按 numOf 排最后的非规范名） */
export function chapterFileNum(name: string): number | null {
  const m = name.match(/^第(\d+)章/)
  return m ? Number(m[1]) : null
}

/**
 * 重排规划：把 rel（正文内文件名）与相邻章交换章号。
 * dir = -1（上移，与前一章交换）/ 1（下移，与后一章交换）。
 * entries 传列表显示序（listChapters 返回序）即可。
 */
export function reorderPlan(entries: ReorderEntry[], rel: string, dir: number): ReorderPlan {
  if (dir !== -1 && dir !== 1) return { ok: false, error: '无效方向' }
  const idx = entries.findIndex((e) => e.file === rel)
  if (idx < 0) return { ok: false, error: '章节不存在' }
  const a = entries[idx]
  const aNum = chapterFileNum(a.file)
  if (aNum === null) return { ok: false, error: '章节文件名缺少「第N章」编号，请先重命名规范化' }
  const j = idx + dir
  if (j < 0) return { ok: false, error: '已是第一章' }
  if (j >= entries.length) return { ok: false, error: '已是最后一章' }
  const b = entries[j]
  const bNum = chapterFileNum(b.file)
  if (bNum === null) return { ok: false, error: '章节文件名缺少「第N章」编号，请先重命名规范化' }
  if (aNum === bNum) return { ok: false, error: '章节编号重复，请先修复命名' }
  const mk = (num: number, old: ReorderEntry): string => {
    const i = old.file.indexOf('_')
    const suffix = i >= 0 ? old.file.slice(i) : '_' + sanitizeFile(old.title ?? old.file.replace(/\.md$/, '')) + '.md'
    return `第${String(num).padStart(2, '0')}章${suffix}`
  }
  return { ok: true, a: a.file, b: b.file, aNum: bNum, bNum: aNum, aNew: mk(bNum, a), bNew: mk(aNum, b) }
}
