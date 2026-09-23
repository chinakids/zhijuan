// P1 F-20260917-10 取证字段验证（2026-09-19 智能层）：runSync 走真代码路径，
// 仅 stub 掉模型会话（driveSession 返回 '[]'=合法空），验证 sync-log 记录的 bodyLen：
// 正常正文 → bodyLen>0；复现现场「仅约定头」→ bodyLen=0。临时项目跑完即删，真库零污染。
import { build as esbuild } from 'esbuild'
import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-userdata-bodylen'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })

const stub = '/tmp/runtime-stub.mjs'
writeFileSync(
  stub,
  `export async function driveSession() { globalThis.__zjDriveCalls = (globalThis.__zjDriveCalls ?? 0) + 1; return '[]' }\nexport function cancelTurn() {}\nexport function newSid(k) { return k + '-' + Date.now() }\nexport function closeHarness() { return Promise.resolve() }\n`
)

const out = '/tmp/zj-bodylen-smoke.mjs'
await esbuild({
  entryPoints: [resolve(root, 'src/main/agent/engine.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  plugins: [
    {
      name: 'stub-runtime',
      setup(b) {
        b.onResolve({ filter: /^\.\/runtime$/ }, (args) => ({ path: stub }))
      }
    }
  ],
  logLevel: 'warning'
})

// 库根=~/Documents/织卷项目库（legacy 非空保持原地，无需 settings）；两个临时项目跑完即删
const lib = '/Users/USER/Documents/织卷项目库'
const seedBody = readFileSync(lib + '/织卷smoke/正文/第01章_雾港栈桥.md', 'utf-8')
const fmOnly = '---\n章号: 1\n题名: 雾港栈桥\n切片: 第一幕_夜\n涉及人物: [韩青]\n---\n'
for (const [id, content] of [
  ['zj-bodylen-ok', seedBody],
  ['zj-bodylen-empty', fmOnly]
]) {
  const d = lib + '/' + id
  rmSync(d, { recursive: true, force: true })
  mkdirSync(d + '/正文', { recursive: true })
  mkdirSync(d + '/人物', { recursive: true })
  mkdirSync(d + '/世界观', { recursive: true })
  writeFileSync(d + '/正文/第01章_雾港栈桥.md', content, 'utf-8')
}

const mod = await import(pathToFileURL(out).href)
const r1 = await mod.runSync('zj-bodylen-ok', '正文/第01章_雾港栈桥.md')
console.log('S1 ok=', r1.ok, 'items=', r1.items?.length ?? 0)
const r2 = await mod.runSync('zj-bodylen-empty', '正文/第01章_雾港栈桥.md')
console.log('S2 ok=', r2.ok, 'items=', r2.items?.length ?? 0, 'bodyEmpty=', r2.evidence?.bodyEmpty ?? false)
await mod.shutdown()

// 严格性短路断言（2026-09-20 创作层）：正文为空 → 不调模型（driveCallCount 不被 r2 递增）、
// 返回 bodyEmpty 证据（UI 证据小字改示「正文为空，未比对」，proposals 零噪音）、sync-log 照记 ok:true/bodyLen 0。
const driveCalls = globalThis.__zjDriveCalls ?? 0

const lastOf = (id) => {
  const lines = readFileSync(lib + '/' + id + '/.zhijuan/sync-log.jsonl', 'utf-8').trim().split('\n').filter(Boolean)
  return JSON.parse(lines[lines.length - 1])
}
const l1 = lastOf('zj-bodylen-ok')
const l2 = lastOf('zj-bodylen-empty')
console.log('S1 sync-log:', JSON.stringify({ bodyLen: l1.bodyLen, ok: l1.ok }))
console.log('S2 sync-log:', JSON.stringify({ bodyLen: l2.bodyLen, ok: l2.ok }))
let fail = 0
if (!(l1.bodyLen > 0)) { console.error('FAIL: S1 bodyLen 应为正数'); fail++ }
if (l2.bodyLen !== 0) { console.error('FAIL: S2 bodyLen 应为 0'); fail++ }
if (r2.ok !== true || (r2.items?.length ?? 0) !== 0) { console.error('FAIL: S2 应 ok:true 且零提案'); fail++ }
if (r2.evidence?.bodyEmpty !== true) { console.error('FAIL: S2 evidence.bodyEmpty 应为 true'); fail++ }
if (driveCalls !== 1) { console.error(`FAIL: 空正文未短路——driveSession 被调 ${driveCalls} 次（应 1，仅 S1）`); fail++ }
if (l2.ok !== true || l2.itemCount !== 0) { console.error('FAIL: S2 sync-log 应 ok:true/零提案'); fail++ }
console.log('S2 短路验证:', JSON.stringify({ driveCalls }))
for (const id of ['zj-bodylen-ok', 'zj-bodylen-empty']) rmSync(lib + '/' + id, { recursive: true, force: true })
if (fail) process.exit(1)
console.log('PASS bodylen-smoke')
process.exit(0)
