// The web app talks to its own API with the session cookie, so its requests
// send credentials (`credentials: 'include'`, `xhr.withCredentials = true`).
// Embedded on another site the components sign in with a bearer token
// instead, and the API answers those origins with
// `Access-Control-Allow-Origin: *`, which browsers refuse for credentialed
// requests. Same-origin requests carry cookies either way, so a same-origin
// proxy keeps working.
export function rewriteCredentials(code) {
  return code
    .replace(/credentials:\s*(['"])include\1/g, "credentials: 'same-origin'")
    .replace(/\.withCredentials\s*=\s*true\b/g, '.withCredentials = false')
}
