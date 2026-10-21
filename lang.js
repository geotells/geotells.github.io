// Spanish for Spanish-speaking phones, English for everyone else.
(function () {
  var es = (navigator.language || '').toLowerCase().indexOf('es') === 0;
  if (!es) return;
  document.documentElement.lang = 'es';
  document.querySelectorAll('[data-es]').forEach(function (el) {
    // Our own text, with <b> for the words to look for on screen.
    el.innerHTML = el.getAttribute('data-es');
  });
})();
