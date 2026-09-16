// 多时间线·切片/线枚举 数据层冒烟（真文件系统，不依赖模型）
// 验证：F-20260916-02 平台层任务 #1 模型层贯通——SliceEntry.line 透传（缺少「时间线」=主线）、
//       listLines 线枚举（正文为源、出现序、章数）、writeLinesRegistry 落 .zhijuan/lines.json、
//       双线交错项目每线内部按章号升序、老项目（全缺省）零迁移单线。
// 用法：cd ~/Desktop/织卷 && node scripts/multiline-slices-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_USERDATA = '/tmp/zj-smoke-multiline'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
rmSync('/tmp/zj-multiline-bundle.mjs', { force: true })

await esbuild({
  stdin: {
    contents: `export * from ${JSON.stringify(resolve(root, 'src/main/slices.ts'))};`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: '/tmp/zj-multiline-bundle.mjs',
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*']
})

const { listSlices, listLines, writeLinesRegistry } = await import('file:///tmp/zj-multiline-bundle.mjs')

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra) }
  else { fail++; console.log('FAIL', name, extra) }
}

const fm = (no, name, slice, line) =>
  ['---', `章号: ${no}`, `题名: ${name}`, `切片: ${slice}`, ...(line ? [`时间线: ${line}`] : []), '---', '', `# ${name}`, '', '正文内容。'].join('\n')

// A) 双线交错项目（线内序正确）
const A = '/tmp/zj-multiline-a'
rmSync(A, { recursive: true, force: true })
mkdirSync(`${A}/正文`, { recursive: true })
writeFileSync(`${A}/正文/第01章_主线一.md`, fm(1, '主线一', '幕A', '主线'))
writeFileSync(`${A}/正文/第02章_旧忆一.md`, fm(2, '旧忆一', '幕0B', '过去线'))
writeFileSync(`${A}/正文/第03章_主线二.md`, fm(3, '主线二', '幕B')) // 缺省=主线
writeFileSync(`${A}/正文/第04章_旧忆二.md`, fm(4, '旧忆二', '幕0C', '过去线'))
writeFileSync(`${A}/正文/第05章_主线三.md`, fm(5, '主线三', '幕C', '主线'))
writeFileSync(`${A}/正文/第06章_无切片.md`, ['---', '章号: 6', '题名: 无切片', '---', '', '# 无切片'].join('\n'))
writeFileSync(`${A}/正文/第07章_无约定头.md`, '# 没有约定头')

const slicesA = listSlices(A)
ok('listSlices 只带切片章（5 条）', slicesA.length === 5, `got ${slicesA.length}`)
ok('缺省「时间线」章 = 主线', slicesA[2].line === '主线' && slicesA[2].name === '幕B')
const linesOfA = slicesA.map((s) => s.line)
ok('双线交错逐章 line 正确', JSON.stringify(linesOfA) === JSON.stringify(['主线', '过去线', '主线', '过去线', '主线']), linesOfA.join(','))
ok('全局排序仍按章号（线字段不破坏既有口径）', JSON.stringify(slicesA.map((s) => s.chapter)) === JSON.stringify(['第01章_主线一', '第02章_旧忆一', '第03章_主线二', '第04章_旧忆二', '第05章_主线三']))
const mainSeq = slicesA.filter((s) => s.line === '主线').map((s) => Number(s.chapter.match(/第0?(\d+)章/)?.[1]))
const pastSeq = slicesA.filter((s) => s.line === '过去线').map((s) => Number(s.chapter.match(/第0?(\d+)章/)?.[1]))
ok('主线线内按章号升序 [1,3,5]', JSON.stringify(mainSeq) === JSON.stringify([1, 3, 5]), mainSeq.join(','))
ok('过去线线内按章号升序 [2,4]', JSON.stringify(pastSeq) === JSON.stringify([2, 4]), pastSeq.join(','))

const linesA = listLines(A)
ok('listLines 枚举（出现序：主线在前）', JSON.stringify(linesA) === JSON.stringify([{ name: '主线', chapters: 3 }, { name: '过去线', chapters: 2 }]), JSON.stringify(linesA))

// B) lines.json 登记（与 slices.json 同构）
const f = writeLinesRegistry(A, linesA)
ok('writeLinesRegistry 落 .zhijuan/lines.json', f.endsWith('.zhijuan/lines.json') && existsSync(f), f)
const back = JSON.parse(readFileSync(f, 'utf-8'))
ok('lines.json 可读回且内容一致', JSON.stringify(back.lines) === JSON.stringify(linesA) && typeof back.updatedAt === 'number')

// C) 老项目（全缺省「时间线」）= 单线零回归
const C = '/tmp/zj-multiline-c'
rmSync(C, { recursive: true, force: true })
mkdirSync(`${C}/正文`, { recursive: true })
writeFileSync(`${C}/正文/第1章_甲.md`, fm(1, '甲', 'x1'))
writeFileSync(`${C}/正文/第2章_乙.md`, fm(2, '乙', 'x2'))
const slicesC = listSlices(C)
ok('老项目切片全部主线', slicesC.every((s) => s.line === '主线'), slicesC.map((s) => s.line).join(','))
ok('老项目 listLines 单线 [主线,2]', JSON.stringify(listLines(C)) === JSON.stringify([{ name: '主线', chapters: 2 }]))

console.log(`\n${pass} PASS · ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
