// The app page's live bits: screenshots in the page's language (light or
// dark as the phone is set, picked by the <source> in each <picture>), the number of
// the daily challenge or word from the link, and the version, date and size of the
// APK on offer. Runs after lang.js.
(function () {
  var es = document.documentElement.lang === 'es';

  document.querySelectorAll('#shots img').forEach(function (img) {
    var name = 'shots/' + (es ? 'es-' : 'en-');
    var n = img.getAttribute('data-n') + '.jpg';
    img.previousElementSibling.srcset = name + 'light-' + n;
    img.src = name + 'dark-' + n;
    if (es) img.alt = img.getAttribute('data-es-alt');
  });

  // "/d?7" or "/w?7", or "?n=7" from the old /daily/ links: which challenge
  // or word was shared. The label is already in the page's language.
  var label = document.getElementById('label');
  if (label) {
    var n = new URLSearchParams(location.search).get('n') || location.search.slice(1);
    if (/^\d+$/.test(n)) label.textContent += (es ? ' n.º ' : ' #') + n;
  }

  // The release the download button gives. Left as written in the page if
  // GitHub does not answer.
  fetch('https://api.github.com/repos/geotells/geotells.github.io/releases/latest')
    .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function (release) {
      var version = (release.name || '').replace(/^GeoTells\s*/, '');
      var date = new Date(release.published_at).toLocaleDateString(es ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      document.getElementById('release').textContent = (es ? 'Versión ' : 'Version ') + version + ' · ' + date;
      var apk = (release.assets || []).filter(function (a) { return /\.apk$/.test(a.name); })[0];
      if (apk) document.getElementById('size').textContent = Math.round(apk.size / 1048576) + ' MB';
    })
    .catch(function () {});
})();
