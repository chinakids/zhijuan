// ===== 织卷 V2 · 作品编译 EPUB 导出（shared 纯函数；模块设计 §四 A 扩展 v1.2） =====
// 产品：成品交付第三出口=EPUB 电子书（校对/分发/阅读器）。零依赖路径：
//   mdBodyHtml（shared/compile.ts，产出即 XML well-formed）→ XHTML content documents
//   → 系统 zip（EPUB3 容器，mac 内置 /usr/bin/zip，2026-09-24 04:30 轮实证
//   `zip -X0` 首发 mimetype + `zip -Xr` 其余 = 合法 EPUB3 容器）。
// 规范依据（W3C EPUB 3.3，https://www.w3.org/TR/epub-33/）：publication MUST 含
//   package document + EPUB navigation document（nav，properties="nav"；NCX 是 EPUB2
//   遗留、EPUB3 已不需要）+ 至少一个 EPUB content document（XHTML/SVG）；XHTML
//   content document 必须 XML well-formed（mdBodyHtml 产出已自闭合/转义）；
//   dcterms:modified 是 package metadata 必填项。
// 本模块只生成「zip 条目清单」（纯函数可单测），打包/对话框在 main 侧（compileEpub.ts）。
// 约定：章序/线名归一由调用方完成（与 compileNovel 同输入 CompileChapterInput），
//   标题口径复用 shared/compile.ts chapterHeading（含「（线：X）」注记）——单一权威源。

import { extractFrontMatter } from './fmatter'
import { chapterBodyOf, mdBodyHtml, chapterHeading, type CompileChapterInput } from './compile'

export const EPUB_MIMETYPE = 'application/epub+zip'

export interface EpubFile {
  /** zip 内路径（正斜杠） */
  name: string
  content: string
  /** 必须 STORED（零压缩）且为 zip 首条目（EPUB OCF 规范：mimetype 无障碍读取） */
  stored?: boolean
}

export interface EpubBuildOptions {
  /** 作品显示名（dc:title） */
  projectTitle: string
  /** 语言（dc:language；默认 zh-CN） */
  lang?: string
  /** dc:identifier（**必填**——调用方生成 urn:uuid:<uuid>；shared 无 node 依赖的红线故不在本层生成） */
  identifier: string
  /** dcterms:modified（EPUB3.3 必填；默认当前 UTC 秒级） */
  modified?: Date
  /** 非主线章标题注记（同 compileNovel 口径；默认开） */
  annotateLines?: boolean
}

/** XML 文本转义（标题/文本节点；& < > 必须，" 保险） */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 章头（front matter）标题文本：与合并 Markdown 成品同口径（chapterHeading 单源） */
export function epubChapterTitle(c: CompileChapterInput, annotate: boolean): string {
  const { fm } = extractFrontMatter(c.text)
  return chapterHeading(c.name, fm, c.line, annotate)
}

/** XHTML content document（EPUB3 要求：xmlns + xml:lang、XML well-formed body） */
export function xhtmlOf(title: string, bodyHtml: string, lang: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE html>\n` +
    `<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(lang)}" xml:lang="${escapeXml(lang)}">\n` +
    `<head><meta charset="utf-8"/><title>${escapeXml(title)}</title></head>\n` +
    `<body>\n${bodyHtml}\n</body>\n</html>\n`
  )
}

/**
 * 生成 EPUB3 全部 zip 条目（不含 mimetype 的首条 stored 语义由调用方按 stored 标记执行）。
 * 结构：mimetype / META-INF/container.xml / OEBPS/package.opf（metadata+manifest+spine）
 *        / OEBPS/nav.xhtml（epub:type="toc"）/ OEBPS/chapNN.xhtml（章序 1 起）。
 * 空章跳过（与 compileNovel 同口径）；无任何章节 → 空数组（调用方提示「没有可导出的正文」）。
 */
export function buildEpubFiles(chapters: CompileChapterInput[], opts: EpubBuildOptions): EpubFile[] {
  const lang = opts.lang || 'zh-CN'
  const annotate = opts.annotateLines !== false
  const identifier = opts.identifier
  const modified = (opts.modified || new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z')

  const kept: { input: CompileChapterInput; title: string; body: string }[] = []
  for (const c of chapters) {
    const body = chapterBodyOf(c.text)
    if (!body) continue
    kept.push({ input: c, title: epubChapterTitle(c, annotate), body })
  }
  if (kept.length === 0) return []

  const hrefOf = (i: number) => `chap${String(i).padStart(2, '0')}.xhtml`
  const content = kept.map((k, i) => ({
    name: hrefOf(i + 1),
    title: k.title,
    html: xhtmlOf(k.title, mdBodyHtml(k.body), lang)
  }))

  const containerXml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n` +
    `  <rootfiles>\n` +
    `    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>\n` +
    `  </rootfiles>\n` +
    `</container>\n`

  const manifestItems = content
    .map((c, i) => `    <item id="chap${i + 1}" href="${hrefOf(i + 1)}" media-type="application/xhtml+xml"/>`)
    .join('\n')
  const spineItems = content.map((_c, i) => `    <itemref idref="chap${i + 1}"/>`).join('\n')
  const navHrefs = content.map((c) => `    <li><a href="${c.name}">${escapeXml(c.title)}</a></li>`).join('\n')
  const packageOpf =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">\n` +
    `  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n` +
    `    <dc:identifier id="pub-id">${escapeXml(identifier)}</dc:identifier>\n` +
    `    <dc:title>${escapeXml(opts.projectTitle)}</dc:title>\n` +
    `    <dc:language>${escapeXml(lang)}</dc:language>\n` +
    `    <meta property="dcterms:modified">${modified}</meta>\n` +
    `  </metadata>\n` +
    `  <manifest>\n` +
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n` +
    manifestItems +
    `\n  </manifest>\n` +
    `  <spine>\n` +
    spineItems +
    `\n  </spine>\n` +
    `</package>\n`

  const navXhtml =
    xhtmlOf('目录', `<nav epub:type="toc" id="toc">\n  <h1>目录</h1>\n  <ol>\n${navHrefs}\n  </ol>\n</nav>`, lang).replace(
      `<html xmlns="http://www.w3.org/1999/xhtml"`,
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"`
    )

  return [
    { name: 'mimetype', content: EPUB_MIMETYPE, stored: true },
    { name: 'META-INF/container.xml', content: containerXml },
    { name: 'OEBPS/package.opf', content: packageOpf },
    { name: 'OEBPS/nav.xhtml', content: navXhtml },
    ...content.map((c) => ({ name: `OEBPS/${c.name}`, content: c.html }))
  ]
}
