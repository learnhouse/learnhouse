/**
 * Mailpit reader for flows that send email (magic link, password reset).
 * Specs that need it skip when E2E_MAILPIT_URL is not set.
 */
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL || ''

export async function latestMailTo(address: string, sinceMs: number, timeoutMs = 30_000): Promise<{ subject: string; text: string; html: string }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}&limit=5`)
    if (res.ok) {
      const data: any = await res.json()
      const msg = (data.messages ?? []).find((m: any) => new Date(m.Created).getTime() >= sinceMs - 2000)
      if (msg) {
        const full: any = await (await fetch(`${MAILPIT_URL}/api/v1/message/${msg.ID}`)).json()
        return { subject: full.Subject, text: full.Text || '', html: full.HTML || '' }
      }
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`no email to ${address} within ${timeoutMs}ms`)
}

/** First link in the email whose URL matches `re`. */
export function linkIn(mail: { text: string; html: string }, re: RegExp): string {
  const urls = [...`${mail.html} ${mail.text}`.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0].replace(/&amp;/g, '&'))
  const hit = urls.find((u) => re.test(u))
  if (!hit) throw new Error(`no link matching ${re} in email; links: ${urls.slice(0, 8).join(' ')}`)
  return hit
}
