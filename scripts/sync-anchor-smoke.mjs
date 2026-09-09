// 织卷 · 切片同步锚点归一化 数据层冒烟（无 GUI / 无模型）：真文件系统 + 真 applyAnchor。
// 复现 2026-09-09 织卷smoke 审计发现的两类坏提案，验证本轮修复后：
//  ① 人物 anchor 填「基础档案」→ 归一为「切片：<切片名>」追加新小节，基础档案原内容不被覆盖；
//  ② 世界观 target 填「总纲.md」→ 归一为「世界观/切片_<切片名>.md」（并自动创建模板）。
// 用法：cd ~/Desktop/织卷 && node scripts/sync-anchor-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-synca-smoke-'))
const entry = join(tmp, 'entry.mts')
writeFileSync(
  entry,
  [
    `import { normalizeSyncItems, ensureWorldSliceFile } from '${root}/src/main/agent/syncAnchor'`,
    `import { applyAnchor } from '${root}/src/main/proposals'`,
    `import { writeFileSync, readFileSync, existsSync } from 'node:fs'`,
    `import { mkdirSync } from 'node:fs'`,
    `import { join } from 'node:path'`,
    ``,
    `const root = '${tmp}'`,
    `mkdirSync(join(root, '人物'), { recursive: true })`,
    `mkdirSync(join(root, '世界观'), { recursive: true })`,
    `const slice = '第一幕_夏夜'`,
    `let fails = 0`,
    `const check = (name, cond) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name); if (!cond) fails++ }`,
    ``,
    `// 场景：角色档案（含手写基础设定）+ 引导模板 + 章节约定头`,
    `writeFileSync(join(root, '人物/林晚.md'), '# 林晚\\n\\n> 定位：女高中生\\n\\n## 基础档案\\n\\n- 年龄：17\\n- 外貌：长发\\n- 背景：转学生\\n')`,
    `writeFileSync(join(root, '世界观/总纲.md'), '# 世界观总纲\\n\\n## 时代背景\\n\\n近未来\\n')`,
    ``,
    `// ① ensure（runSync 前置）：切片文件自动创建`,
    `const rel = ensureWorldSliceFile(root, slice)`,
    `check('ensureWorldSliceFile 创建 ' + rel, rel === '世界观/切片_第一幕_夏夜.md' && existsSync(join(root, rel)))`,
    ``,
    `// ② 旧格式人物提案：anchor='基础档案'、before 指向基础设定`,
    `let items = normalizeSyncItems([{ target: '人物/林晚.md', anchor: '基础档案', kind: 'upsert-section', before: '基础设定', after: '- 本幕动向：主动靠近', reason: 'r' }], slice)`,
    `check('人物 anchor 归一为「切片：第一幕_夏夜」', items[0].anchor === '切片：第一幕_夏夜')`,
    `const personBefore = readFileSync(join(root, '人物/林晚.md'), 'utf-8')`,
    `const personAfter = applyAnchor(personBefore, { ...items[0], kind: 'upsert-section' }).out`,
    `check('基础档案原内容保留（年龄/外貌/背景仍在）', personAfter.includes('- 年龄：17') && personAfter.includes('- 背景：转学生'))`,
    `check('切片小节追加（含切片名标题，不覆盖长期小节）', personAfter.includes('切片：第一幕_夏夜') && personAfter.includes('本幕动向：主动靠近'))`,
    ``,
    `// ③ 旧格式世界观提案：target='世界观/总纲.md'`,
    `items = normalizeSyncItems([{ target: '世界观/总纲.md', anchor: '', kind: 'upsert-section', before: '', after: '- 事件：灯塔熄灭', reason: 'r' }], slice)`,
    `check('世界观 target 归一为 切片_ 文件', items[0].target === '世界观/切片_第一幕_夏夜.md')`,
    `check('世界观 anchor 归一', items[0].anchor === '切片：第一幕_夏夜')`,
    `const worldAfter = applyAnchor(readFileSync(join(root, rel), 'utf-8'), items[0]).out`,
    `const total = readFileSync(join(root, '世界观/总纲.md'), 'utf-8')`,
    `check('总纲不被污染（仍只有时代背景）', total.includes('近未来') && !total.includes('灯塔熄灭'))`,
    `check('事件写入切片文件', worldAfter.includes('灯塔熄灭'))`,
    ``,
    `console.log(fails === 0 ? 'SMOKE OK（' + slice + '）' : 'SMOKE FAILED: ' + fails)`,
    `process.exit(fails === 0 ? 0 : 1)`
  ].join('\n')
)

const out = join(tmp, 'bundle.mjs')
await esbuild({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent' })
const { spawnSync } = await import('node:child_process')
const r = spawnSync(process.execPath, [out], { stdio: 'inherit' })
rmSync(tmp, { recursive: true, force: true })
process.exit(r.status ?? 1)
