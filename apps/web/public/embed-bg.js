// Runs synchronously in <head> before body paint.
// Sets html+body background for /embed/ routes to prevent white flash.
(function () {
  if (!/^\/embed\//.test(location.pathname)) return;
  var p = new URLSearchParams(location.search);
  var c = p.get('bgcolor');
  // Sanitise: only allow hex colour values (3-8 chars, e.g. fff, ff00aa, 09090bff)
  var bg = c && /^[0-9a-fA-F]{3,8}$/.test(c) ? '#' + c : '#09090b';
  var s = document.createElement('style');
  s.textContent = 'html,body{background-color:' + bg + '!important}';
  document.head.appendChild(s);
})();
