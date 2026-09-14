import { describe, expect, it } from 'vitest'
import { charDocMarkdown, quickCharDocMarkdown } from '../../src/shared/charDoc'

describe('charDocMarkdown（人物档案模板单一权威源，2026-09-15 从 ProjectGuide 抽出）', () => {
  it('与项目引导原版逐字符同构：约定头/H1/定位/关键特征/基础档案/注释', () => {
    const md = charDocMarkdown('林晚', '高中生', '沉静寡言')
    expect(md).toBe(
      '---\n别名: []\n---\n' +
        '# 林晚\n\n' +
        '> 定位：高中生\n' +
        '> 关键特征：沉静寡言\n\n' +
        '## 基础档案\n\n' +
        '（年龄 / 外貌 / 背景 / 性格取向，按需补写）\n\n' +
        '<!-- 正文保存时，切片同步会把 TA 在本章的新状态写入「## 切片：<切片名>」小节（没有则自动追加）；基础档案是长期设定，请在这里手动维护，勿与切片小节混写。 -->\n' +
        '<!-- 若 TA 在正文里还有别的称呼（昵称/化名），把「别名: [小七, 七爷]」写进顶部 front matter——「在场/称谓」机械检查会按它识别。 -->\n'
    )
  })

  it('名称注入：front matter 不动、H1 与文本中的名字正确', () => {
    const md = charDocMarkdown('阿七', '守灯人', '热心')
    expect(md.startsWith('---\n别名: []\n---\n# 阿七\n')).toBe(true)
    expect(md).toContain('> 定位：守灯人')
    expect(md).toContain('> 关键特征：热心')
  })

  it('quickCharDocMarkdown：role/traits 用括号占位（作者待填项），其余同构', () => {
    const md = quickCharDocMarkdown('新角色1')
    expect(md.startsWith('---\n别名: []\n---\n# 新角色1\n')).toBe(true)
    expect(md).toContain('> 定位：（身份 / 职业）')
    expect(md).toContain('> 关键特征：（关键特征，待补充）')
    expect(md).toContain('## 基础档案')
    expect(md).toContain('<!-- 正文保存时')
  })
})
