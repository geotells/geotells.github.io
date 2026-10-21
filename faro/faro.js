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
  openTab(location.hash.slice(1) || 'reports');
}

const loaded = {};
function openTab(name) {
  if (!$(`t-${name}`)) name = 'reports';
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

$('reload-reports').addEventListener('click', () => loadReports().catch(panelError));
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
    chip.addEventListener('click', () => { filter = key; loadReports().catch(panelError); });
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

$('batch').addEventListener('change', () => { sceneBatch = $('batch').value; loadScenes().catch(panelError); });

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
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset view';
    reset.addEventListener('click', () => viewer._reset?.());
    const text = (cls, t) => { const p = document.createElement('p'); p.className = cls; p.textContent = t; return p; };
    card.append(head, viewer, reset, text('prompt', sc.prompt), text('answer', `Answer: ${sc.answer}`), text('note', sc.why));
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

// The scene as the app frames it: its heading, pitch and field of view.
async function showPanorama(el, sc) {
  try {
    const gm = await loadMaps();
    const pov = { heading: sc.heading, pitch: sc.pitch };
    const zoom = Math.log2(180 / sc.fov);
    const pano = new gm.StreetViewPanorama(el, {
      pano: sc.pano, pov, zoom,
      disableDefaultUI: true, clickToGo: false, linksControl: false, showRoadLabels: false,
      addressControl: false, motionTracking: false, motionTrackingControl: false, fullscreenControl: true,
    });
    el._reset = () => { pano.setPov(pov); pano.setZoom(zoom); };
  } catch (e) {
    el.textContent = `Could not show it: ${e.message}`;
  }
}

// ---- Stats (as the old stats page draws them) -------------------------

$('reload-stats').addEventListener('click', () => loadStats().catch(panelError));

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
  drawStats(stats, release);
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

// Columns, stacked when there are several series. Values on top of each.
function columns(box, rows, label, series, { height = 200 } = {}) {
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
    let base = 0;
    series.forEach((s, j) => {
      const v = r[s.key];
      if (v > 0) {
        const last = series.slice(j + 1).every((n) => !(r[n.key] > 0));
        const h = y(base) - y(base + v);
        svg.appendChild(el('rect', { x: cx - bw / 2, y: y(base + v), width: bw, height: Math.max(h, 1), rx: last ? 5 : 0, fill: s.color(r) }));
        if (last) svg.appendChild(el('rect', { x: cx - bw / 2, y: y(base + v) + h / 2, width: bw, height: h / 2, fill: s.color(r) }));
      }
      base += v;
    });
    svg.appendChild(el('text', { x: cx, y: y(base) - 6, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: 'var(--text)' }, num.format(base)));
    if (i % labelEvery === 0) svg.appendChild(el('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, label(r)));
  });
}

// Horizontal bars with the name on the left and the value at the end.
function bars(box, rows, name, value, color) {
  if (!rows.length) return empty(box, 'Nothing yet.');
  box.replaceChildren();
  const W = Math.max(280, box.clientWidth), rowH = 32, H = rows.length * rowH;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'font-family': 'Overpass, sans-serif' });
  box.appendChild(svg);
  const left = Math.max(...rows.map((r) => textWidth(svg, name(r), 13))) + 12;
  const right = textWidth(svg, num.format(Math.max(...rows.map(value))), 13) + 12;
  const max = Math.max(1, ...rows.map(value));
  rows.forEach((r, i) => {
    const yy = i * rowH;
    const w = Math.max(3, (value(r) / max) * (W - left - right));
    svg.appendChild(el('text', { x: left - 10, y: yy + 20, 'text-anchor': 'end', 'font-size': 13, fill: 'var(--text)' }, name(r)));
    svg.appendChild(el('rect', { x: left, y: yy + 7, width: w, height: 18, rx: 5, fill: color(r) }));
    svg.appendChild(el('text', { x: left + w + 8, y: yy + 20, 'font-size': 13, 'font-weight': 700, fill: 'var(--muted)' }, num.format(value(r))));
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
    const b = document.createElement('b'); b.textContent = num.format(value);
    li.append(span, b); box.appendChild(li);
  }
}

function drawStats(s, releases) {
  $('stats-when').textContent = `Updated ${new Date(s.at).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}`;
  const history = s.downloads.map((d) => ({ ...d, live: false }));
  for (const release of releases) {
    if (!history.some((d) => d.version === release.version)) history.push({ ...release, live: true });
  }
  history.sort((a, b) => a.published.localeCompare(b.published) || a.version.localeCompare(b.version, 'en', { numeric: true }));
  $('k-downloads').textContent = num.format(history.reduce((n, d) => n + d.downloads, 0));
  $('k-downloads-sub').textContent = releases.length
    ? `${releases.map((r) => `${num.format(r.downloads)} on ${r.version}`).join(', ')}, the sites' current versions`
    : 'Closed versions only: GitHub did not answer';
  $('k-today').textContent = num.format(s.summary.today);
  $('k-week').textContent = num.format(s.summary.last_7_days);
  $('k-week-sub').textContent = `${num.format(s.summary.last_30_days)} in the last 30 days`;
  const ret = s.returning;
  $('k-return').textContent = ret.installs ? pct.format(ret.returned / ret.installs) : '—';
  $('k-return-sub').textContent = `${num.format(ret.returned)} of ${num.format(ret.installs)} installs played on 2+ days`;

  const daily = s.daily.slice(-30).map((d) => ({ ...d, old: d.active - d.new }));
  columns($('c-daily'), daily, (d) => shortDay(d.day), [{ key: 'old', color: () => 'var(--faint)' }, { key: 'new', color: () => 'var(--gold)' }]);
  columns($('c-days'), s.days_played, (d) => (d.days === 1 ? '1 day' : `${d.days} days`), [{ key: 'installs', color: () => 'var(--blue)' }]);
  columns($('c-downloads'), history, (d) => d.version, [{ key: 'downloads', color: (d) => (d.live ? 'var(--gold)' : 'var(--faint)') }]);
  bars($('c-versions'), s.versions, (r) => r.version, (r) => r.installs, versionColor);
  columns($('c-levels'), s.levels, (d) => `L${d.level}`, [{ key: 'players', color: () => 'var(--gold)' }]);
  columns($('c-streaks'), s.streaks, (d) => `${d.streak}`, [{ key: 'players', color: () => 'var(--blue)' }]);

  const tbody = $('t-challenge');
  tbody.replaceChildren();
  if (!s.challenge.length) { const td = tbody.insertRow().insertCell(); td.colSpan = 5; td.className = 'empty'; td.textContent = 'No results yet.'; }
  for (const c of s.challenge.slice().reverse()) {
    const tr = tbody.insertRow();
    for (const [t, cls] of [[`#${c.number}`], [num.format(c.players), 'n'], [Number(c.average).toFixed(1), 'n'], [num.format(c.perfect), 'n'], [`${Number(c.seconds).toFixed(0)} s`, 'n']]) {
      const td = tr.insertCell(); td.textContent = t; if (cls) td.className = cls;
    }
  }
  const counts = s.counts;
  listRows($('l-counts'), [
    ['Phones with push notifications', counts.push_devices],
    ['Installs with reminders', counts.reminder_installs],
    ['… in Spanish', counts.reminders_es],
    ['… in English', counts.reminders_en],
    ['Have played the daily challenge', counts.challenge_players],
    ['Cloud progress copies', counts.backups],
  ], '');
  listRows($('l-tests'), s.tests.map((t) => [`${t.kind === 'emulator' ? 'Emulator' : 'Local build'} · ${t.version}`, t.installs]), 'No test installs in the last 30 days.');
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
    loadVersions().catch(panelError);
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
