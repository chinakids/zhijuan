import { describe, expect, it } from 'vitest'
import { buildEpubFiles, EPUB_MIMETYPE } from '../../src/shared/epub'

const chapter = (name: string, fm: string, body: string) => `${fm}\n${body}`

const OPTS = {
  projectTitle: '雾港',
  identifier: 'urn:uuid:fixed-test-id',
  modified: new Date('2026-09-24T08:00:00Z')
}

describe('buildEpubFiles（作品编译 EPUB 导出，零依赖纯函数）', () => {
  it('容器三件 + 分章 XHTML：mimetype（无换行）/container.xml/package.opf/nav 全产出', () => {
    const c1 = chapter('第01章_雾港', '---\n章号: 1\n题名: 雾港栈桥\n---', '雾很大。')
    const files = buildEpubFiles([{ name: '第01章_雾港', text: c1, line: '主线' }], OPTS)
    expect(files.map((f) => f.name)).toEqual([
      'mimetype',
      'META-INF/container.xml',
      'OEBPS/package.opf',
      'OEBPS/nav.xhtml',
      'OEBPS/chap01.xhtml'
    ])
    const mimetype = files[0]
    expect(mimetype.stored).toBe(true)
    expect(mimetype.content).toBe(EPUB_MIMETYPE)
    expect(mimetype.content).not.toContain('\n')
  })

  it('container.xml 指向 OEBPS/package.opf（rootfile full-path + media-type）', () => {
    const c1 = chapter('第01章_雾港', '---\n章号: 1\n题名: 雾港栈桥\n---', '雾很大。')
    const files = buildEpubFiles([{ name: '第01章_雾港', text: c1, line: '主线' }], OPTS)
    const c = files.find((f) => f.name === 'META-INF/container.xml')!.content
    expect(c).toContain('<container version="1.0"')
    expect(c).toContain('urn:oasis:names:tc:opendocument:xmlns:container')
    expect(c).toContain('full-path="OEBPS/package.opf"')
    expect(c).toContain('media-type="application/oebps-package+xml"')
  })

  it('package.opf：dc 元数据（title/identifier/language）+ dcterms:modified（EPUB3.3 必填）', () => {
    const c1 = chapter('第01章_雾港', '---\n章号: 1\n题名: 雾港栈桥\n---', '雾很大。')
    const files = buildEpubFiles([{ name: '第01章_雾港', text: c1, line: '主线' }], OPTS)
    const opf = files.find((f) => f.name === 'OEBPS/package.opf')!.content
    expect(opf).toContain('<dc:title>雾港</dc:title>')
    expect(opf).toContain('<dc:identifier id="pub-id">urn:uuid:fixed-test-id</dc:identifier>')
    expect(opf).toContain('<dc:language>zh-CN</dc:language>')
    expect(opf).toContain('<meta property="dcterms:modified">2026-09-24T08:00:00Z</meta>')
    expect(opf).toContain('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"')
  })

  it('nav.xhtml：epub:type="toc" 目录，spine 与 manifest 按章序、跳过空章', () => {
    const c1 = chapter('第01章_雾港', '---\n章号: 1\n题名: 雾港栈桥\n---', '雾很大。')
    const empty = chapter('第02章_空', '---\n章号: 2\n题名: 空章\n---', '   ')
    const c3 = chapter('第03章_灯下', '---\n章号: 3\n题名: 灯下\n---', '他点亮了煤油灯。')
    const files = buildEpubFiles(
      [
        { name: '第01章_雾港', text: c1, line: '主线' },
        { name: '第02章_空', text: empty, line: '主线' },
        { name: '第03章_灯下', text: c3, line: '主线' }
      ],
      OPTS
    )
    const hrefs = files.filter((f) => /^OEBPS\/chap\d+\.xhtml$/.test(f.name)).map((f) => f.name)
    expect(hrefs).toEqual(['OEBPS/chap01.xhtml', 'OEBPS/chap02.xhtml'])
    const nav = files.find((f) => f.name === 'OEBPS/nav.xhtml')!.content
    expect(nav).toContain('<nav epub:type="toc"')
    expect(nav).toContain('<a href="chap01.xhtml">第1章 雾港栈桥</a>')
    expect(nav).toContain('<a href="chap02.xhtml">第3章 灯下</a>')
    expect(nav).not.toContain('空章')
    const opf = files.find((f) => f.name === 'OEBPS/package.opf')!.content
    expect(opf).toContain('<item id="chap1" href="chap01.xhtml"')
    expect(opf).toContain('<itemref idref="chap1"/>')
    expect(opf).toContain('<itemref idref="chap2"/>')
  })

  it('XHTML 内容文档：xmlns + lang + title + 正文（markdown 标记已转 HTML、XML 转义）', () => {
    const c1 = chapter('第01章_雾港', '---\n章号: 1\n题名: 雾港栈桥\n---', 'A & B < C > D\n\n- 甲')
    const files = buildEpubFiles([{ name: '第01章_雾港', text: c1, line: '主线' }], OPTS)
    const x = files.find((f) => f.name === 'OEBPS/chap01.xhtml')!.content
    expect(x).toContain('<html xmlns="http://www.w3.org/1999/xhtml"')
    expect(x).toContain('lang="zh-CN" xml:lang="zh-CN"')
    expect(x).toContain('<title>第1章 雾港栈桥</title>')
    expect(x).toContain('<p>A &amp; B &lt; C &gt; D</p>')
    expect(x).toContain('<ul><li>甲</li></ul>')
  })

  it('非主线章标题注记（线：X）同 compileNovel 口径；annotateLines:false 关闭', () => {
    const past = chapter('第01章_旧历', '---\n章号: 1\n题名: 旧历\n---', '过去。')
    const files = buildEpubFiles([{ name: '第01章_旧历', text: past, line: '过去线' }], OPTS)
    const nav = files.find((f) => f.name === 'OEBPS/nav.xhtml')!.content
    expect(nav).toContain('第1章 旧历（线：过去线）')
    const files2 = buildEpubFiles([{ name: '第01章_旧历', text: past, line: '过去线' }], {
      ...OPTS,
      annotateLines: false
    })
    expect(files2.find((f) => f.name === 'OEBPS/nav.xhtml')!.content).toContain('第1章 旧历</a>')
  })

  it('空章节列表 → 空数组（调用方按「没有可导出的正文」提示）', () => {
    expect(buildEpubFiles([], OPTS)).toEqual([])
  })
})
