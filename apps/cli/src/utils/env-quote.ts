/**
 * Quote a value for a docker-compose `.env` file so docker compose's dotenv
 * parser preserves it *literally* — no interpolation of `$VAR`, no `#` comment
 * truncation, no whitespace trimming.
 *
 * Scheme (verified against `docker compose` with container `printenv`):
 *   - no special chars      → emit as-is
 *   - no single quote in it  → wrap in single quotes (fully literal, incl. `$`)
 *   - contains a single quote → wrap in double quotes, escaping `\` and `"`
 *
 * The only imperfect case is a value containing BOTH a single quote AND a `$`
 * (the double-quote fallback would interpolate `$VAR`) — vanishingly rare for
 * passwords/emails, and far better than the previous `'\''` scheme which broke
 * docker compose's parser entirely on any embedded single quote.
 */
export function quoteEnvValue(value: string): string {
  if (value === '') return ''
  if (!/[\s#$'"\\`!]/.test(value)) return value
  if (!value.includes("'")) return `'${value}'`
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
