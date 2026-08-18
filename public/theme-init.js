(function(){
  var m = localStorage.getItem('theme');
  var d = m === 'dark' || (m !== 'light' && matchMedia('(prefers-color-scheme:dark)').matches);
  if(d) document.documentElement.classList.add('dark');
  var r = document.documentElement.style;
  r.colorScheme = d ? 'dark' : 'light';
  var bg = localStorage.getItem('theme-bg') || (d ? '#111111' : '#ffffff');
  r.backgroundColor = bg;
  r.setProperty('--color-bg', bg);
  r.setProperty('--color-bg-card', bg);
  r.setProperty('--color-bg-header', bg);
  var h = bg.match(/[a-f\d]{2}/gi);
  if(h) r.setProperty('--color-bg-header-rgb', h.map(function(x){return parseInt(x,16)}).join(' '));
})();
