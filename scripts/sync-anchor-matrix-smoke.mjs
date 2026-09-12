// 织卷 · 切片同步产出端防线矩阵 数据层冒烟（无 GUI / 无模型）
// 候选 2d「产出端审计」（2026-09-13 智能层轮）：normalizeSyncItems 白名单制导后，
// 无论模型把 anchor/target 写成什么形态，产出必须归一到模块设计 §7/§8 的唯一合法形态：
//   人物 → target=人物/<姓名>.md、anchor=「切片：<切片名>」
//   世界 → target=世界观/切片_<切片名>.md、anchor=「切片：<切片名>」
// 断言覆盖：长期小节误填 / 总纲污染 / 无前缀 / 带 # 号 / 后缀废话 / 旧无前缀世界文件 / 空 anchor。
// 用法：cd ~/Desktop/织卷 && node scripts/sync-anchor-matrix-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-synca-matrix-'))
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
    `const slice = '第一幕_雾港之夜'`,
    `let fails = 0`,
    `const check = (name, cond) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name); if (!cond) fails++ }`,
    `const count = (s, sub) => s.split(sub).length - 1`,
    ``,
    `// 场景：人物档案（手写基础设定）+ 总纲 + 旧无前缀世界文件（历史格式）+ 切片模板`,
    `writeFileSync(join(root, '人物/林晓.md'), '# 林晓\\\\n\\\\n> 定位：灯塔镇守夜人\\\\n\\\\n## 基础档案\\\\n\\\\n- 年龄：24\\\\n- 职业：守夜人\\\\n- 背景：十年前船难幸存者\\\\n')`,
    `writeFileSync(join(root, '世界观/总纲.md'), '# 世界观总纲\\\\n\\\\n## 时代背景\\\\n\\\\n雾港小镇，近未来\\\\n')`,
    `writeFileSync(join(root, '世界观/第一幕_雾港之夜.md'), '# 雾港之夜\\\\n\\\\n- 旧格式：大雾持续\\\\n')`,
    `const rel = ensureWorldSliceFile(root, slice)`,
    `check('ensureWorldSliceFile 创建 ' + rel, rel === '世界观/切片_第一幕_雾港之夜.md')`,
    ``,
    `const person = (anchor) => normalizeSyncItems([{ target: '人物/林晓.md', anchor, kind: 'upsert-section', before: '', after: '- 本幕状态：在栈桥等船', reason: 'r' }], slice)[0]`,
    `const world = (target, anchor) => normalizeSyncItems([{ target, anchor, kind: 'upsert-section', before: '', after: '- 事件：灯塔熄灭', reason: 'r' }], slice)[0]`,
    ``,
    `// ---- 人物侧：各类坏锚点一律归一到唯一合法形态 ----`,
    `for (const [label, bad] of [`,
    `  ['长期小节「基础档案」', '基础档案'],`,
    `  ['长期小节「基础设定」', '基础设定'],`,
    `  ['无「切片：」前缀', '第一幕_雾港之夜'],`,
    `  ['带 # 号', '## 切片：第一幕_雾港之夜'],`,
    `  ['后缀废话', '切片：第一幕_雾港之夜（深夜续）'],`,
    `  ['空字符串', ''],`,
    `  ['超长自定义', '切片：第一幕_雾港之夜——台风来袭' + '的详细记录']`,
    `]) {`,
    `  const it = person(bad)`,
    `  check('人物 anchor 归一：' + label + ' → 「切片：第一幕_雾港之夜」', it.anchor === '切片：第一幕_雾港之夜')`,
    `}`,
    `// 盘上形态：重复写两次同切片（模拟两次保存同步），切片小节必须唯一、基础档案保留`,
    `const t0 = readFileSync(join(root, '人物/林晓.md'), 'utf-8')`,
    `const t1 = applyAnchor(t0, person('基础档案')).out`,
    `const t2 = applyAnchor(t1, person('切片：第一幕_雾港之夜（深夜续）')).out`,
    `check('两次同步后切片小节唯一（无重复堆积）', count(t2, '## 切片：第一幕_雾港之夜') === 1)`,
    `check('基础档案原内容保留（年龄/职业/背景仍在）', t2.includes('- 年龄：24') && t2.includes('- 背景：十年前船难幸存者'))`,
    `check('切片内容写入且不含异号锚点', t2.includes('本幕状态：在栈桥等船') && !t2.includes('深夜续'))`,
    ``,
    `// ---- 世界侧：target 一律归一切片文件、anchor 一律归一 ----`,
    `for (const [label, target, anchor] of [`,
    `  ['总纲污染', '世界观/总纲.md', ''],`,
    `  ['旧无前缀文件', '世界观/第一幕_雾港之夜.md', '切片：第一幕_雾港之夜'],`,
    `  ['锚点写「总纲」', '世界观/总纲.md', '总纲'],`,
    `  ['锚点带 #', '世界观/总纲.md', '## 第一幕_雾港之夜'],`,
    `]) {`,
    `  const it = world(target, anchor)`,
    `  check('世界观归一：' + label + ' → target=切片_<名>.md', it.target === '世界观/切片_第一幕_雾港之夜.md')`,
    `  check('世界观归一：' + label + ' → anchor=「切片：第一幕_雾港之夜」', it.anchor === '切片：第一幕_雾港之夜')`,
    `}`,
    `const wt = applyAnchor(readFileSync(join(root, rel), 'utf-8'), world('世界观/总纲.md', '总纲')).out`,
    `check('总纲不被污染（仍只有时代背景）', readFileSync(join(root, '世界观/总纲.md'), 'utf-8').includes('近未来') && !readFileSync(join(root, '世界观/总纲.md'), 'utf-8').includes('灯塔熄灭'))`,
    `check('事件写入切片文件（H1 整节替换口径）', wt.includes('灯塔熄灭'))`,
    `check('切片文件无「## 总纲」异号标题混入', !wt.includes('## 总纲'))`,
    `check('切片文件结构干净（H1 唯一且为「# 切片：…」）', count(wt, '# 切片：第一幕_雾港之夜') === 1)`,
    `// 注入端读取口径：模板说明行被替换后不再是空壳（isTemplateShell 视角=有事实）`,
    `const shell = wt.split('\\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('> 本切片的世界状态')).length === 0`,
    `check('切片文件成非空壳（注入端可读取为设定）', !shell)`,
    ``,
    `// ---- 空切片名（约定头缺失）也不崩：统一「切片状态」 ----`,
    `const noSlice = normalizeSyncItems([{ target: '人物/林晓.md', anchor: '基础档案', kind: 'upsert-section', before: '', after: '- x', reason: '' }], '')[0]`,
    `check('无切片名时 anchor 归一为「切片状态」', noSlice.anchor === '切片状态' && noSlice.target === '人物/林晓.md')`,
    ``,
    `console.log(fails === 0 ? 'SMOKE OK（矩阵 ' + slice + '）' : 'SMOKE FAILED: ' + fails)`,
    `process.exit(fails === 0 ? 0 : 1)`
  ].join('\n')
)

const out = join(tmp, 'bundle.mjs')
await esbuild({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent' })
const { spawnSync } = await import('node:child_process')
const r = spawnSync(process.execPath, [out], { stdio: 'inherit' })
rmSync(tmp, { recursive: true, force: true })
process.exit(r.status ?? 1)
