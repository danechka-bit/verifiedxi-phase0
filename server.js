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

const SESSION_COOKIE = 'vxi_session';
const COOKIE_SECURE = /^https:/.test(process.env.APP_BASE_URL || '');

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
function videoEmbedHtml(v) {
  if (v.source === 'youtube' || v.source === 'vimeo') {
    return `<div class="video-embed"><iframe src="${escapeHtml(v.url)}" frameborder="0" allowfullscreen></iframe></div>`;
  }
  if (v.source === 'upload') {
    return `<div class="video-embed"><video controls src="${escapeHtml(v.url)}"></video></div>`;
  }
  return `<p class="hint"><a href="${escapeHtml(v.url)}" target="_blank" rel="noopener">Watch video ↗</a></p>`;
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

// ---------------- Pages ----------------

async function homePage() {
  const s = await db.stats();
  return layout('Home', `
    <div class="eyebrow">Welcome</div>
    <h1>Get your stats seen —<br>and believed.</h1>
    <p class="sub">Real guardian ID verification, real data persistence. Stat matching against lff.lv is done by a human in the admin queue — not automated, and that's intentional (see the README).</p>

    <div class="ticker">
      <div class="tstat"><div class="tnum">${s.verified_players}</div><div class="tlbl">Verified players</div></div>
      <div class="tdiv"></div>
      <div class="tstat"><div class="tnum">${s.verified_scouts}</div><div class="tlbl">Scouts active</div></div>
      <div class="tdiv"></div>
      <div class="tstat"><div class="tnum">${s.pending_reviews}</div><div class="tlbl">In review</div></div>
    </div>

    <a class="tap-card" href="/player/new">
      <div class="icon">${PLAYER_ICON}</div>
      <div>
        <div class="title">I'm a player</div>
        <div class="desc">Build a verified profile from your club stats</div>
      </div>
      <div class="chev">›</div>
    </a>
    <a class="tap-card" href="/scout/new">
      <div class="icon">${SCOUT_ICON}</div>
      <div>
        <div class="title">I'm a scout</div>
        <div class="desc">Find players with confirmed performance data</div>
      </div>
      <div class="chev">›</div>
    </a>
    <a class="tap-card" href="/admin">
      <div class="icon">${STAFF_ICON}</div>
      <div>
        <div class="title">I'm staff</div>
        <div class="desc">Approve guardians, verify seasons, approve scouts</div>
      </div>
      <div class="chev">›</div>
    </a>
  `);
}

function playerNewPage() {
  return layout('New player', `
    <div class="eyebrow">Player signup</div>
    <h1>Set up your profile</h1>
    <p class="sub">This is what scouts will see first. If the player is under 18, a guardian must be verified before the profile goes live.</p>
    <form method="POST" action="/player/new">
      <label>Your email</label><input type="email" name="email" required placeholder="you@example.com">
      <p class="hint">Used to log back in and manage this profile — no password needed, we email a sign-in link.</p>
      <label>Full name</label><input name="full_name" required placeholder="Full name">
      <label>Position</label>
      <select name="position" required>
        <option value="" disabled selected>Choose a position</option>
        <optgroup label="Goalkeeper">
          <option>GK</option>
        </optgroup>
        <optgroup label="Defenders">
          <option>LB</option>
          <option>CB</option>
          <option>RB</option>
        </optgroup>
        <optgroup label="Midfielders">
          <option>CDM</option>
          <option>CM</option>
          <option>LM</option>
          <option>RM</option>
          <option>CAM</option>
        </optgroup>
        <optgroup label="Attackers">
          <option>ST</option>
          <option>RW</option>
          <option>LW</option>
        </optgroup>
      </select>
      <label>Club</label><input name="club" required placeholder="Club">
      <label>Birth year</label><input name="birth_year" required placeholder="e.g. 2009">
      <div class="section-title">Guardian (required if under 18)</div>
      <label>Guardian name</label><input name="guardian_name" placeholder="Guardian name">
      <label>Guardian email</label><input name="guardian_email" placeholder="guardian@example.com">
      <p class="hint">${identity.isConfigured()
        ? 'After creating the profile, the guardian completes a real ID check through Stripe Identity.'
        : 'Stripe Identity isn\'t configured on this server, so a staff member will approve this guardian manually from the admin queue.'}</p>
      <button type="submit">Create profile</button>
    </form>
  `);
}

function playerStatusPage(player, guardian, seasons, videos, session) {
  const canAddSeason = player.profile_status === 'active';
  return layout('Player profile', `
    <div class="eyebrow">Player profile</div>
    <div class="profile-head">
      ${player.photo_url
        ? `<img class="avatar-photo" src="${escapeHtml(player.photo_url)}" alt="">`
        : `<div class="avatar">${escapeHtml(initials(player.full_name))}</div>`}
      <div>
        <div class="name">${escapeHtml(player.full_name.toUpperCase())} ${statusBadge(player.profile_status)}</div>
        <div class="meta">${escapeHtml(player.position)} · ${escapeHtml(player.club)} · born ${player.birth_year}</div>
      </div>
    </div>

    ${player.bio ? `<p class="sub">${escapeHtml(player.bio)}</p>` : ''}

    ${guardian ? `
      <div class="card">
        <div class="row"><b>Guardian: ${escapeHtml(guardian.name)}</b> ${statusBadge(guardian.id_verification_status)}</div>
        ${guardian.id_verification_status === 'approved' ? '' : identity.isConfigured() ? `
          <p class="hint">Profile is frozen — invisible to scouts, no season submissions — until this guardian's ID is verified. No timeout.</p>
          <a class="btn" href="/guardian/${guardian.id}/verify">Start ID verification</a>
        ` : `<p class="hint">Profile is frozen — invisible to scouts, no season submissions — until this guardian's ID is approved in the admin queue. No timeout.</p>`}
      </div>
    ` : ''}

    ${seasons.map(s => `
      <div class="card">
        <div class="row"><b>${escapeHtml(s.season_label)} · ${escapeHtml(s.club)}</b> ${statusBadge(s.verification_status)}</div>
        <div class="stat-grid">
          <div class="stat-box"><b>${s.apps}</b><span>Apps</span></div>
          <div class="stat-box"><b>${s.goals}</b><span>Goals</span></div>
          <div class="stat-box"><b>${s.assists}</b><span>Assists</span></div>
          <div class="stat-box"><b>${s.minutes}</b><span>Mins</span></div>
        </div>
        <p class="hint">Source: ${escapeHtml(s.source_url)}${s.verified_by ? ` · verified by ${escapeHtml(s.verified_by)} (manual)` : ''}</p>
      </div>
    `).join('')}

    ${canAddSeason ? `
      <div class="section-title">Add a season</div>
      <form method="POST" action="/player/${player.id}/season">
        <label>lff.lv link</label><input name="source_url" required value="lff.lv/spelotajs/toms-ozolins-2009">
        <label>Club</label><input name="club" required value="${escapeHtml(player.club)}">
        <label>Season label</label><input name="season_label" required value="2025/26">
        <div class="stat-grid" style="margin-top:14px;">
          <div><label>Apps</label><input name="apps" value="14"></div>
          <div><label>Goals</label><input name="goals" value="9"></div>
          <div><label>Assists</label><input name="assists" value="5"></div>
          <div><label>Minutes</label><input name="minutes" value="1120"></div>
        </div>
        <p class="hint">This goes to the admin queue for a human to check against the live lff.lv page — nothing is auto-verified in Phase 0.</p>
        <button type="submit">Submit for verification</button>
      </form>
    ` : `<p class="hint">Season submission unlocks once the guardian is approved.</p>`}

    <div class="section-title">Highlights</div>
    ${videos.length === 0 ? `<p class="hint">No highlight videos yet.</p>` : videos.map(v => `
      <div class="card">
        ${v.title ? `<b>${escapeHtml(v.title)}</b>` : ''}
        ${videoEmbedHtml(v)}
      </div>
    `).join('')}
    <form method="POST" action="/player/${player.id}/video" enctype="multipart/form-data">
      <label>YouTube or Vimeo link</label><input type="url" name="video_url" placeholder="https://youtube.com/watch?v=...">
      <label>Or upload a video file</label><input type="file" name="video_file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v">
      <label>Title (optional)</label><input name="title" placeholder="e.g. Hat-trick vs Skonto U17">
      <p class="hint">Provide a link OR a file, not both. Uploads: mp4/mov/webm/m4v, up to 150MB.</p>
      <button type="submit">Add highlight</button>
    </form>

    <div class="section-title">Edit profile</div>
    <form method="POST" action="/player/${player.id}/profile">
      <label>Bio</label>
      <textarea name="bio" rows="4" placeholder="Tell scouts about your playing style, achievements, availability...">${escapeHtml(player.bio || '')}</textarea>
      <label>Photo URL</label><input type="url" name="photo_url" value="${escapeHtml(player.photo_url || '')}" placeholder="https://...">
      <button type="submit" class="secondary">Save profile</button>
    </form>
  `, session);
}

function scoutNewPage() {
  return layout('New scout', `
    <div class="eyebrow">Before you search</div>
    <h1>Verify your organization</h1>
    <p class="sub">Every scout account is reviewed before search access is granted.</p>
    <form method="POST" action="/scout/new">
      <label>Your email</label><input type="email" name="email" required placeholder="you@example.com">
      <p class="hint">Used to log back in and search — no password needed, we email a sign-in link.</p>
      <label>Your name</label><input name="name" required value="Jānis Vītols">
      <label>Organization / academy</label><input name="organization" required value="Riga Youth Development Academy">
      <label>Role</label>
      <select name="role"><option selected>Scout</option><option>Academy director</option><option>Agent</option></select>
      <label>Public profile link</label><input name="public_profile_url" value="linkedin.com/in/janis-vitols-scouting">
      <button type="submit">Submit for verification</button>
    </form>
  `);
}

function scoutStatusPage(scout, session) {
  return layout('Scout status', `
    <div class="eyebrow">Scout status</div>
    <div class="profile-head">
      ${scout.photo_url
        ? `<img class="avatar-photo" src="${escapeHtml(scout.photo_url)}" alt="">`
        : `<div class="avatar">${escapeHtml(initials(scout.name))}</div>`}
      <div>
        <div class="name">${escapeHtml(scout.name.toUpperCase())} ${statusBadge(scout.verification_status)}</div>
        <div class="meta">${escapeHtml(scout.organization)} · ${escapeHtml(scout.role)}</div>
      </div>
    </div>
    ${scout.bio ? `<p class="sub">${escapeHtml(scout.bio)}</p>` : ''}
    ${scout.looking_for ? `<div class="card"><b>Looking for</b><p class="hint">${escapeHtml(scout.looking_for)}</p></div>` : ''}
    ${scout.verification_status === 'verified'
      ? `<a class="btn" href="/scouts">Search verified players</a>`
      : `<p class="hint">Waiting on admin review. This queues on the Admin page.</p>`}

    <div class="section-title">Edit profile</div>
    <form method="POST" action="/scout/${scout.id}/profile">
      <label>Bio</label>
      <textarea name="bio" rows="4" placeholder="A bit about you and your organization...">${escapeHtml(scout.bio || '')}</textarea>
      <label>Photo URL</label><input type="url" name="photo_url" value="${escapeHtml(scout.photo_url || '')}" placeholder="https://...">
      <label>Who are you looking for?</label>
      <textarea name="looking_for" rows="3" placeholder="e.g. Forwards, born 2008-2010, based in Riga region, 8+ goals this season">${escapeHtml(scout.looking_for || '')}</textarea>
      <button type="submit" class="secondary">Save profile</button>
    </form>
  `, session);
}

function loginPage(error) {
  return layout('Log in', `
    <div class="eyebrow">Sign in</div>
    <h1>Log in</h1>
    <p class="sub">Enter the email you used to sign up as a player or a scout — we'll send a one-time link, no password needed.</p>
    ${error ? `<p class="hint" style="color:#A5352A;">${escapeHtml(error)}</p>` : ''}
    <form method="POST" action="/login">
      <label>Email</label><input type="email" name="email" required placeholder="you@example.com">
      <button type="submit">Send sign-in link</button>
    </form>
  `);
}

function loginSentPage(email, devLink) {
  return layout('Check your email', `
    <div class="eyebrow">Almost there</div>
    <h1>Check your email</h1>
    <p class="sub">If ${escapeHtml(email)} has an account, a sign-in link is on its way. The link expires in 15 minutes.</p>
    ${devLink ? `
      <div class="card">
        <b>No email service is configured on this server yet</b>
        <p class="hint">So here's the link directly, for local testing:</p>
        <a class="btn" href="${devLink}">Sign in as ${escapeHtml(email)}</a>
      </div>
    ` : ''}
  `);
}

function searchPage(scout, players, session) {
  if (!scout || scout.verification_status !== 'verified') {
    return layout('Search', `
      <div class="eyebrow">Scout search</div>
      <h1>Search players</h1>
      <p class="sub">${session
        ? `You need a verified scout account to search. Check your status, or <a href="/scout/new">sign up</a> if you haven't.`
        : `You need a verified scout account to search. <a href="/login">Log in</a> or <a href="/scout/new">sign up</a> if you haven't.`}</p>
    `, session);
  }
  return layout('Search players', `
    <div class="eyebrow">Verified · ${escapeHtml(scout.organization)}</div>
    <h1>Find players</h1>
    <p class="sub">Signed in as ${escapeHtml(scout.name)}</p>
    ${players.length === 0 ? `<p class="hint">No verified players yet — verify a season from the admin queue to see one here.</p>` : ''}
    ${players.map(p => `
      <div class="card">
        <div class="player-row" style="border:none;background:transparent;padding:0;margin-bottom:14px;">
          ${p.photo_url
            ? `<img class="avatar-photo" src="${escapeHtml(p.photo_url)}" alt="" style="width:46px;height:46px;">`
            : `<div class="avatar">${escapeHtml(initials(p.full_name))}</div>`}
          <div>
            <div class="rname">${escapeHtml(p.full_name)}</div>
            <div class="rmeta">${escapeHtml(p.position)} · ${escapeHtml(p.club)} · born ${p.birth_year}</div>
          </div>
          <div style="margin-left:auto;">${statusBadge('active')}</div>
        </div>
        ${p.bio ? `<p class="hint">${escapeHtml(p.bio)}</p>` : ''}
        ${p.seasons.map(s => `
          <div class="stat-grid">
            <div class="stat-box"><b>${s.apps}</b><span>Apps</span></div>
            <div class="stat-box"><b>${s.goals}</b><span>Goals</span></div>
            <div class="stat-box"><b>${s.assists}</b><span>Assists</span></div>
            <div class="stat-box"><b>${s.minutes}</b><span>Mins</span></div>
          </div>
        `).join('')}
        ${p.videos && p.videos.length > 0 ? p.videos.map(v => videoEmbedHtml(v)).join('') : ''}
        <p class="hint">Contact goes to the club, never the player directly.</p>
      </div>
    `).join('')}
  `, session);
}

async function adminPage() {
  const guardians = await db.pendingGuardians();
  const seasons = await db.pendingSeasons();
  const scouts = await db.pendingScouts();
  return layout('Admin queue', `
    <div class="eyebrow">Play staff</div>
    <h1>Review queue</h1>

    <div class="section-title">Guardians awaiting ID review (${guardians.length})</div>
    ${guardians.length === 0 ? `<p class="hint">Nothing pending.</p>` : guardians.map(g => `
      <div class="card">
        <div class="row">
          <span><b>${escapeHtml(g.name)}</b> — ${escapeHtml(g.email)}</span>
          <span>
            <form style="display:inline" method="POST" action="/admin/guardian/${g.id}/approve"><button type="submit">Approve</button></form>
            <form style="display:inline" method="POST" action="/admin/guardian/${g.id}/reject"><button type="submit" class="secondary danger">Reject</button></form>
          </span>
        </div>
        ${g.last_error ? `<p class="hint">Stripe Identity check failed and is awaiting retry: <code>${escapeHtml(g.last_error)}</code></p>` : ''}
      </div>
    `).join('')}

    <div class="section-title">Seasons awaiting manual lff.lv match (${seasons.length})</div>
    ${seasons.length === 0 ? `<p class="hint">Nothing pending.</p>` : seasons.map(s => {
      return `
      <div class="card">
        <div class="row">
          <span><b>${escapeHtml(s.player_full_name)}</b> — ${escapeHtml(s.season_label)}, ${s.goals}G ${s.assists}A</span>
          <form method="POST" action="/admin/season/${s.id}/verify"><button type="submit">Mark verified</button></form>
        </div>
        <p class="hint">Check by hand: <code>${escapeHtml(s.source_url)}</code></p>
      </div>`;
    }).join('')}

    <div class="section-title">Scouts awaiting review (${scouts.length})</div>
    ${scouts.length === 0 ? `<p class="hint">Nothing pending.</p>` : scouts.map(s => `
      <div class="card">
        <div class="row">
          <span><b>${escapeHtml(s.name)}</b> — ${escapeHtml(s.organization)} (${escapeHtml(s.role)})</span>
          <form method="POST" action="/admin/scout/${s.id}/approve"><button type="submit">Approve</button></form>
        </div>
        <p class="hint">Profile: ${escapeHtml(s.public_profile_url)}</p>
      </div>
    `).join('')}
  `);
}

// Confirms the current request may act as this player/scout: either they're
// logged in as that exact account, or they authenticated as admin (staff can
// always view/act on any profile). Writes the appropriate response and
// returns { ok: false } when neither holds, so callers just `if (!auth.ok) return;`.
async function authorizeOwnerOrAdmin(req, res, type, id) {
  const session = await getCurrentSession(req);
  if (session && session.type === type && String(session.record.id) === String(id)) {
    return { ok: true, session };
  }
  if (checkAdminAuth(req)) {
    return { ok: true, session: null };
  }
  if (session) {
    send(res, 403, layout('Not allowed', `<p>This isn't your ${type === 'player' ? 'profile' : 'account'}.</p>`, session));
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
    if (path === '/admin' || path.startsWith('/admin/')) {
      if (!requireAdminAuth(req, res)) return;
    }

    if (method === 'GET' && path === '/') return send(res, 200, await homePage());

    if (method === 'GET' && path === '/player/new') return send(res, 200, playerNewPage());
    if (method === 'POST' && path === '/player/new') {
      const body = await readBody(req);
      let guardian = null;
      if (body.guardian_name && body.guardian_email) {
        guardian = await db.createGuardian({ name: body.guardian_name, email: body.guardian_email });
      }
      const player = await db.createPlayer({
        full_name: body.full_name, position: body.position, club: body.club,
        birth_year: body.birth_year, guardian_id: guardian ? guardian.id : null,
        email: body.email
      });
      const sessionId = await db.createSession('player', player.id);
      setSessionCookie(res, sessionId);
      return redirect(res, `/player/${player.id}`);
    }

    const playerMatch = path.match(/^\/player\/(\d+)$/);
    if (method === 'GET' && playerMatch) {
      const player = await db.getPlayer(playerMatch[1]);
      if (!player) return send(res, 404, layout('Not found', '<p>Player not found.</p>'));
      const auth = await authorizeOwnerOrAdmin(req, res, 'player', player.id);
      if (!auth.ok) return;
      const guardian = player.guardian_id ? await db.getGuardian(player.guardian_id) : null;
      const seasons = await db.seasonsForPlayer(player.id);
      const videos = await db.videosForPlayer(player.id);
      return send(res, 200, playerStatusPage(player, guardian, seasons, videos, auth.session));
    }

    const guardianVerifyMatch = path.match(/^\/guardian\/(\d+)\/verify$/);
    if (method === 'GET' && guardianVerifyMatch) {
      if (!identity.isConfigured()) return send(res, 503, layout('Not available', '<p>Stripe Identity isn\'t configured on this server.</p>'));
      const guardian = await db.getGuardian(guardianVerifyMatch[1]);
      if (!guardian) return send(res, 404, layout('Not found', '<p>Guardian not found.</p>'));
      const owningPlayer = await db.getPlayerByGuardian(guardian.id);
      if (!owningPlayer) return send(res, 404, layout('Not found', '<p>No player is linked to this guardian.</p>'));
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
      await db.createSeason({ player_id: seasonMatch[1], ...body });
      return redirect(res, `/player/${seasonMatch[1]}`);
    }

    const profileMatch = path.match(/^\/player\/(\d+)\/profile$/);
    if (method === 'POST' && profileMatch) {
      const auth = await authorizeOwnerOrAdmin(req, res, 'player', profileMatch[1]);
      if (!auth.ok) return;
      const body = await readBody(req);
      await db.updatePlayerProfile(profileMatch[1], { bio: body.bio, photo_url: body.photo_url });
      return redirect(res, `/player/${profileMatch[1]}`);
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
        return send(res, 400, layout('Upload failed', `<p>${escapeHtml(err.message)}</p><p><a href="/player/${videoMatch[1]}">Back</a></p>`, auth.session));
      }
      return redirect(res, `/player/${videoMatch[1]}`);
    }

    const uploadMatch = path.match(/^\/uploads\/videos\/([a-f0-9]+\.\w+)$/);
    if (method === 'GET' && uploadMatch) {
      const file = media.readUploadedFile(uploadMatch[1]);
      if (!file) return send(res, 404, layout('Not found', '<p>Video not found.</p>'));
      res.writeHead(200, { 'Content-Type': file.contentType });
      return fs.createReadStream(file.filePath).pipe(res);
    }

    if (method === 'GET' && path === '/scout/new') return send(res, 200, scoutNewPage());
    if (method === 'POST' && path === '/scout/new') {
      const body = await readBody(req);
      const scout = await db.createScout(body);
      const sessionId = await db.createSession('scout', scout.id);
      setSessionCookie(res, sessionId);
      return redirect(res, `/scout/${scout.id}`);
    }
    const scoutMatch = path.match(/^\/scout\/(\d+)$/);
    if (method === 'GET' && scoutMatch) {
      const scout = await db.getScout(scoutMatch[1]);
      if (!scout) return send(res, 404, layout('Not found', '<p>Scout not found.</p>'));
      const auth = await authorizeOwnerOrAdmin(req, res, 'scout', scout.id);
      if (!auth.ok) return;
      return send(res, 200, scoutStatusPage(scout, auth.session));
    }

    const scoutProfileMatch = path.match(/^\/scout\/(\d+)\/profile$/);
    if (method === 'POST' && scoutProfileMatch) {
      const auth = await authorizeOwnerOrAdmin(req, res, 'scout', scoutProfileMatch[1]);
      if (!auth.ok) return;
      const body = await readBody(req);
      await db.updateScoutProfile(scoutProfileMatch[1], { bio: body.bio, photo_url: body.photo_url, looking_for: body.looking_for });
      return redirect(res, `/scout/${scoutProfileMatch[1]}`);
    }

    if (method === 'GET' && path === '/scouts') {
      const currentSession = await getCurrentSession(req);
      const scout = (currentSession && currentSession.type === 'scout') ? currentSession.record : null;
      const players = await db.searchablePlayers();
      return send(res, 200, searchPage(scout, players, currentSession));
    }

    if (method === 'GET' && path === '/login') return send(res, 200, loginPage());
    if (method === 'POST' && path === '/login') {
      const body = await readBody(req);
      const email = (body.email || '').trim();
      const account = email ? await db.findAccountByEmail(email) : null;
      if (!account) return send(res, 200, loginPage(`No account found for ${email}.`));
      const token = await db.createLoginToken(email);
      const link = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/login/verify?token=${token}`;
      if (mailer.isConfigured()) {
        await mailer.sendMagicLink(email, link);
        return send(res, 200, loginSentPage(email, null));
      }
      return send(res, 200, loginSentPage(email, link));
    }
    if (method === 'GET' && path === '/login/verify') {
      const email = await db.consumeLoginToken(parsed.query.token);
      if (!email) return send(res, 200, loginPage('That sign-in link is invalid or has expired.'));
      const account = await db.findAccountByEmail(email);
      if (!account) return send(res, 200, loginPage('No account found for that email anymore.'));
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

    if (method === 'GET' && path === '/admin') return send(res, 200, await adminPage());

    const gApprove = path.match(/^\/admin\/guardian\/(\d+)\/approve$/);
    if (method === 'POST' && gApprove) { await db.approveGuardian(gApprove[1], 'staff'); return redirect(res, '/admin'); }
    const gReject = path.match(/^\/admin\/guardian\/(\d+)\/reject$/);
    if (method === 'POST' && gReject) { await db.rejectGuardian(gReject[1], 'staff'); return redirect(res, '/admin'); }

    const sVerify = path.match(/^\/admin\/season\/(\d+)\/verify$/);
    if (method === 'POST' && sVerify) { await db.verifySeason(sVerify[1], 'staff'); return redirect(res, '/admin'); }

    const scApprove = path.match(/^\/admin\/scout\/(\d+)\/approve$/);
    if (method === 'POST' && scApprove) { await db.approveScout(scApprove[1], 'staff'); return redirect(res, '/admin'); }

    send(res, 404, layout('Not found', '<p>Page not found. <a href="/">Home</a></p>'));
  } catch (err) {
    console.error(err);
    send(res, 500, layout('Error', `<p>Something broke: ${escapeHtml(err.message)}</p>`));
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
