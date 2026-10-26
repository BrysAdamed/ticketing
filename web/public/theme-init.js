(function () {
  var root = document.documentElement;
  var theme = null;
  var density = null;
  try {
    theme = localStorage.getItem('tk-theme');
    density = localStorage.getItem('tk-density');
  } catch (e) {}
  var dark =
    theme === 'dark' ||
    ((!theme || theme === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (density === 'compact') root.setAttribute('data-density', 'compact');
})();
