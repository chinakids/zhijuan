// @ 引用注入上下文 · 数据层冒烟（真读盘，不依赖模型）
// 验证：expandAtRefs 解析 〔类型·名称｜路径〕 → store.readDoc 读真文件 → 剥 front matter → 组装注入块。
// 用法：cd ~/Desktop/织卷 && node scripts/at-refs-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
// 坑（2026-09-11）：/tmp/zj-smoke-userdata 可能残留测试写入的 zhijuan-settings.json
// （libraryRoot 指向已删除临时目录）→ stub 环境 libraryRoot 会定位到空路径。
// 显式用干净 userData：getSettings 读不到 → libraryRoot 回退 文档/织卷项目库（真实库）。
process.env.ZJ_USERDATA = '/tmp/zj-smoke-atrefs'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const out = '/tmp/at-refs-bundle.mjs'

await esbuild({
  stdin: {
    contents: `export { expandAtRefs } from ${JSON.stringify(resolve(root, 'src/main/agent/refs.ts'))};`,
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

const { expandAtRefs } = await import(pathToFileURL(out).href)

// 真实项目库 agent冒烟（只读，不写任何文件）
const pid = 'agent冒烟'
const prompt =
  '〔人物·林晓｜人物/林晓.md〕〔章节·雾港｜正文/第01章_雾港.md〕〔素材·索引｜素材库/索引.md〕〔人物·幽灵｜人物/幽灵.md〕 只回答：林晓的祖母被称为什么？她等的是什么？'

const { refs, block } = await expandAtRefs(pid, prompt)
if (!block) throw new Error('注入块为空——引用未展开')

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

console.log('=== @ 引用展开（真读盘）===')
console.log('引用数:', refs.length, '(应为 4)')
assert('解析出 4 个引用', refs.length === 4)
assert('人物·林晓 found 且保留约定头（身份在约定头里）', refs[0].found && refs[0].content.includes('渔家女') && refs[0].content.includes('姓名: 林晓'))
assert('章节·雾港 注入正文内容且剥了 front matter（无「章号:」）', refs[1].found && refs[1].content.includes('雾港的夜') && !refs[1].content.includes('章号:'))
assert('素材·索引 注入索引内容', refs[2].found && refs[2].content.includes('不来的船'))
assert('人物·幽灵（不存在）found=false', !refs[3].found && refs[3].content === '')
assert('注入块含「用户引用展开」标题', block.includes('【用户引用展开】'))
assert('注入块对未读到文件给 zj_read_doc 指路', block.includes('zj_read_doc'))
assert('注入块保留引用标签', block.includes('〔人物·林晓｜人物/林晓.md〕'))

// 无引用 → 零开销短路
const empty = await expandAtRefs(pid, '普通消息，没有引用')
assert('无引用 block=null', empty.block === null && empty.refs.length === 0)

console.log(`\n=== 结果: ${pass} 断言全过 ===`)
process.exit(0)
