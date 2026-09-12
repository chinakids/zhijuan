// ===== 织卷 · 时间切片枚举（共享纯函数，2026-09-12 第 19 轮） =====
// 正文是切片唯一源（模块设计 §14 之 / 评审 D2）；main/slices（真机）与 devShim（浏览器 mock）
// 共用同一枚举口径，避免两侧解析分叉（此前 mock 用正则手写、缺「时间」字段，与真机不一致）。
import { extractFrontMatter } from './fmatter'
import type { SliceEntry } from './types'

export interface SliceSource {
  /** 文件名（正文/ 下，含 .md） */
  file: string
  /** 全文（含 front matter） */
  text: string
  /** 文件修改时间（mock 无盘可传 0/模拟值；仅透传） */
  updatedAt: number
}

/** 章头「涉及人物」字段（安全取数组） */
function chapterChars(fm: Record<string, unknown> | null): string[] {
  const v = fm?.['涉及人物']
  return Array.isArray(v) ? v.map(String).filter(Boolean) : []
}

/** 按章号数值排序（第2章 在 第10章 前）；同号或解析不出时按文件名兜底 */
function noOf(s: SliceEntry): number {
  const m = s.chapter.match(/第\s*(\d+)/)
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER
}

/**
 * 时间切片枚举：与真机 main/slices.listSlices 完全同口径——
 * extractFrontMatter 解析；切片名为空跳过；「时间」键透传（无则 undefined）；
 * 涉及人物取数组；按章号数值升序，同号/无号按章节名 localeCompare（zh）兜底。
 */
export function listSliceEntries(sources: SliceSource[]): SliceEntry[] {
  const out: SliceEntry[] = []
  for (const s of sources) {
    const { fm } = extractFrontMatter(s.text)
    const name = String(fm?.['切片'] ?? '').trim()
    if (!name) continue
    out.push({
      name,
      chapter: s.file.replace(/\.md$/, ''),
      time: String(fm?.['时间'] ?? '').trim() || undefined,
      chars: chapterChars(fm),
      updatedAt: s.updatedAt
    })
  }
  out.sort((a, b) => {
    const na = noOf(a)
    const nb = noOf(b)
    if (na !== nb) return na - nb
    return a.chapter.localeCompare(b.chapter, 'zh')
  })
  return out
}
