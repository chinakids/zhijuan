import { describe, expect, it } from 'vitest'
import { orderProjects } from '../../src/shared/projects'
import type { ProjectSummary } from '../../src/shared/types'

function p(id: string, name: string, description: string, updatedAt: number): ProjectSummary {
  return {
    id,
    name,
    description,
    createdAt: 0,
    updatedAt,
    stats: { chapters: 0, characters: 0, worldviewFiles: 0, materials: 0 }
  }
}

describe('orderProjects（首页过滤 + 排序）', () => {
  const list = [
    p('a', '雾港', '海边的故事', 100),
    p('b', '山那边', '山里的故事', 200),
    p('c', '灯下集', '短篇合集', 300)
  ]

  it('query 为空时返回全部，且未打开过的按 updatedAt 降序', () => {
    const out = orderProjects(list, [], '')
    expect(out.map((x) => x.id)).toEqual(['c', 'b', 'a'])
  })

  it('最近打开的项目置顶：按 openedAt 降序，未打开的按 updatedAt 降序排后', () => {
    const out = orderProjects(
      list,
      [
        { id: 'a', openedAt: 50 },
        { id: 'b', openedAt: 500 }
      ],
      ''
    )
    expect(out.map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })

  it('再打开一次已存在的项目 = 置顶（去重 + 新时间戳）', () => {
    const out = orderProjects(
      list,
      [
        { id: 'a', openedAt: 500 },
        { id: 'b', openedAt: 400 },
        { id: 'a', openedAt: 600 }
      ],
      ''
    )
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('recents 里指向不存在项目的 id 被忽略（不炸、不占位）', () => {
    const out = orderProjects(list, [{ id: 'ghost', openedAt: 9999 }], '')
    expect(out.map((x) => x.id)).toEqual(['c', 'b', 'a'])
  })

  it('query 按 名称/简介 大小写不敏感子串过滤，排序规则不变', () => {
    const out = orderProjects(list, [], '山')
    expect(out.map((x) => x.id)).toEqual(['b'])
    const out2 = orderProjects(list, [], '海边')
    expect(out2.map((x) => x.id)).toEqual(['a'])
  })

  it('query 全空白等价于无过滤；无命中返回空数组', () => {
    expect(orderProjects(list, [], '   ')).toHaveLength(3)
    expect(orderProjects(list, [], '不存在')).toHaveLength(0)
  })

  it('过滤与最近打开叠加：命中的按 recents 排', () => {
    const out = orderProjects(
      list,
      [
        { id: 'c', openedAt: 100 },
        { id: 'b', openedAt: 900 }
      ],
      '的'
    )
    expect(out.map((x) => x.id)).toEqual(['b', 'a'])
  })
})
