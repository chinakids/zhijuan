// 织卷真模型冒烟 · 驱动超时真取消链路（智能层 2026-09-14）
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/subtask-timeout-cancel-live.mjs
// 前提：dsh-runtime 已装（node_modules 存在）、vLLM 127.0.0.1:8888 在线、patch-server-cancel 已重放。
// 链路：长输出任务（maxMs=8s）→ driveSession 独立时钟触发超时 → cancelTurn 真取消引擎侧轮次 →
//       错误文案提示引擎已中止 → 同一会话快速复用（证明旧轮确已中止，未被排队）→ runSubtask 折叠错误正确。
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'
import { resetProbeUserdata } from './lib/probe-settings.mjs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-timeout-cancel'
resetProbeUserdata()
const out = '/tmp/timeout-cancel-bundle.mjs'

await esbuild({
  stdin: {
    contents:
      `export { driveSession, cancelTurn, ensureHarness, closeHarness } from ${JSON.stringify(
        resolve(root, 'src/main/agent/runtime.ts')
      )};\n` +
      `export { runSubtask } from ${JSON.stringify(resolve(root, 'src/main/agent/subtask.ts'))};`,
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

const { driveSession, cancelTurn, ensureHarness, closeHarness, runSubtask } = await import(pathToFileURL(out).href)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')) }
}

const LONG_PROMPT =
  '请连续输出 120 行文字，每行是一句完整的中文短句（约 30 字），内容围绕「雪夜的渡口」自由发挥，不要分区、不要标题、不要停，务必写满 120 行。'

console.log('=== 1) 引擎就绪 ===')
const err = await ensureHarness()
ok('ensureHarness 无错', !err, String(err))
if (err) process.exit(1)
await sleep(800)

console.log('=== 2) 基线：短任务（maxMs=60s）===') 
const t0 = Date.now()
const base = await driveSession('zj-tc-base-' + Date.now(), '只回复两个字：在的', { maxMs: 60000 })
console.log('基线耗时 ' + (Date.now() - t0) + 'ms，text=' + base.slice(0, 30))
ok('基线任务正常返回', base.length > 0, 'text=' + base.slice(0, 40))

console.log('=== 3) 超时真取消：长任务 maxMs=8s ===')
const sid = 'zj-tc-live-' + Date.now()
const t1 = Date.now()
let timeoutMsg = ''
try {
  await driveSession(sid, LONG_PROMPT, { maxMs: 8000 })
  ok('长任务应在 8s 后抛错（未抛=异常）', false, 'driveSession 返回了')
} catch (e) {
  const el = Date.now() - t1
  timeoutMsg = String(e?.message ?? e)
  console.log('抛错耗时 ' + el + 'ms，message=' + timeoutMsg)
  ok('长任务 ~8s 触发超时（6~15s）', el > 5000 && el < 15000, 'el=' + el + 'ms')
}
ok('超时文案提示引擎侧结果（已中止/未能中止）', /驱动超时/.test(timeoutMsg) && /中止/.test(timeoutMsg), timeoutMsg)

console.log('=== 4) 超时后同一会话可复用（证明旧轮真被中止未排队）===')
const t2 = Date.now()
const again = await driveSession(sid, '回复三个字：收到啦', { maxMs: 15000 })
console.log('复用耗时 ' + (Date.now() - t2) + 'ms，text=' + again.slice(0, 30))
ok('超时后会话快速复用（<15s 且含关键词）', again.includes('收到'), 'text=' + again.slice(0, 40))

console.log('=== 5) runSubtask 超时路径折叠 ===')
const def = {
  id: 'smoke-timeout',
  title: '冒烟超时',
  sidPrefix: 'zj-tc-st',
  buildParts: async () => [LONG_PROMPT],
  parse: (t) => ({ raw: t }),
  maxMs: 8000
}
const t3 = Date.now()
const stOut = await runSubtask(def, 'smoke-project')
const el3 = Date.now() - t3
console.log('runSubtask 耗时 ' + el3 + 'ms，result=' + JSON.stringify(stOut).slice(0, 160))
ok('runSubtask 超时返回 ok=false', stOut.ok === false, 'ok=' + stOut.ok)
ok('runSubtask 错误含超时与中止提示', /驱动超时/.test(stOut.error ?? '') && /中止/.test(stOut.error ?? ''), String(stOut.error))
ok('runSubtask 在 6~15s 内返回', el3 > 5000 && el3 < 15000, 'el=' + el3 + 'ms')

console.log('=== 6) 未知会话超时也在时钟内收尾（静默守卫：不永久悬挂）===')
const t4 = Date.now()
let silentEnd = ''
try {
  const r = await driveSession('zj-tc-silent-' + Date.now(), '只回复：好', { maxMs: 6000 })
  silentEnd = 'resolve len=' + r.length
} catch (e) {
  silentEnd = 'reject ' + String(e?.message ?? e).slice(0, 60)
}
console.log('未知会话 ' + (Date.now() - t4) + 'ms 结束：' + silentEnd)
ok('未知/静默会话在 6~12s 内收尾（不永久挂起）', Date.now() - t4 < 12000, silentEnd)

await closeHarness()
console.log('\n结果：PASS=' + pass + ' FAIL=' + fail)
process.exit(fail > 0 ? 1 : 0)
