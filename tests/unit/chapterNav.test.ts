import { describe, expect, it } from 'vitest'
import { chapterNeighbors, chapterNeighborsIn, chapterNavLabel } from '../../src/shared/chapterNav'
import type { ChapterEntry } from '../../src/shared/types'

function ch(file: string, no?: number, title = '', name?: string): ChapterEntry {
  return { file, name: name ?? file, mtime: 0, wordCount: 0, fm: no === undefined ? null : { 章号: no, 题名: title || undefined } } as ChapterEntry
}

describe('chapterNeighbors（章导航相邻：与章节列表序一致）', () => {
  const list = [ch('第01章_开场.md', 1, '开场'), ch('第02章_发展.md', 2, '发展'), ch('第03章_高潮.md', 3, '高潮')]

  it('中间章：prev/next 都取相邻条目', () => {
    expect(chapterNeighbors(list, '第02章_发展.md')).toEqual({ prev: list[0], next: list[2] })
  })

  it('第一章：prev=null', () => {
    expect(chapterNeighbors(list, '第01章_开场.md')).toEqual({ prev: null, next: list[1] })
  })

  it('最后一章：next=null', () => {
    expect(chapterNeighbors(list, '第03章_高潮.md')).toEqual({ prev: list[1], next: null })
  })

  it('无选中/未找到/单章：双 null（边界安全）', () => {
    expect(chapterNeighbors(list, null)).toEqual({ prev: null, next: null })
    expect(chapterNeighbors(list, '不存在.md')).toEqual({ prev: null, next: null })
    expect(chapterNeighbors([list[0]], '第01章_开场.md')).toEqual({ prev: null, next: null })
  })
})

describe('chapterNeighborsIn（镜头内章导航：domain=章列可见集，2026-10-27 体验层）', () => {
  // 阅读序 6 章：主线 1/3/5、过去线 2/4/6（与 demo-order「潮汐的岔路」同构）
  const main = [ch('第01章_晨港.md', 1, '晨港'), ch('第02章_旧港.md', 2, '旧港'), ch('第03章_灯塔.md', 3, '灯塔'),
    ch('第04章_长堤.md', 4, '长堤'), ch('第05章_归航.md', 5, '归航'), ch('第06章_旧港之二.md', 6, '旧港之二')]
  const past = [main[1], main[3], main[5]]

  it('可见集=全量 → 与 chapterNeighbors 完全一致（零回归）', () => {
    for (const c of main) expect(chapterNeighborsIn(main, main, c.file)).toEqual(chapterNeighbors(main, c.file))
  })

  it('筛「过去线」+ 选中第2章 → 下一章=第4章（跳过主线第3章）', () => {
    expect(chapterNeighborsIn(main, past, main[1].file)).toEqual({ prev: null, next: main[3] })
  })

  it('筛「过去线」+ 选中中间章 → 前后都取线内相邻章', () => {
    expect(chapterNeighborsIn(main, past, main[3].file)).toEqual({ prev: main[1], next: main[5] })
  })

  it('筛「过去线」+ 选中末章 → 下一章 null（线内到底，不退化为跨线）', () => {
    expect(chapterNeighborsIn(main, past, main[5].file)).toEqual({ prev: main[3], next: null })
  })

  it('选中章不在镜头内 → 就近安置：主线第1章 → 下一章=第2章', () => {
    expect(chapterNeighborsIn(main, past, main[0].file)).toEqual({ prev: null, next: main[1] })
  })

  it('选中章不在镜头内（夹在线内章之间）→ 前后各取最近的线内章', () => {
    expect(chapterNeighborsIn(main, past, main[2].file)).toEqual({ prev: main[1], next: main[3] })
  })

  it('可见集为空 / 无选中 / 选中章不存在 → 双 null（边界安全）', () => {
    expect(chapterNeighborsIn(main, [], main[0].file)).toEqual({ prev: null, next: null })
    expect(chapterNeighborsIn(main, past, null)).toEqual({ prev: null, next: null })
    expect(chapterNeighborsIn(main, past, '不存在.md')).toEqual({ prev: null, next: null })
  })
})

describe('chapterNavLabel（按钮辅助标注：第N章 · 题名）', () => {
  it('有 fm：章号+题名', () => {
    expect(chapterNavLabel(ch('第01章_开场.md', 1, '开场'))).toBe('第1章 · 开场')
  })

  it('无 fm：文件名兜底', () => {
    expect(chapterNavLabel(ch('片段.md'))).toBe('片段.md')
  })
})
