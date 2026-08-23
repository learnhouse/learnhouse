// Runs synchronously in <head>, before <body> paints, so an RTL locale never
// flashes an LTR layout. Same reason and same mechanism as embed-bg.js.
//
// The server cannot do this: i18next's highest-priority detection source is
// localStorage, which is client-only. So the detection order below MIRRORS
// `detection.order` in lib/i18n.ts exactly — localStorage, cookie, querystring,
// navigator.
//
// The RTL list is duplicated from RTL_LANGUAGES in lib/direction.ts, because
// this file runs before any bundle loads and cannot import it.
// tests/rtl-guard.test.mjs asserts the two lists stay in sync — update both.
(function () {
  var RTL = {
    ar: 1, fa: 1, he: 1, iw: 1, ur: 1, ps: 1,
    sd: 1, ug: 1, yi: 1, dv: 1, ckb: 1,
  };

  function detect() {
    try {
      var stored = localStorage.getItem('i18nextLng');
      if (stored) return stored;
    } catch { /* private mode / sandboxed iframe */ }

    var cookie = document.cookie.match(/(?:^|;\s*)i18next=([^;]*)/);
    if (cookie) {
      try { return decodeURIComponent(cookie[1]) } catch { /* malformed */ }
    }

    try {
      var qs = new URLSearchParams(location.search).get('lng');
      if (qs) return qs;
    } catch { /* malformed query string */ }

    return (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  }

  var code = String(detect() || 'en').split('-')[0].toLowerCase();
  var dir = RTL[code] ? 'rtl' : 'ltr';

  var el = document.documentElement;
  el.setAttribute('lang', code);
  el.setAttribute('dir', dir);
  el.style.setProperty('--dir', dir === 'rtl' ? '-1' : '1');
})();
