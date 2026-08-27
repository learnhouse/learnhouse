(() => {
  const panel = document.getElementById('cookiePanel')
  const acceptButton = document.getElementById('acceptCookies')
  const rejectButton = document.getElementById('rejectCookies')
  const consentKey = 'acyberschool_cookie_consent'

  if (!panel || !acceptButton || !rejectButton) return

  const existingChoice = localStorage.getItem(consentKey)

  if (!existingChoice) {
    panel.hidden = false
  }

  const saveChoice = (choice) => {
    localStorage.setItem(consentKey, choice)
    document.documentElement.dataset.cookieConsent = choice
    panel.hidden = true

    window.dispatchEvent(
      new CustomEvent('acyberschool:cookie-consent', {
        detail: { choice }
      })
    )
  }

  if (existingChoice) {
    document.documentElement.dataset.cookieConsent = existingChoice
  }

  acceptButton.addEventListener('click', () => saveChoice('accepted'))
  rejectButton.addEventListener('click', () => saveChoice('rejected'))
})()
