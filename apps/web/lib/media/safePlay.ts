/**
 * Start playback without letting a rejected play() escape as an unhandled error.
 *
 * `HTMLMediaElement.play()` returns a promise that rejects in two situations we
 * cause on purpose and cannot avoid:
 *   - NotAllowedError — the browser's autoplay policy refused because there was
 *     no user gesture yet (restoring a player's state on mount, resuming after a
 *     source swap).
 *   - AbortError — a pause() or a new src landed before playback started.
 *
 * Nobody was awaiting these calls, so the rejection surfaced as an unhandled
 * promise rejection and was reported as an application error.
 */
export function safePlay(el: HTMLMediaElement | null | undefined) {
  const started = el?.play()
  if (started && typeof started.catch === 'function') {
    // Return the *handled* promise — returning the original would hand the
    // rejection right back to any caller that awaits it.
    return started.catch(() => {
      /* autoplay blocked or playback superseded — nothing to do */
    })
  }
  return started
}
