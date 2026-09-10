import { describe, expect, it } from 'vitest'
import { buildLibraryTree } from '../../src/shared/libraryTree'

describe('buildLibraryTree（shared 纯逻辑）', () => {
  it('categories + files 组装：类别按名称排序、文件按 mtime 新→旧、缺失目录自动补节点', () => {
    const tree = buildLibraryTree(
      [
        { name: '人物', count: 1 },
        { name: '环境', count: 2 }
      ],
      [
        { file: '环境/校园.md', name: '校园', mtime: 100 },
        { file: '人物/账房.md', name: '账房', mtime: 300 },
        { file: '环境/子/站台.md', name: '站台', mtime: 200 },
        { file: '野外/灯塔.md', name: '灯塔', mtime: 50 }
      ]
    )
    expect(tree.map((n) => n.name).sort()).toEqual(['人物', '环境', '野外'].sort())
    const person = tree.find((n) => n.name === '人物')!
    expect(person).toMatchObject({ count: 1, files: [{ file: '人物/账房.md', name: '账房', mtime: 300 }] })
    // 环境：子目录素材也计入，按 mtime 降序
    const env = tree.find((n) => n.name === '环境')!
    expect(env.count).toBe(2)
    expect(env.files.map((f) => f.name)).toEqual(['站台', '校园'])
    // 手动建的目录（不在 categories）自动补节点
    const field = tree.find((n) => n.name === '野外')!
    expect(field.count).toBe(1)
    expect(field.files[0].name).toBe('灯塔')
  })

  it('空类别保留展示（count 0）；隐藏段被忽略', () => {
    const tree = buildLibraryTree(
      [{ name: '器物', count: 0 }, { name: '场景', count: 0 }],
      [{ file: '场景/茶馆.md', name: '茶馆', mtime: 1 }, { file: '.hidden/x.md', name: 'x', mtime: 1 }]
    )
    expect(tree.find((n) => n.name === '器物')).toMatchObject({ count: 0, files: [] })
    expect(tree.find((n) => n.name === '场景')!.files).toHaveLength(1)
    expect(tree.some((n) => n.name === '.hidden')).toBe(false)
  })
})
