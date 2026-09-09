// Tiny server-rendered HTML helpers — no template engine dependency needed.
// Visual language (colors, type, cards, badges) ported from the design
// mockups (verifiedxi-mockup*.html) into this real, multi-page site.

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const CHECK_ICON = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3"><path d="M4 12l5 5L20 6"/></svg>';
const CLOCK_ICON = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
const CROSS_ICON = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function layout(title, bodyHtml, session) {
  const accountNav = session
    ? `<a href="/${session.type}/${session.record.id}">My ${session.type === 'player' ? 'profile' : 'account'}</a><a href="/logout">Log out</a>`
    : `<a href="/login">Log in</a>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} · VerifiedXI</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

:root{
  --pitch-dark:#132A24; --pitch:#1F4B3F; --turf:#3A7D5C; --turf-light:#5CA680;
  --chalk:#F5F2E9; --paper:#FCFAF4; --ink:#152420; --ink-soft:#5B6B65;
  --gold:#C89B3C; --gold-soft:#E8D9B0; --line:#DCD6C4;
  --radius:16px; --shadow:0 16px 34px -18px rgba(19,42,36,0.35);
}
*{box-sizing:border-box;}
body{margin:0;font-family:'Inter',-apple-system,Arial,sans-serif;background:var(--paper);color:var(--ink);}

.topbar{
  background:var(--pitch-dark);color:var(--chalk);
  padding:14px 24px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
}
.topbar .mark{
  width:28px;height:28px;border-radius:50%;border:2px solid var(--gold);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
}
.topbar .word{font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:1px;}
.topbar .tag{
  font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:1.4px;text-transform:uppercase;
  color:var(--gold-soft);border-left:1px solid rgba(245,242,233,0.3);padding-left:10px;opacity:0.85;
}
.topbar nav{margin-left:auto;display:flex;gap:4px;flex-wrap:wrap;}
.topbar a{
  color:var(--chalk);text-decoration:none;font-weight:600;font-size:13px;
  padding:8px 12px;border-radius:20px;opacity:0.75;transition:opacity 0.15s,background 0.15s;
}
.topbar a:hover{opacity:1;background:rgba(245,242,233,0.08);}

.wrap{max-width:640px;margin:0 auto;padding:40px 20px 90px;}

.eyebrow{
  font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:1.8px;text-transform:uppercase;
  color:var(--turf);font-weight:600;margin-bottom:6px;
}
h1{font-family:'Bebas Neue',sans-serif;font-size:36px;letter-spacing:0.4px;line-height:1.05;margin:0 0 8px;}
.sub{color:var(--ink-soft);font-size:14.5px;margin-bottom:28px;line-height:1.55;}

label{display:block;font-size:11.5px;font-weight:600;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.6px;margin:16px 0 7px;}
input, select{
  width:100%;padding:12px 14px;border:1.5px solid var(--line);border-radius:10px;
  font-size:14.5px;font-family:inherit;background:var(--chalk);color:var(--ink);
}
input:focus-visible, select:focus-visible, button:focus-visible, a.btn:focus-visible{
  outline:2.5px solid var(--gold);outline-offset:2px;
}

button, .btn{
  display:inline-flex;align-items:center;gap:8px;background:var(--pitch);color:var(--chalk);
  border:none;padding:13px 22px;border-radius:12px;font-size:14.5px;font-weight:600;
  cursor:pointer;text-decoration:none;margin-top:18px;font-family:inherit;
  transition:background 0.15s ease, transform 0.1s ease;
}
button:hover, .btn:hover{background:var(--turf);}
button:active, .btn:active{transform:scale(0.98);}
button.secondary, .btn.secondary{background:transparent;color:var(--pitch);border:1.5px solid var(--line);}
button.secondary:hover, .btn.secondary:hover{background:transparent;border-color:var(--turf);}
button.danger{background:transparent;color:#C74B3D;border:1.5px solid #E2A79E;}
button.danger:hover{background:#FBEAEA;}

.card{background:var(--chalk);border:1.5px solid var(--line);border-radius:var(--radius);padding:20px;margin-bottom:16px;}
.row{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;}

.badge{
  display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;border-radius:20px;
  padding:4px 10px 4px 7px;font-family:'IBM Plex Mono',monospace;letter-spacing:0.3px;
}
.badge.ok{background:#EAF3EC;color:var(--pitch);border:1.3px solid var(--turf-light);}
.badge.wait{background:#FBF3DE;color:#8A6A22;border:1.3px solid var(--gold);}
.badge.no{background:#FBEAEA;color:#A5352A;border:1.3px solid #E2A79E;}

.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px;}
.stat-box{background:var(--paper);border-radius:10px;padding:10px 4px;text-align:center;}
.stat-box b{display:block;font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:18px;color:var(--pitch);}
.stat-box span{font-size:9px;text-transform:uppercase;letter-spacing:0.4px;color:var(--ink-soft);}

.hint{font-size:12.5px;color:var(--ink-soft);margin-top:8px;line-height:1.5;}
.section-title{font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:var(--turf);font-weight:700;margin:32px 0 12px;}
code{background:var(--paper);padding:2px 6px;border-radius:4px;font-size:12px;font-family:'IBM Plex Mono',monospace;}

/* Landing tap-cards */
.tap-card{
  display:flex;align-items:center;gap:14px;background:var(--chalk);border:1.5px solid var(--line);
  border-radius:var(--radius);padding:18px;margin-bottom:14px;text-decoration:none;color:inherit;
  transition:border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}
.tap-card:hover{border-color:var(--turf);transform:translateY(-2px);box-shadow:var(--shadow);}
.tap-card .icon{
  width:44px;height:44px;border-radius:12px;background:var(--pitch);color:var(--gold-soft);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
}
.tap-card .title{font-weight:700;font-size:15.5px;margin-bottom:2px;}
.tap-card .desc{font-size:12.5px;color:var(--ink-soft);}
.tap-card .chev{margin-left:auto;color:var(--ink-soft);font-size:20px;flex-shrink:0;}

/* Ticker */
.ticker{display:flex;background:var(--pitch);border-radius:14px;padding:16px 6px;margin-bottom:26px;}
.ticker .tstat{text-align:center;flex:1;}
.ticker .tnum{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:21px;color:var(--gold-soft);}
.ticker .tlbl{font-size:9.5px;text-transform:uppercase;letter-spacing:0.4px;color:rgba(245,242,233,0.65);margin-top:4px;}
.ticker .tdiv{width:1px;background:rgba(245,242,233,0.15);margin:2px 2px;}

/* Avatar / jersey badge */
.avatar{
  width:46px;height:46px;border-radius:12px;flex-shrink:0;
  background:linear-gradient(160deg,var(--pitch),var(--pitch-dark));color:var(--gold-soft);
  display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:19px;
  box-shadow:inset 0 0 0 1.5px rgba(232,217,176,0.35);
}
.profile-head{display:flex;gap:14px;align-items:center;margin-bottom:22px;}
.profile-head .name{font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:0.3px;line-height:1;}
.profile-head .meta{font-size:12.5px;color:var(--ink-soft);margin-top:5px;}

/* Player search rows */
.player-row{
  display:flex;align-items:center;gap:12px;background:var(--chalk);border:1.5px solid var(--line);
  border-radius:14px;padding:14px;margin-bottom:10px;
}
.player-row .rname{font-weight:700;font-size:14.5px;}
.player-row .rmeta{font-size:12px;color:var(--ink-soft);margin-top:2px;}
</style>
</head>
<body>
  <div class="topbar">
    <div class="mark"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--gold)" stroke-width="2.6"><path d="M4 12l5 5L20 6"/></svg></div>
    <div class="word">VERIFIEDXI</div>
    <div class="tag">Phase 1</div>
    <nav>
      <a href="/player/new">Player signup</a>
      <a href="/scout/new">Scout signup</a>
      <a href="/scouts">Search players</a>
      <a href="/admin">Admin</a>
      ${accountNav}
    </nav>
  </div>
  <div class="wrap">${bodyHtml}</div>
</body>
</html>`;
}

function statusBadge(status) {
  const map = {
    active: ['ok', CHECK_ICON, 'ACTIVE'], verified: ['ok', CHECK_ICON, 'VERIFIED'], approved: ['ok', CHECK_ICON, 'APPROVED'],
    frozen: ['wait', CLOCK_ICON, 'FROZEN'], submitted: ['wait', CLOCK_ICON, 'SUBMITTED'], pending: ['wait', CLOCK_ICON, 'PENDING'],
    ai_reviewed: ['wait', CLOCK_ICON, 'AI REVIEWED'], matching: ['wait', CLOCK_ICON, 'MATCHING'],
    rejected: ['no', CROSS_ICON, 'REJECTED'], unmatched: ['no', CROSS_ICON, 'UNMATCHED'], flagged_for_human: ['no', CROSS_ICON, 'FLAGGED']
  };
  const [cls, icon, label] = map[status] || ['wait', CLOCK_ICON, status.toUpperCase()];
  return `<span class="badge ${cls}">${icon}${label}</span>`;
}

// Two-letter initials for the jersey/avatar badge, e.g. "Toms Ozoliņš" -> "TO".
function initials(fullName) {
  return String(fullName || '')
    .trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

module.exports = { layout, escapeHtml, statusBadge, initials };
