import { describe, expect, it } from 'vitest'
import { countWords, stripChapterGuideBlock } from '../../src/shared/count'

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

  it('建章写入的「本章故事要素」指引块不计入字数（F-20261027-02）', () => {
    const md = [
      '---',
      '章号: 1',
      '题名: 渡口',
      '切片: 第一幕',
      '涉及人物: [林晚]',
      '---',
      '',
      '> == 本章故事要素 ==',
      '> - 目标：把船撑到对岸',
      '> - 核心冲突：夜里起了雾',
      '> - 关键事件：灯笼灭了一次',
      '> - 前情呼应：上一章的信',
      '>',
      '> （本章写作指引：可随进度修改；保存后随正文进入切片同步与 agent 上下文）',
      '',
      '# 渡口'
    ].join('\n')
    // 只剩题名「渡口」=2 字（要素块整块剥掉，含其后的空行）
    expect(countWords(md)).toBe(2)
    // 未动笔的新建章：剥完只剩空 → 0
    expect(countWords(md.replace('# 渡口', ''))).toBe(0)
    // 写了正文后只计正文
    expect(countWords(md + '\n\n雾从江面漫上来，灯笼晃了一下。')).toBe(17)
  })

  it('编辑器回写后的要素块（Milkdown 把 == 转义成 \\==、- 转 *）同样剥掉', () => {
    const md = [
      '> \\== 本章故事要素 ==',
      '>',
      '> * 目标：把船撑到对岸',
      '> * 核心冲突：夜里起了雾',
      '>',
      '> （本章写作指引：可随进度修改；保存后随正文进入切片同步与 agent 上下文）',
      '',
      '# 渡口',
      '',
      '雾从江面漫上来。'
    ].join('\n')
    expect(countWords(md)).toBe(10)
    expect(stripChapterGuideBlock(md).trim()).toBe('# 渡口\n\n雾从江面漫上来。')
  })

  it('正文中间的引用块与「要素块」字样不算章首指引块（非该形态零影响）', () => {
    expect(stripChapterGuideBlock('开场正文。\n\n> == 本章故事要素 ==\n> - 目标：X')).toBe(
      '开场正文。\n\n> == 本章故事要素 ==\n> - 目标：X'
    )
    // 章首是普通过引文（题记），不是要素块 → 原样保留
    expect(stripChapterGuideBlock('---\n章号: 2\n---\n\n> 题记：夜航\n\n正文')).toBe(
      '> 题记：夜航\n\n正文'
    )
  })
})
