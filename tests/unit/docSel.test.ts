import { describe, expect, it } from 'vitest'
import { resolveDocSel } from '../../src/renderer/src/features/docs/docSel'

describe('resolveDocSel：DocSection 选中项与列表一致性', () => {
  const relDir = '人物'
  const files = [
    { file: '阿七.md', name: '阿七' },
    { file: '总览.md', name: '总览' },
    { file: '沈藏.md', name: '沈藏' }
  ]

  it('选中项存在 → 保持', () => {
    expect(resolveDocSel('人物/阿七.md', files, relDir)).toBe('人物/阿七.md')
    expect(resolveDocSel('人物/总览.md', files, relDir)).toBe('人物/总览.md')
  })

  it('选中项不在列表（overview 缺失/被删）→ 置空，不选中不存在的文档', () => {
    expect(resolveDocSel('人物/总览.md', files.filter((f) => f.file !== '总览.md'), relDir)).toBeNull()
    expect(resolveDocSel('人物/幽灵.md', files, relDir)).toBeNull()
  })

  it('空选中 → null；跨目录路径不复用他目录同名文档', () => {
    expect(resolveDocSel(null, files, relDir)).toBeNull()
    // 世界观/总纲.md 是别的 relDir 的文档，人物页不应视为存在
    expect(resolveDocSel('世界观/总纲.md', files, '人物')).toBeNull()
  })
})
