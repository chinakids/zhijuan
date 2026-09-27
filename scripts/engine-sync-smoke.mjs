// 引擎冒烟 · 切片同步（走 harness + 真模型；2026-09-27 智能层补接 probe-settings——裸 userdata 无 llm
// 会连 providers 默认 127 占位空轮，发布脱敏地雷同款）
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resetProbeUserdata } from './lib/probe-settings.mjs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
// 干净 userData：防 /tmp/zj-smoke-userdata 残留 settings 把 libraryRoot 指到已删除目录
process.env.ZJ_USERDATA = '/tmp/zj-smoke-engine-sync'
resetProbeUserdata()
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
