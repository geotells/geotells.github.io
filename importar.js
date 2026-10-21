// The import page (importar.html): the transfer code GeoSense put after the
// # of the address, shown to copy, and the link that opens GeoTells with it
// (geotells://import?code=..., which GeoTells takes as if typed). Runs
// after lang.js. The code never leaves the browser.
(function () {
  var es = document.documentElement.lang === 'es';
  // As the app reads it (normalizeTransferCode): twelve characters of the
  // code's own, dashes and spaces aside.
  var alphabet = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/;
  var code = decodeURIComponent(location.hash.slice(1)).toUpperCase().replace(/[\s-]/g, '');
  if (!alphabet.test(code)) {
    document.getElementById('no-code').hidden = false;
    return;
  }

  // "7K2P9QXM4HTD" as "7K2P-9QXM-4HTD", as the app shows it.
  var shown = code.match(/.{1,4}/g).join('-');
  document.getElementById('code').textContent = shown;
  document.getElementById('with-code').hidden = false;
  document.getElementById('open').href = 'geotells://import?code=' + code;
  document.getElementById('open-step').hidden = false;

  var copy = document.getElementById('copy');
  var label = copy.textContent;
  copy.addEventListener('click', function () {
    var done = function () {
      copy.textContent = es ? copy.getAttribute('data-es-done') : 'Copied';
      setTimeout(function () { copy.textContent = label; }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, select);
    } else {
      select();
    }
  });

  // Without the clipboard: the code selected, for the phone's own Copy.
  function select() {
    var range = document.createRange();
    range.selectNodeContents(document.getElementById('code'));
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
})();
