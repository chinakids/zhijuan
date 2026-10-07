import { describe, expect, it } from 'vitest'
import { chapterNeighbors, chapterNavLabel } from '../../src/shared/chapterNav'
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

describe('chapterNavLabel（按钮辅助标注：第N章 · 题名）', () => {
  it('有 fm：章号+题名', () => {
    expect(chapterNavLabel(ch('第01章_开场.md', 1, '开场'))).toBe('第1章 · 开场')
  })

  it('无 fm：文件名兜底', () => {
    expect(chapterNavLabel(ch('片段.md'))).toBe('片段.md')
  })
})
