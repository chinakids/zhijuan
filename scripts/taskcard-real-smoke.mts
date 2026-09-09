// 真实任务卡数据冒烟：读「素材库验收」项目的真任务卡（管道 2026-09-03 回填），验证 parseTaskCard
import { readFileSync } from 'node:fs'
import { parseTaskCard } from '../src/shared/taskCard.ts'

const p = process.env.HOME + '/Documents/织卷项目库/素材库验收/素材库/采集池/任务_先一条试试.md'
const text = readFileSync(p, 'utf8')
const d = parseTaskCard(text)
console.log('status=', d.status)
console.log('category=', d.category)
console.log('keywords=', JSON.stringify(d.keywords))
console.log('result=', d.result)
console.log('finishedAt=', d.finishedAt)
console.log('body head=', d.body.split('\n')[0])
const ok = d.status === 'done' && d.result === '素材库/环境/采集_先一条试试.md' && d.finishedAt === '2026-09-03 12:25' && d.keywords.includes('旧图书馆')
console.log(ok ? 'PASS: 真任务卡解析正确（done/结果/完成/关键词）' : 'FAIL')
process.exit(ok ? 0 : 1)
