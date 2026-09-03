// 引擎冒烟 · 切片同步（走 harness + 真模型）
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
const out = '/tmp/zj-engine-sync.mjs'

await esbuild({
  entryPoints: [resolve(root, 'src/main/agent/engine.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})

const mod = await import(pathToFileURL(out).href)
console.log('=== 开始 runSync:', new Date().toISOString())
const r = await mod.runSync('agent冒烟', '正文/第01章_雾港.md')
console.log('=== 结果:', JSON.stringify(r, null, 2).slice(0, 1600))
await mod.shutdown()
