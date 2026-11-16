// Routes without structured data. Matching them explicitly (rather than
// relying on default.tsx) clears the previous page's JSON-LD on client-side
// navigation, since slots keep their last state when nothing matches.
export default function SeoNone() {
  return null
}
