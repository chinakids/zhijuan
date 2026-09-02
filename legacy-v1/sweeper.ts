// 织卷 · 章节审计的 LLM 调用层（主进程）
// 职责：把「本章正文」交给本地 LLM 产出结构化记录 → 再用 shared/sweeper 的纯逻辑
// 把「疑似设定变化」转成草稿（绝不直接改设定）。
import { ipcMain } from 'electron'
import type { Project, Chapter, SweepDraft } from '../shared/types'
import { buildAssembledContext } from '../shared/composer'
import { sliceAt, charSnapshot } from '../shared/setting'
import { parseAudit, inferChangeCandidates, toSweepDrafts } from '../shared/sweeper'
import { parseElementMelt, toCreateDrafts, type MeltElement } from '../shared/melt'

let _abort: AbortController | null = null

function currentNames(project: Project, chapter: Chapter): string {
  const ctx = buildAssembledContext(project, chapter)
  return ctx.chars
    .map((i) => {
      const c = i.target
      const last = sliceAt(c.slices ?? [], ctx.currentNum)
      return `${c.name}（此时状态：${last?.content || charSnapshot(c)}）`
    })
    .join('\n')
}

function auditPrompt(project: Project, chapter: Chapter, recent: string): string {
  const names = currentNames(project, chapter)
  return `你是小说项目的设定管理员。请阅读下面这一章正文，然后输出一份「章节记录 + 人物状态推进」，供项目维护用。

如果前面的章节有记录（近期摘要），只把它们当作背景，不要重复它们的内容：
${recent || '（无）'}

本章出场人物的最新已知状态：
${names || '（无）'}

本章正文：
${(chapter.content || '').slice(0, 24000)}

请只输出一个 JSON 对象，不要输出任何解释、注释或 Markdown 围栏：
{
  "chapterNum": ${chapter.num},
  "summary": "120字以内的本章事件摘要",
  "characterStates": [
    { "name": "出场人物的名字", "state": "本章结束时该人物相对上一状态的新状态，若全然没变就不列该人" }
  ],
  "resolved": ["本章兑现的伏笔（可空数组）"],
  "sown": ["本章新埋的伏笔或节点（可空数组）"],
  "standingChanges": ["世界观或人物关系的永久性变化（可空数组）"]
}`
}

async function auditChapter(
  project: Project,
  chapter: Chapter,
  opts: { baseUrl: string; model: string; apiKey: string }
): Promise<{ ok: true; drafts: SweepDraft[]; prompt: string } | { ok: false; error: string }> {
  const recent = (project.records ?? [])
    .filter((r) => r.chapterNum < chapter.num)
    .sort((a, b) => b.chapterNum - a.chapterNum)
    .slice(0, 2)
    .map((r) => `第${r.chapterNum}章：${r.summary}`)
    .join('\n')

  _abort?.abort()
  _abort = new AbortController()
  const url = opts.baseUrl.replace(/\/$/, '') + '/chat/completions'
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + opts.apiKey
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: 'user', content: auditPrompt(project, chapter, recent) }],
        temperature: 0.2,
        max_tokens: 4000,
        stream: false
      }),
      signal: _abort.signal
    })
    if (!res.ok) throw new Error(`LLM 请求失败: ${res.status}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string; reasoning?: string } }[] }
    const msg = data.choices?.[0]?.message
    const raw = msg?.content ?? msg?.reasoning ?? ''
    if (!raw.trim()) throw new Error('审计模型返回为空')

    const { record, error } = parseAudit(raw)
    if (!record) throw new Error('审计结果解析失败：' + error)

    const changes = inferChangeCandidates(project, record)
    const newDrafts = toSweepDrafts(project, chapter, record, changes)
    if (newDrafts.length === 0) throw new Error('没有检测到任何变化或记录内容')
    return { ok: true, drafts: newDrafts, prompt: auditPrompt(project, chapter, recent) }
  } finally {
    // 无资源需要清理（请求以 result 返回）
  }
}

export function registerSweepIpc() {
  ipcMain.handle('audit:generate', async (_e, project: Project, chapter: Chapter, opts: { baseUrl: string; model: string; apiKey: string }) => {
    try {
      return await auditChapter(project, chapter, opts)
    } catch (err) {
      return { ok: false as const, error: (err as Error).message }
    }
  })
  ipcMain.handle('melt:convert', async (_e, text: string, atChapter: number, opts: { baseUrl: string; model: string; apiKey: string }) => {
    try {
      const trimmed = (text ?? '').trim()
      if (!trimmed) return { ok: false as const, error: '没有可分解的文本' }
      _abort?.abort()
      _abort = new AbortController()
      const url = opts.baseUrl.replace(/\/$/, '') + '/chat/completions'
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + opts.apiKey },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            {
              role: 'user',
              content:
                '把下面这段设定文字拆成若干条目（每条对应一个规则/场景/道具/设定信息卡）。' +
                '只输出一个 JSON 数组，不要任何解释或 Markdown 围栏：\n' +
                '[{"kind":"rule|scene|prop|lore|other","name":"条目名","tags":["标签"],"content":"详细设定"}]\n\n' +
                '文字：\n' +
                trimmed.slice(0, 12000)
            }
          ],
          temperature: 0.2,
          max_tokens: 2000,
          stream: false
        }),
        signal: _abort.signal
      })
      if (!res.ok) throw new Error(`LLM 请求失败: ${res.status}`)
      const data = (await res.json()) as { choices?: { message?: { content?: string; reasoning?: string } }[] }
      const raw = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.message?.reasoning ?? ''
      const { elements, error } = parseElementMelt(raw)
      if (elements.length === 0) throw new Error('没有解析出任何条目：' + (error ?? '空结果'))
      const drafts = toCreateDrafts(elements, atChapter, trimmed.slice(0, 12))
      return { ok: true as const, drafts, elements: elements.slice(0, 20) }
    } catch (err) {
      return { ok: false as const, error: (err as Error).message }
    }
  })
}
