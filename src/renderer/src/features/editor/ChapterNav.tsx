import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ChapterEntry } from '../../../../shared/types'
import { chapterNeighbors, chapterNavLabel } from '../../../../shared/chapterNav'
import { Button } from '../../components/ui/button'

/**
 * 正文「上一章/下一章」导航（2026-10-07 创作层）——多章连写闭环：写完一章→下一章无需回侧栏找。
 * 位置=DocEditor 底部状态条右组（经 Novel statusExtra 注入，与规则体检同排=不单独占行 F-20260917-07）。
 * 形态=icon-only（③级功能点：icon+title+aria 双写）；边界=无相邻章时禁用并明示（已是第一章/最后一章）。
 * 语义=章号线性（与章节列表序一致）；窄窗（effectiveNarrow）经 hidden 隐藏（状态条空间被压缩，防溢出）。
 */
export default function ChapterNav({
  list,
  sel,
  onGo,
  hidden
}: {
  list: ChapterEntry[]
  sel: string | null
  onGo: (file: string) => void
  hidden?: boolean
}) {
  if (hidden) return null
  const { prev, next } = chapterNeighbors(list, sel)
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        disabled={!prev}
        className="h-6 w-6"
        data-testid="chapter-prev"
        onClick={() => prev && onGo(prev.file)}
        title={prev ? `上一章：${chapterNavLabel(prev)}` : '已是第一章'}
        aria-label={prev ? `上一章：${chapterNavLabel(prev)}` : '已是第一章'}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={!next}
        className="h-6 w-6"
        data-testid="chapter-next"
        onClick={() => next && onGo(next.file)}
        title={next ? `下一章：${chapterNavLabel(next)}` : '已是最后一章'}
        aria-label={next ? `下一章：${chapterNavLabel(next)}` : '已是最后一章'}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </span>
  )
}
