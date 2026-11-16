// Runs synchronously in <head>, before <body> paints, so a dark-mode user
// never sees a white flash. Same mechanism as dir-init.js.
//
// Manual only: the choice is what the user picked (localStorage `lh:theme`,
// mirrored from their account by ColorSchemeProvider). The OS setting is never
// read. Embeds follow their host page instead. Mirrors lib/theme/colorScheme.ts
// (THEME_STORAGE_KEY, isThemeExempt); tests/color-scheme.test.mjs keeps them
// in sync.
(function () {
  try {
    if (/^\/embed\//.test(location.pathname)) return;
    if (localStorage.getItem('lh:theme') !== 'dark') return;
    var root = document.documentElement;
    root.setAttribute('data-theme', 'dark');
    root.style.colorScheme = 'dark';
  } catch (e) { /* storage blocked: light */ }
})();
