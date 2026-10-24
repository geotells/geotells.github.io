// GeoTells Faro: the admin panel. Reports, stats, the update rule and the
// phone that gets report alerts. Everything comes from admin_* functions in
// Supabase (supabase/migrations/20261019120000_reports_and_admin.sql), which
// only answer an admin signed in with a password and an authenticator code;
// this page holds no key of its own.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/+esm';

const SUPABASE_URL = 'https://kvlhqytsdhstkjhoclxu.supabase.co';
const PUBLISHABLE = 'sb_publishable_TOpALZYOS3lzNgfkuiGY2Q_6zpB-Lw3';
// Each website's current APK, for its live download count: GeoTells on
// geotells.com, and GeoSense (its last version, the move to GeoTells) on
// playgeosense.com.
const RELEASES = [
  { repo: 'geotells/geotells.github.io', apk: 'GeoTells.apk' },
  { repo: 'geosenselearnthemetas-arch/geosenselearnthemetas-arch.github.io', apk: 'GeoSense.apk' },
];
// Website downloads that were ours, not players': a release's APK fetched
// to check it. Taken off each version's count, live or closed.
const OWN_DOWNLOADS = { '2.0.0': 1, '1.7.0': 1 };
// Google's Street View viewer for the Scenes tab: a browser key that only
// works on the panel's own sites (Maps JavaScript API only). Public by
// design, like the publishable key above.
const MAPS_KEY = 'AIzaSyDvoRAtgHHesjw9lhgHqqoXzSOXncLJW9s';

const supabase = createClient(SUPABASE_URL, PUBLISHABLE, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'geotells-faro' },
});

const $ = (id) => document.getElementById(id);
const num = new Intl.NumberFormat('en');
const pct = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 0 });
const ago = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const views = ['v-login', 'v-mfa', 'v-denied', 'v-panel'];

function show(view) {
  for (const v of views) $(v).hidden = v !== view;
}

function say(box, message) {
  box.hidden = !message;
  box.textContent = message || '';
}

async function call(fn, params) {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new Error(error.message);
  return data;
}

// ---- Signing in ------------------------------------------------------

let factorId = null;

async function start() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return show('v-login');
  await afterPassword();
}

$('f-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  say($('login-error'));
  const button = ev.submitter;
  button.disabled = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    if (error) throw error;
    $('password').value = '';
    await afterPassword();
  } catch (e) {
    say($('login-error'), e.message === 'Invalid login credentials' ? 'Wrong email or password.' : e.message);
  } finally {
    button.disabled = false;
  }
});

// Past the password: an admin gives the authenticator code, setting the
// app up the first time. Anyone else stops here.
async function afterPassword() {
  try {
    const me = await call('admin_me');
    if (!me.admin) return show('v-denied');
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.currentLevel === 'aal2') return enterPanel();
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = factors.totp.find((f) => f.status === 'verified');
    $('mfa-enroll').hidden = !!verified;
    if (verified) {
      factorId = verified.id;
      $('mfa-title').textContent = 'Authenticator code';
    } else {
      // A setup left halfway is started again.
      for (const f of factors.all.filter((f) => f.status === 'unverified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'GeoTells Faro' });
      if (error) throw error;
      factorId = data.id;
      $('mfa-qr').src = data.totp.qr_code;
      $('mfa-secret').textContent = data.totp.secret;
      $('mfa-title').textContent = 'Set up the authenticator';
    }
    say($('mfa-error'));
    show('v-mfa');
    $('code').focus();
  } catch (e) {
    show('v-login');
    say($('login-error'), `Could not sign in: ${e.message}`);
  }
}

$('f-mfa').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const button = ev.submitter;
  button.disabled = true;
  try {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: $('code').value.trim() });
    if (error) throw error;
    $('code').value = '';
    await enterPanel();
  } catch (e) {
    say($('mfa-error'), /invalid/i.test(e.message) ? 'That code is not right. Try the current one.' : e.message);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('click', async (ev) => {
  if (ev.target.closest('[data-action="sign-out"]')) {
    await supabase.auth.signOut();
    show('v-login');
  }
});

// ---- The panel -------------------------------------------------------

let me = null;

async function enterPanel() {
  me = await call('admin_me');
  const { data } = await supabase.auth.getUser();
  $('who').textContent = data.user?.email ?? '';
  $('account').textContent = `Signed in as ${data.user?.email ?? 'unknown'}.`;
  show('v-panel');
  openTab(location.hash.slice(1) || 'stats');
  // The new reports and scenes on their tabs' badges, whichever tab opened.
  for (const load of [loadReports, loadScenes]) load().catch(() => {});
}

const loaded = {};
function openTab(name) {
  if (!$(`t-${name}`)) name = 'stats';
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const t of document.querySelectorAll('.tab')) t.hidden = t.id !== `t-${name}`;
  history.replaceState(null, '', `#${name}`);
  say($('panel-error'));
  const load = { reports: loadReports, scenes: loadScenes, stats: loadStats, versions: loadVersions, settings: loadSettings }[name];
  if (name === 'reports' || name === 'scenes' || !loaded[name]) load().then(() => { loaded[name] = true; }, panelError);
}

for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => openTab(b.dataset.tab));

function panelError(e) {
  // The session ran out: back to signing in.
  if (/not allowed|JWT/i.test(e.message)) return afterPassword();
  say($('panel-error'), `Something went wrong: ${e.message}`);
}

// Loaded again (Refresh, a filter): an earlier error goes once it works.
const reload = (load) => load().then(() => say($('panel-error')), panelError);

// ---- Reports ---------------------------------------------------------

const STATUSES = [['new', 'New'], ['reviewing', 'Reviewing'], ['fixed', 'Fixed'], ['dismissed', 'Dismissed'], ['all', 'All']];
const REASONS = { wrongAnswer: 'Wrong answer', badQuestion: 'Bad question', typo: 'Spelling or translation', other: 'Something else' };
let filter = 'new';
let lastReports = { counts: {}, reports: [] };
const open = new Set();

async function loadReports() {
  lastReports = await call('admin_reports', { p_status: filter === 'all' ? null : filter });
  drawReports();
}

$('reload-reports').addEventListener('click', () => reload(loadReports));
$('grouped').addEventListener('change', drawReports);

function drawFilter() {
  const box = $('status-filter');
  box.replaceChildren();
  const counts = lastReports.counts || {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const [key, label] of STATUSES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-pressed', String(filter === key));
    chip.textContent = `${label} ${num.format(key === 'all' ? all : counts[key] ?? 0)}`;
    chip.addEventListener('click', () => { filter = key; reload(loadReports); });
    box.appendChild(chip);
  }
  const fresh = counts.new ?? 0;
  $('new-count').hidden = !fresh;
  $('new-count').textContent = num.format(fresh);
}

// What a report is about: the question and the country, sample or answer.
const subject = (d) => d.answer || d.country || d.sample || '';
const groupKey = (r) => ($('grouped').checked ? `${r.details.question || '?'}|${subject(r.details)}` : `#${r.id}`);

function drawReports() {
  drawFilter();
  const box = $('report-list');
  box.replaceChildren();
  if (!lastReports.reports.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = filter === 'new' ? 'No new reports. All caught up.' : 'Nothing here.';
    return box.appendChild(p);
  }
  const groups = new Map();
  for (const r of lastReports.reports) {
    const key = groupKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  // Most reported first, then the most recent.
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || b[1][0].received_at.localeCompare(a[1][0].received_at));
  for (const [key, reports] of ordered) box.appendChild(drawGroup(key, reports));
}

function pill(text, cls = '') {
  const s = document.createElement('span');
  s.className = `pill ${cls}`;
  s.textContent = text;
  return s;
}

function when(iso) {
  const seconds = (new Date(iso) - Date.now()) / 1000;
  const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return ago.format(Math.round(seconds / size), unit);
  return 'just now';
}

function drawGroup(key, reports) {
  const node = $('tpl-group').content.firstElementChild.cloneNode(true);
  const first = reports[0];
  const d = first.details || {};
  node.querySelector('.group-title').textContent = [d.question || 'Unknown question', subject(d)].filter(Boolean).join(' · ');
  const meta = node.querySelector('.group-meta');
  meta.append(pill(reports.length === 1 ? '1 report' : `${reports.length} reports`));
  for (const reason of new Set(reports.map((r) => r.reason))) meta.append(pill(REASONS[reason] || reason));
  meta.append(pill(first.status, first.status), when(first.received_at));

  const body = node.querySelector('.group-body');
  const head = node.querySelector('.group-head');
  body.hidden = !open.has(key);
  head.setAttribute('aria-expanded', String(!body.hidden));
  head.addEventListener('click', () => {
    body.hidden = !body.hidden;
    head.setAttribute('aria-expanded', String(!body.hidden));
    if (body.hidden) open.delete(key); else open.add(key);
  });

  const list = node.querySelector('.reports');
  for (const r of reports) list.appendChild(drawReport(r));

  // The group is edited as one, starting from its newest report.
  const form = node.querySelector('form');
  form.status.value = first.status;
  form.fixed_in.value = first.fixed_in || '';
  form.message.value = first.player_message || '';
  form.note.value = first.note || '';
  const fixedIn = node.querySelector('.fixed-in');
  const syncFixed = () => {
    fixedIn.hidden = form.status.value !== 'fixed';
    form.fixed_in.required = form.status.value === 'fixed';
  };
  syncFixed();
  form.status.addEventListener('change', syncFixed);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const error = form.querySelector('.error');
    say(error);
    const button = ev.submitter;
    button.disabled = true;
    try {
      await call('admin_update_reports', {
        p_ids: reports.map((r) => r.id),
        p_status: form.status.value,
        p_fixed_in: form.fixed_in.value.trim() || null,
        p_note: form.note.value,
        p_message: form.message.value.trim(),
      });
      open.add(key);
      await loadReports();
    } catch (e) {
      say(error, e.message);
    } finally {
      button.disabled = false;
    }
  });
  return node;
}

function drawReport(r) {
  const box = document.createElement('div');
  box.className = 'report';
  const top = document.createElement('div');
  top.className = 'row';
  top.append(pill(REASONS[r.reason] || r.reason), pill(r.status, r.status));
  const time = document.createElement('span');
  time.className = 'note';
  time.textContent = `${new Date(r.received_at).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })} · ${r.app_version || '?'} · ${r.locale || '?'}`;
  top.append(time);
  box.append(top);

  const comment = document.createElement('div');
  comment.className = 'comment';
  comment.textContent = r.comment || 'No comment.';
  box.append(comment);

  const dl = document.createElement('dl');
  const add = (k, v) => {
    if (v === undefined || v === null || v === '') return;
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = typeof v === 'string' ? v : JSON.stringify(v);
    dl.append(dt, dd);
  };
  for (const [k, v] of Object.entries(r.details || {})) if (k !== 'setup') add(k, v);
  add('setup', r.details?.setup);
  add('platform', r.platform);
  add('player', r.player ? `${r.player} · ${r.player_reports} report${r.player_reports === 1 ? '' : 's'} from this install` : 'Old version (forwarded)');
  if (r.player_told_at) add('player told', new Date(r.player_told_at).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }));
  box.append(dl);
  return box;
}

// New reports show up on their own while the panel is open.
setInterval(() => {
  if (document.visibilityState === 'visible' && !$('v-panel').hidden && !$('t-reports').hidden) loadReports().catch(() => {});
}, 2 * 60 * 1000);

// ---- Scenes waiting for approval -----------------------------------------

let maps = null;
function loadMaps() {
  if (maps) return maps;
  maps = new Promise((resolve, reject) => {
    if (!MAPS_KEY) return reject(new Error('the Street View key is not set yet (MAPS_KEY in faro.js)'));
    window.__faroMaps = () => resolve(window.google.maps);
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&v=weekly&loading=async&callback=__faroMaps`;
    script.onerror = () => reject(new Error('Google Maps did not load'));
    document.head.appendChild(script);
  });
  return maps;
}

let sceneBatch = null;
async function loadScenes() {
  const data = await call('admin_scene_reviews', { p_batch: sceneBatch });
  sceneBatch = data.batch;
  const select = $('batch');
  select.replaceChildren(...data.batches.map((b) => {
    const o = document.createElement('option');
    o.value = b.batch;
    o.textContent = `${b.batch} · ${b.open ? `${b.open} to review` : 'done'}`;
    o.selected = b.batch === sceneBatch;
    return o;
  }));
  const open = data.batches.reduce((n, b) => n + b.open, 0);
  $('scene-count').hidden = !open;
  $('scene-count').textContent = num.format(open);
  drawScenes(data.scenes);
}

$('batch').addEventListener('change', () => { sceneBatch = $('batch').value; reload(loadScenes); });

function sceneProgress(scenes) {
  const ok = scenes.filter((s) => s.verdict === 'ok').length, no = scenes.filter((s) => s.verdict === 'no').length;
  $('scene-progress').textContent = `${ok} ok · ${no} no · ${scenes.length - ok - no} left`;
}

function drawScenes(scenes) {
  const box = $('scene-list');
  box.replaceChildren();
  sceneProgress(scenes);
  if (!scenes.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No scenes waiting.';
    return box.appendChild(p);
  }
  const watcher = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      watcher.unobserve(e.target);
      showPanorama(e.target, e.target._scene);
    }
  }, { rootMargin: '200px' });
  scenes.forEach((sc, i) => {
    const card = document.createElement('article');
    card.className = `card scene${sc.verdict ? ' ' + sc.verdict : ''}`;
    const head = document.createElement('div');
    head.className = 'row';
    const n = document.createElement('span');
    n.className = 'num';
    n.textContent = i + 1;
    const lesson = document.createElement('span');
    lesson.className = 'note';
    lesson.textContent = `${sc.lesson} · Google, ${sc.taken}`;
    head.append(n, lesson);
    const viewer = document.createElement('div');
    viewer.className = 'viewer';
    viewer._scene = sc;
    watcher.observe(viewer);
    // A sign's text: veiled round it, as the question shows it.
    const frame = document.createElement('div');
    frame.className = 'viewer-frame';
    frame.append(viewer);
    const close = textCloseUp(sc);
    if (close) {
      const veil = document.createElement('div');
      veil.className = 'veil';
      veil.style.setProperty('--w', close.width);
      veil.style.setProperty('--h', close.height);
      frame.append(veil);
    }
    const buttons = document.createElement('div');
    buttons.className = 'row';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset view';
    reset.addEventListener('click', () => viewer._reset?.());
    buttons.append(reset);
    if (close) {
      // The answer: the veil off and the camera back to the whole street.
      const flip = document.createElement('button');
      flip.type = 'button';
      flip.textContent = 'Show answer';
      flip.addEventListener('click', () => {
        const answered = frame.classList.toggle('answered');
        flip.textContent = answered ? 'Show question' : 'Show answer';
        viewer._show?.(answered);
      });
      buttons.append(flip);
    }
    const text = (cls, t) => { const p = document.createElement('p'); p.className = cls; p.textContent = t; return p; };
    card.append(head, frame, buttons, text('prompt', sc.prompt), text('answer', `Answer: ${sc.answer}`), text('note', sc.why));
    if (sc.note) card.append(text('error', `Note: ${sc.note}`));
    const vote = document.createElement('div');
    vote.className = 'vote';
    const comment = document.createElement('textarea');
    comment.className = 'comment';
    comment.placeholder = 'Comment (optional)';
    comment.value = sc.comment || '';
    const save = async (verdict) => {
      try {
        await call('admin_set_scene_review', { p_id: sc.id, p_verdict: verdict, p_comment: comment.value });
        sc.verdict = verdict;
        sc.comment = comment.value;
        card.className = `card scene${verdict ? ' ' + verdict : ''}`;
        sceneProgress(scenes);
      } catch (e) {
        panelError(e);
      }
    };
    for (const [v, label] of [['ok', '✔ Keep'], ['no', '✖ Remove']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = v;
      b.textContent = label;
      b.addEventListener('click', () => save(sc.verdict === v ? null : v));
      vote.append(b);
    }
    comment.addEventListener('change', () => save(sc.verdict ?? null));
    card.append(vote, comment);
    box.appendChild(card);
  });
}

// Where a sign's text is seen from in the question, as the app's
// StreetScene._textCloseUp works it out: straight at it, until it is 60% of
// the view's width, never more than 4 times closer. Its size there, as
// shares of the view. Null for other scenes, or a text already big enough.
function textCloseUp(sc) {
  const at = sc.scene?.textAt;
  if (!at) return null;
  const [x, y, w, h] = at;
  const rad = Math.PI / 180;
  const closer = Math.min(0.6 / w, 4);
  if (closer <= 1) return { heading: sc.heading, pitch: sc.pitch, fov: sc.fov, width: w, height: h };
  const half = Math.tan((sc.fov * rad) / 2);
  const right = (x - 0.5) * 2 * half, up = (0.5 - y) * 2 * half * 0.75;
  return {
    heading: (sc.heading + Math.atan(right / Math.cos(sc.pitch * rad)) / rad + 360) % 360,
    pitch: sc.pitch + Math.atan(up) / rad,
    fov: (2 * Math.atan(half / closer)) / rad,
    width: w * closer,
    height: h * closer,
  };
}

// The scene as the app frames it: its heading, pitch and field of view; a
// sign's text first from closer, as the question shows it.
async function showPanorama(el, sc) {
  try {
    const gm = await loadMaps();
    const whole = { pov: { heading: sc.heading, pitch: sc.pitch }, zoom: Math.log2(180 / sc.fov) };
    const close = textCloseUp(sc);
    const asked = close ? { pov: { heading: close.heading, pitch: close.pitch }, zoom: Math.log2(180 / close.fov) } : whole;
    let shown = asked;
    const pano = new gm.StreetViewPanorama(el, {
      pano: sc.pano, pov: asked.pov, zoom: asked.zoom,
      disableDefaultUI: true, clickToGo: false, linksControl: false, showRoadLabels: false,
      addressControl: false, motionTracking: false, motionTrackingControl: false, fullscreenControl: true,
    });
    el._reset = () => { pano.setPov(shown.pov); pano.setZoom(shown.zoom); };
    el._show = (answered) => { shown = answered ? whole : asked; el._reset(); };
  } catch (e) {
    el.textContent = `Could not show it: ${e.message}`;
  }
}

// ---- Stats -----------------------------------------------------------

// What admin_stats gives (supabase/migrations/20261023120000_faro_stats.sql)
// comes per app where it can, so the tab shows GeoTells, GeoSense or both:
// the two never share an install, so their counts add up.
$('reload-stats').addEventListener('click', () => reload(loadStats));

const APPS = ['both', 'geotells', 'geosense'];
let statsApp = (() => { try { return APPS.find((a) => a === localStorage.getItem('faro-stats-app')) ?? 'both'; } catch { return 'both'; } })();
const inApp = (r) => statsApp === 'both' || r.app === statsApp;
const appOfVersion = (v) => (v.startsWith('1.') ? 'geosense' : 'geotells');

for (const chip of document.querySelectorAll('#stats-app .chip')) {
  chip.setAttribute('aria-pressed', String(chip.dataset.app === statsApp));
  chip.addEventListener('click', () => {
    statsApp = chip.dataset.app;
    try { localStorage.setItem('faro-stats-app', statsApp); } catch { /* kept for this visit only */ }
    for (const c of document.querySelectorAll('#stats-app .chip')) c.setAttribute('aria-pressed', String(c === chip));
    if (lastStats) drawStats(...lastStats);
  });
}

// The lessons in the order they open, with what opens them.
const LESSONS = [
  ['hemisphere', 'Hemispheres', 'L1'], ['continent', 'Continents', 'L1'], ['map', 'Find the country', 'L1'],
  ['flag', 'Flags', 'L2'], ['plate', 'Plates', 'L3'], ['driving_side', 'Driving side', 'L4'], ['coverage', 'Coverage', 'L5'],
  ['capital', 'Capitals', 'L6'], ['neighbours', 'Neighbors', 'L7'], ['alphabet', 'Alphabets', 'L8'],
  ['latin_letters', 'Latin letters', 'Alphabets 1'], ['one_country', 'One letter, one country', 'Alphabets 2'],
  ['lookalike', 'Look-alike scripts', 'Alphabets 3'],
  ['road_lines', 'Road lines', 'L9'], ['language', 'Languages', 'L10'], ['street_names', 'Street names', 'Languages'],
  ['domain', 'Domains', 'L11'], ['coast', 'Coasts', 'L12'], ['city', 'Cities', 'L13'], ['phone', 'Phone codes', 'L14'],
  ['us_states', 'US states', 'L15'], ['ca_provinces', 'Canadian provinces', 'L15'], ['stop_signs', 'Stop signs', 'L16'],
  ['front_plates', 'Front plates', 'L17'],
];
const lessonOrder = (key) => { const i = LESSONS.findIndex(([k]) => k === key); return i < 0 ? LESSONS.length : i; };
const lessonName = (key) => LESSONS.find(([k]) => k === key)?.[1] ?? key;

// A subject as a person reads it: a country's name for its code, words for
// the rest ("yellowEu" as "yellow eu").
const regions = new Intl.DisplayNames('en', { type: 'region' });
function subjectName(skill, s) {
  if (/^[A-Z]{2}$/.test(s) && skill !== 'us_states' && skill !== 'ca_provinces') {
    try { return regions.of(s); } catch { return s; }
  }
  const words = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const day = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const total = (rows, key) => rows.reduce((n, r) => n + (Number(r[key]) || 0), 0);
const share = (a, b) => (b ? pct.format(a / b) : '—');

// The rows of the apps shown, those with the same key added up.
function merged(rows, keyOf, fields) {
  const out = new Map();
  for (const r of rows.filter(inApp)) {
    const k = keyOf(r);
    const t = out.get(k);
    if (!t) out.set(k, { ...r });
    else for (const f of fields) t[f] += r[f];
  }
  return [...out.values()];
}

async function fetchRelease({ repo, apk: name }) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const r = await res.json();
    const apk = (r.assets || []).find((a) => a.name === name);
    return apk ? { version: (r.name || '').replace(/^\S+ /, ''), downloads: apk.download_count, published: apk.updated_at.slice(0, 10) } : null;
  } catch { return null; }
}

// The sites' current versions that answered.
const fetchReleases = async () => (await Promise.all(RELEASES.map(fetchRelease))).filter(Boolean);

let lastStats = null;
async function loadStats() {
  const [stats, releases] = await Promise.all([call('admin_stats'), fetchReleases()]);
  lastStats = [stats, releases];
  drawStats(stats, releases);
}

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs, text) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};
const textWidth = (svg, s, size) => { const t = el('text', { 'font-size': size }, s); svg.appendChild(t); const w = t.getComputedTextLength(); t.remove(); return w; };
const shortDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function empty(box, message) { box.replaceChildren(); const p = document.createElement('p'); p.className = 'empty'; p.textContent = message; box.appendChild(p); }

// Columns, stacked when there are several series. Values on top of each;
// a column that is not over yet (dim) drawn fainter.
function columns(box, rows, label, series, { height = 200, dim = () => false } = {}) {
  if (!rows.length) return empty(box, 'Nothing yet.');
  box.replaceChildren();
  const W = Math.max(280, box.clientWidth), H = height, top = 20, bottom = 26;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'font-family': 'Overpass, sans-serif' });
  box.appendChild(svg);
  const max = Math.max(1, ...rows.map((r) => series.reduce((s, k) => s + r[k.key], 0)));
  const y = (v) => H - bottom - (v / max) * (H - top - bottom);
  const step = W / rows.length, bw = Math.min(40, step * 0.62);
  svg.appendChild(el('line', { x1: 0, x2: W, y1: H - bottom, y2: H - bottom, stroke: 'var(--line)' }));
  const labelEvery = Math.ceil(rows.length / Math.max(1, Math.floor(W / 52)));
  rows.forEach((r, i) => {
    const cx = step * i + step / 2;
    const g = el('g', dim(r) ? { opacity: 0.45 } : {});
    svg.appendChild(g);
    let base = 0;
    series.forEach((s, j) => {
      const v = r[s.key];
      if (v > 0) {
        const last = series.slice(j + 1).every((n) => !(r[n.key] > 0));
        const h = y(base) - y(base + v);
        g.appendChild(el('rect', { x: cx - bw / 2, y: y(base + v), width: bw, height: Math.max(h, 1), rx: last ? 5 : 0, fill: s.color(r) }));
        if (last) g.appendChild(el('rect', { x: cx - bw / 2, y: y(base + v) + h / 2, width: bw, height: h / 2, fill: s.color(r) }));
      }
      base += v;
    });
    if (base > 0 || rows.length <= 12) g.appendChild(el('text', { x: cx, y: y(base) - 6, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: 'var(--text)' }, num.format(base)));
    if (i % labelEvery === 0) svg.appendChild(el('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, label(r)));
  });
}

// Horizontal bars with the name on the left and the value at the end.
function bars(box, rows, name, value, color, text = (r) => num.format(value(r))) {
  if (!rows.length) return empty(box, 'Nothing yet.');
  box.replaceChildren();
  const W = Math.max(280, box.clientWidth), rowH = 32, H = rows.length * rowH;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'font-family': 'Overpass, sans-serif' });
  box.appendChild(svg);
  const left = Math.max(...rows.map((r) => textWidth(svg, name(r), 13))) + 12;
  const right = Math.max(...rows.map((r) => textWidth(svg, text(r), 13))) + 12;
  const max = Math.max(1, ...rows.map(value));
  rows.forEach((r, i) => {
    const yy = i * rowH;
    const w = Math.max(3, (value(r) / max) * (W - left - right));
    svg.appendChild(el('text', { x: left - 10, y: yy + 20, 'text-anchor': 'end', 'font-size': 13, fill: 'var(--text)' }, name(r)));
    svg.appendChild(el('rect', { x: left, y: yy + 7, width: w, height: 18, rx: 5, fill: color(r) }));
    svg.appendChild(el('text', { x: left + w + 8, y: yy + 20, 'font-size': 13, 'font-weight': 700, fill: 'var(--muted)' }, text(r)));
  });
}

const versionKind = (v) => (v === '1.0.0' ? 'test' : v.includes('-beta') ? 'beta' : 'stable');
const versionColor = (r) => ({ stable: 'var(--gold)', beta: 'var(--blue)', test: 'var(--faint)' })[versionKind(r.version)];

function listRows(box, rows, emptyText) {
  box.replaceChildren();
  if (!rows.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = emptyText; return box.appendChild(li); }
  for (const [label, value] of rows) {
    const li = document.createElement('li');
    const span = document.createElement('span'); span.textContent = label;
    const b = document.createElement('b'); b.textContent = typeof value === 'number' ? num.format(value) : value;
    li.append(span, b); box.appendChild(li);
  }
}

// Table rows: each cell a text, numbers (class n) on the right.
function tableRows(tbody, rows, emptyText, cols) {
  tbody.replaceChildren();
  if (!rows.length) { const td = tbody.insertRow().insertCell(); td.colSpan = cols; td.className = 'empty'; td.textContent = emptyText; return; }
  for (const cells of rows) {
    const tr = tbody.insertRow();
    for (const [t, cls, title] of cells) {
      const td = tr.insertCell(); td.textContent = t;
      if (cls) td.className = cls;
      if (title) td.title = title;
    }
  }
}

// A KPI's line under the number: the text, and how it went against the 7
// days before.
function versus(box, now, before, text) {
  box.replaceChildren();
  if (before != null) {
    const d = now - before;
    const s = document.createElement('span');
    s.className = d > 0 ? 'up' : d < 0 ? 'down' : '';
    s.textContent = d > 0 ? `▲ ${num.format(d)}` : d < 0 ? `▼ ${num.format(-d)}` : '= same';
    box.append(s, ` vs the 7 days before (${num.format(before)})`);
  }
  if (text) box.append(before != null ? ` · ${text}` : text);
}

function drawStats(s, releases) {
  $('stats-when').textContent = `Updated ${new Date(s.at).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}`;
  const today = s.today;

  // The headline numbers.
  const w = s.windows.filter(inApp);
  $('k-week').textContent = num.format(total(w, 'active_7'));
  versus($('k-week-sub'), total(w, 'active_7'), total(w, 'active_prev_7'), `${num.format(total(w, 'today'))} today`);
  $('k-new').textContent = num.format(total(w, 'new_7'));
  versus($('k-new-sub'), total(w, 'new_7'), total(w, 'new_prev_7'));
  const cohorts = merged(s.cohorts, (c) => c.week, ['installs', 'd1', 'd1_base', 'w1', 'w1_base', 'w2', 'w2_base']).sort((a, b) => a.week.localeCompare(b.week));
  const [d1, d1b, w1, w1b] = ['d1', 'd1_base', 'w1', 'w1_base'].map((k) => total(cohorts, k));
  $('k-d1').textContent = share(d1, d1b);
  $('k-d1-sub').textContent = d1b ? `${num.format(d1)} of ${num.format(d1b)} installs a day or more old` : 'No install old enough yet';
  $('k-w1').textContent = share(w1, w1b);
  $('k-w1-sub').textContent = w1b ? `${num.format(w1)} of ${num.format(w1b)} installs a week or more old` : 'No install a week old yet';

  // Each day of the last 30 (since the first counted), those with no one too.
  const byDay = new Map(merged(s.daily, (d) => d.day, ['active', 'new']).map((d) => [d.day, d]));
  const counted = s.daily[0]?.day ?? today;
  const length = Math.min(30, Math.round((Date.parse(today) - Date.parse(counted)) / 864e5) + 1);
  const daily = Array.from({ length }, (_, i) => {
    const d = day(today, i - length + 1);
    const r = byDay.get(d) ?? { active: 0, new: 0 };
    return { day: d, active: r.active, new: r.new, old: r.active - r.new };
  });
  const week = daily.slice(-7, -1);
  const avg = total(week, 'active') / week.length;
  $('k-habit').textContent = share(avg, total(w, 'active_7'));
  $('k-habit-sub').textContent = `On an average day this week, ${avg.toFixed(1)} of the ${num.format(total(w, 'active_7'))} played`;
  columns($('c-daily'), daily, (d) => shortDay(d.day), [{ key: 'old', color: () => 'var(--faint)' }, { key: 'new', color: () => 'var(--gold)' }],
    { dim: (d) => d.day === today });

  const cell = (a, b) => (b ? [`${share(a, b)}`, 'n', `${a} of ${b}`] : ['—', 'n']);
  tableRows($('t-cohorts'), cohorts.slice().reverse().map((c) => [
    [`Week of ${shortDay(c.week)}`], [num.format(c.installs), 'n'], cell(c.d1, c.d1_base), cell(c.w1, c.w1_base), cell(c.w2, c.w2_base),
  ]), 'No installs yet.', 5);
  columns($('c-days'), merged(s.days_played, (d) => d.days, ['installs']).sort((a, b) => a.days - b.days),
    (d) => (d.days === 1 ? '1 day' : `${d.days} days`), [{ key: 'installs', color: () => 'var(--blue)' }]);

  // The move to GeoTells.
  const moved = total(s.move.moved, 'n');
  const g7 = s.move.geosense_7 ?? {};
  const tells7 = total(s.windows.filter((r) => r.app === 'geotells'), 'active_7');
  listRows($('l-move'), [
    ['Moved to GeoTells so far', moved],
    ['… in the last 7 days', total(s.move.moved.filter((m) => m.day > day(today, -7)), 'n')],
    ['GeoSense 1.7 and up: can move now', g7.can_move ?? 0],
    ['Older GeoSense: has to update first', g7.update_first ?? 0],
    ['GeoTells installs, last 7 days', tells7],
  ], '');
  const first = s.move.moved[0]?.day;
  const movedDays = new Map(s.move.moved.map((m) => [m.day, m.n]));
  const span = first ? Math.max(1, Math.round((Date.parse(today) - Date.parse(first)) / 864e5) + 1) : 0;
  columns($('c-moved'), Array.from({ length: Math.min(span, 30) }, (_, i) => {
    const d = day(today, i - Math.min(span, 30) + 1);
    return { day: d, n: movedDays.get(d) ?? 0 };
  }), (d) => shortDay(d.day), [{ key: 'n', color: () => 'var(--gold)' }], { dim: (d) => d.day === today });

  drawLearning(s);
  drawHabits(s);
  drawDownloads(s, releases);

  // Day to day.
  const r = s.reports;
  listRows($('l-reports'), [
    ['Open now (new or reviewing)', r.open],
    ['Oldest open', r.oldest_open ? when(r.oldest_open) : '—'],
    ['Days to close one (median)', r.days_to_close == null ? '—' : Number(r.days_to_close).toFixed(1)],
  ], '');
  columns($('c-reports'), r.weeks, (x) => shortDay(x.week), [{ key: 'received', color: () => 'var(--blue)' }]);
  const reach = merged(s.reach, () => 'all', ['push', 'reminders', 'es', 'en'])[0] ?? { push: 0, reminders: 0, es: 0, en: 0 };
  const active30 = total(w, 'active_30');
  listRows($('l-counts'), [
    ['Phones with push notifications', reach.push],
    ['With reminders', reach.reminders],
    ['… in Spanish', reach.es],
    ['… in English', reach.en],
    ['Reminders, of the installs of the last 30 days', share(reach.reminders, active30)],
  ], '');
  listRows($('l-tests'), s.tests.map((t) => [`${t.kind === 'emulator' ? 'Emulator' : 'Computer build'} · ${t.version}`, t.installs]),
    'No test installs in the last 30 days.');
}

function drawLearning(s) {
  const p = merged(s.players, () => 'all', ['copies', 'played', 'placement', 'alive', 'ended', 'lessons'])[0]
    ?? { copies: 0, played: 0, placement: 0, lessons: 0 };
  const skills = merged(s.skills, (k) => k.skill, ['players', 'mastered', 'correct', 'wrong']).sort((a, b) => lessonOrder(a.skill) - lessonOrder(b.skill));
  const box = $('k-learning');
  box.replaceChildren();
  for (const [label, value, sub] of [
    ['Players with a copy', num.format(p.played), `${num.format(p.copies - p.played)} more never finished a lesson`],
    ['Lessons finished', num.format(p.lessons), p.played ? `${num.format(Math.round(p.lessons / p.played))} per player` : ''],
    ['Lessons mastered whole', num.format(total(skills, 'mastered')), 'Every subject in them'],
    ['Took the placement exam', share(p.placement, p.played), `${num.format(p.placement)} players`],
  ]) {
    const k = document.createElement('div');
    k.className = 'kpi';
    for (const [cls, t] of [['label', label], ['value', value], ['sub', sub]]) {
      const span = document.createElement('span'); span.className = cls; span.textContent = t; k.append(span);
    }
    box.append(k);
  }

  // Players who reached each level: everyone at that level or above.
  const levels = merged(s.levels, (l) => l.level, ['players']);
  const top = Math.max(0, ...levels.map((l) => l.level));
  const reached = Array.from({ length: top }, (_, i) => ({ level: i + 1, players: total(levels.filter((l) => l.level > i), 'players') }));
  const played = total(levels, 'players');
  bars($('c-funnel'), reached, (r) => `L${r.level}`, (r) => r.players, () => 'var(--gold)',
    (r) => `${num.format(r.players)} · ${share(r.players, played)}`);

  const BUCKETS = { 1: '1–9', 10: '10–24', 25: '25–49', 50: '50–99', 100: '100–249', 250: '250–499', 500: '500+' };
  const done = new Map(merged(s.lessons_done, (b) => b.from, ['players']).map((b) => [b.from, b.players]));
  columns($('c-lessons'), played ? Object.entries(BUCKETS).map(([from, name]) => ({ name, players: done.get(Number(from)) ?? 0 })) : [],
    (b) => b.name, [{ key: 'players', color: () => 'var(--blue)' }]);

  tableRows($('t-skills'), skills.map((k) => [
    [lessonName(k.skill)], [LESSONS.find(([key]) => key === k.skill)?.[2] ?? '—'], [num.format(k.players), 'n'],
    [share(k.correct, k.correct + k.wrong), 'n'], [num.format(k.correct + k.wrong), 'n'], [num.format(k.mastered), 'n'],
  ]), 'No lessons played yet.', 6);

  // The most missed, for the lesson chosen.
  const select = $('hardest-skill');
  const have = [...new Set(s.hardest.map((h) => h.skill))].sort((a, b) => lessonOrder(a) - lessonOrder(b));
  const chosen = have.includes(select.value) ? select.value : have[0];
  select.replaceChildren(...have.map((k) => { const o = document.createElement('option'); o.value = k; o.textContent = lessonName(k); o.selected = k === chosen; return o; }));
  tableRows($('t-hardest'), s.hardest.filter((h) => h.skill === chosen).map((h) => [
    [subjectName(h.skill, h.subject)], [share(h.wrong, h.correct + h.wrong), 'n', `${h.wrong} wrong`],
    [num.format(h.correct + h.wrong), 'n'], [num.format(h.players), 'n'],
  ]), 'Nothing missed often yet.', 4);
}

$('hardest-skill').addEventListener('change', () => { if (lastStats) drawLearning(lastStats[0]); });

function drawHabits(s) {
  const p = merged(s.players, () => 'all', ['alive', 'ended'])[0] ?? { alive: 0, ended: 0 };
  const best = Math.max(0, ...s.players.filter(inApp).map((x) => x.best ?? 0));
  listRows($('l-streaks'), [['Streaks going', p.alive], ['Ended (the copy still shows them)', p.ended], ['Longest ever', best ? `${num.format(best)} days` : '—']], '');
  columns($('c-streaks'), merged(s.streaks, (x) => x.streak, ['players']).sort((a, b) => a.streak - b.streak),
    (d) => `${d.streak}`, [{ key: 'players', color: () => 'var(--blue)' }]);

  tableRows($('t-challenge'), s.challenge.slice().reverse().map((c) => [
    [`#${c.number}`], [num.format(c.players), 'n'], [share(c.players, c.active), 'n', `${c.players} of ${c.active} active that day`],
    [Number(c.average).toFixed(1), 'n'], [num.format(c.perfect), 'n'], [`${Number(c.seconds).toFixed(0)} s`, 'n'],
  ]), 'No results yet.', 6);

  // "flag:LB:LB": the lesson, then what was asked (the last part is the answer).
  const question = (key) => {
    const [skill, ...rest] = key.split(':');
    const asked = rest.length > 1 ? rest.slice(0, -1) : rest;
    return `${lessonName(skill)} · ${asked.map((a) => subjectName(skill, a)).join(' · ')}`;
  };
  const hard = s.challenge_questions.filter((q) => q.players >= 2 && q.right < q.players)
    .sort((a, b) => a.right / a.players - b.right / b.players || b.players - a.players || b.number - a.number).slice(0, 8);
  tableRows($('t-questions'), hard.map((q) => [
    [`#${q.number}`], [question(q.key), '', q.key], [`${q.players - q.right} of ${q.players}`, 'n'],
  ]), 'No question missed by most yet.', 3);

  tableRows($('t-words'), s.words.slice(-14).reverse().map((x) => [
    [`#${x.number}`], [num.format(x.players), 'n'], [share(x.finished, x.players), 'n', `${x.finished} of ${x.players}`],
    [x.guesses == null ? '—' : Number(x.guesses).toFixed(1), 'n'],
  ]), 'No words played yet.', 4);
}

function drawDownloads(s, releases) {
  const players = (d) => ({ ...d, downloads: Math.max(0, d.downloads - (OWN_DOWNLOADS[d.version] ?? 0)) });
  const ofApp = (d) => inApp({ app: appOfVersion(d.version) });
  releases = releases.map(players).filter(ofApp);
  const history = s.downloads.map((d) => ({ ...players(d), live: false })).filter(ofApp);
  for (const release of releases) {
    if (!history.some((d) => d.version === release.version)) history.push({ ...release, live: true });
  }
  history.sort((a, b) => a.published.localeCompare(b.published) || a.version.localeCompare(b.version, 'en', { numeric: true }));
  $('k-downloads').textContent = `· ${num.format(total(history, 'downloads'))}`;
  $('k-downloads-sub').textContent = releases.length
    ? `From the websites, while each version was the latest. Live now: ${releases.map((r) => `${num.format(r.downloads)} on ${r.version}`).join(', ')}.`
    : 'From the websites, while each version was the latest. GitHub did not answer: closed versions only.';
  columns($('c-downloads'), history, (d) => d.version, [{ key: 'downloads', color: (d) => (d.live ? 'var(--gold)' : 'var(--faint)') }]);

  // Only versions still the latest once days were counted (since the first
  // day in s.daily): before that, no install was.
  const firsts = new Map(s.first_versions.map((f) => [f.version, f.installs]));
  const counted = s.daily[0]?.day ?? s.today;
  tableRows($('t-convert'), history.filter((d) => d.live || d.replaced >= counted).reverse().map((d) => {
    const n = firsts.get(d.version) ?? 0;
    return [[d.live ? `${d.version} (live)` : d.version], [num.format(d.downloads), 'n'], [num.format(n), 'n'], [share(n, d.downloads), 'n']];
  }), 'No downloads yet.', 4);
  bars($('c-versions'), s.versions.filter(inApp), (r) => r.version, (r) => r.installs, versionColor);
}

let resize;
window.addEventListener('resize', () => {
  clearTimeout(resize);
  resize = setTimeout(() => { if (lastStats && !$('t-stats').hidden) drawStats(...lastStats); }, 150);
});

// ---- Versions --------------------------------------------------------

// The app whose rule the tab shows: each is told to update from its own
// website.
let versionApp = 'geotells';
const appName = (app) => (app === 'geotells' ? 'GeoTells' : 'GeoSense');

for (const chip of document.querySelectorAll('#version-app .chip')) {
  chip.addEventListener('click', () => {
    versionApp = chip.dataset.app;
    for (const c of document.querySelectorAll('#version-app .chip')) c.setAttribute('aria-pressed', String(c === chip));
    say($('versions-error'));
    reload(loadVersions);
  });
}

async function loadVersions() {
  const v = await call('admin_versions', { p_app: versionApp });
  $('versions-title').textContent = `Update rule: ${appName(versionApp)}`;
  $('recommended').value = v.recommended || '';
  $('minimum').value = v.minimum || '';
  $('versions-updated').textContent = `Last changed ${new Date(v.updated_at).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}.`;
  bars($('c-versions-2'), v.versions, (r) => r.version, (r) => r.installs, versionColor);
}

$('f-versions').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  say($('versions-error'));
  const recommended = $('recommended').value.trim();
  const minimum = $('minimum').value.trim();
  if (minimum && !confirm(`${appName(versionApp)} versions below ${minimum} will be blocked until they update from its website. Save?`)) return;
  const button = ev.submitter;
  button.disabled = true;
  try {
    await call('admin_set_versions', { p_recommended: recommended, p_minimum: minimum, p_app: versionApp });
    await loadVersions();
  } catch (e) {
    say($('versions-error'), e.message);
  } finally {
    button.disabled = false;
  }
});

// ---- Settings: report alerts -------------------------------------------

async function loadSettings() {
  me = await call('admin_me');
  $('alert-state').textContent = me.alert_phone ? 'Alerts are on: they go to the phone you chose.' : 'Alerts are off.';
  $('alert-test').disabled = !me.alert_phone;
  $('alert-off').disabled = !me.alert_phone;
}

$('f-alert').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  say($('alert-error'));
  try {
    const r = await call('admin_set_alert_phone', { p_code: $('transfer').value });
    if (!r.found) return say($('alert-error'), 'No install has that transfer code. Check it in the app, under Settings.');
    $('transfer').value = '';
    await loadSettings();
    if (!r.push) $('alert-state').textContent = 'Phone found, but it has no notifications yet: turn on reminders in the app on that phone, open it once, then send a test.';
  } catch (e) {
    say($('alert-error'), e.message);
  }
});

$('alert-test').addEventListener('click', async () => {
  try {
    const sent = await call('admin_test_alert');
    $('alert-state').textContent = sent ? 'Test sent: it should arrive within a minute.' : 'No phone chosen yet.';
  } catch (e) {
    say($('alert-error'), e.message);
  }
});

$('alert-off').addEventListener('click', async () => {
  try {
    await call('admin_clear_alert_phone');
    await loadSettings();
  } catch (e) {
    say($('alert-error'), e.message);
  }
});

start();
