// 织卷 · 曲线兑现检查的 LLM 调用层（主进程）
// M2.4：把「本章曲线契约 + 正文分块」交给本地 LLM 核一遍，返回结构化兑现报告。
// 纯逻辑在 shared/fulfill：这里只负责拼 prompt、调模型、把模型回报交给 parse。
import { ipcMain } from 'electron'
import type { Project, Chapter } from '../shared/types'
import { buildFulfillChecklist, segmentText, renderFulfillPrompt, parseFulfillReport, renderFulfillReport } from '../shared/fulfill'

let _abort: AbortController | null = null

async function checkFulfill(
  project: Project,
  chapter: Chapter,
  opts: { baseUrl: string; model: string; apiKey: string }
): Promise<{ ok: true; report: ReturnType<typeof parseFulfillReport>; markdown: string; prompt: string; checklistCount: number; source: string } | { ok: false; error: string }> {
  const checklist = buildFulfillChecklist(chapter)
  if (checklist.source === 'empty') {
    return {
      ok: false,
      error: '本章还没有可用曲线（每条曲线至少两个控制点），先画好曲线再检查。'
    }
  }
  const blocks = segmentText(chapter.content || '')
  if (blocks.length === 0) {
    return { ok: false, error: '本章还没有正文，先生成或写入正文。' }
  }
  const prompt = renderFulfillPrompt(project.name, chapter.num, chapter.title || '', checklist, blocks)

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
        messages: [
          {
            role: 'system',
            content: '你是一个严格照单执行格式要求的审稿工具。用户要你输出的东西必须原样按行输出，任何分析、解释都要排在回报行之后。先给完整回报行，别先自言自语。'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 6000,
        stream: false
      }),
      signal: AbortSignal.any([_abort.signal, AbortSignal.timeout(600_000)])
    })
    if (!res.ok) throw new Error(`LLM 请求失败: ${res.status}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string; reasoning?: string } }[] }
    const msg = data.choices?.[0]?.message
    const content = msg?.content ?? ''
    const reasoning = msg?.reasoning ?? ''
    // 推理模型的坑：正文可能整个落在 reasoning，content 为 null；也可能 content 是推理过程而真正
    // 的行式回报在 reasoning 里（或反之）。双通道都试：够格就用 content，不够再用 reasoning。
    let raw = content
    let report = parseFulfillReport(raw, checklist)
    const scored = (r: ReturnType<typeof parseFulfillReport>) => r.met + r.partial + r.miss
    if (reasoning && reasoning !== content && scored(report) === 0) {
      const alt = parseFulfillReport(reasoning, checklist)
      if (scored(alt) > scored(report)) {
        report = alt
        raw = reasoning
      }
    }
    if (!raw.trim() && !reasoning.trim()) throw new Error('兑现检查返回为空')
    if (scored(report) === 0) {
      // 两种都解析不出行式回报：向模型追问一次（再给一次机会，通常是模型把分析当正文了）
      const retry = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + opts.apiKey
        },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: 'user', content: prompt },
            { role: 'assistant', content: raw.trim() || '（未返回内容）' },
            { role: 'user', content: '刚才不是按格式返回的。现在只按格式输出各条目回报行：每一行一条“条目id: 已兑现/部分兑现/未兑现 — 块号: 理由”，不要任何其它文字。' }
          ],
          temperature: 0.1,
          max_tokens: 4000,
          stream: false
        }),
        signal: AbortSignal.any([_abort.signal, AbortSignal.timeout(180_000)])
      })
      if (retry.ok) {
        const r2 = (await retry.json()) as { choices?: { message?: { content?: string; reasoning?: string } }[] }
        const m2 = r2.choices?.[0]?.message
        const retryText = m2?.content ?? m2?.reasoning ?? ''
        const alt = parseFulfillReport(retryText, checklist)
        if (scored(alt) > scored(report)) {
          report = alt
          raw = retryText
        }
      }
    }
    const markdown = renderFulfillReport(project.name, chapter, checklist, report)
    return {
      ok: true,
      report: { ...report, raw: raw.slice(0, 8000) },
      markdown,
      prompt,
      checklistCount: checklist.items.length,
      source: 'board'
    }
  } catch (err) {
    return { ok: false as const, error: (err as Error).message }
  }
}

export function registerFulfillIpc() {
  ipcMain.handle(
    'fulfill:check',
    async (
      _e,
      project: Project,
      chapter: Chapter,
      opts: { baseUrl: string; model: string; apiKey: string }
    ) => {
      return checkFulfill(project, chapter, opts)
    }
  )
  ipcMain.handle('fulfill:abort', () => {
    _abort?.abort()
  })
}
