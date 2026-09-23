// 作品编译 Word 导出 · 数据层冒烟（真实 textutil 转换，非 mock）
// 场景：把 src/main/compileDocx.ts（含 shared/compile.ts mdToHtml）esbuild bundle 后用真机
//       exportDocx 转 docx——断言产物存在、为合法 OOXML（unzip -p 可取 document.xml）、正文文字可达、
//       失败路径（坏输出路径）返回 ok:false 不抛出。
// 用法：node scripts/compile-docx-datasmoke.mjs（mac 且有 textutil；无需 CDP/浏览器）
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 注意：不能 new URL(...).pathname 拿仓库根——中文目录「织卷」会被百分号编码成不存在路径（spawn cwd 伪报 ENOENT）
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TMP = mkdtempSync(join(tmpdir(), 'zj-docx-ds-'))

// bundle（仓库标准模式：esbuild 单文件入口 → /tmp → node import）
const bundle = join(TMP, 'bundle.cjs')
execSync(`npx esbuild src/main/compileDocx.ts --bundle --platform=node --format=cjs --outfile=${bundle}`, {
  cwd: ROOT,
  stdio: 'inherit'
})
const mod = await import(pathToFileURL(bundle).href)
const { exportDocx, docxAvailable } = mod

let bad = 0
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (cond ? '' : ' | ' + extra))
  if (!cond) bad++
}

check('本机 textutil 可用（mac 前置）', docxAvailable() === true)

// 仿真实成品：章标题 + 强调 + 列表 + 空章
const md = `# 第1章 雾港

雾很大，栈桥**隐没**在灰白里。他紧了紧*领口*。

- 甲
- 乙

# 第2章 灯下

他点亮了煤油灯。
`
const outDocx = join(TMP, '成品.docx')
const r = exportDocx(md, outDocx)
check('exportDocx 成功', r.ok === true, JSON.stringify(r))
if (r.ok) {
  const st = readFileSync(outDocx)
  check('产物存在且非空（docx 为 zip）', existsSync(outDocx) && st.length > 1000, String(st.length))
  const xml = execSync(`unzip -p "${outDocx}" word/document.xml 2>/dev/null || true`, { encoding: 'utf8' })
  check('OOXML document.xml 可达', xml.includes('<w:document'), xml.slice(0, 80))
  check('章标题文字在产物中', xml.includes('第1章') && xml.includes('雾港'), '')
  check('正文文字在产物中', xml.includes('隐没') && xml.includes('煤油灯'), '')
}

// 失败路径：输出到不存在目录 → ok:false（不抛异常，调用方按 error 提示）
const rBad = exportDocx(md, join(TMP, 'no-such-dir', 'x.docx'))
check('坏输出路径 → ok:false 不抛出', rBad.ok === false && typeof rBad.error === 'string', JSON.stringify(rBad))

console.log(bad === 0 ? 'SMOKE ALL PASS' : 'SMOKE FAIL ' + bad)
process.exit(bad === 0 ? 0 : 1)
