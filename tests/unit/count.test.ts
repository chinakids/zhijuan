import { describe, expect, it } from 'vitest'
import { countWords } from '../../src/shared/count'

describe('countWords（真实正文字数）', () => {
  it('去掉 front matter 与 Markdown 标记后再计字符', () => {
    const md = [
      '---',
      '章号: 1',
      '题名: 示例',
      '---',
      '',
      '# 开端',
      '',
      '正文第一段内容写在这里。',
      '',
      '> 引用行内容也算正文',
      '',
      '- 列表项文字'
    ].join('\n')
    // 计：正文第一段内容写在这里。=12，引用行内容也算正文=9，列表项文字=5，标题文字开端=2（只剥 # 标记）
    expect(countWords(md)).toBe(28)
  })

  it('链接只算可见文字', () => {
    expect(countWords('[织卷](https://example.com)')).toBe(2)
  })

  it('连续西文字母数字按一个词计（V2 / deepseek 各算 1 个；中文标点仍算可见字符）', () => {
    expect(countWords('V2 版本，deepseek 模型')).toBe(7)
  })

  it('无 front matter 也能直接算；全文空白得 0', () => {
    expect(countWords('只有正文')).toBe(4)
    expect(countWords('---\n键: 值\n---')).toBe(0)
  })

  it('HTML 注释（元信息/占位提示）不计入字数，且跨行注释也剥', () => {
    expect(countWords('<!-- 分幕草稿缺第 2 段：此处情节未写成，待补齐 -->\n\n正文内容')).toBe(4)
    expect(countWords('开头\n<!-- 跨行\n注释 -->\n结尾')).toBe(4)
  })
})
