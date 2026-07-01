// Ambient type for `mailchecker` (ships no types). It exposes a single-domain
// disposable/invalid-email check backed by a bundled list of 55k+ domains.
declare module 'mailchecker' {
  const MailChecker: {
    isValid(_email: string): boolean
  }
  export default MailChecker
}
