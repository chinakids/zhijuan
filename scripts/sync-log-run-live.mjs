// 织卷 · runSync 旁路记录三接入点数据层真验证（2026-09-16 创作层，候选 2 收口）
// 03:45 轮已用单测覆盖 syncLog 本体 + devShim 覆盖 UI 层；本脚本把 engine.ts 三处旁路
// append（成功/解析失败/异常）用【真实 runSync + 真实文件系统】钉死——
// stub 只替 driveSession（Martin Fowler「Stubs provide canned answers」：被测系统其余全部真实执行），
// 断言 .zhijuan/sync-log.jsonl 落盘且字段/结果三路径正确，且「旁路记录不改变同步结果」。
// 用法：cd ~/Desktop/织卷 && node scripts/sync-log-run-live.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdirSync, rmSync, mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-synclog-live-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: join(tmp, 'lib') }), 'utf-8')
mkdirSync(join(tmp, 'lib'), { recursive: true })

const pid = '同步记录真链'
const mk = (p, s) => {
  const dir = join(tmp, 'lib', pid, p.split('/').slice(0, -1).join('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(tmp, 'lib', pid, p), s, 'utf-8')
}
mk(
  '人物/林晓.md',
  ['# 林晓', '', '> 定位：等船的女孩', '', '## 基础档案', '', '- 年龄：19', '- 身份：渔村遗孤', '', '## 切片：第一幕_雾港之夜', '', '- 站在栈桥，等十年未归的船'].join('\n')
)
mk(
  '人物/陈默.md',
  ['# 陈默', '', '> 定位：缉私队新人', '', '## 基础档案', '', '- 年龄：24', '- 职业：缉私队队员', '', '## 切片：第一幕_雾港之夜', '', '- 在栈桥遇见林晓'].join('\n')
)
mk(
  '正文/第01章_雾港.md',
  ['---', '章号: 1', '题名: 雾港', '切片: 第一幕_雾港之夜', '涉及人物: [林晓, 陈默, 沈藏]', '---', '', '# 雾港', '', '雾港的夜把整条街浸在灰里。林晓停在栈桥尽头的灯柱下，陈默把外套披到她肩上。沈藏在街角的屋檐下远远看着，没敢上前。'].join('\n')
)

// stub runtime：只替 driveSession 三态罐头答案；cancelTurn/closeHarness 空实现
const stubRuntime = `
export async function driveSession(sid, prompt, opts) {
  const sc = process.env.ZJ_DRIVE_SCENARIO || 'ok'
  if (sc === 'throw') throw new Error('模拟异常（stub runtime）')
  if (sc === 'prose') return '这是模型跑偏输出的散文，不是设定补丁 JSON 数组，请忽略它。'
  return JSON.stringify([
    { target: '人物/林晓.md', kind: 'append', after: '- 新增：今晚在栈桥等到了船', reason: '林晓新增行为' },
    { target: '人物/沈藏.md', kind: 'append', after: '- 新增：远远看着，没敢上前', reason: '沈藏新增行为' }
  ])
}
export const cancelTurn = async () => false
export const closeHarness = async () => {}
`

const out = join(tmp, 'bundle.mjs')
await esbuild({
  entryPoints: [resolve(root, 'src/main/agent/engine.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning',
  plugins: [
    {
      name: 'stub-runtime',
      setup(build) {
        build.onResolve({ filter: /^\.\/runtime$/ }, () => ({ path: 'stub-runtime', namespace: 'stub-runtime' }))
        build.onLoad({ filter: /.*/, namespace: 'stub-runtime' }, () => ({ contents: stubRuntime, loader: 'js' }))
      }
    }
  ]
})
const mod = await import(pathToFileURL(out).href)

const logPath = join(tmp, 'lib', pid, '.zhijuan', 'sync-log.jsonl')
const readLog = () => {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
}

let fails = 0
const check = (name, cond, extra = '') => {
  console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (cond ? '' : (extra ? ' —— ' + extra : '')))
  if (!cond) fails++
}

console.log('=== runSync 旁路记录三接入点数据层验证:', new Date().toISOString())
try {
  // —— 场景 A：成功 + 守卫（模型补丁含已建档林晓 + 未建档沈藏）——
  process.env.ZJ_DRIVE_SCENARIO = 'ok'
  const ra = await mod.runSync(pid, '正文/第01章_雾港.md')
  let log = readLog()
  check('A: runSync 返回 ok=true（旁路不影响结果）', ra.ok === true, JSON.stringify(ra).slice(0, 160))
  check('A: 成功路径已落盘 1 条日志', log.length === 1, 'len=' + log.length)
  if (log.length === 1) {
    const e = log[0]
    check('A: ok=true', e.ok === true)
    check('A: itemCount=1（林晓保留，沈藏被守卫拦截）', e.itemCount === 1, 'got ' + e.itemCount)
    check('A: guardCount=1（未建档沈藏被拦）', e.guardCount === 1, 'got ' + e.guardCount)
    check('A: chapter 字段正确', e.chapter === '正文/第01章_雾港.md')
    check('A: slice 来自约定头', e.slice === '第一幕_雾港之夜')
    check('A: castCount=3 / fileCount=2', e.castCount === 3 && e.fileCount === 2, `cast=${e.castCount} files=${e.fileCount}`)
    check('A: 成功条无 error 字段', e.error === undefined)
    check('A: time 为数字', typeof e.time === 'number' && e.time > 0)
  }

  // —— 场景 B：解析失败（模型输出散文，重试仍散文）——
  process.env.ZJ_DRIVE_SCENARIO = 'prose'
  const rb = await mod.runSync(pid, '正文/第01章_雾港.md')
  log = readLog()
  check('B: runSync 返回 ok=false', rb.ok === false && /未能解析为设定 JSON 数组/.test(rb.error), JSON.stringify(rb).slice(0, 120))
  check('B: 解析失败路径已落盘，共 2 条', log.length === 2, 'len=' + log.length)
  if (log.length >= 2) {
    const e = log[1]
    check('B: ok=false', e.ok === false)
    check('B: error 含解析失败文案', typeof e.error === 'string' && e.error.includes('未能解析为设定 JSON 数组'))
    check('B: error 为 120 字截断（clipLogError）', typeof e.error === 'string' && e.error.length <= 121, 'len=' + (e.error || '').length)
    check('B: itemCount=0 / guardCount=0', e.itemCount === 0 && e.guardCount === 0)
    check('B: slice 仍从约定头解析', e.slice === '第一幕_雾港之夜')
  }

  // —— 场景 C：异常抛出（模型层 throw → runSync catch）——
  process.env.ZJ_DRIVE_SCENARIO = 'throw'
  const rc = await mod.runSync(pid, '正文/第01章_雾港.md')
  log = readLog()
  check('C: runSync 返回 ok=false 且 error 含异常文案', rc.ok === false && /模拟异常/.test(rc.error), JSON.stringify(rc).slice(0, 120))
  check('C: 异常路径已落盘，共 3 条', log.length === 3, 'len=' + log.length)
  if (log.length >= 3) {
    const e = log[2]
    check('C: ok=false', e.ok === false)
    check('C: error 含模拟异常', typeof e.error === 'string' && e.error.includes('模拟异常'))
    check('C: itemCount=0 / guardCount=0', e.itemCount === 0 && e.guardCount === 0)
  }

  // —— 旁路不侵入：日志条数 = 调用次数（成功路径重试分支不重复记、B 重试两次只记一次）——
  check('三路径共 3 条记录（无重复/无遗漏）', log.length === 3)
  check('全部记录均为合法 JSONL 单行', readFileSync(logPath, 'utf-8').split('\n').filter((l) => l.trim()).every((l) => l.startsWith('{')))

  // —— 世界切片文件确实被 runSync 真实创建（下游真实执行佐证）——
  check('runSync 真实副作用：世界观切片文件已创建', existsSync(join(tmp, 'lib', pid, '世界观', '切片_第一幕_雾港之夜.md')))

  console.log(fails === 0 ? 'SYNC-LOG-RUN LIVE OK' : 'SYNC-LOG-RUN LIVE FAILED: ' + fails)
  process.exit(fails === 0 ? 0 : 1)
} finally {
  await mod.shutdown().catch(() => {})
  rmSync(tmp, { recursive: true, force: true })
}
