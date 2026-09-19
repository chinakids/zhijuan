// ===== 织卷 · 时间切片枚举（共享纯函数，2026-09-12 第 19 轮） =====
// 正文是切片唯一源（模块设计 §14 之 / 评审 D2）；main/slices（真机）与 devShim（浏览器 mock）
// 共用同一枚举口径，避免两侧解析分叉（此前 mock 用正则手写、缺「时间」字段，与真机不一致）。
import { extractFrontMatter } from './fmatter'
import { chapterLine } from './line'
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
      line: chapterLine(fm),
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

/**
 * 按世界切片文件命名约定（shared/paths.worldSliceFile：世界观/切片_<切片名>.md）解析文件名中的切片名。
 * 输入=相对「世界观/」的文件名（listDocs(id,'世界观') 的 file 字段口径）；
 * 非「切片_」前缀返回 null——总纲/作者自定义设定文档/旧无前缀格式（context.readWorldState 的只读兜底名）均不参与孤儿判定。
 * 注意只匹配顶层文件名（子目录嵌套文件不判，保守跳过）。
 */
export function sliceNameOfWorldFile(file: string): string | null {
  const m = /^切片_(.+)\.md$/.exec(file)
  return m ? m[1] : null
}

/**
 * 世界切片孤儿文件判定（2026-09-19 创作层）：世界文件名为「切片_<名>.md」且 <名> 不在活跃切片集合 →
 * 孤儿=切片改名后保留的历史快照（已退出活跃流：context 装配按当前章切片名读、writeRegistry 不登记）。
 * 供浏览面标注（世界观页 DocSection「历史」徽标）；不提供删除/列表入口（语义=保留为历史，见口径表）。
 */
export function orphanWorldFiles(files: string[], activeSliceNames: string[]): string[] {
  const active = new Set(activeSliceNames)
  return files.filter((f) => {
    const n = sliceNameOfWorldFile(f)
    return n !== null && !active.has(n)
  })
}
