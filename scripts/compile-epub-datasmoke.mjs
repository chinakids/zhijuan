// 作品编译 EPUB 导出 · 数据层冒烟（真实 zip 打包，非 mock）
// 场景：src/main/compileEpub.ts（含 shared/epub.ts）esbuild bundle 后真机 exportEpub 打 .epub——
// 断言：① zip 可用（mac 前置）；② 产物为合法 EPUB3 容器：mimetype 首条且 STORED 无附加字段、
//    container.xml/package.opf/nav.xhtml/chap 齐备且 content 精确可达（python3 zipfile 判定，
//    与 EpubCheck 同族语义）；③ 正文文字在 XHTML 中；④ 覆盖既有同名输出（zip 更新坑）；⑤ 坏路径 ok:false。
// 用法：node scripts/compile-epub-datasmoke.mjs（mac 且有 zip；无需 CDP/浏览器）
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 中文目录「织卷」不可用 new URL().pathname（百分号编码成不存在路径）
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TMP = mkdtempSync(join(tmpdir(), 'zj-epub-ds-'))

const bundle = join(TMP, 'bundle.cjs')
execSync(`npx esbuild src/main/compileEpub.ts --bundle --platform=node --format=cjs --outfile=${bundle}`, {
  cwd: ROOT,
  stdio: 'inherit'
})
const mod = await import(pathToFileURL(bundle).href)
const { exportEpub, zipAvailable } = mod

let bad = 0
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (cond ? '' : ' | ' + extra))
  if (!cond) bad++
}

check('本机 zip 可用（mac 前置）', zipAvailable() === true)

const fm = (no, title) => `---\n章号: ${no}\n题名: ${title}\n---`
const chapters = [
  { name: '第01章_雾港', text: `${fm(1, '雾港栈桥')}\n雾很大，栈桥**隐没**在灰白里。\n\n- 甲\n- 乙\n`, line: '主线' },
  { name: '第02章_灯下', text: `${fm(2, '灯下')}\n他点亮了煤油灯。\n`, line: '主线' },
  { name: '第03章_旧历', text: `${fm(3, '旧历')}\n过去的事。\n`, line: '过去线' }
]
const outEpub = join(TMP, '成品.epub')
const r = exportEpub(chapters, '雾港', outEpub)
check('exportEpub 成功', r.ok === true, JSON.stringify(r))
if (r.ok) {
  check('产物存在且非空', existsSync(outEpub) && readFileSync(outEpub).length > 1000, String(readFileSync(outEpub).length))
  // python3 zipfile：首条=mimetype 且 STORED、无附加字段（OCF 规范 core 判据）
  const report = execSync(
    `python3 -c "import zipfile,json;z=zipfile.ZipFile('${outEpub}');i=z.infolist();print(json.dumps({'names':[x.filename for x in i],'first':i[0].filename,'first_comp':i[0].compress_type,'first_extra':len(i[0].extra),'mime':z.read('mimetype').decode(),'opf':z.read('OEBPS/package.opf').decode(),'nav':z.read('OEBPS/nav.xhtml').decode(),'chap':z.read('OEBPS/chap01.xhtml').decode(),'chap2':z.read('OEBPS/chap02.xhtml').decode()}))"`,
    { encoding: 'utf8' }
  )
  const rep = JSON.parse(report)
  check('mimetype 是 zip 首条目', rep.first === 'mimetype', rep.names.slice(0, 3).join(','))
  check('mimetype 条目 STORED（0 压缩）', rep.first_comp === 0, String(rep.first_comp))
  check('mimetype 无附加字段（-X）', rep.first_extra === 0, String(rep.first_extra))
  check('mimetype 内容= application/epub+zip', rep.mime === 'application/epub+zip', rep.mime)
  check('container.xml/opf/nav/两章 XHTML 均在内', rep.names.includes('META-INF/container.xml') && rep.names.includes('OEBPS/nav.xhtml') && rep.names.includes('OEBPS/chap02.xhtml'))
  check('package.opf 有 dc:title/identifier/dcterms:modified', rep.opf.includes('<dc:title>雾港</dc:title>') && rep.opf.includes('dcterms:modified') && rep.opf.includes('urn:uuid:'))
  check('nav 目录含 toc 与两章链接', rep.nav.includes('epub:type="toc"') && rep.nav.includes('第1章 雾港栈桥') && rep.nav.includes('第2章 灯下'))
  check('非主线章标题带（线：过去线）', rep.nav.includes('第3章 旧历（线：过去线）'))
  check('XHTML：xmlns + 正文文字（强调已转标签）', rep.chap.includes('xmlns="http://www.w3.org/1999/xhtml"') && rep.chap.includes('<strong>隐没</strong>') && rep.chap.includes('<ul><li>甲</li><li>乙</li></ul>'))
  check('chap02 文字可达', rep.chap2.includes('煤油灯'))
  // zip 完整性
  const t = execSync(`unzip -t "${outEpub}" 2>&1 | tail -1`, { encoding: 'utf8' })
  check('unzip -t 校验通过', /No errors detected/.test(t), t.trim())
  // 覆盖既有同名输出（zip 更新坑：不先删会残留旧条目）
  writeFileSync(outEpub, '不是zip')
  const r2 = exportEpub(chapters, '雾港', outEpub)
  check('覆盖既有同名文件仍成功且内容正确', r2.ok === true && readFileSync(outEpub).length > 1000, JSON.stringify(r2))
}

// 失败路径：输出到不存在目录 → ok:false（不抛异常）
const rBad = exportEpub(chapters, '雾港', join(TMP, 'no-such-dir', 'x.epub'))
check('坏输出路径 → ok:false 不抛出', rBad.ok === false && typeof rBad.error === 'string', JSON.stringify(rBad))

rmSync(TMP, { recursive: true, force: true })
console.log(bad === 0 ? 'SMOKE ALL PASS' : 'SMOKE FAIL ' + bad)
process.exit(bad === 0 ? 0 : 1)
