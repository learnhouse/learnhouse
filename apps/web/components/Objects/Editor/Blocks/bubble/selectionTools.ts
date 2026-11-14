/*
 Pure helpers for the selection menu (unit tested): a word-level diff for AI
 previews, the AI prompts, parsing AI quiz/flashcard answers into blocks,
 word counts and the deep link to a passage.
*/

export type DiffPart = { kind: 'same' | 'add' | 'del'; text: string }

/** Word-level diff (LCS over tokens that keep their trailing whitespace). */
export function wordDiff(before: string, after: string): DiffPart[] {
  const tok = (s: string) => s.match(/\S+\s*|\s+/g) ?? []
  const a = tok(before)
  const b = tok(after)
  // Long passages: skip the quadratic table and show replace-all.
  if (a.length * b.length > 250_000) {
    return [
      ...(before ? [{ kind: 'del' as const, text: before }] : []),
      ...(after ? [{ kind: 'add' as const, text: after }] : []),
    ]
  }
  const norm = (s: string) => s.trim()
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = norm(a[i]) === norm(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += text
    else out.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (norm(a[i]) === norm(b[j])) {
      push('same', b[j])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', a[i++])
    } else {
      push('add', b[j++])
    }
  }
  while (i < a.length) push('del', a[i++])
  while (j < b.length) push('add', b[j++])
  return out
}

export type AIAction =
  | 'improve'
  | 'shorten'
  | 'expand'
  | 'grammar'
  | 'tone_friendly'
  | 'tone_formal'
  | 'tone_confident'
  | 'translate'
  | 'explain'
  | 'quiz'
  | 'flashcards'

export const TEXT_AI_ACTIONS: AIAction[] = ['improve', 'shorten', 'expand', 'grammar', 'explain']
export const TONE_AI_ACTIONS: AIAction[] = ['tone_friendly', 'tone_formal', 'tone_confident']
export const BLOCK_AI_ACTIONS: AIAction[] = ['quiz', 'flashcards']

const KEEP = 'Keep the same language as the text unless asked otherwise. Return only the result, with no preamble, quotes or explanation.'

/** The prompt sent to the existing activity AI chat endpoint. */
export function buildAIPrompt(action: AIAction, text: string, language?: string): string {
  const quoted = `"""\n${text}\n"""`
  switch (action) {
    case 'improve':
      return `Improve the writing of this passage from a lesson: clearer, more engaging, same meaning and roughly the same length. ${KEEP}\n${quoted}`
    case 'shorten':
      return `Make this passage from a lesson about half as long while keeping every key idea. ${KEEP}\n${quoted}`
    case 'expand':
      return `Expand this passage from a lesson with more detail and one concrete example, about twice as long. ${KEEP}\n${quoted}`
    case 'grammar':
      return `Fix spelling, grammar and punctuation in this passage. Change nothing else. ${KEEP}\n${quoted}`
    case 'tone_friendly':
      return `Rewrite this passage in a warm, friendly, encouraging tone. ${KEEP}\n${quoted}`
    case 'tone_formal':
      return `Rewrite this passage in a clear, formal, professional tone. ${KEEP}\n${quoted}`
    case 'tone_confident':
      return `Rewrite this passage in a confident, direct tone. ${KEEP}\n${quoted}`
    case 'translate':
      return `Translate this passage into ${language || 'English'}. Return only the translation, with no preamble or quotes.\n${quoted}`
    case 'explain':
      return `Explain this passage simply, as you would to a beginner, in 2-4 short sentences. ${KEEP}\n${quoted}`
    case 'quiz':
      return `Write 1 to 3 multiple-choice questions that check understanding of this passage. Reply with JSON only, no code fence: [{"question": string, "answers": [{"answer": string, "correct": boolean}]}]. Each question has 3 or 4 answers and exactly one correct answer. Use the passage's language.\n${quoted}`
    case 'flashcards':
      return `Turn the key facts of this passage into 2 to 6 flashcards. Reply with JSON only, no code fence: [{"question": string, "answer": string}]. Keep each side short. Use the passage's language.\n${quoted}`
  }
}

/** Remove fences/quotes models sometimes add around a plain answer. */
export function cleanAIText(raw: string): string {
  let s = (raw || '').trim()
  s = s.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
  if (/^(["“])[\s\S]*(["”])$/.test(s) && s.length > 1) s = s.slice(1, -1).trim()
  return s
}

function parseJSONArray(raw: string): any[] | null {
  const s = cleanAIText(raw)
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start === -1 || end <= start) return null
  try {
    const v = JSON.parse(s.slice(start, end + 1))
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

let idCounter = 0
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}`

/** A blockQuiz node from the AI's JSON, or null when it isn't usable. */
export function quizNodeFromAI(raw: string): any | null {
  const arr = parseJSONArray(raw)
  if (!arr) return null
  const questions = arr
    .map((q: any) => {
      const answers = Array.isArray(q?.answers)
        ? q.answers
            .filter((a: any) => typeof a?.answer === 'string' && a.answer.trim())
            .slice(0, 6)
            .map((a: any) => ({ answer_id: newId('answer'), answer: a.answer.trim().slice(0, 300), correct: a.correct === true }))
        : []
      if (typeof q?.question !== 'string' || !q.question.trim() || answers.length < 2 || !answers.some((a: any) => a.correct)) return null
      return {
        question_id: newId('question'),
        question: q.question.trim().slice(0, 500),
        type: 'multiple_choice',
        response_type: answers.filter((a: any) => a.correct).length > 1 ? 'multiple' : 'single',
        answers,
      }
    })
    .filter(Boolean)
    .slice(0, 10)
  if (!questions.length) return null
  return { type: 'blockQuiz', attrs: { quizId: newId('quiz'), questions } }
}

/** Flipcard nodes (in a grid when there are several) from the AI's JSON. */
export function flashcardNodesFromAI(raw: string): any | null {
  const arr = parseJSONArray(raw)
  if (!arr) return null
  const cards = arr
    .filter((c: any) => typeof c?.question === 'string' && typeof c?.answer === 'string' && c.question.trim() && c.answer.trim())
    .slice(0, 12)
    .map((c: any) => ({
      type: 'flipcard',
      attrs: { question: c.question.trim().slice(0, 300), answer: c.answer.trim().slice(0, 500), color: 'blue', alignment: 'center', size: 'medium' },
    }))
  if (!cards.length) return null
  return cards.length === 1 ? cards[0] : { type: 'flipcardGrid', attrs: { columns: Math.min(3, cards.length) }, content: cards }
}

/** ProseMirror content for AI text: plain text, paragraphs on blank lines. */
export function textToContent(text: string): any[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (paras.length <= 1) return text.trim() ? [{ type: 'text', text: text.trim() }] : []
  return paras.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p.replace(/\n/g, ' ') }] }))
}

export function countWords(text: string): { words: number; chars: number } {
  const trimmed = (text || '').trim()
  // Count CJK characters as words: they are not space separated.
  const cjk = (trimmed.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length
  const latin = trimmed.replace(/[぀-ヿ㐀-鿿가-힯]/g, ' ').split(/\s+/).filter(Boolean).length
  return { words: latin + cjk, chars: trimmed.length }
}

/**
 * Link straight to a passage of the learner page with a URL text fragment
 * (#:~:text=…), which browsers scroll to and highlight. Long selections use
 * the start,end form.
 */
export function passageLink(pageUrl: string, text: string): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return pageUrl
  const enc = (s: string) => encodeURIComponent(s).replace(/-/g, '%2D')
  const words = clean.split(' ')
  const fragment = words.length > 8 ? `${enc(words.slice(0, 4).join(' '))},${enc(words.slice(-4).join(' '))}` : enc(clean)
  return `${pageUrl.split('#')[0]}#:~:text=${fragment}`
}
