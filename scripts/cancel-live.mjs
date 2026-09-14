// 织卷真模型冒烟 · 「停止生成」真中断链路（智能层 2026-09-14）
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/cancel-live.mjs
// 前提：dsh-runtime 已装（node_modules 存在）、vLLM 127.0.0.1:8888 在线、patch-server-cancel 已重放（install.sh 会自动做）。
// 链路：长输出任务 → 数秒后 cancelTurn（session/cancel RPC → 引擎 agent.cancel）→
//       断言 driveSession 快速返回（不等模型跑完）＋ 引擎侧出现 aborted 收尾 ＋ 同一会话后续可正常用。
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-cancel-live'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const out = '/tmp/cancel-live-bundle.mjs'

await esbuild({
  stdin: {
    contents:
      `export { driveSession, cancelTurn, closeHarness, ensureHarness } from ${JSON.stringify(resolve(root, 'src/main/agent/runtime.ts'))};`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})

const { driveSession, cancelTurn, ensureHarness, closeHarness } = await import(pathToFileURL(out).href)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')) }
}

console.log('=== 1) 引擎就绪 ===')
const err = await ensureHarness()
ok('ensureHarness 无错', !err, String(err))
if (err) process.exit(1)
await sleep(800)

console.log('=== 2) 基线：短任务（回复两字）===')
const t0 = Date.now()
const base = await driveSession('zj-cancel-base-' + Date.now(), '只回复两个字：在的', { maxMs: 90000 })
const baseMs = Date.now() - t0
console.log('基线耗时 ' + baseMs + 'ms，文本=' + base.slice(0, 30))
ok('基线任务正常返回', base.length > 0, 'text=' + base.slice(0, 40))

console.log('=== 3) 真中断：长任务跑 3s 后取消 ===')
const sid = 'zj-cancel-live-' + Date.now()
const events = []
const p = driveSession(
  sid,
  '请连续输出 120 行文字，每行是一句完整的中文短句（约 30 字），内容围绕「海边的夜晚」自由发挥，不要分区、不要标题、不要停，务必写满 120 行。',
  {
    maxMs: 240000,
    onEvent: (n) => events.push(n),
    isAborted: () => false // 冒烟直接操作 cancelTurn，不用 run 层信号
  }
)
await sleep(3000)
const t1 = Date.now()
const cancelled = await cancelTurn(sid)
console.log('cancelTurn 返回 cancelled=' + cancelled)
ok('session/cancel 被引擎接受', cancelled === true)
let text = ''
try {
  text = await Promise.race([p, sleep(45000).then(() => { throw new Error('取消后 driveSession 未在 45s 内返回') })])
} catch (e) {
  ok('取消后 driveSession 快速返回', false, String(e.message))
}
const cancelWait = Date.now() - t1
console.log('取消后等待 ' + cancelWait + 'ms，文本长度=' + text.length)
ok('取消后 driveSession 快速返回（<45s，且远小于长任务自然时长）', cancelWait < 45000, 'waited=' + cancelWait + 'ms')
ok('取消截断了输出（文本远短于 120 行）', text.length < 3000, 'len=' + text.length)
const sawAborted = events.some((n) => {
  const ev = n?.params?.event
  return ev?.type === 'turn/end' && ev?.data?.reason?.kind === 'aborted'
})
ok('引擎侧出现 aborted 收尾事件', sawAborted, 'turn/end总数=' + events.filter((n) => n?.params?.event?.type === 'turn/end').length + '，kinds=' + JSON.stringify(events.filter((n) => n?.params?.event?.type === 'turn/end').map((n) => n?.params?.event?.data?.reason?.kind)))
// 收集完事件后，sub 已随 driveSession 关闭；这里只读已收集的数组，不需要再订阅

console.log('=== 4) 取消后同一会话仍可用 ===')
const t2 = Date.now()
const again = await driveSession(sid, '回复三个字：收到啦', { maxMs: 90000 })
console.log('恢复耗时 ' + (Date.now() - t2) + 'ms，文本=' + again.slice(0, 30))
ok('取消后会话可继续用', again.includes('收到'), 'text=' + again.slice(0, 40))

console.log('=== 5) 未知会话 cancelTurn 幂等降级 ===')
const noop = await cancelTurn('zj-nonexistent-' + Date.now())
ok('未知会话返回 false（不抛错）', noop === false)

await closeHarness()
console.log('\\n结果：PASS=' + pass + ' FAIL=' + fail)
process.exit(fail > 0 ? 1 : 0)
