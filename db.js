// Real Postgres data layer. Every other file only talks to the functions
// exported here, not to `pg` directly — that's what made this swap possible
// without touching server.js's routes or views.js at all.

const { Pool, Client } = require('pg');
const crypto = require('crypto');

const DB_NAME = process.env.PGDATABASE || 'verifiedxi';
const CONNECTION_BASE = process.env.DATABASE_URL_BASE || 'postgres://localhost:5432';

const pool = new Pool({ connectionString: `${CONNECTION_BASE}/${DB_NAME}` });

async function ensureDatabase() {
  const admin = new Client({ connectionString: `${CONNECTION_BASE}/postgres` });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
  if (rowCount === 0) await admin.query(`CREATE DATABASE "${DB_NAME}"`);
  await admin.end();
}

async function init() {
  await ensureDatabase();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guardians (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      id_verification_status TEXT NOT NULL DEFAULT 'submitted', -- not_started -> submitted -> under_review -> approved/rejected
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      verified_at TIMESTAMPTZ,
      verified_by TEXT, -- 'staff' (manual) or 'stripe_identity' (automated)
      stripe_session_id TEXT
    );

    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      position TEXT NOT NULL,
      club TEXT NOT NULL,
      birth_year INTEGER NOT NULL,
      guardian_id INTEGER REFERENCES guardians(id),
      profile_status TEXT NOT NULL, -- frozen: waiting on guardian review. No timeout — it just waits.
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      email TEXT
    );

    CREATE TABLE IF NOT EXISTS seasons (
      id SERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id),
      club TEXT NOT NULL,
      season_label TEXT NOT NULL,
      source_url TEXT NOT NULL,
      apps INTEGER NOT NULL DEFAULT 0,
      goals INTEGER NOT NULL DEFAULT 0,
      assists INTEGER NOT NULL DEFAULT 0,
      minutes INTEGER NOT NULL DEFAULT 0,
      verification_status TEXT NOT NULL DEFAULT 'submitted', -- submitted -> matching -> verified/unmatched
      verification_method TEXT, -- 'manual' for Phase 0, 'automated' later
      verified_at TIMESTAMPTZ,
      verified_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS scouts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      organization TEXT NOT NULL,
      role TEXT NOT NULL,
      public_profile_url TEXT,
      verification_status TEXT NOT NULL DEFAULT 'pending', -- pending -> ai_reviewed -> verified/flagged_for_human/rejected
      ai_confidence_score REAL,
      reviewed_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      email TEXT
    );

    -- Passwordless login: a login_token is a short-lived, single-use code
    -- emailed (or, without an email provider configured, shown directly) to
    -- prove someone controls an address; consuming one issues a session.
    CREATE TABLE IF NOT EXISTS login_tokens (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL, -- 'player' or 'scout'
      subject_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    -- A player's highlight reel: any number of linked (YouTube/Vimeo) or
    -- uploaded videos. 'upload' rows point at a file under data/uploads/ --
    -- local disk, which is fine for dev but won't survive most hosting
    -- platforms' ephemeral filesystems; swap for real object storage
    -- (S3/R2/Cloudinary) before deploying (see README).
    CREATE TABLE IF NOT EXISTS videos (
      id SERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id),
      source TEXT NOT NULL, -- 'youtube' | 'vimeo' | 'upload'
      url TEXT NOT NULL,
      title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE guardians ADD COLUMN IF NOT EXISTS verified_by TEXT;
    ALTER TABLE guardians ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
    ALTER TABLE guardians ADD COLUMN IF NOT EXISTS last_error TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS bio TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS photo_url TEXT;
    ALTER TABLE scouts ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE scouts ADD COLUMN IF NOT EXISTS bio TEXT;
    ALTER TABLE scouts ADD COLUMN IF NOT EXISTS photo_url TEXT;
    ALTER TABLE scouts ADD COLUMN IF NOT EXISTS looking_for TEXT;
  `);
}

// ---- Guardians ----
async function createGuardian({ name, email }) {
  const { rows } = await pool.query(
    `INSERT INTO guardians (name, email) VALUES ($1, $2) RETURNING *`,
    [name, email]
  );
  return rows[0];
}

async function approveGuardian(id, reviewer) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE guardians SET id_verification_status = 'approved', verified_at = now(), verified_by = $2
       WHERE id = $1 RETURNING *`,
      [id, reviewer || 'staff']
    );
    if (rows.length === 0) { await client.query('ROLLBACK'); return null; }
    // Flip any player waiting on this guardian to active
    await client.query(
      `UPDATE players SET profile_status = 'active' WHERE guardian_id = $1 AND profile_status = 'frozen'`,
      [id]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function rejectGuardian(id, reviewer) {
  const { rows } = await pool.query(
    `UPDATE guardians SET id_verification_status = 'rejected', verified_by = $2 WHERE id = $1 RETURNING *`,
    [id, reviewer || 'staff']
  );
  return rows[0] || null;
}

async function getGuardian(id) {
  const { rows } = await pool.query(`SELECT * FROM guardians WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function setGuardianStripeSession(id, sessionId) {
  const { rows } = await pool.query(
    `UPDATE guardians SET stripe_session_id = $2 WHERE id = $1 RETURNING *`,
    [id, sessionId]
  );
  return rows[0] || null;
}

async function setGuardianLastError(id, message) {
  const { rows } = await pool.query(
    `UPDATE guardians SET last_error = $2 WHERE id = $1 RETURNING *`,
    [id, message]
  );
  return rows[0] || null;
}

async function getPlayerByGuardian(guardianId) {
  const { rows } = await pool.query(`SELECT * FROM players WHERE guardian_id = $1 LIMIT 1`, [guardianId]);
  return rows[0] || null;
}

// ---- Players ----
async function createPlayer({ full_name, position, club, birth_year, guardian_id, email }) {
  const profileStatus = guardian_id ? 'frozen' : 'active';
  const { rows } = await pool.query(
    `INSERT INTO players (full_name, position, club, birth_year, guardian_id, profile_status, email)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [full_name, position, club, Number(birth_year), guardian_id || null, profileStatus, email || null]
  );
  return rows[0];
}

async function updatePlayerProfile(id, { bio, photo_url }) {
  const { rows } = await pool.query(
    `UPDATE players SET bio = $2, photo_url = $3 WHERE id = $1 RETURNING *`,
    [id, bio || null, photo_url || null]
  );
  return rows[0] || null;
}

// ---- Videos (a player's highlight reel) ----
async function addVideo({ player_id, source, url, title }) {
  const { rows } = await pool.query(
    `INSERT INTO videos (player_id, source, url, title) VALUES ($1, $2, $3, $4) RETURNING *`,
    [Number(player_id), source, url, title || null]
  );
  return rows[0];
}

async function videosForPlayer(playerId) {
  const { rows } = await pool.query(
    `SELECT * FROM videos WHERE player_id = $1 ORDER BY id DESC`, [playerId]
  );
  return rows;
}

async function getPlayer(id) {
  const { rows } = await pool.query(`SELECT * FROM players WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function listPlayers() {
  const { rows } = await pool.query(`SELECT * FROM players ORDER BY id`);
  return rows;
}

// ---- Seasons (stat submissions) ----
async function createSeason({ player_id, club, season_label, source_url, apps, goals, assists, minutes }) {
  const { rows } = await pool.query(
    `INSERT INTO seasons (player_id, club, season_label, source_url, apps, goals, assists, minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [Number(player_id), club, season_label, source_url,
     Number(apps) || 0, Number(goals) || 0, Number(assists) || 0, Number(minutes) || 0]
  );
  return rows[0];
}

async function verifySeason(id, reviewer) {
  const { rows } = await pool.query(
    `UPDATE seasons SET verification_status = 'verified', verification_method = 'manual',
       verified_at = now(), verified_by = $2
     WHERE id = $1 RETURNING *`,
    [id, reviewer || 'staff']
  );
  return rows[0] || null;
}

async function seasonsForPlayer(playerId) {
  const { rows } = await pool.query(
    `SELECT * FROM seasons WHERE player_id = $1 ORDER BY id`,
    [playerId]
  );
  return rows;
}

// ---- Scouts ----
async function createScout({ name, organization, role, public_profile_url, email }) {
  const { rows } = await pool.query(
    `INSERT INTO scouts (name, organization, role, public_profile_url, email)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, organization, role, public_profile_url, email || null]
  );
  return rows[0];
}

async function approveScout(id, reviewer) {
  const { rows } = await pool.query(
    `UPDATE scouts SET verification_status = 'verified', reviewed_by = $2
     WHERE id = $1 RETURNING *`,
    [id, reviewer || 'staff']
  );
  return rows[0] || null;
}

async function getScout(id) {
  const { rows } = await pool.query(`SELECT * FROM scouts WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function updateScoutProfile(id, { bio, photo_url, looking_for }) {
  const { rows } = await pool.query(
    `UPDATE scouts SET bio = $2, photo_url = $3, looking_for = $4 WHERE id = $1 RETURNING *`,
    [id, bio || null, photo_url || null, looking_for || null]
  );
  return rows[0] || null;
}

// ---- Admin queues ----
async function pendingGuardians() {
  const { rows } = await pool.query(
    `SELECT * FROM guardians WHERE id_verification_status = 'submitted' ORDER BY id`
  );
  return rows;
}

async function pendingSeasons() {
  const { rows } = await pool.query(
    `SELECT seasons.*, players.full_name AS player_full_name
     FROM seasons JOIN players ON players.id = seasons.player_id
     WHERE seasons.verification_status = 'submitted'
     ORDER BY seasons.id`
  );
  return rows;
}

async function pendingScouts() {
  const { rows } = await pool.query(
    `SELECT * FROM scouts WHERE verification_status = 'pending' ORDER BY id`
  );
  return rows;
}

// ---- Public search (only what a scout should ever see) ----
// filters: { position, club, birthYearMin, birthYearMax, minGoals } — all optional.
// position/club/birth-year are applied in SQL; minGoals is a per-season stat so
// it's applied after seasons are attached (a player matches if ANY verified
// season meets it).
async function searchablePlayers(filters = {}) {
  const { position, club, birthYearMin, birthYearMax, minGoals } = filters;
  const { rows: players } = await pool.query(
    `SELECT * FROM players
     WHERE profile_status = 'active'
       AND ($1::text IS NULL OR position = $1)
       AND ($2::text IS NULL OR club ILIKE '%' || $2 || '%')
       AND ($3::int IS NULL OR birth_year >= $3)
       AND ($4::int IS NULL OR birth_year <= $4)
     ORDER BY id`,
    [position || null, club || null, birthYearMin || null, birthYearMax || null]
  );
  const { rows: verifiedSeasons } = await pool.query(
    `SELECT * FROM seasons WHERE verification_status = 'verified' ORDER BY id`
  );
  const { rows: allVideos } = await pool.query(`SELECT * FROM videos ORDER BY id DESC`);
  return players
    .map(p => ({
      ...p,
      seasons: verifiedSeasons.filter(s => s.player_id === p.id),
      videos: allVideos.filter(v => v.player_id === p.id)
    }))
    .filter(p => p.seasons.length > 0)
    .filter(p => !minGoals || p.seasons.some(s => s.goals >= minGoals));
}

// ---- Auth: passwordless login + sessions ----

// Looks up whichever account (player or scout) owns this email. Case-insensitive.
// A real product would need to handle one email owning both a player and a
// scout account; for now the first match wins, which is fine at this scale.
async function findAccountByEmail(email) {
  const { rows: players } = await pool.query(
    `SELECT * FROM players WHERE lower(email) = lower($1) LIMIT 1`, [email]
  );
  if (players[0]) return { type: 'player', record: players[0] };
  const { rows: scouts } = await pool.query(
    `SELECT * FROM scouts WHERE lower(email) = lower($1) LIMIT 1`, [email]
  );
  if (scouts[0]) return { type: 'scout', record: scouts[0] };
  return null;
}

async function createLoginToken(email) {
  const token = crypto.randomBytes(24).toString('base64url');
  await pool.query(
    `INSERT INTO login_tokens (token, email, expires_at) VALUES ($1, $2, now() + interval '15 minutes')`,
    [token, email]
  );
  return token;
}

// Single-use: an already-consumed or expired token returns null.
async function consumeLoginToken(token) {
  const { rows } = await pool.query(
    `UPDATE login_tokens SET used_at = now()
     WHERE token = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING email`,
    [token]
  );
  return rows[0] ? rows[0].email : null;
}

async function createSession(subjectType, subjectId) {
  const id = crypto.randomBytes(24).toString('base64url');
  await pool.query(
    `INSERT INTO sessions (id, subject_type, subject_id, expires_at) VALUES ($1, $2, $3, now() + interval '30 days')`,
    [id, subjectType, subjectId]
  );
  return id;
}

// Returns { type, record } for a valid, unexpired session, or null.
async function getSession(sessionId) {
  const { rows } = await pool.query(
    `SELECT * FROM sessions WHERE id = $1 AND expires_at > now()`, [sessionId]
  );
  const session = rows[0];
  if (!session) return null;
  const record = session.subject_type === 'player'
    ? await getPlayer(session.subject_id)
    : await getScout(session.subject_id);
  if (!record) return null;
  return { type: session.subject_type, record };
}

async function deleteSession(sessionId) {
  await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

// Real counts for the homepage ticker — no placeholder numbers.
async function stats() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(DISTINCT player_id) FROM seasons WHERE verification_status = 'verified')::int AS verified_players,
      (SELECT COUNT(*) FROM scouts WHERE verification_status = 'verified')::int AS verified_scouts,
      ((SELECT COUNT(*) FROM guardians WHERE id_verification_status = 'submitted')
        + (SELECT COUNT(*) FROM seasons WHERE verification_status = 'submitted')
        + (SELECT COUNT(*) FROM scouts WHERE verification_status = 'pending'))::int AS pending_reviews
  `);
  return rows[0];
}

module.exports = {
  init, stats,
  createGuardian, approveGuardian, rejectGuardian, getGuardian,
  setGuardianStripeSession, setGuardianLastError, getPlayerByGuardian,
  createPlayer, getPlayer, listPlayers, updatePlayerProfile,
  createSeason, verifySeason, seasonsForPlayer,
  createScout, approveScout, getScout, updateScoutProfile,
  addVideo, videosForPlayer,
  pendingGuardians, pendingSeasons, pendingScouts,
  searchablePlayers,
  findAccountByEmail, createLoginToken, consumeLoginToken,
  createSession, getSession, deleteSession
};
