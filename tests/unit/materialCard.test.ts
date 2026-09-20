import { describe, expect, it } from 'vitest'
import { isMaterialCard, materialPreview, materialTags, materialContextPreview } from '../../src/shared/materialCard'

describe('shared/materialCard（2026-09-18 从 LibraryBrowser 抽取：素材卡文件判据/标签/预览单一权威源）', () => {
  it('isMaterialCard：排除 采集池/ 任务卡、索引.md 目录文档、隐藏文件', () => {
    expect(isMaterialCard('桥段/旧物定情.md')).toBe(true)
    expect(isMaterialCard('环境/雾海夜航.md')).toBe(true)
    expect(isMaterialCard('采集池/任务_1.md')).toBe(false)
    expect(isMaterialCard('索引.md')).toBe(false)
    expect(isMaterialCard('.hidden.md')).toBe(false)
  })

  it('materialTags：兼容 `标签:`（旧演示）与 `tags:`（模块设计）两种键，数组/字符串都解析', () => {
    expect(materialTags('---\n标签: [桥段, 旧物, 相遇]\n---\n正文')).toEqual(['桥段', '旧物', '相遇'])
    expect(materialTags('---\ntags: [环境, 雾]\n---\n正文')).toEqual(['环境', '雾'])
    expect(materialTags('---\n标签: 桥段,旧物\n---\n正文')).toEqual(['桥段', '旧物'])
    expect(materialTags('---\n其他: x\n---\n正文')).toEqual([])
    expect(materialTags('无约定头')).toEqual([])
  })

  it('materialPreview：第一个非空行（含标题行——采集草稿题名在 H1 里，与文件名不同源）；剥 Markdown 标记后截 max 字符', () => {
    const doc = ['---', '标签: [环境]', '---', '', '# 雾海夜航', '', '大雾的夜里，港口的能见度往往不足五十米。', ''].join('\n')
    expect(materialPreview(doc)).toBe('雾海夜航') // 首非空行=标题行；UI 预览剥 `# ` 标记（2026-09-20 体验层走查）
    expect(materialPreview('---\ntags: [x]\n---\n\n# 唯一标题行\n')).toBe('唯一标题行')
    const long = '长'.repeat(100)
    const got = materialPreview('---\ntags: []\n---\n\n' + long, 48)
    expect(got).toHaveLength(48 + 1) // 48 字 + '…'
    expect(got.endsWith('…')).toBe(true)
  })

  it('materialContextPreview：H1=素材名（模板素材）→ 取正文行做增量；题名≠文件名（采集草稿）→ 保留题名；空壳→空', () => {
    // 模板素材：H1=文件名 → 预览=正文行
    const tpl = ['---', '标签: [桥段]', '---', '', '# 旧物定情', '', '用一个旧物件串起两人第一次真正交集的场景。', ''].join('\n')
    expect(materialContextPreview(tpl, '旧物定情')).toContain('用一个旧物件串起')
    expect(materialContextPreview(tpl, '旧物定情')).not.toContain('#')
    // 采集草稿：H1=内容题名 ≠ 文件名 → 预览=题名
    const draft = ['---', '标签: [图书馆]', '---', '', '# 校园老图书馆（采集草稿）', '', '> 采集自公开网络，**草稿**。', ''].join('\n')
    expect(materialContextPreview(draft, '采集_演示图书馆')).toContain('校园老图书馆')
    // 模板空壳：无正文行 → 空（路标只留文件名+标签）
    const shell = ['---', '标签: [桥段]', '---', '', '# 旧物定情', '', '## 用途', ''].join('\n')
    expect(materialContextPreview(shell, '旧物定情')).toBe('')
    // 截断
    const long = '索'.repeat(100)
    expect(materialContextPreview('# 名\n' + long, '名', 48)).toBe('索'.repeat(48) + '…')
  })
})
