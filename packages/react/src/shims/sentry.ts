// The web app reports crashes to its own Sentry project. Inside a host app
// that is the host's business: errors surface through onError / onEvent.
export const isInitialized = () => false
export const captureException = () => undefined
export const lastEventId = () => undefined
export const showReportDialog = () => {}
