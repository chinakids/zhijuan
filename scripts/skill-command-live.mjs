// / 命令模板真机冒烟：把 `/续写 …` 展开为模板 prompt 后走真边车+真模型 runChat，
// 验证模板指令能让模型按正文修改口径调 zj_edit_doc（编辑事件 arrive，且 edits 非空）。
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/skill-command-live.mjs
import { build as esbuild } from 'esbuild'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
// 干净 userData：防残留 settings 把 libraryRoot 指到已删除目录
process.env.ZJ_USERDATA = '/tmp/zj-smoke-skill-live'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const out = '/tmp/skill-live-bundle.mjs'

await esbuild({
  stdin: {
    contents:
      `export { expandCommand } from ${JSON.stringify(resolve(root, 'src/shared/commands.ts'))};` +
      `export { runChat } from ${JSON.stringify(resolve(root, 'src/main/agent/engine.ts'))}`,
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

const mod = await import(pathToFileURL(out).href)
const prompt = mod.expandCommand('/续写 三百字，把旧灯的灯语伏笔带出来。', '雾港')
if (!prompt) throw new Error('命令未展开')
console.log('=== 展开后的 prompt（前 160 字）：\n', prompt.slice(0, 160), '\n…')

const rid = 'skilllive-' + Date.now()
let gotMeta = false
let gotEdit = false
console.log('=== 开始 runChat（/续写 模板真机冒烟）', new Date().toISOString())
await mod.runChat(
  {
    requestId: rid,
    projectId: 'agent冒烟',
    chapterRel: '正文/第01章_雾港.md',
    chapterTitle: '雾港',
    prompt,
    quote: null
  },
  (e) => {
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'meta') {
      gotMeta = true
      process.stdout.write('\n[工具] ' + e.tool + (e.args ? ' · ' + e.args : '') + '\n')
    } else if (e.type === 'meta-done') process.stdout.write('[工具完成] ' + e.message.slice(0, 60) + '\n')
    else if (e.type === 'edit') {
      gotEdit = true
      process.stdout.write('\n[正文修改提案] file=' + e.file + ' 处数=' + e.edits.length + '\n')
      for (const ed of e.edits || []) {
        process.stdout.write('  - find: ' + ed.find.slice(0, 60) + '\n    → ' + ed.replace.slice(0, 80) + (ed.reason ? '（' + ed.reason + '）' : '') + '\n')
      }
    } else if (e.type === 'final') process.stdout.write('\n[最终回复] ' + e.text.slice(0, 200) + '\n')
    else if (e.type === 'error') process.stdout.write('\n[错误] ' + e.message + '\n')
  }
)
console.log('\n=== 结果: gotMeta=' + gotMeta + ' gotEdit=' + gotEdit)
process.exit(gotEdit ? 0 : 1)
