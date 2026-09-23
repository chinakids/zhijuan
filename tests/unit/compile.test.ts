import { describe, expect, it } from 'vitest'
import { compileNovel, mdToHtml } from '../../src/shared/compile'

const chapter = (name: string, fm: string, body: string) => `${fm}\n${body}`

describe('compileNovel（作品编译·整书合并导出）', () => {
  it('按给定顺序拼接：剥 front matter、章号题名作一级标题、章间空行、文件尾换行', () => {
    const c1 = chapter(
      '第01章_雾港',
      '---\n章号: 1\n题名: 雾港栈桥\n切片: [开局]\n时间线: [主线]\n涉及人物: [沈藏]\n---',
      '雾很大，栈桥隐没在灰白里。'
    )
    const c2 = chapter('第02章_灯下', '---\n章号: 2\n题名: 灯下\n---', '他点亮了煤油灯。')
    const out = compileNovel([
      { name: '第01章_雾港', text: c1, line: '主线' },
      { name: '第02章_灯下', text: c2, line: '主线' }
    ])
    expect(out).toBe(
      '# 第1章 雾港栈桥\n\n雾很大，栈桥隐没在灰白里。\n\n# 第2章 灯下\n\n他点亮了煤油灯。\n'
    )
    expect(out).not.toContain('章号:')
    expect(out).not.toContain('---')
  })

  it('无 front matter 的文档：标题回退显示名，正文原样', () => {
    const out = compileNovel([{ name: '后记', text: '写完了。', line: '主线' }])
    expect(out).toBe('# 后记\n\n写完了。\n')
  })

  it('剥 HTML 注释（分幕缺段占位注释不入成品）', () => {
    const text = '正文一段。\n<!-- 分幕草稿缺第 2 段：此处情节未写成，待补齐 -->\n正文二段。'
    const out = compileNovel([{ name: '第01章', text, line: '主线' }])
    // 注释行剥离后留下空行 = Markdown 段落分隔（注释曾独占一行），内容不丢
    expect(out).toBe('# 第01章\n\n正文一段。\n\n正文二段。\n')
    expect(out).not.toContain('<!--')
  })

  it('空章（剥后无内容）跳过不占位', () => {
    const c1 = chapter('第01章', '---\n章号: 1\n---', '   ')
    const c2 = chapter('第02章', '---\n章号: 2\n题名: 有字\n---', '正文字。')
    const out = compileNovel([
      { name: '第01章', text: c1, line: '主线' },
      { name: '第02章', text: c2, line: '主线' }
    ])
    expect(out).toBe('# 第2章 有字\n\n正文字。\n')
  })

  it('多线注记：非主线章标题尾加（线：X）；主线不加', () => {
    const past = chapter('第01章_旧历', '---\n章号: 1\n题名: 旧历\n---', '过去。')
    const main = chapter('第02章_灯下', '---\n章号: 2\n题名: 灯下\n---', '现在。')
    const out = compileNovel([
      { name: '第01章_旧历', text: past, line: '过去线' },
      { name: '第02章_灯下', text: main, line: '主线' }
    ])
    expect(out).toContain('# 第1章 旧历（线：过去线）\n\n过去。')
    expect(out).toContain('# 第2章 灯下\n\n现在。')
  })

  it('annotateLines:false 时不加线注记', () => {
    const past = chapter('第01章_旧历', '---\n章号: 1\n题名: 旧历\n---', '过去。')
    const out = compileNovel([{ name: '第01章_旧历', text: past, line: '过去线' }], {
      annotateLines: false
    })
    expect(out).toBe('# 第1章 旧历\n\n过去。\n')
  })

  it('空章节列表 → 空串（调用方按「没有可导出的正文」提示）', () => {
    expect(compileNovel([])).toBe('')
  })

  it('章号缺失但题名在：标题只有题名；题名缺失章号在：标题=第N章+显示名', () => {
    const a = chapter('第01章', '---\n题名: 无号之章\n---', 'A。')
    const b = chapter('第02章_无名', '---\n章号: 2\n---', 'B。')
    const out = compileNovel([
      { name: '第01章', text: a, line: '主线' },
      { name: '第02章_无名', text: b, line: '主线' }
    ])
    expect(out).toContain('# 无号之章\n\nA。')
    expect(out).toContain('# 第2章 第02章_无名\n\nB。')
  })
})

describe('mdToHtml（作品编译 Word 导出转换层，零依赖）', () => {
  it('标题/段落/强调/无序列表转 HTML 骨架', () => {
    const html = mdToHtml('# 第1章 雾港\n\n雾很大，栈桥**隐没**在灰白里。\n\n- 甲\n- 乙')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<h1>第1章 雾港</h1>')
    expect(html).toContain('<p>雾很大，栈桥<strong>隐没</strong>在灰白里。</p>')
    expect(html).toContain('<ul><li>甲</li><li>乙</li></ul>')
  })

  it('特殊字符转义；*斜体* 与 `代码` 行内标记', () => {
    const html = mdToHtml('A & B < C > D "E"\n\n*斜* 与 `码`')
    expect(html).toContain('<p>A &amp; B &lt; C &gt; D &quot;E&quot;</p>')
    expect(html).toContain('<em>斜</em>')
    expect(html).toContain('<code>码</code>')
  })

  it('引用块、分割线、二级标题', () => {
    const html = mdToHtml('> 引言\n\n---\n\n## 小节')
    expect(html).toContain('<blockquote>引言</blockquote>')
    expect(html).toContain('<hr/>')
    expect(html).toContain('<h2>小节</h2>')
  })

  it('空串 → 空字符串（调用方按「没有可导出的正文」提示）', () => {
    expect(mdToHtml('')).toBe('')
  })

  it('未配对强调符按纯文本保留（不产残标签）', () => {
    const html = mdToHtml('价格 2 * 3')
    expect(html).toContain('价格 2 * 3')
    expect(html).not.toContain('<em>')
  })
})
