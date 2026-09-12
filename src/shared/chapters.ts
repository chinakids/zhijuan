// ===== 织卷 · 章节列表解析（共享纯函数，2026-09-12 第 19 轮） =====
// 约定头是正文唯一半结构化锚（模块设计 §2.3）；「列出章节」是 store（真机）与 devShim（浏览器 mock）
// 共用的口径，抽成纯函数避免两侧实现分叉——2026-09-10/09-11 已多次因 mock 与真机不同口径
// 造成无头冒烟「mock 假绿」（listDocs 剥 .md、涉及人物解析缺字段、searchDocs 缺 limit/起点）。
import { extractFrontMatter } from './fmatter'
import { countWords } from './count'
import type { ChapterEntry, ChapterFrontMatter } from './types'

export interface ChapterSource {
  /** 相对「正文」目录的路径（含子目录），如 第01章_雾港.md */
  file: string
  /** 去扩展名的显示名（basename 剥 .md；与 store.listDocs 的 name 同口径） */
  name: string
  /** 全文（含 front matter） */
  text: string
  /** 文件修改时间（无头 mock 可用模拟值；仅透传展示） */
  mtime: number
}

/** 文件名里的章号（第NN章；匹配不到 → Infinity 排最后） */
function numOf(name: string): number {
  const m = name.match(/第(\d+)章/)
  return m ? Number(m[1]) : Infinity
}

/**
 * 章节列表：与真机 store.listChapters 完全同口径——
 * extractFrontMatter 解析约定头；ok 判据 = 存在（章号/切片/题名）任一关键字段；
 * 「章号」在此归一成数值一次（extractFrontMatter 一律按字符串返回，类型为 number）；
 * 排序按文件名第N章（无号排最后）；wordCount 按 countWords（剥约定头与标记）。
 */
export function listChapterEntries(sources: ChapterSource[]): ChapterEntry[] {
  return sources
    .map((d) => {
      const { fm } = extractFrontMatter(d.text)
      const c = fm as unknown as ChapterFrontMatter | null
      const ok = !!c && (c['章号'] !== undefined || c['切片'] !== undefined || c['题名'] !== undefined)
      if (ok && c) {
        const n = Number(c['章号'])
        if (Number.isFinite(n)) c['章号'] = n
      }
      return {
        file: d.file,
        name: d.name,
        fm: ok ? c : null,
        wordCount: countWords(d.text),
        mtime: d.mtime,
        hasPendingProposal: false
      }
    })
    .sort((a, b) => numOf(a.name) - numOf(b.name))
}
