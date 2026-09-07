require('dotenv').config();
const http = require('http');
const url = require('url');
const querystring = require('querystring');
const db = require('./db');
const identity = require('./identity');
const { layout, escapeHtml, statusBadge } = require('./views');

const PORT = process.env.PORT || 3000;

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

function homePage() {
  return layout('Home', `
    <h1>VerifiedXI — Phase 0</h1>
    <p class="sub">This is the concierge MVP: real guardian ID gate, real data persistence, but stat matching against lff.lv is done by a human in the admin queue — not automated. That's intentional (see the backend plan).</p>
    <div class="card">
      <b>Try it as a player</b>
      <p class="hint">Create a profile → submit a guardian for ID review → once approved, submit a season's stats for manual verification.</p>
      <a class="btn" href="/player/new">Start as a player</a>
    </div>
    <div class="card">
      <b>Try it as a scout</b>
      <p class="hint">Sign up an organization → wait for review → search verified players once approved.</p>
      <a class="btn secondary" href="/scout/new">Start as a scout</a>
    </div>
    <div class="card">
      <b>Play staff</b>
      <p class="hint">Approve guardians, verify seasons, and approve scouts from the review queue.</p>
      <a class="btn secondary" href="/admin">Open admin queue</a>
    </div>
  `);
}

function playerNewPage() {
  return layout('New player', `
    <h1>Create a player profile</h1>
    <p class="sub">If the player is under 18, a guardian must be verified before the profile goes live.</p>
    <form method="POST" action="/player/new">
      <label>Full name</label><input name="full_name" required value="Toms Ozoliņš">
      <label>Position</label>
      <select name="position"><option>GK</option><option>DF</option><option>MF</option><option selected>FW</option></select>
      <label>Club</label><input name="club" required value="BFC Daugava U17">
      <label>Birth year</label><input name="birth_year" required value="2009">
      <div class="section-title">Guardian (required if under 18)</div>
      <label>Guardian name</label><input name="guardian_name" value="Ligita Ozoliņa">
      <label>Guardian email</label><input name="guardian_email" value="ligita.ozolina@example.com">
      <p class="hint">${identity.isConfigured()
        ? 'After creating the profile, the guardian completes a real ID check through Stripe Identity.'
        : 'Stripe Identity isn\'t configured on this server, so a staff member will approve this guardian manually from the admin queue.'}</p>
      <button type="submit">Create profile</button>
    </form>
  `);
}

function playerStatusPage(player, guardian, seasons) {
  const canAddSeason = player.profile_status === 'active';
  return layout('Player profile', `
    <h1>${escapeHtml(player.full_name)} ${statusBadge(player.profile_status)}</h1>
    <p class="sub">${escapeHtml(player.position)} · ${escapeHtml(player.club)} · born ${player.birth_year}</p>

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
  `);
}

function scoutNewPage() {
  return layout('New scout', `
    <h1>Verify your organization</h1>
    <p class="sub">Every scout account is reviewed before search access is granted.</p>
    <form method="POST" action="/scout/new">
      <label>Your name</label><input name="name" required value="Jānis Vītols">
      <label>Organization / academy</label><input name="organization" required value="Riga Youth Development Academy">
      <label>Role</label>
      <select name="role"><option selected>Scout</option><option>Academy director</option><option>Agent</option></select>
      <label>Public profile link</label><input name="public_profile_url" value="linkedin.com/in/janis-vitols-scouting">
      <button type="submit">Submit for verification</button>
    </form>
  `);
}

function scoutStatusPage(scout) {
  return layout('Scout status', `
    <h1>${escapeHtml(scout.name)} ${statusBadge(scout.verification_status)}</h1>
    <p class="sub">${escapeHtml(scout.organization)} · ${escapeHtml(scout.role)}</p>
    ${scout.verification_status === 'verified'
      ? `<a class="btn" href="/scouts?scoutId=${scout.id}">Search verified players</a>`
      : `<p class="hint">Waiting on admin review. This queues on the Admin page.</p>`}
  `);
}

function searchPage(scout, players) {
  if (!scout || scout.verification_status !== 'verified') {
    return layout('Search', `
      <h1>Search players</h1>
      <p class="sub">You need a verified scout account to search. <a href="/scout/new">Sign up</a> or check your status if you already did.</p>
    `);
  }
  return layout('Search players', `
    <h1>Verified players</h1>
    <p class="sub">Signed in as ${escapeHtml(scout.name)} · ${escapeHtml(scout.organization)} ${statusBadge('verified')}</p>
    ${players.length === 0 ? `<p class="hint">No verified players yet — verify a season from the admin queue to see one here.</p>` : ''}
    ${players.map(p => `
      <div class="card">
        <div class="row"><b>${escapeHtml(p.full_name)}</b> ${statusBadge('active')}</div>
        <p class="hint">${escapeHtml(p.position)} · ${escapeHtml(p.club)} · born ${p.birth_year}</p>
        ${p.seasons.map(s => `
          <div class="stat-grid">
            <div class="stat-box"><b>${s.apps}</b><span>Apps</span></div>
            <div class="stat-box"><b>${s.goals}</b><span>Goals</span></div>
            <div class="stat-box"><b>${s.assists}</b><span>Assists</span></div>
            <div class="stat-box"><b>${s.minutes}</b><span>Mins</span></div>
          </div>
        `).join('')}
        <p class="hint">Contact goes to the club, never the player directly.</p>
      </div>
    `).join('')}
  `);
}

async function adminPage() {
  const guardians = await db.pendingGuardians();
  const seasons = await db.pendingSeasons();
  const scouts = await db.pendingScouts();
  return layout('Admin queue', `
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
    if (method === 'GET' && path === '/') return send(res, 200, homePage());

    if (method === 'GET' && path === '/player/new') return send(res, 200, playerNewPage());
    if (method === 'POST' && path === '/player/new') {
      const body = await readBody(req);
      let guardian = null;
      if (body.guardian_name && body.guardian_email) {
        guardian = await db.createGuardian({ name: body.guardian_name, email: body.guardian_email });
      }
      const player = await db.createPlayer({
        full_name: body.full_name, position: body.position, club: body.club,
        birth_year: body.birth_year, guardian_id: guardian ? guardian.id : null
      });
      return redirect(res, `/player/${player.id}`);
    }

    const playerMatch = path.match(/^\/player\/(\d+)$/);
    if (method === 'GET' && playerMatch) {
      const player = await db.getPlayer(playerMatch[1]);
      if (!player) return send(res, 404, layout('Not found', '<p>Player not found.</p>'));
      const guardian = player.guardian_id ? await db.getGuardian(player.guardian_id) : null;
      const seasons = await db.seasonsForPlayer(player.id);
      return send(res, 200, playerStatusPage(player, guardian, seasons));
    }

    const guardianVerifyMatch = path.match(/^\/guardian\/(\d+)\/verify$/);
    if (method === 'GET' && guardianVerifyMatch) {
      if (!identity.isConfigured()) return send(res, 503, layout('Not available', '<p>Stripe Identity isn\'t configured on this server.</p>'));
      const guardian = await db.getGuardian(guardianVerifyMatch[1]);
      if (!guardian) return send(res, 404, layout('Not found', '<p>Guardian not found.</p>'));
      const session = await identity.createVerificationSession(guardian);
      await db.setGuardianStripeSession(guardian.id, session.id);
      res.writeHead(302, { Location: session.url });
      return res.end();
    }

    const guardianReturnMatch = path.match(/^\/guardian\/(\d+)\/verify\/return$/);
    if (method === 'GET' && guardianReturnMatch) {
      const guardian = await db.getGuardian(guardianReturnMatch[1]);
      if (!guardian || !guardian.stripe_session_id) return redirect(res, '/');
      const session = await identity.retrieveVerificationSession(guardian.stripe_session_id);
      await applyStripeSessionResult(guardian.id, session);
      const player = await db.getPlayerByGuardian(guardian.id);
      return redirect(res, player ? `/player/${player.id}` : '/');
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
      const body = await readBody(req);
      await db.createSeason({ player_id: seasonMatch[1], ...body });
      return redirect(res, `/player/${seasonMatch[1]}`);
    }

    if (method === 'GET' && path === '/scout/new') return send(res, 200, scoutNewPage());
    if (method === 'POST' && path === '/scout/new') {
      const body = await readBody(req);
      const scout = await db.createScout(body);
      return redirect(res, `/scout/${scout.id}`);
    }
    const scoutMatch = path.match(/^\/scout\/(\d+)$/);
    if (method === 'GET' && scoutMatch) {
      const scout = await db.getScout(scoutMatch[1]);
      if (!scout) return send(res, 404, layout('Not found', '<p>Scout not found.</p>'));
      return send(res, 200, scoutStatusPage(scout));
    }

    if (method === 'GET' && path === '/scouts') {
      const scoutId = parsed.query.scoutId;
      const scout = scoutId ? await db.getScout(scoutId) : null;
      const players = await db.searchablePlayers();
      return send(res, 200, searchPage(scout, players));
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
