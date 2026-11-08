/*
 * LearnHouse embed helper. Add once to a page that shows LearnHouse activity
 * iframes:
 *
 *   <iframe src="https://<org>/embed/<org>/course/<course>/activity/<activity>" data-learnhouse-embed></iframe>
 *   <script src="https://<org>/embed.js" async></script>
 *
 * - Sizes each iframe to its content (opt out with data-learnhouse-autoresize="false").
 * - Re-dispatches what happens inside as DOM events on the iframe, bubbling:
 *   learnhouse:ready, learnhouse:resize, learnhouse:complete, learnhouse:media,
 *   learnhouse:link_click, learnhouse:unavailable. The message is in event.detail.
 *
 * Only messages from the page's own LearnHouse iframes are used: each one is
 * matched to its iframe by event.source.
 */
;(function () {
  if (typeof window === 'undefined' || window.__learnhouseEmbed) return
  window.__learnhouseEmbed = true

  var SELECTOR = 'iframe[data-learnhouse-embed], iframe[src*="/embed/"][src*="/activity/"]'

  function frames() {
    return document.querySelectorAll(SELECTOR)
  }

  function hello(frame) {
    try {
      if (frame.contentWindow) frame.contentWindow.postMessage({ source: 'learnhouse-host', type: 'hello' }, '*')
    } catch (e) {
      /* the frame is gone */
    }
  }

  function watch(frame) {
    if (frame.__learnhouseWatched) return
    frame.__learnhouseWatched = true
    frame.addEventListener('load', function () {
      hello(frame)
    })
    hello(frame)
  }

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || data.source !== 'learnhouse' || data.version !== 1 || typeof data.type !== 'string') return
    var list = frames()
    for (var i = 0; i < list.length; i++) {
      var frame = list[i]
      if (frame.contentWindow !== event.source) continue
      if (data.type === 'resize' && frame.getAttribute('data-learnhouse-autoresize') !== 'false' && data.height > 0) {
        frame.style.height = Math.ceil(data.height) + 'px'
      }
      var detail = {}
      for (var key in data) if (Object.prototype.hasOwnProperty.call(data, key)) detail[key] = data[key]
      frame.dispatchEvent(new CustomEvent('learnhouse:' + data.type, { detail: detail, bubbles: true }))
      return
    }
  })

  function scan() {
    var list = frames()
    for (var i = 0; i < list.length; i++) watch(list[i])
  }

  scan()
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true })
  }
})()
