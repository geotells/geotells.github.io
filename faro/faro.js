// GeoTells Faro: the admin panel. Reports, stats, the update rule and the
// phone that gets report alerts. Everything comes from admin_* functions in
// Supabase (supabase/migrations/20261019120000_reports_and_admin.sql), which
// only answer an admin signed in with a password and an authenticator code;
// this page holds no key of its own.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/+esm';

const SUPABASE_URL = 'https://kvlhqytsdhstkjhoclxu.supabase.co';
const PUBLISHABLE = 'sb_publishable_TOpALZYOS3lzNgfkuiGY2Q_6zpB-Lw3';
// The website's current APKs, for its live download count (geotells.com):
// the main one and, since 2.6.1, the 32-bit one for old phones ("Other
// versions"), counted together.
const RELEASES = [
  { repo: 'geotells/geotells.github.io', apks: ['GeoTells.apk', 'GeoTells-32bit.apk'] },
];
// Website downloads that were ours, not players': a release's APK fetched
// to check it. Taken off each version's count, live or closed.
const OWN_DOWNLOADS = { '2.0.0': 1 };
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
  // The new reports, scenes and crashes on their tabs' badges, whichever tab opened.
  for (const load of [loadReports, loadScenes, loadCrashes]) load().catch(() => {});
}

const loaded = {};
function openTab(name) {
  if (!$(`t-${name}`)) name = 'stats';
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const t of document.querySelectorAll('.tab')) t.hidden = t.id !== `t-${name}`;
  history.replaceState(null, '', `#${name}`);
  say($('panel-error'));
  const load = { progress: loadProgress, onboarding: loadOnboarding, reports: loadReports, scenes: loadScenes, crashes: loadCrashes, stats: loadStats, api: loadApi, versions: loadVersions, settings: loadSettings }[name];
  if (name === 'reports' || name === 'scenes' || name === 'crashes' || !loaded[name]) load().then(() => { loaded[name] = true; }, panelError);
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

// ---- Crashes ---------------------------------------------------------

const CRASH_STATUSES = [['new', 'New'], ['fixed', 'Fixed'], ['ignored', 'Ignored'], ['all', 'All']];
const CRASH_KINDS = { flutter: 'Flutter', uncaught: 'Uncaught', startup: 'Startup' };
let crashFilter = 'new';
let lastCrashes = { counts: {}, groups: [] };
const openCrashes = new Set();

async function loadCrashes() {
  lastCrashes = await call('admin_crashes', { p_status: crashFilter === 'all' ? null : crashFilter });
  drawCrashes();
}

$('reload-crashes').addEventListener('click', () => reload(loadCrashes));

function drawCrashes() {
  const counts = lastCrashes.counts || {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const chips = $('crash-filter');
  chips.replaceChildren();
  for (const [key, label] of CRASH_STATUSES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-pressed', String(crashFilter === key));
    chip.textContent = `${label} ${num.format(key === 'all' ? all : counts[key] ?? 0)}`;
    chip.addEventListener('click', () => { crashFilter = key; reload(loadCrashes); });
    chips.appendChild(chip);
  }
  $('crash-count').hidden = !counts.new;
  $('crash-count').textContent = num.format(counts.new ?? 0);

  const box = $('crash-list');
  box.replaceChildren();
  if (!lastCrashes.groups.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = crashFilter === 'new' ? 'No new crashes.' : 'Nothing here.';
    return box.appendChild(p);
  }
  for (const g of lastCrashes.groups) box.appendChild(drawCrashGroup(g));
}

function drawCrashGroup(g) {
  const node = $('tpl-crash').content.firstElementChild.cloneNode(true);
  const latest = g.crashes[0];
  node.querySelector('.group-title').textContent = latest.error.split('\n')[0] || 'Unknown error';
  const meta = node.querySelector('.group-meta');
  meta.append(
    pill(g.count === 1 ? '1 time' : `${num.format(g.count)} times`),
    pill(g.installs === 1 ? '1 install' : `${num.format(g.installs)} installs`),
    pill(CRASH_KINDS[latest.kind] || latest.kind),
    pill(g.status, g.status),
  );
  if (g.last_day) meta.append(pill(`${num.format(g.last_day)} today`, 'new'));
  meta.append(`${g.versions.slice(0, 3).join(', ')}${g.versions.length > 3 ? '…' : ''} · ${when(g.last)}`);

  const body = node.querySelector('.group-body');
  const head = node.querySelector('.group-head');
  body.hidden = !openCrashes.has(g.fingerprint);
  head.setAttribute('aria-expanded', String(!body.hidden));
  head.addEventListener('click', () => {
    body.hidden = !body.hidden;
    head.setAttribute('aria-expanded', String(!body.hidden));
    if (body.hidden) openCrashes.delete(g.fingerprint); else openCrashes.add(g.fingerprint);
  });

  const list = node.querySelector('.reports');
  const first = document.createElement('p');
  first.className = 'note';
  first.textContent = `First seen ${new Date(g.first).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}. The last ${g.crashes.length}:`;
  list.append(first);
  for (const c of g.crashes) list.appendChild(drawCrash(c));

  const form = node.querySelector('form');
  form.status.value = g.status;
  form.fixed_in.value = g.fixed_in || '';
  form.note.value = g.note || '';
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
      await call('admin_update_crashes', {
        p_fingerprints: [g.fingerprint],
        p_status: form.status.value,
        p_fixed_in: form.fixed_in.value.trim() || null,
        p_note: form.note.value,
      });
      openCrashes.add(g.fingerprint);
      await loadCrashes();
    } catch (e) {
      say(error, e.message);
    } finally {
      button.disabled = false;
    }
  });
  return node;
}

function drawCrash(c) {
  const box = document.createElement('div');
  box.className = 'report';
  const top = document.createElement('div');
  top.className = 'row';
  const time = document.createElement('span');
  time.className = 'note';
  time.textContent = [
    new Date(c.received_at).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }),
    `${c.app} ${c.app_version}`.trim(), c.platform, c.locale, c.player && `install ${c.player}`,
  ].filter(Boolean).join(' · ');
  // What the tool needs: the version on the first line, then the trace.
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy trace';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(`${c.app} ${c.app_version}\n${c.error}\n${c.stack}`);
    copy.textContent = 'Copied';
    setTimeout(() => { copy.textContent = 'Copy trace'; }, 1500);
  });
  top.append(pill(CRASH_KINDS[c.kind] || c.kind), time, copy);
  box.append(top);

  const error = document.createElement('div');
  error.className = 'comment';
  error.textContent = c.error;
  box.append(error);
  if (c.context) {
    const where = document.createElement('div');
    where.className = 'note';
    where.textContent = c.context;
    box.append(where);
  }
  if (c.stack) {
    const pre = document.createElement('pre');
    pre.className = 'trace';
    pre.textContent = c.stack;
    box.append(pre);
  }
  return box;
}

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
    // Moved, turned or zoomed to better it: this view is the one the app
    // will use (a sign's text keeps its framing: its place in it is measured).
    if (!close) {
      const keep = document.createElement('button');
      keep.type = 'button';
      keep.textContent = 'Use this view';
      keep.disabled = true;
      viewer._changed = (changed) => { keep.disabled = !changed; keep.textContent = 'Use this view'; };
      keep.addEventListener('click', async () => {
        const v = viewer._view?.();
        if (!v) return;
        try {
          await call('admin_set_scene_view', { p_id: sc.id, p_pano: v.pano, p_heading: v.heading, p_pitch: v.pitch, p_fov: v.fov });
          Object.assign(sc, v);
          viewer._kept?.(v);
          keep.disabled = true;
          keep.textContent = 'View saved ✔';
        } catch (e) {
          panelError(e);
        }
      });
      buttons.append(keep);
    }
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
    // Free to move along the road, turn and zoom, to find a better view.
    const free = !close;
    const pano = new gm.StreetViewPanorama(el, {
      pano: sc.pano, pov: asked.pov, zoom: asked.zoom,
      disableDefaultUI: true, clickToGo: free, linksControl: free, zoomControl: free, showRoadLabels: false,
      addressControl: false, motionTracking: false, motionTrackingControl: false, fullscreenControl: true,
    });
    let home = sc.pano;
    el._reset = () => { if (pano.getPano() !== home) pano.setPano(home); pano.setPov(shown.pov); pano.setZoom(shown.zoom); };
    el._show = (answered) => { shown = answered ? whole : asked; el._reset(); };
    const round = (v) => Math.round(v * 10) / 10;
    el._view = () => {
      const pov = pano.getPov();
      return {
        pano: pano.getPano(),
        heading: round((pov.heading % 360 + 360) % 360),
        pitch: round(pov.pitch),
        fov: round(Math.min(120, 180 / 2 ** pano.getZoom())),
      };
    };
    el._kept = (v) => { home = v.pano; shown = { pov: { heading: v.heading, pitch: v.pitch }, zoom: Math.log2(180 / v.fov) }; };
    const changed = () => {
      const v = el._view(), z = shown.zoom;
      el._changed?.(v.pano !== home || Math.abs(v.heading - shown.pov.heading) > 0.5 || Math.abs(v.pitch - shown.pov.pitch) > 0.5 || Math.abs(pano.getZoom() - z) > 0.05);
    };
    for (const ev of ['pano_changed', 'pov_changed', 'zoom_changed']) pano.addListener(ev, changed);
  } catch (e) {
    el.textContent = `Could not show it: ${e.message}`;
  }
}

// ---- Stats -----------------------------------------------------------

// What admin_stats gives (supabase/migrations/20261023120000_faro_stats.sql)
// comes per app where it can; the tab shows GeoTells only (2.x and up).
$('reload-stats').addEventListener('click', () => reload(loadStats));

const inApp = (r) => r.app === 'geotells';
const isGeoTells = (v) => !v.startsWith('1.');

// The lessons in the order they open, with what opens them (LessonUnlock in
// lib/game/country_lessons.dart; levels as restructured on 2026-11-15).
const LESSONS = [
  ['hemisphere', 'Hemispheres', 'L1'], ['continent', 'Continents', 'L1'], ['map', 'Find the country', 'L1'],
  ['flag', 'Flags', 'L2'], ['plate', 'Plates', 'L4'], ['driving_side', 'Driving side', 'L5'], ['coverage', 'Coverage', 'L6'],
  ['capital', 'Capitals', 'L7'], ['neighbours', 'Neighbors', 'L8'], ['alphabet', 'Alphabets', 'L9'],
  ['latin_letters', 'Telltale letters', 'Alphabets 1'], ['lookalike', 'Look-alike scripts', 'Alphabets 2'],
  ['road_lines', 'Road lines', 'L11'], ['language', 'Languages', 'L12'], ['street_names', 'Street names', 'L13'],
  ['domain', 'Domains', 'L14'], ['coast', 'Coasts', 'L16'], ['city', 'Cities', 'L17'],
  ['phone_family', 'Phone zones and families', 'L18'], ['phone', 'Phone codes', 'Phone families'],
  ['us_states', 'US states', 'L19'], ['ca_provinces', 'Canadian provinces', 'L19'], ['mx_states', 'Mexican states', 'L19'],
  ['stop_signs', 'Stop signs', 'L20'],
  ['br_states', 'Brazilian states', 'L21'], ['ar_provinces', 'Argentine provinces', 'L21'], ['cl_regions', 'Chilean regions', 'L21'],
  ['front_plates', 'Front plates', 'L22'],
  ['tr_provinces', 'Turkish provinces', 'L23'], ['ru_districts', 'Russian districts', 'L23'],
  ['jp_regions', 'Japanese regions', 'L23'], ['id_islands', 'Indonesian islands', 'L23'],
  ['chevrons', 'Chevrons', 'L24'], ['au_states', 'Australian states', 'L25'], ['za_provinces', 'South African provinces', 'L25'],
  ['rivers', 'Rivers', 'L26'], ['lakes', 'Lakes', 'Rivers'],
  // Gone on 2026-11-19 (its letters went to Telltale letters and Look-alikes); kept for old logs.
  ['one_country', 'One letter, one country (removed)', '—'],
];
const lessonOrder = (key) => { const i = LESSONS.findIndex(([k]) => k === key); return i < 0 ? LESSONS.length : i; };
const lessonName = (key) => LESSONS.find(([k]) => k === key)?.[1] ?? key;

// A subject as a person reads it: a country's name for its code, words for
// the rest ("yellowEu" as "yellow eu").
const regions = new Intl.DisplayNames('en', { type: 'region' });
// Regions' subjects are states and provinces, whose codes (SA, WA, EC) are not countries.
const REGION_SKILLS = new Set(['us_states', 'ca_provinces', 'mx_states', 'br_states', 'ar_provinces', 'cl_regions',
  'tr_provinces', 'ru_districts', 'jp_regions', 'id_islands', 'au_states', 'za_provinces']);
function subjectName(skill, s) {
  if (/^[A-Z]{2}$/.test(s) && !REGION_SKILLS.has(skill)) {
    try { return regions.of(s); } catch { return s; }
  }
  const words = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const day = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const total = (rows, key) => rows.reduce((n, r) => n + (Number(r[key]) || 0), 0);
const share = (a, b) => (b ? pct.format(a / b) : '—');

// The app's rows, those with the same key added up.
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

async function fetchRelease({ repo, apks: [name, ...others] }) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const r = await res.json();
    const apk = (r.assets || []).find((a) => a.name === name);
    const extra = (r.assets || []).filter((a) => others.includes(a.name)).reduce((n, a) => n + a.download_count, 0);
    return apk ? { version: (r.name || '').replace(/^\S+ /, ''), downloads: apk.download_count + extra, published: apk.updated_at.slice(0, 10) } : null;
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

// ---- Progress --------------------------------------------------------

// What admin_progression gives (supabase/migrations/20261111120000_lesson_progression.sql):
// per lesson level, whether players keep mastering things or get stuck.

$('reload-progress').addEventListener('click', () => reload(loadProgress));

let progressDays = (() => { try { return Number(localStorage.getItem('faro-progress-days')) || 30; } catch { return 30; } })();
for (const chip of document.querySelectorAll('#progress-days .chip')) {
  chip.setAttribute('aria-pressed', String(Number(chip.dataset.days) === progressDays));
  chip.addEventListener('click', () => {
    progressDays = Number(chip.dataset.days);
    try { localStorage.setItem('faro-progress-days', String(progressDays)); } catch { /* kept for this visit only */ }
    for (const c of document.querySelectorAll('#progress-days .chip')) c.setAttribute('aria-pressed', String(c === chip));
    reload(loadProgress);
  });
}

async function loadProgress() {
  $('progress-when').textContent = 'Loading…';
  const p = await call('admin_progression', { p_days: progressDays });
  drawProgress(p);
  $('progress-when').textContent = `Last ${p.days} days · ${new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}`;
}

function drawProgress(p) {
  $('progress-n').textContent = p.stuckGames;
  const lessons = p.lessons.slice().sort((a, b) => lessonOrder(a.lesson) - lessonOrder(b.lesson));
  const games = total(lessons, 'games'), counted = total(lessons, 'counted_games');
  const box = $('k-progress');
  box.replaceChildren();
  for (const [label, value, sub] of [
    ['Lesson games', num.format(games), `${num.format(Math.max(0, ...lessons.map((l) => l.players)))} players in the busiest lesson`],
    ['Moving on', share(total(lessons, 'gain_games'), counted), `of ${num.format(counted)} games with counts mastered something new`],
    ['Stuck now', num.format(p.stuck.length), `players with ${p.stuckGames}+ games in a row getting nowhere`],
    ['Reviews that worked', share(total(lessons, 'reviews_worked'), total(lessons, 'reviews')), `of ${num.format(total(lessons, 'reviews'))} shown, ${num.format(total(lessons, 'reviews_looked'))} looked at`],
  ]) {
    const k = document.createElement('div');
    k.className = 'kpi';
    for (const [cls, t] of [['label', label], ['value', value], ['sub', sub]]) {
      const s = document.createElement('span'); s.className = cls; s.textContent = t; k.appendChild(s);
    }
    box.appendChild(k);
  }
  const orDash = (v, f = (x) => num.format(x)) => (v == null ? '—' : f(v));
  tableRows($('t-lesson-progress'), lessons.map((l) => [
    [lessonName(l.lesson), '', l.lesson], [num.format(l.players), 'n'], [num.format(l.games), 'n'], [`${l.right_pct}%`, 'n'],
    [share(l.gain_games, l.counted_games), 'n', `${l.gain_games} of ${l.counted_games} games with counts`],
    [orDash(l.stuck_now), l.stuck_now > 0 ? 'n warn' : 'n'],
    [l.dry_median == null ? '—' : `${l.dry_median} · ${l.dry_worst}`, 'n', 'Median · worst, per player'],
    [orDash(l.first_gain_median), 'n', l.never_gained ? `${l.never_gained} players never mastered one yet` : ''],
    [l.reviews ? `${l.reviews_worked}/${l.reviews}` : '—', 'n', l.reviews ? `${l.reviews_looked} looked at, ${l.reviews - l.reviews_looked} skipped` : ''],
  ]), 'No lesson games yet.', 9);
  tableRows($('t-stuck'), p.stuck.map((s) => [
    [s.player], [lessonName(s.lesson), '', s.lesson], [num.format(s.games), 'n'], [`${s.right_pct}%`, 'n', `Last ${p.stuckGames} games`],
    [`${num.format(s.mastered)} / ${num.format(s.subjects)}`, 'n'], [s.version], [when(s.last_at)],
  ]), 'Nobody stuck.', 7);
}

// ---- Onboarding ------------------------------------------------------

// What admin_onboarding gives (supabase/migrations/20261112120000_onboarding_events.sql):
// the welcome tour's funnel, first launches on phones only.

$('reload-onboarding').addEventListener('click', () => reload(loadOnboarding));

let onboardingDays = (() => { try { return Number(localStorage.getItem('faro-onboarding-days')) || 30; } catch { return 30; } })();
for (const chip of document.querySelectorAll('#onboarding-days .chip')) {
  chip.setAttribute('aria-pressed', String(Number(chip.dataset.days) === onboardingDays));
  chip.addEventListener('click', () => {
    onboardingDays = Number(chip.dataset.days);
    try { localStorage.setItem('faro-onboarding-days', String(onboardingDays)); } catch { /* kept for this visit only */ }
    for (const c of document.querySelectorAll('#onboarding-days .chip')) c.setAttribute('aria-pressed', String(c === chip));
    reload(loadOnboarding);
  });
}

let onboardingFrom = 'first';
for (const chip of document.querySelectorAll('#onboarding-from .chip')) {
  chip.addEventListener('click', () => {
    onboardingFrom = chip.dataset.from;
    for (const c of document.querySelectorAll('#onboarding-from .chip')) c.setAttribute('aria-pressed', String(c === chip));
    reload(loadOnboarding);
  });
}

async function loadOnboarding() {
  $('onboarding-when').textContent = 'Loading…';
  const o = await call('admin_onboarding', { p_days: onboardingDays, p_from: onboardingFrom });
  drawOnboarding(o);
  $('onboarding-when').textContent = `Last ${o.days} days · ${new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}`;
}

// The tour's questions and answers, as the app sends them.
const ONBOARDING_ANSWERS = {
  guess: ['Where is this street?', { paris: 'Paris (right)', newyork: 'New York', tokyo: 'Tokyo' }],
  stripe: ['Tap what gives the road away', { found: 'Tapped the lines', shown: 'Shown after 2 misses' }],
  sign: ['Which country is the sign in?', { RS: 'Serbia (right)', BR: 'Brazil', JP: 'Japan' }],
  level: ['How much have you played?', { never: 'Never', little: 'A little', lots: 'A lot' }],
  skip: ['Skip, on page', { 1: 'Page 1', 2: 'Page 2', 3: 'Page 3' }],
};

function drawOnboarding(o) {
  const f = o.funnel, a = o.after;
  const box = $('k-onboarding');
  box.replaceChildren();
  for (const [label, value, sub] of [
    o.from === 'settings'
      ? ['Tours from Settings', num.format(f.started), `and ${num.format(o.firstRuns)} first launches`]
      : ['First launches', num.format(f.started), `and ${num.format(o.settingsRuns)} tours from Settings`],
    ['Finished the tour', share(f.level + f.straight, f.started), `${num.format(f.skipped)} skipped, ${num.format(f.brought)} brought progress`],
    ['Played the practice', share(f.practice_done, f.started), o.practiceRightAvg == null ? 'none finished yet' : `${o.practiceRightAvg} of 5 right on average`],
    ['Came back another day', share(a.came_back, a.players), `${num.format(a.played_lesson)} of ${num.format(a.players)} played a lesson`],
  ]) {
    const k = document.createElement('div');
    k.className = 'kpi';
    for (const [cls, t] of [['label', label], ['value', value], ['sub', sub]]) {
      const s = document.createElement('span'); s.className = cls; s.textContent = t; k.appendChild(s);
    }
    box.appendChild(k);
  }
  const steps = [
    ['Started', f.started], ['Answered Paris', f.guess], ['Page 2', f.page2], ['Got past the stripe', f.stripe],
    ['Page 3', f.page3], ['Answered the sign', f.sign], ['Page 4', f.page4], ['Chose a level', f.level],
    ['Practice started', f.practice], ['Practice finished', f.practice_done], ['Placement started', f.placement],
    ['Placement finished', f.placement_done], ['Tips on home seen', f.tips_done],
  ];
  if (!f.started) empty($('c-tour-funnel'), 'No tours yet.');
  else bars($('c-tour-funnel'), steps, (s) => s[0], (s) => s[1], () => 'var(--gold)', (s) => `${num.format(s[1])} · ${share(s[1], f.started)}`);
  const rows = o.answers.slice().sort((x, y) => Object.keys(ONBOARDING_ANSWERS).indexOf(x.step) - Object.keys(ONBOARDING_ANSWERS).indexOf(y.step));
  tableRows($('t-onboarding-answers'), rows.map((r) => {
    const [question, names] = ONBOARDING_ANSWERS[r.step] ?? [r.step, {}];
    return [[question], [names[r.value] ?? r.value], [num.format(r.runs), 'n']];
  }), 'No answers yet.', 3);
  columns($('c-onboarding-daily'), o.daily, (d) => shortDay(d.day), [{ key: 'runs', color: () => 'var(--gold)' }]);
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

  // The accounts (GeoTells only, so the app chips leave them as they are).
  const acc = s.accounts ?? { total: 0, daily: [], active_30: 0, active_30_with_account: 0, gifts: [] };
  listRows($('l-accounts'), [
    ['Accounts so far', acc.total],
    ['… new in the last 7 days', total(acc.daily.filter((a) => a.day > day(today, -7)), 'new')],
    ['Active installs, last 30 days', acc.active_30],
    ['… with an account', `${num.format(acc.active_30_with_account)} (${share(acc.active_30_with_account, acc.active_30)})`],
  ], '');
  const accDays = new Map(acc.daily.map((a) => [a.day, a.new]));
  columns($('c-accounts'), Array.from({ length: 30 }, (_, i) => {
    const d = day(today, i - 29);
    return { day: d, n: accDays.get(d) ?? 0 };
  }), (d) => shortDay(d.day), [{ key: 'n', color: () => 'var(--gold)' }], { dim: (d) => d.day === today });
  const where = { ask: 'Asked after a level or streak', result: 'Under a lesson result', home: 'Home card', settings: 'Settings', welcome: 'Welcome tour', photo: 'Photo at the top of home' };
  listRows($('l-gifts'), acc.gifts.map((g) => [where[g.from] ?? 'Before it was counted', g.n]), 'No gifts yet.');

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
  const ofApp = (d) => isGeoTells(d.version);
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

// ---- API -------------------------------------------------------------

// What admin_api_usage gives (supabase/migrations/20261115190000_api_usage.sql):
// the scene budget, the scenes given per day, and Google's requests per day
// and service (copied every 3 hours by .github/workflows/api_usage.yml).

// Set in the Google Cloud project (quotas and Monitoring alerts), not on the
// server: kept here by hand when they change there.
const GOOGLE = {
  android: { service: 'maps-android-backend.googleapis.com', name: 'Street View (app)', cap: 400, alert: 250, free: 5000 },
  web: { service: 'maps-backend.googleapis.com', name: 'Maps JS (Faro)', cap: 160, alert: 120 },
};
const SERVICE_NAMES = {
  'maps-android-backend.googleapis.com': 'Maps SDK for Android',
  'maps-backend.googleapis.com': 'Maps JavaScript API',
  'fcm.googleapis.com': 'Cloud Messaging (pushes)',
  'firebaseinstallations.googleapis.com': 'Firebase installations',
  'identitytoolkit.googleapis.com': 'Sign-in (Identity Toolkit)',
  'mapsbilling-pa.googleapis.com': 'Maps billing (with Maps JS)',
};

$('reload-api').addEventListener('click', () => reload(loadApi));

let apiDays = (() => { try { return Number(localStorage.getItem('faro-api-days')) || 30; } catch { return 30; } })();
for (const chip of document.querySelectorAll('#api-days .chip')) {
  chip.setAttribute('aria-pressed', String(Number(chip.dataset.days) === apiDays));
  chip.addEventListener('click', () => {
    apiDays = Number(chip.dataset.days);
    try { localStorage.setItem('faro-api-days', String(apiDays)); } catch { /* kept for this visit only */ }
    for (const c of document.querySelectorAll('#api-days .chip')) c.setAttribute('aria-pressed', String(c === chip));
    reload(loadApi);
  });
}

let lastApi = null;
let apiResize;
window.addEventListener('resize', () => {
  clearTimeout(apiResize);
  apiResize = setTimeout(() => { if (lastApi && !$('t-api').hidden) drawApi(lastApi); }, 150);
});

async function loadApi() {
  $('api-when').textContent = 'Loading…';
  const a = lastApi = await call('admin_api_usage', { p_days: apiDays });
  drawApi(a);
  // Again once the tab is laid out, so the charts know their width (not
  // before the page is in sight).
  requestAnimationFrame(() => { if (lastApi === a) drawApi(a); });
  const google = a.google_updated ? `Google's counts ${when(a.google_updated)}` : 'No counts from Google yet';
  $('api-when').textContent = `Last ${a.days} days · ${google}`;
}

function drawApi(a) {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 8);
  const google = (service) => a.google.filter((g) => g.service === service);
  const on = (rows, day) => rows.find((r) => r.day === day)?.requests ?? 0;
  const inMonth = (rows) => rows.filter((r) => r.day.startsWith(month)).reduce((n, r) => n + r.requests, 0);
  const android = google(GOOGLE.android.service), web = google(GOOGLE.web.service);
  const b = a.budget, s = a.share;
  const box = $('k-api');
  box.replaceChildren();
  for (const [label, value, sub, warn] of [
    ['Scenes this month', `${num.format(s.month_used)} / ${num.format(b.monthly_limit)}`, `${num.format(s.month_left)} left, ${s.days_left} days to go`, s.month_left === 0],
    ['Per player today', b.enabled ? num.format(s.allowance) : 'Off', b.enabled ? `about ${num.format(s.active)} players a day · ${b.min_daily} to ${b.max_daily}` : 'scenes turned off', !b.enabled],
    [`${GOOGLE.android.name} today`, `${num.format(on(android, today))} / ${GOOGLE.android.cap}`, `${num.format(inMonth(android))} this month, ${num.format(GOOGLE.android.free)} free`, on(android, today) >= GOOGLE.android.alert],
    [`${GOOGLE.web.name} today`, `${num.format(on(web, today))} / ${GOOGLE.web.cap}`, `${num.format(inMonth(web))} this month`, on(web, today) >= GOOGLE.web.alert],
  ]) {
    const k = document.createElement('div');
    k.className = warn ? 'kpi warn' : 'kpi';
    for (const [cls, t] of [['label', label], ['value', value], ['sub', sub]]) {
      const span = document.createElement('span'); span.className = cls; span.textContent = t; k.appendChild(span);
    }
    box.appendChild(k);
  }
  // Every day of the period, those Google has no count for at 0.
  const days = a.scenes.map((r) => r.day);
  const androidDays = days.map((day) => ({ day, requests: on(android, day) }));
  const overAlert = (r) => (r.requests >= GOOGLE.android.alert ? 'var(--bad)' : 'var(--blue)');
  if (!android.length) empty($('c-api-android'), 'No counts from Google yet.');
  else columns($('c-api-android'), androidDays, (r) => shortDay(r.day), [{ key: 'requests', color: overAlert }], { dim: (r) => r.day === today });
  $('api-android-note').textContent = `Requests Google counted for the Android key (each scene opened, and a few calls around it). Red: ${GOOGLE.android.alert} or more, when Google sends the alert; it stops at ${GOOGLE.android.cap}.`;
  if (!a.scenes.some((r) => r.given)) empty($('c-api-scenes'), 'No scenes given yet.');
  else columns($('c-api-scenes'), a.scenes, (r) => shortDay(r.day), [{ key: 'given', color: () => 'var(--gold)' }], { dim: (r) => r.day === today });
  const byService = {};
  for (const g of a.google) if (g.day.startsWith(month)) byService[g.service] = (byService[g.service] ?? 0) + g.requests;
  listRows($('l-api-month'), Object.entries(byService).sort((x, y) => y[1] - x[1]).map(([svc, n]) => [SERVICE_NAMES[svc] ?? svc.replace('.googleapis.com', ''), n]), 'No counts from Google yet.');
  listRows($('l-api-caps'), [
    [`${GOOGLE.android.name}: daily cap`, GOOGLE.android.cap],
    [`${GOOGLE.android.name}: email alert in 24 h`, GOOGLE.android.alert],
    [`${GOOGLE.web.name}: daily cap`, GOOGLE.web.cap],
    [`${GOOGLE.web.name}: email alert in 24 h`, GOOGLE.web.alert],
    ['Maps JS 3D and grounding', 'Off'],
  ], '');
  drawUnlimited(a.unlimited ?? []);
  $('sb-enabled').checked = b.enabled;
  $('sb-monthly').value = b.monthly_limit;
  $('sb-min').value = b.min_daily;
  $('sb-max').value = b.max_daily;
}

// Each with its scenes today and this month, and Remove.
function drawUnlimited(rows) {
  const box = $('l-unlimited');
  box.replaceChildren();
  if (!rows.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Nobody yet.'; return box.appendChild(li); }
  for (const r of rows) {
    const li = document.createElement('li');
    const span = document.createElement('span'); span.textContent = r.email;
    const b = document.createElement('b'); b.textContent = `${num.format(r.today)} today · ${num.format(r.month)} this month `;
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      if (!confirm(`${r.email} goes back to the daily allowance. Remove?`)) return;
      remove.disabled = true;
      try {
        await call('admin_remove_scene_unlimited', { p_email: r.email });
        await loadApi();
      } catch (e) {
        say($('unlimited-error'), e.message);
        remove.disabled = false;
      }
    });
    b.appendChild(remove);
    li.append(span, b); box.appendChild(li);
  }
}

$('f-unlimited').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  say($('unlimited-error'));
  const button = ev.submitter;
  button.disabled = true;
  try {
    await call('admin_add_scene_unlimited', { p_email: $('unlimited-email').value.trim() });
    $('unlimited-email').value = '';
    await loadApi();
  } catch (e) {
    say($('unlimited-error'), e.message);
  } finally {
    button.disabled = false;
  }
});

$('f-scene-budget').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  say($('sb-error'));
  const enabled = $('sb-enabled').checked;
  const monthly = Number($('sb-monthly').value), min = Number($('sb-min').value), max = Number($('sb-max').value);
  if (max < min) return say($('sb-error'), 'The maximum cannot be under the minimum.');
  if (!enabled && !confirm('No player will see Street View scenes until they are turned on again. Save?')) return;
  const button = ev.submitter;
  button.disabled = true;
  try {
    await call('admin_set_scene_budget', { p_enabled: enabled, p_monthly: monthly, p_min: min, p_max: max });
    await loadApi();
  } catch (e) {
    say($('sb-error'), e.message);
  } finally {
    button.disabled = false;
  }
});

// ---- Versions --------------------------------------------------------

// GeoTells's rule: players are told to update from geotells.com.
const versionApp = 'geotells';

async function loadVersions() {
  const v = await call('admin_versions', { p_app: versionApp });
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
  if (minimum && !confirm(`GeoTells versions below ${minimum} will be blocked until they update from its website. Save?`)) return;
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
  $('alert-state').textContent = !me.alert_phone ? 'Alerts are off.'
    : me.alert_push ? 'Alerts are on: they go to the phone you chose.'
    : 'Alerts are lost: the phone you chose has no notifications (signed out, reinstalled or notifications off). Choose your phone again.';
  $('alert-test').disabled = !me.alert_phone;
  $('alert-off').disabled = !me.alert_phone;
}

$('f-alert').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  say($('alert-error'));
  try {
    const r = await call('admin_set_alert_phone', { p_code: $('transfer').value });
    if (!r.found) return say($('alert-error'), $('transfer').value.includes('@')
      ? 'No Google account with that email has signed in to the app.'
      : 'No install has that transfer code. Check it in the app, under Settings.');
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
