// zj_collect_suggest 真机冒烟：走主进程 runChat + 真边车真模型，验证工具被调用且 translate 出 collect 事件
// （2026-09-29 智能层候选 1：agent 建议素材采集）。用法：cd ~/Desktop/织卷 && node scripts/zj-collect-live.mjs
import { resetProbeUserdata } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
// 干净 userData：防残留 settings 把 libraryRoot 指到已删除目录
process.env.ZJ_USERDATA = '/tmp/zj-smoke-zjcollect'
resetProbeUserdata()
const out = '/tmp/zj-collect-live.mjs'

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
const rid = 'collectlive-' + Date.now()
let gotCollect = false
let gotMeta = false
let payload = null
console.log('=== 开始 runChat（zj_collect_suggest 冒烟）', new Date().toISOString())
await mod.runChat(
  {
    requestId: rid,
    projectId: 'agent冒烟',
    chapterRel: '正文/第01章_雾港.md',
    chapterTitle: '雾港',
    prompt:
      '本章雾港码头候车室的场景缺少九十年代小城的具体年代细节（陈设、氛围、器物），手头资料不足。请必须调用 zj_collect_suggest 工具提出一条采集建议（demand 具体到可搜索、keywords 3 个左右、category 建议值、note 说明与本作的关联），然后用几句话说明你建议的原因。',
    quote: null
  },
  (e) => {
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'meta') {
      gotMeta = true
      process.stdout.write('\n[工具] ' + e.tool + (e.args ? ' · ' + String(e.args).slice(0, 120) : '') + '\n')
    } else if (e.type === 'meta-done') process.stdout.write('[工具完成] ' + e.message.slice(0, 60) + '\n')
    else if (e.type === 'collect') {
      gotCollect = true
      payload = e.suggestion
      process.stdout.write('\n[采集建议] demand=' + e.suggestion.demand + '\n  keywords=' + JSON.stringify(e.suggestion.keywords) + '\n  category=' + e.suggestion.category + '\n  note=' + e.suggestion.note + '\n')
    } else if (e.type === 'final') process.stdout.write('\n[最终回复] ' + e.text.slice(0, 160) + '\n')
    else if (e.type === 'error') process.stdout.write('\n[错误] ' + e.message + '\n')
  }
)
console.log('\n=== 结果: gotMeta=' + gotMeta + ' gotCollect=' + gotCollect)
if (gotCollect) {
  const ok = payload?.demand && payload?.category && Array.isArray(payload?.keywords)
  console.log('=== 载荷完整=' + ok)
  process.exit(ok ? 0 : 1)
}
process.exit(1)
