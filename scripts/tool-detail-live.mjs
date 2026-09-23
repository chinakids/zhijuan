// 工具卡「细节展开」· 真模型冒烟：runChat 走真边车+真模型，验证 translate 真实产出 argsJson/result。
// （devShim UI 冒烟已验渲染层；此处验主进程协议——meta 带完整参数 JSON、meta-done 带完整结果正文）
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/tool-detail-live.mjs
import { resetProbeUserdata } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-tool-detail-live'
resetProbeUserdata()
const out = '/tmp/tool-detail-live-bundle.mjs'

await esbuild({
  stdin: {
    contents: `export { runChat } from ${JSON.stringify(resolve(root, 'src/main/agent/engine.ts'))};`,
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

const { runChat } = await import(pathToFileURL(out).href)

const rid = 'td-' + Date.now()
const metas = []
const dones = []
let gotFinal = false
let error = null

console.log('=== 开始 runChat（工具卡细节展开 · 真机冒烟）', new Date().toISOString())
await runChat(
  {
    requestId: rid,
    projectId: 'agent冒烟',
    chapterRel: '正文/第01章_雾港.md',
    chapterTitle: '雾港',
    prompt:
      '用 zj_read_doc 读一下 正文/第01章_雾港.md 的开头 2000 字符，然后一句话告诉我这段写了谁的什么；不要改文件。',
    quote: null
  },
  (e) => {
    if (e.type === 'meta') {
      metas.push(e)
      process.stdout.write('\n[工具开始] ' + e.tool + ' args=' + (e.args ?? '') + ' argsJson?=' + (e.argsJson ? 'YES' : 'NO') + '\n')
    } else if (e.type === 'meta-done') {
      dones.push(e)
      process.stdout.write('  [工具完成] ' + e.tool + ' ok=' + (e.ok ?? true) + ' result?=' + (e.result ? 'YES' : 'NO') + ' resultHead=' + (e.result ?? '').slice(0, 60).replace(/\n/g, ' ') + '\n')
    } else if (e.type === 'final') {
      gotFinal = true
    } else if (e.type === 'error') {
      error = e.message
    }
  }
)
console.log('\n=== 结果: meta=' + metas.length + ' done=' + dones.length + ' final=' + gotFinal + ' err=' + (error ?? '无'))

let fails = 0
if (error) {
  console.error('运行错误：' + error)
  fails++
}
if (!gotFinal) {
  console.error('final 未到齐')
  fails++
}
const m = metas.find((x) => x.tool === 'zj_read_doc')
if (!m) {
  console.error('未见 zj_read_doc meta 事件')
  fails++
} else {
  let argsOk = typeof m.argsJson === 'string' && m.argsJson.includes('file')
  console.log('meta 参数 JSON：' + (argsOk ? 'PASS' : 'FAIL') + ' → ' + (m.argsJson ?? '').slice(0, 80))
  if (!argsOk) fails++
}
const d = dones.find((x) => x.tool === 'zj_read_doc')
if (!d) {
  console.error('未见 zj_read_doc meta-done 事件')
  fails++
} else {
  let resOk = typeof d.result === 'string' && d.result.length > 80
  console.log('meta-done 结果全文：' + (resOk ? 'PASS（' + d.result.length + ' 字符）' : 'FAIL') + ' → ' + (d.result ?? '').slice(0, 80).replace(/\n/g, ' '))
  if (!resOk) fails++
}
console.log(fails === 0 ? 'ALL OK ✅' : 'FAILED ❌ (' + fails + ')')
process.exit(fails === 0 ? 0 : 1)
