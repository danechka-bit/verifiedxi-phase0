require('dotenv').config();
const http = require('http');
const url = require('url');
const fs = require('fs');
const crypto = require('crypto');
const querystring = require('querystring');
const { formidable } = require('formidable');
const db = require('./db');
const identity = require('./identity');
const mailer = require('./mailer');
const media = require('./media');
const { layout, escapeHtml, statusBadge, initials } = require('./views');
const { t, resolveLang } = require('./i18n');
const validate = require('./validate');

const SESSION_COOKIE = 'vxi_session';
const LANG_COOKIE = 'vxi_lang';
const COOKIE_SECURE = /^https:/.test(process.env.APP_BASE_URL || '');

// Current UI language for this request: the vxi_lang cookie (set by the
// /lang/:code switcher), defaulting to English for a first-time visitor.
function getLang(req) {
  return resolveLang(parseCookies(req)[LANG_COOKIE]);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i === -1) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(res, sessionId) {
  const attrs = [`${SESSION_COOKIE}=${sessionId}`, 'HttpOnly', 'Path=/', 'Max-Age=2592000', 'SameSite=Lax'];
  if (COOKIE_SECURE) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

// The logged-in player/scout for this request, or null. Does not throw —
// callers decide whether the route requires a session.
async function getCurrentSession(req) {
  const sessionId = parseCookies(req)[SESSION_COOKIE];
  if (!sessionId) return null;
  return db.getSession(sessionId);
}

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'staff';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Constant-time compare so a mistyped password can't be brute-forced faster
// via response-time differences (crypto.timingSafeEqual needs equal-length
// buffers, so pad first — the length check above still leaks length, which
// is fine for a password with no fixed expected length).
function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// No ADMIN_PASSWORD set means local dev without it configured yet — let it
// through so `npm start` still works out of the box, but this must be set
// before deploying anywhere real (see README).
function checkAdminAuth(req) {
  if (!ADMIN_PASSWORD) return true;
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
  return safeEqual(user || '', ADMIN_USERNAME) && safeEqual(pass || '', ADMIN_PASSWORD);
}

function requireAdminAuth(req, res) {
  if (checkAdminAuth(req)) return true;
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="VerifiedXI Admin"', 'Content-Type': 'text/plain' });
  res.end('Authentication required.');
  return false;
}

const PLAYER_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg>';
const SCOUT_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
const STAFF_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>';

const PORT = process.env.PORT || 3000;

// Renders one highlight video as an embed (YouTube/Vimeo iframe, or a
// native <video> for an uploaded file); a plain outbound link for anything
// else (a pasted URL we didn't recognize as YouTube/Vimeo).
const POSITION_GROUPS = [
  ['position_group.gk', ['GK']],
  ['position_group.def', ['LB', 'CB', 'RB']],
  ['position_group.mid', ['CDM', 'CM', 'LM', 'RM', 'CAM']],
  ['position_group.att', ['ST', 'RW', 'LW']]
];

// The same grouped position <option>s used on player signup and the scout
// search filter, so the two never drift out of sync. `selected` (if given)
// marks one option as pre-selected — used by the search filter to persist
// the current filter across a page reload.
function positionOptionsHtml(lang, selected) {
  return POSITION_GROUPS.map(([groupKey, codes]) => `
    <optgroup label="${t(lang, groupKey)}">
      ${codes.map(code => `<option${code === selected ? ' selected' : ''}>${code}</option>`).join('')}
    </optgroup>
  `).join('');
}

// Aggregate stats across a player's *verified* seasons only — a submitted-
// but-not-yet-checked season doesn't count toward the trusted total, same
// logic as why it doesn't appear in scout search either.
function careerTotals(seasons) {
  const verified = seasons.filter(s => s.verification_status === 'verified');
  return verified.reduce((t, s) => ({
    apps: t.apps + s.apps, goals: t.goals + s.goals,
    assists: t.assists + s.assists, minutes: t.minutes + s.minutes,
    seasonsCount: t.seasonsCount + 1
  }), { apps: 0, goals: 0, assists: 0, minutes: 0, seasonsCount: 0 });
}

// A Transfermarkt-style "career totals" bar — reuses the homepage ticker's
// look (bold numbers on a pitch-green bar), skipped entirely if nothing is
// verified yet rather than showing a bar of zeroes.
function careerTotalsHtml(seasons, lang) {
  const totals = careerTotals(seasons);
  if (totals.seasonsCount === 0) return '';
  return `
    <div class="eyebrow">${t(lang, 'player_status.career_totals', { n: totals.seasonsCount })}</div>
    <div class="ticker">
      <div class="tstat"><div class="tnum">${totals.apps}</div><div class="tlbl">${t(lang, 'stat.apps')}</div></div>
      <div class="tdiv"></div>
      <div class="tstat"><div class="tnum">${totals.goals}</div><div class="tlbl">${t(lang, 'stat.goals')}</div></div>
      <div class="tdiv"></div>
      <div class="tstat"><div class="tnum">${totals.assists}</div><div class="tlbl">${t(lang, 'stat.assists')}</div></div>
      <div class="tdiv"></div>
      <div class="tstat"><div class="tnum">${totals.minutes}</div><div class="tlbl">${t(lang, 'stat.mins')}</div></div>
    </div>
  `;
}

// Season links are stored without a protocol (e.g. "lff.lv/spelotajs/...",
// matching the placeholder), which would resolve as a broken relative link
// in an <a href>. Add https:// only when nothing's there already.
function withProtocol(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// The season-by-season record as a compact table (Transfermarkt-style)
// instead of one big card per season — much more scannable once a player
// has more than one or two seasons on file. Season label links to the
// lff.lv source so the underlying record is always one click away.
function seasonsTableHtml(seasons, lang) {
  if (seasons.length === 0) return '';
  return `
    <div class="table-scroll">
      <table class="stats-table">
        <thead><tr>
          <th>${t(lang, 'stat.season_col')}</th>
          <th>${t(lang, 'stat.club_col')}</th>
          <th>${t(lang, 'stat.apps')}</th>
          <th>${t(lang, 'stat.goals')}</th>
          <th>${t(lang, 'stat.assists')}</th>
          <th>${t(lang, 'stat.mins')}</th>
          <th>${t(lang, 'stat.status_col')}</th>
        </tr></thead>
        <tbody>
          ${seasons.map(s => `
            <tr>
              <td><a href="${escapeHtml(withProtocol(s.source_url))}" target="_blank" rel="noopener">${escapeHtml(s.season_label)}</a></td>
              <td>${escapeHtml(s.club)}</td>
              <td>${s.apps}</td>
              <td>${s.goals}</td>
              <td>${s.assists}</td>
              <td>${s.minutes}</td>
              <td>${statusBadge(s.verification_status, lang)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function videoEmbedHtml(v, lang) {
  if (v.source === 'youtube' || v.source === 'vimeo') {
    return `<div class="video-embed"><iframe src="${escapeHtml(v.url)}" frameborder="0" allowfullscreen></iframe></div>`;
  }
  if (v.source === 'upload') {
    return `<div class="video-embed"><video controls src="${escapeHtml(v.url)}"></video></div>`;
  }
  return `<p class="hint"><a href="${escapeHtml(v.url)}" target="_blank" rel="noopener">${t(lang, 'highlights.watch_link')}</a></p>`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(querystring.parse(data)));
  });
}

function send(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function redirect(res, path) {
  res.writeHead(302, { Location: path });
  res.end();
}

// A request failed server-side validation (bad/missing data). Renders a
// small explanatory page with a link back rather than silently coercing bad
// input (e.g. a negative goal count) into something wrong-but-storable.
function sendValidationError(res, lang, message, backUrl, session) {
  send(res, 400, layout(t(lang, 'error.validation_title'), `
    <div class="eyebrow">${t(lang, 'error.validation_title')}</div>
    <h1>${t(lang, 'error.validation_title')}</h1>
    <p class="sub">${message}</p>
    <a class="btn secondary" href="${backUrl}">${t(lang, 'error.go_back')}</a>
  `, session, lang));
}

// ---------------- Pages ----------------

async function homePage(lang) {
  const s = await db.stats();
  return layout('Home', `
    <div class="eyebrow">${t(lang, 'home.eyebrow')}</div>
    <h1>${t(lang, 'home.title')}</h1>
    <p class="sub">${t(lang, 'home.sub')}</p>

    <div class="ticker">
      <div class="tstat"><div class="tnum">${s.verified_players}</div><div class="tlbl">${t(lang, 'home.ticker_verified_players')}</div></div>
      <div class="tdiv"></div>
      <div class="tstat"><div class="tnum">${s.verified_scouts}</div><div class="tlbl">${t(lang, 'home.ticker_scouts_active')}</div></div>
      <div class="tdiv"></div>
      <div class="tstat"><div class="tnum">${s.pending_reviews}</div><div class="tlbl">${t(lang, 'home.ticker_in_review')}</div></div>
    </div>

    <a class="tap-card" href="/player/new">
      <div class="icon">${PLAYER_ICON}</div>
      <div>
        <div class="title">${t(lang, 'home.player_title')}</div>
        <div class="desc">${t(lang, 'home.player_desc')}</div>
      </div>
      <div class="chev">›</div>
    </a>
    <a class="tap-card" href="/scout/new">
      <div class="icon">${SCOUT_ICON}</div>
      <div>
        <div class="title">${t(lang, 'home.scout_title')}</div>
        <div class="desc">${t(lang, 'home.scout_desc')}</div>
      </div>
      <div class="chev">›</div>
    </a>
    <a class="tap-card" href="/admin">
      <div class="icon">${STAFF_ICON}</div>
      <div>
        <div class="title">${t(lang, 'home.staff_title')}</div>
        <div class="desc">${t(lang, 'home.staff_desc')}</div>
      </div>
      <div class="chev">›</div>
    </a>
  `, null, lang);
}

function playerNewPage(lang) {
  return layout(t(lang, 'player_new.title_tag'), `
    <div class="eyebrow">${t(lang, 'player_new.eyebrow')}</div>
    <h1>${t(lang, 'player_new.title')}</h1>
    <p class="sub">${t(lang, 'player_new.sub')}</p>
    <form method="POST" action="/player/new">
      <label>${t(lang, 'player_new.email_label')}</label><input type="email" name="email" required placeholder="you@example.com">
      <p class="hint">${t(lang, 'player_new.email_hint')}</p>
      <label>${t(lang, 'player_new.full_name_label')}</label><input name="full_name" required placeholder="${t(lang, 'player_new.full_name_placeholder')}">
      <label>${t(lang, 'player_new.position_label')}</label>
      <select name="position" required>
        <option value="" disabled selected>${t(lang, 'player_new.position_placeholder')}</option>
        ${positionOptionsHtml(lang)}
      </select>
      <label>${t(lang, 'player_new.federation_label')}</label>
      <select name="federation" required>
        ${Object.keys(validate.FEDERATIONS).map(code => `<option value="${code}">${t(lang, `federation.${code}`)}</option>`).join('')}
      </select>
      <label>${t(lang, 'player_new.club_label')}</label><input name="club" required placeholder="${t(lang, 'player_new.club_placeholder')}">
      <label>${t(lang, 'player_new.birth_year_label')}</label><input name="birth_year" required placeholder="${t(lang, 'player_new.birth_year_placeholder')}">
      <div class="section-title">${t(lang, 'player_new.guardian_section')}</div>
      <label>${t(lang, 'player_new.guardian_name_label')}</label><input name="guardian_name" placeholder="${t(lang, 'player_new.guardian_name_placeholder')}">
      <label>${t(lang, 'player_new.guardian_email_label')}</label><input name="guardian_email" placeholder="${t(lang, 'player_new.guardian_email_placeholder')}">
      <p class="hint">${identity.isConfigured()
        ? t(lang, 'player_new.stripe_hint_configured')
        : t(lang, 'player_new.stripe_hint_unconfigured')}</p>
      <button type="submit">${t(lang, 'player_new.submit')}</button>
    </form>
  `, null, lang);
}

function playerStatusPage(player, guardian, seasons, videos, session, lang) {
  const canAddSeason = player.profile_status === 'active';
  return layout(t(lang, 'player_status.title_tag'), `
    <div class="eyebrow">${t(lang, 'player_status.eyebrow')}</div>
    <div class="profile-head">
      ${player.photo_url
        ? `<img class="avatar-photo" src="${escapeHtml(player.photo_url)}" alt="">`
        : `<div class="avatar">${escapeHtml(initials(player.full_name))}</div>`}
      <div>
        <div class="name">${escapeHtml(player.full_name.toUpperCase())} ${statusBadge(player.profile_status, lang)}</div>
        <div class="meta">${escapeHtml(player.position)} · ${escapeHtml(player.club)} · ${t(lang, 'player_status.born', { year: player.birth_year })}</div>
      </div>
    </div>

    ${player.bio ? `<p class="sub">${escapeHtml(player.bio)}</p>` : ''}

    ${guardian ? `
      <div class="card">
        <div class="row"><b>${t(lang, 'player_status.guardian_prefix', { name: escapeHtml(guardian.name) })}</b> ${statusBadge(guardian.id_verification_status, lang)}</div>
        ${guardian.id_verification_status === 'approved' ? '' : identity.isConfigured() ? `
          <p class="hint">${t(lang, 'player_status.guardian_frozen_configured')}</p>
          <a class="btn" href="/guardian/${guardian.id}/verify">${t(lang, 'player_status.start_verification')}</a>
        ` : `<p class="hint">${t(lang, 'player_status.guardian_frozen_unconfigured')}</p>`}
      </div>
    ` : ''}

    ${careerTotalsHtml(seasons, lang)}
    ${seasonsTableHtml(seasons, lang)}

    ${canAddSeason ? (() => {
      const domain = validate.FEDERATIONS[player.federation].domain;
      return `
      <div class="section-title">${t(lang, 'add_season.title')}</div>
      <form method="POST" action="/player/${player.id}/season">
        <label>${t(lang, 'add_season.link_label', { domain })}</label><input name="source_url" required placeholder="${t(lang, 'add_season.link_placeholder', { domain })}">
        <label>${t(lang, 'add_season.club_label')}</label><input name="club" required value="${escapeHtml(player.club)}">
        <label>${t(lang, 'add_season.season_label_label')}</label><input name="season_label" required placeholder="${t(lang, 'add_season.season_label_placeholder')}">
        <div class="stat-grid" style="margin-top:14px;">
          <div><label>${t(lang, 'stat.apps')}</label><input name="apps" placeholder="0"></div>
          <div><label>${t(lang, 'stat.goals')}</label><input name="goals" placeholder="0"></div>
          <div><label>${t(lang, 'stat.assists')}</label><input name="assists" placeholder="0"></div>
          <div><label>${t(lang, 'stat.mins')}</label><input name="minutes" placeholder="0"></div>
        </div>
        <p class="hint">${t(lang, 'add_season.hint', { domain })}</p>
        <button type="submit">${t(lang, 'add_season.submit')}</button>
      </form>
    `; })() : `<p class="hint">${t(lang, 'add_season.locked_hint')}</p>`}

    <div class="section-title">${t(lang, 'highlights.title')}</div>
    ${videos.length === 0 ? `<p class="hint">${t(lang, 'highlights.none')}</p>` : videos.map(v => `
      <div class="card">
        ${v.title ? `<b>${escapeHtml(v.title)}</b>` : ''}
        ${videoEmbedHtml(v, lang)}
      </div>
    `).join('')}
    <form method="POST" action="/player/${player.id}/video" enctype="multipart/form-data">
      <label>${t(lang, 'highlights.link_label')}</label><input type="url" name="video_url" placeholder="https://youtube.com/watch?v=...">
      <label>${t(lang, 'highlights.upload_label')}</label><input type="file" name="video_file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v">
      <label>${t(lang, 'highlights.video_title_label')}</label><input name="title" placeholder="${t(lang, 'highlights.video_title_placeholder')}">
      <p class="hint">${t(lang, 'highlights.hint')}</p>
      <button type="submit">${t(lang, 'highlights.submit')}</button>
    </form>

    <div class="section-title">${t(lang, 'edit_profile.title')}</div>
    <form method="POST" action="/player/${player.id}/profile">
      <label>${t(lang, 'edit_profile.bio_label')}</label>
      <textarea name="bio" rows="4" placeholder="${t(lang, 'edit_profile.bio_placeholder_player')}">${escapeHtml(player.bio || '')}</textarea>
      <label>${t(lang, 'edit_profile.photo_url_label')}</label><input type="url" name="photo_url" value="${escapeHtml(player.photo_url || '')}" placeholder="${t(lang, 'edit_profile.photo_url_placeholder')}">
      <button type="submit" class="secondary">${t(lang, 'edit_profile.submit')}</button>
    </form>
  `, session, lang);
}

function scoutNewPage(lang) {
  return layout(t(lang, 'scout_new.title_tag'), `
    <div class="eyebrow">${t(lang, 'scout_new.eyebrow')}</div>
    <h1>${t(lang, 'scout_new.title')}</h1>
    <p class="sub">${t(lang, 'scout_new.sub')}</p>
    <form method="POST" action="/scout/new">
      <label>${t(lang, 'scout_new.email_label')}</label><input type="email" name="email" required placeholder="you@example.com">
      <p class="hint">${t(lang, 'scout_new.email_hint')}</p>
      <label>${t(lang, 'scout_new.name_label')}</label><input name="name" required placeholder="${t(lang, 'scout_new.name_placeholder')}">
      <label>${t(lang, 'scout_new.org_label')}</label><input name="organization" required placeholder="${t(lang, 'scout_new.org_placeholder')}">
      <label>${t(lang, 'scout_new.role_label')}</label>
      <select name="role" required>
        <option value="" disabled selected>${t(lang, 'scout_new.role_placeholder')}</option>
        <option value="Scout">${t(lang, 'role.scout')}</option>
        <option value="Academy director">${t(lang, 'role.academy_director')}</option>
        <option value="Agent">${t(lang, 'role.agent')}</option>
      </select>
      <label>${t(lang, 'scout_new.profile_link_label')}</label><input name="public_profile_url" placeholder="${t(lang, 'scout_new.profile_link_placeholder')}">
      <button type="submit">${t(lang, 'scout_new.submit')}</button>
    </form>
  `, null, lang);
}

function scoutStatusPage(scout, session, lang) {
  return layout(t(lang, 'scout_status.title_tag'), `
    <div class="eyebrow">${t(lang, 'scout_status.eyebrow')}</div>
    <div class="profile-head">
      ${scout.photo_url
        ? `<img class="avatar-photo" src="${escapeHtml(scout.photo_url)}" alt="">`
        : `<div class="avatar">${escapeHtml(initials(scout.name))}</div>`}
      <div>
        <div class="name">${escapeHtml(scout.name.toUpperCase())} ${statusBadge(scout.verification_status, lang)}</div>
        <div class="meta">${escapeHtml(scout.organization)} · ${escapeHtml(scout.role)}</div>
      </div>
    </div>
    ${scout.bio ? `<p class="sub">${escapeHtml(scout.bio)}</p>` : ''}
    ${scout.looking_for ? `<div class="card"><b>${t(lang, 'scout_status.looking_for_title')}</b><p class="hint">${escapeHtml(scout.looking_for)}</p></div>` : ''}
    ${scout.verification_status === 'verified'
      ? `<a class="btn" href="/scouts">${t(lang, 'scout_status.search_btn')}</a>`
      : `<p class="hint">${t(lang, 'scout_status.waiting_review')}</p>`}

    <div class="section-title">${t(lang, 'edit_profile.title')}</div>
    <form method="POST" action="/scout/${scout.id}/profile">
      <label>${t(lang, 'edit_profile.bio_label')}</label>
      <textarea name="bio" rows="4" placeholder="${t(lang, 'edit_profile.bio_placeholder_scout')}">${escapeHtml(scout.bio || '')}</textarea>
      <label>${t(lang, 'edit_profile.photo_url_label')}</label><input type="url" name="photo_url" value="${escapeHtml(scout.photo_url || '')}" placeholder="${t(lang, 'edit_profile.photo_url_placeholder')}">
      <label>${t(lang, 'edit_profile.looking_for_label')}</label>
      <textarea name="looking_for" rows="3" placeholder="${t(lang, 'edit_profile.looking_for_placeholder')}">${escapeHtml(scout.looking_for || '')}</textarea>
      <button type="submit" class="secondary">${t(lang, 'edit_profile.submit')}</button>
    </form>
  `, session, lang);
}

function loginPage(error, lang) {
  return layout(t(lang, 'login.title_tag'), `
    <div class="eyebrow">${t(lang, 'login.eyebrow')}</div>
    <h1>${t(lang, 'login.title')}</h1>
    <p class="sub">${t(lang, 'login.sub')}</p>
    ${error ? `<p class="hint" style="color:#A5352A;">${escapeHtml(error)}</p>` : ''}
    <form method="POST" action="/login">
      <label>${t(lang, 'login.email_label')}</label><input type="email" name="email" required placeholder="you@example.com">
      <button type="submit">${t(lang, 'login.submit')}</button>
    </form>
  `, null, lang);
}

function loginSentPage(email, devLink, lang) {
  return layout(t(lang, 'login_sent.title_tag'), `
    <div class="eyebrow">${t(lang, 'login_sent.eyebrow')}</div>
    <h1>${t(lang, 'login_sent.title')}</h1>
    <p class="sub">${t(lang, 'login_sent.sub', { email: escapeHtml(email) })}</p>
    ${devLink ? `
      <div class="card">
        <b>${t(lang, 'login_sent.dev_notice')}</b>
        <p class="hint">${t(lang, 'login_sent.dev_hint')}</p>
        <a class="btn" href="${devLink}">${t(lang, 'login_sent.dev_link', { email: escapeHtml(email) })}</a>
      </div>
    ` : ''}
  `, null, lang);
}

function searchPage(scout, players, session, lang, filters, totalUnfiltered) {
  if (!scout || scout.verification_status !== 'verified') {
    return layout(t(lang, 'search.title_tag'), `
      <div class="eyebrow">${t(lang, 'search.eyebrow')}</div>
      <h1>${t(lang, 'search.title')}</h1>
      <p class="sub">${t(lang, session ? 'search.need_verified_in' : 'search.need_verified_out')}</p>
    `, session, lang);
  }
  filters = filters || {};
  const hasFilters = filters.position || filters.club || filters.birth_year_min || filters.birth_year_max || filters.min_goals;
  return layout(t(lang, 'search.results_title_tag'), `
    <div class="eyebrow">${t(lang, 'search.results_eyebrow', { org: escapeHtml(scout.organization) })}</div>
    <h1>${t(lang, 'search.results_title')}</h1>
    <p class="sub">${t(lang, 'search.signed_in_as', { name: escapeHtml(scout.name) })}</p>

    <form method="GET" action="/scouts" class="card">
      <label>${t(lang, 'search.filter_position')}</label>
      <select name="position">
        <option value="">${t(lang, 'search.filter_any_position')}</option>
        ${positionOptionsHtml(lang, filters.position)}
      </select>
      <label>${t(lang, 'search.filter_club')}</label>
      <input name="club" value="${escapeHtml(filters.club || '')}" placeholder="${t(lang, 'search.filter_club_placeholder')}">
      <div class="stat-grid" style="grid-template-columns:1fr 1fr 1fr;margin-top:14px;">
        <div><label>${t(lang, 'search.filter_birth_from')}</label><input name="birth_year_min" value="${escapeHtml(filters.birth_year_min || '')}"></div>
        <div><label>${t(lang, 'search.filter_birth_to')}</label><input name="birth_year_max" value="${escapeHtml(filters.birth_year_max || '')}"></div>
        <div><label>${t(lang, 'search.filter_min_goals')}</label><input name="min_goals" value="${escapeHtml(filters.min_goals || '')}"></div>
      </div>
      <button type="submit">${t(lang, 'search.filter_apply')}</button>
      ${hasFilters ? `<a class="btn secondary" href="/scouts">${t(lang, 'search.filter_clear')}</a>` : ''}
    </form>

    <p class="hint">${t(lang, 'search.results_count', { n: players.length })}</p>
    ${players.length === 0 ? `<p class="hint">${t(lang, totalUnfiltered === 0 ? 'search.no_players' : 'search.no_matches')}</p>` : ''}
    ${players.map(p => `
      <div class="card">
        <div class="player-row" style="border:none;background:transparent;padding:0;margin-bottom:14px;">
          ${p.photo_url
            ? `<img class="avatar-photo" src="${escapeHtml(p.photo_url)}" alt="" style="width:46px;height:46px;">`
            : `<div class="avatar">${escapeHtml(initials(p.full_name))}</div>`}
          <div>
            <div class="rname">${escapeHtml(p.full_name)}</div>
            <div class="rmeta">${escapeHtml(p.position)} · ${escapeHtml(p.club)} · ${t(lang, 'player_status.born', { year: p.birth_year })}</div>
          </div>
          <div style="margin-left:auto;">${statusBadge('active', lang)}</div>
        </div>
        ${p.bio ? `<p class="hint">${escapeHtml(p.bio)}</p>` : ''}
        ${careerTotalsHtml(p.seasons, lang)}
        ${seasonsTableHtml(p.seasons, lang)}
        ${p.videos && p.videos.length > 0 ? p.videos.map(v => videoEmbedHtml(v, lang)).join('') : ''}
        <p class="hint">${t(lang, 'search.contact_hint')}</p>
      </div>
    `).join('')}
  `, session, lang);
}

async function adminPage(lang) {
  const guardians = await db.pendingGuardians();
  const seasons = await db.pendingSeasons();
  const scouts = await db.pendingScouts();
  return layout(t(lang, 'admin.title_tag'), `
    <div class="eyebrow">${t(lang, 'admin.eyebrow')}</div>
    <h1>${t(lang, 'admin.title')}</h1>

    <div class="section-title">${t(lang, 'admin.guardians_section', { n: guardians.length })}</div>
    ${guardians.length === 0 ? `<p class="hint">${t(lang, 'admin.nothing_pending')}</p>` : guardians.map(g => `
      <div class="card">
        <div class="row">
          <span><b>${escapeHtml(g.name)}</b> — ${escapeHtml(g.email)}</span>
          <span>
            <form style="display:inline" method="POST" action="/admin/guardian/${g.id}/approve"><button type="submit">${t(lang, 'admin.approve')}</button></form>
            <form style="display:inline" method="POST" action="/admin/guardian/${g.id}/reject"><button type="submit" class="secondary danger">${t(lang, 'admin.reject')}</button></form>
          </span>
        </div>
        ${g.last_error ? `<p class="hint">${t(lang, 'admin.stripe_failed_hint', { error: `<code>${escapeHtml(g.last_error)}</code>` })}</p>` : ''}
      </div>
    `).join('')}

    <div class="section-title">${t(lang, 'admin.seasons_section', { n: seasons.length })}</div>
    ${seasons.length === 0 ? `<p class="hint">${t(lang, 'admin.nothing_pending')}</p>` : seasons.map(s => {
      return `
      <div class="card">
        <div class="row">
          <span><b>${escapeHtml(s.player_full_name)}</b> · ${t(lang, `federation.${s.player_federation}`)} — ${escapeHtml(s.season_label)}, ${s.goals}G ${s.assists}A</span>
          <form method="POST" action="/admin/season/${s.id}/verify"><button type="submit">${t(lang, 'admin.mark_verified')}</button></form>
        </div>
        <p class="hint">${t(lang, 'admin.check_by_hand', { url: `<code>${escapeHtml(s.source_url)}</code>` })}</p>
      </div>`;
    }).join('')}

    <div class="section-title">${t(lang, 'admin.scouts_section', { n: scouts.length })}</div>
    ${scouts.length === 0 ? `<p class="hint">${t(lang, 'admin.nothing_pending')}</p>` : scouts.map(s => `
      <div class="card">
        <div class="row">
          <span><b>${escapeHtml(s.name)}</b> — ${escapeHtml(s.organization)} (${escapeHtml(s.role)})</span>
          <form method="POST" action="/admin/scout/${s.id}/approve"><button type="submit">${t(lang, 'admin.approve')}</button></form>
        </div>
        <p class="hint">${t(lang, 'admin.profile_label', { url: escapeHtml(s.public_profile_url) })}</p>
      </div>
    `).join('')}
  `, null, lang);
}

// Confirms the current request may act as this player/scout: either they're
// logged in as that exact account, or they authenticated as admin (staff can
// always view/act on any profile). Writes the appropriate response and
// returns { ok: false } when neither holds, so callers just `if (!auth.ok) return;`.
async function authorizeOwnerOrAdmin(req, res, type, id) {
  const lang = getLang(req);
  const session = await getCurrentSession(req);
  if (session && session.type === type && String(session.record.id) === String(id)) {
    return { ok: true, session };
  }
  if (checkAdminAuth(req)) {
    return { ok: true, session: null };
  }
  if (session) {
    send(res, 403, layout(t(lang, 'error.not_found_title'), `<p>${t(lang, type === 'player' ? 'error.not_allowed_profile' : 'error.not_allowed_account')}</p>`, session, lang));
  } else {
    redirect(res, '/login');
  }
  return { ok: false };
}

// Applies a Stripe VerificationSession's outcome to a guardian record.
// 'requires_input' (a failed check that's still retryable — Stripe's normal
// outcome for a bad document or declined consent) records the reason so the
// admin queue isn't blind to it, since 'canceled' rarely fires in practice.
async function applyStripeSessionResult(guardianId, session) {
  const mapped = identity.mapStatus(session.status);
  if (mapped === 'approved') return db.approveGuardian(guardianId, 'stripe_identity');
  if (mapped === 'rejected') return db.rejectGuardian(guardianId, 'stripe_identity');
  if (session.last_error) {
    return db.setGuardianLastError(guardianId, session.last_error.reason || session.last_error.code);
  }
}

// ---------------- Router ----------------

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  const method = req.method;

  try {
    const lang = getLang(req);

    const langMatch = path.match(/^\/lang\/(en|lv|ru)$/);
    if (method === 'GET' && langMatch) {
      const attrs = [`${LANG_COOKIE}=${langMatch[1]}`, 'Path=/', 'Max-Age=31536000', 'SameSite=Lax'];
      if (COOKIE_SECURE) attrs.push('Secure');
      res.setHeader('Set-Cookie', attrs.join('; '));
      return redirect(res, req.headers.referer || '/');
    }

    if (path === '/admin' || path.startsWith('/admin/')) {
      if (!requireAdminAuth(req, res)) return;
    }

    if (method === 'GET' && path === '/') return send(res, 200, await homePage(lang));

    if (method === 'GET' && path === '/player/new') return send(res, 200, playerNewPage(lang));
    if (method === 'POST' && path === '/player/new') {
      const body = await readBody(req);
      if (!validate.isValidEmail(body.email)) {
        return sendValidationError(res, lang, t(lang, 'error.invalid_email'), '/player/new');
      }
      if (!validate.required(body.full_name) || !validate.required(body.club)) {
        return sendValidationError(res, lang, t(lang, 'error.required_fields'), '/player/new');
      }
      if (!validate.oneOf(body.position, validate.POSITIONS)) {
        return sendValidationError(res, lang, t(lang, 'error.invalid_position'), '/player/new');
      }
      if (!validate.oneOf(body.federation, Object.keys(validate.FEDERATIONS))) {
        return sendValidationError(res, lang, t(lang, 'error.invalid_federation'), '/player/new');
      }
      const birthYear = validate.intInRange(body.birth_year, validate.BIRTH_YEAR_MIN, validate.BIRTH_YEAR_MAX);
      if (birthYear === null) {
        return sendValidationError(res, lang, t(lang, 'error.invalid_birth_year', { min: validate.BIRTH_YEAR_MIN, max: validate.BIRTH_YEAR_MAX }), '/player/new');
      }
      const hasGuardianName = validate.required(body.guardian_name);
      const hasGuardianEmail = validate.required(body.guardian_email);
      if (hasGuardianName !== hasGuardianEmail) {
        return sendValidationError(res, lang, t(lang, 'error.guardian_incomplete'), '/player/new');
      }
      if (hasGuardianEmail && !validate.isValidEmail(body.guardian_email)) {
        return sendValidationError(res, lang, t(lang, 'error.invalid_email'), '/player/new');
      }
      let guardian = null;
      if (hasGuardianName && hasGuardianEmail) {
        guardian = await db.createGuardian({ name: body.guardian_name, email: body.guardian_email });
      }
      const player = await db.createPlayer({
        full_name: body.full_name, position: body.position, club: body.club,
        birth_year: birthYear, guardian_id: guardian ? guardian.id : null,
        email: body.email, federation: body.federation
      });
      const sessionId = await db.createSession('player', player.id);
      setSessionCookie(res, sessionId);
      return redirect(res, `/player/${player.id}`);
    }

    const playerMatch = path.match(/^\/player\/(\d+)$/);
    if (method === 'GET' && playerMatch) {
      const player = await db.getPlayer(playerMatch[1]);
      if (!player) return send(res, 404, layout(t(lang, 'error.not_found_title'), `<p>${t(lang, 'error.player_not_found')}</p>`, null, lang));
      const auth = await authorizeOwnerOrAdmin(req, res, 'player', player.id);
      if (!auth.ok) return;
      const guardian = player.guardian_id ? await db.getGuardian(player.guardian_id) : null;
      const seasons = await db.seasonsForPlayer(player.id);
      const videos = await db.videosForPlayer(player.id);
      return send(res, 200, playerStatusPage(player, guardian, seasons, videos, auth.session, lang));
    }

    const guardianVerifyMatch = path.match(/^\/guardian\/(\d+)\/verify$/);
    if (method === 'GET' && guardianVerifyMatch) {
      if (!identity.isConfigured()) return send(res, 503, layout(t(lang, 'error.not_available_title'), `<p>${t(lang, 'error.stripe_not_configured')}</p>`, null, lang));
      const guardian = await db.getGuardian(guardianVerifyMatch[1]);
      if (!guardian) return send(res, 404, layout(t(lang, 'error.not_found_title'), `<p>${t(lang, 'error.guardian_not_found')}</p>`, null, lang));
      const owningPlayer = await db.getPlayerByGuardian(guardian.id);
      if (!owningPlayer) return send(res, 404, layout(t(lang, 'error.not_found_title'), `<p>${t(lang, 'error.no_linked_player')}</p>`, null, lang));
      const auth = await authorizeOwnerOrAdmin(req, res, 'player', owningPlayer.id);
      if (!auth.ok) return;
      const session = await identity.createVerificationSession(guardian);
      await db.setGuardianStripeSession(guardian.id, session.id);
      res.writeHead(302, { Location: session.url });
      return res.end();
    }

    const guardianReturnMatch = path.match(/^\/guardian\/(\d+)\/verify\/return$/);
    if (method === 'GET' && guardianReturnMatch) {
      const guardian = await db.getGuardian(guardianReturnMatch[1]);
      if (!guardian || !guardian.stripe_session_id) return redirect(res, '/');
      const player = await db.getPlayerByGuardian(guardian.id);
      if (!player) return redirect(res, '/');
      const auth = await authorizeOwnerOrAdmin(req, res, 'player', player.id);
      if (!auth.ok) return;
      const session = await identity.retrieveVerificationSession(guardian.stripe_session_id);
      await applyStripeSessionResult(guardian.id, session);
      return redirect(res, `/player/${player.id}`);
    }

    if (method === 'POST' && path === '/webhooks/stripe') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks);
      let event;
      try {
        event = identity.constructWebhookEvent(rawBody, req.headers['stripe-signature']);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end(`Webhook Error: ${err.message}`);
      }
      if (event.type === 'identity.verification_session.verified' || event.type === 'identity.verification_session.requires_input') {
        const session = event.data.object;
        const guardianId = session.metadata && session.metadata.guardian_id;
        if (guardianId) {
          await applyStripeSessionResult(guardianId, session);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"received":true}');
    }

    const seasonMatch = path.match(/^\/player\/(\d+)\/season$/);
    if (method === 'POST' && seasonMatch) {
      const auth = await authorizeOwnerOrAdmin(req, res, 'player', seasonMatch[1]);
      if (!auth.ok) return;
      const body = await readBody(req);
      const backUrl = `/player/${seasonMatch[1]}`;
      if (!validate.required(body.source_url) || !validate.required(body.club) || !validate.required(body.season_label)) {
        return sendValidationError(res, lang, t(lang, 'error.required_fields'), backUrl, auth.session);
      }
      const seasonPlayer = await db.getPlayer(seasonMatch[1]);
      if (!validate.isValidSourceUrl(body.source_url, seasonPlayer.federation)) {
        const domain = validate.FEDERATIONS[seasonPlayer.federation].domain;
        return sendValidationError(res, lang, t(lang, 'add_season.wrong_domain', { domain }), backUrl, auth.session);
      }
      // These fields aren't required in the form — blank means 0, but
      // anything present must be a valid number in range (not just coerced
      // to 0 by a stray minus sign, as `Number(x) || 0` used to allow).
      const statOrZero = (s, max) => validate.required(s) ? validate.intInRange(s, 0, max) : 0;
      const apps = statOrZero(body.apps, 100);
      const goals = statOrZero(body.goals, 300);
      const assists = statOrZero(body.assists, 300);
      const minutes = statOrZero(body.minutes, 10000);
      if (apps === null || goals === null || assists === null || minutes === null) {
        return sendValidationError(res, lang, t(lang, 'error.invalid_stats', { max: 10000 }), backUrl, auth.session);
      }
      await db.createSeason({ player_id: seasonMatch[1], ...body, apps, goals, assists, minutes });
      return redirect(res, backUrl);
    }

    const profileMatch = path.match(/^\/player\/(\d+)\/profile$/);
    if (method === 'POST' && profileMatch) {
      const auth = await authorizeOwnerOrAdmin(req, res, 'player', profileMatch[1]);
      if (!auth.ok) return;
      const body = await readBody(req);
      const backUrl = `/player/${profileMatch[1]}`;
      if (!validate.maxLen(body.bio, 2000) || !validate.maxLen(body.photo_url, 2000)) {
        return sendValidationError(res, lang, t(lang, 'error.text_too_long', { max: 2000 }), backUrl, auth.session);
      }
      await db.updatePlayerProfile(profileMatch[1], { bio: body.bio, photo_url: body.photo_url });
      return redirect(res, backUrl);
    }

    const videoMatch = path.match(/^\/player\/(\d+)\/video$/);
    if (method === 'POST' && videoMatch) {
      const auth = await authorizeOwnerOrAdmin(req, res, 'player', videoMatch[1]);
      if (!auth.ok) return;
      const form = formidable({ maxFileSize: media.MAX_UPLOAD_BYTES });
      const [fields, files] = await form.parse(req);
      const videoUrl = (fields.video_url && fields.video_url[0] || '').trim();
      const title = (fields.title && fields.title[0] || '').trim();
      const uploaded = files.video_file && files.video_file[0];
      if (!validate.maxLen(title, 200) || !validate.maxLen(videoUrl, 2000)) {
        return sendValidationError(res, lang, t(lang, 'error.text_too_long', { max: 200 }), `/player/${videoMatch[1]}`, auth.session);
      }
      try {
        if (uploaded && uploaded.size > 0) {
          const savedPath = media.saveUploadedFile(uploaded);
          await db.addVideo({ player_id: videoMatch[1], source: 'upload', url: savedPath, title });
        } else if (videoUrl) {
          const parsed = media.parseVideoLink(videoUrl);
          await db.addVideo({
            player_id: videoMatch[1],
            source: parsed ? parsed.source : 'link',
            url: parsed ? parsed.embedUrl : videoUrl,
            title
          });
        }
      } catch (err) {
        return send(res, 400, layout(t(lang, 'error.upload_failed_title'), `<p>${escapeHtml(err.message)}</p><p><a href="/player/${videoMatch[1]}">${t(lang, 'error.upload_failed_back')}</a></p>`, auth.session, lang));
      }
      return redirect(res, `/player/${videoMatch[1]}`);
    }

    const uploadMatch = path.match(/^\/uploads\/videos\/([a-f0-9]+\.\w+)$/);
    if (method === 'GET' && uploadMatch) {
      const file = media.readUploadedFile(uploadMatch[1]);
      if (!file) return send(res, 404, layout(t(lang, 'error.not_found_title'), `<p>${t(lang, 'error.video_not_found')}</p>`, null, lang));
      res.writeHead(200, { 'Content-Type': file.contentType });
      return fs.createReadStream(file.filePath).pipe(res);
    }

    if (method === 'GET' && path === '/scout/new') return send(res, 200, scoutNewPage(lang));
    if (method === 'POST' && path === '/scout/new') {
      const body = await readBody(req);
      if (!validate.isValidEmail(body.email)) {
        return sendValidationError(res, lang, t(lang, 'error.invalid_email'), '/scout/new');
      }
      if (!validate.required(body.name) || !validate.required(body.organization)) {
        return sendValidationError(res, lang, t(lang, 'error.required_fields'), '/scout/new');
      }
      if (!validate.oneOf(body.role, validate.SCOUT_ROLES)) {
        return sendValidationError(res, lang, t(lang, 'error.invalid_role'), '/scout/new');
      }
      const scout = await db.createScout(body);
      const sessionId = await db.createSession('scout', scout.id);
      setSessionCookie(res, sessionId);
      return redirect(res, `/scout/${scout.id}`);
    }
    const scoutMatch = path.match(/^\/scout\/(\d+)$/);
    if (method === 'GET' && scoutMatch) {
      const scout = await db.getScout(scoutMatch[1]);
      if (!scout) return send(res, 404, layout(t(lang, 'error.not_found_title'), `<p>${t(lang, 'error.scout_not_found')}</p>`, null, lang));
      const auth = await authorizeOwnerOrAdmin(req, res, 'scout', scout.id);
      if (!auth.ok) return;
      return send(res, 200, scoutStatusPage(scout, auth.session, lang));
    }

    const scoutProfileMatch = path.match(/^\/scout\/(\d+)\/profile$/);
    if (method === 'POST' && scoutProfileMatch) {
      const auth = await authorizeOwnerOrAdmin(req, res, 'scout', scoutProfileMatch[1]);
      if (!auth.ok) return;
      const body = await readBody(req);
      const backUrl = `/scout/${scoutProfileMatch[1]}`;
      if (!validate.maxLen(body.bio, 2000) || !validate.maxLen(body.photo_url, 2000) || !validate.maxLen(body.looking_for, 2000)) {
        return sendValidationError(res, lang, t(lang, 'error.text_too_long', { max: 2000 }), backUrl, auth.session);
      }
      await db.updateScoutProfile(scoutProfileMatch[1], { bio: body.bio, photo_url: body.photo_url, looking_for: body.looking_for });
      return redirect(res, backUrl);
    }

    if (method === 'GET' && path === '/scouts') {
      const currentSession = await getCurrentSession(req);
      const scout = (currentSession && currentSession.type === 'scout') ? currentSession.record : null;
      const filters = {
        position: parsed.query.position || '',
        club: parsed.query.club || '',
        birth_year_min: parsed.query.birth_year_min || '',
        birth_year_max: parsed.query.birth_year_max || '',
        min_goals: parsed.query.min_goals || ''
      };
      const players = await db.searchablePlayers({
        position: filters.position || undefined,
        club: filters.club || undefined,
        birthYearMin: filters.birth_year_min ? Number(filters.birth_year_min) : undefined,
        birthYearMax: filters.birth_year_max ? Number(filters.birth_year_max) : undefined,
        minGoals: filters.min_goals ? Number(filters.min_goals) : undefined
      });
      const totalUnfiltered = players.length === 0 ? (await db.searchablePlayers()).length : players.length;
      return send(res, 200, searchPage(scout, players, currentSession, lang, filters, totalUnfiltered));
    }

    if (method === 'GET' && path === '/login') return send(res, 200, loginPage(null, lang));
    if (method === 'POST' && path === '/login') {
      const body = await readBody(req);
      const email = (body.email || '').trim();
      const account = email ? await db.findAccountByEmail(email) : null;
      if (!account) return send(res, 200, loginPage(t(lang, 'login.error_no_account', { email }), lang));
      const token = await db.createLoginToken(email);
      const link = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/login/verify?token=${token}`;
      if (mailer.isConfigured()) {
        await mailer.sendMagicLink(email, link);
        return send(res, 200, loginSentPage(email, null, lang));
      }
      return send(res, 200, loginSentPage(email, link, lang));
    }
    if (method === 'GET' && path === '/login/verify') {
      const email = await db.consumeLoginToken(parsed.query.token);
      if (!email) return send(res, 200, loginPage(t(lang, 'login.error_expired'), lang));
      const account = await db.findAccountByEmail(email);
      if (!account) return send(res, 200, loginPage(t(lang, 'login.error_no_account_anymore'), lang));
      const sessionId = await db.createSession(account.type, account.record.id);
      setSessionCookie(res, sessionId);
      return redirect(res, `/${account.type}/${account.record.id}`);
    }
    if (method === 'GET' && path === '/logout') {
      const sessionId = parseCookies(req)[SESSION_COOKIE];
      if (sessionId) await db.deleteSession(sessionId);
      clearSessionCookie(res);
      return redirect(res, '/');
    }

    if (method === 'GET' && path === '/admin') return send(res, 200, await adminPage(lang));

    const gApprove = path.match(/^\/admin\/guardian\/(\d+)\/approve$/);
    if (method === 'POST' && gApprove) { await db.approveGuardian(gApprove[1], 'staff'); return redirect(res, '/admin'); }
    const gReject = path.match(/^\/admin\/guardian\/(\d+)\/reject$/);
    if (method === 'POST' && gReject) { await db.rejectGuardian(gReject[1], 'staff'); return redirect(res, '/admin'); }

    const sVerify = path.match(/^\/admin\/season\/(\d+)\/verify$/);
    if (method === 'POST' && sVerify) { await db.verifySeason(sVerify[1], 'staff'); return redirect(res, '/admin'); }

    const scApprove = path.match(/^\/admin\/scout\/(\d+)\/approve$/);
    if (method === 'POST' && scApprove) { await db.approveScout(scApprove[1], 'staff'); return redirect(res, '/admin'); }

    send(res, 404, layout(t(lang, 'error.not_found_title'), `<p>${t(lang, 'error.page_not_found')}</p>`, null, lang));
  } catch (err) {
    console.error(err);
    const lang = getLang(req);
    send(res, 500, layout(t(lang, 'error.error_title'), `<p>${t(lang, 'error.something_broke', { message: escapeHtml(err.message) })}</p>`, null, lang));
  }
});

db.init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`VerifiedXI Phase 0 running at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to set up the database:', err.message);
    process.exit(1);
  });
