window.addEventListener('error', function(e) {
  var d = document.getElementById('root');
  if (d && !d.hasChildNodes()) {
    d.style.cssText = 'padding:2rem;font-family:monospace;font-size:14px;color:#c00;white-space:pre-wrap;word-break:break-all;';
    d.textContent = '[boot error] ' + (e.message || 'unknown') + '\n' + (e.filename || '') + ':' + (e.lineno || '');
  }
});
window.addEventListener('unhandledrejection', function(e) {
  var d = document.getElementById('root');
  if (d && !d.hasChildNodes()) {
    d.style.cssText = 'padding:2rem;font-family:monospace;font-size:14px;color:#c00;white-space:pre-wrap;word-break:break-all;';
    d.textContent = '[promise error] ' + (e.reason && (e.reason.message || e.reason) || 'unknown');
  }
});
