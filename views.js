// Tiny server-rendered HTML helpers — no template engine dependency needed.

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function layout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} · VerifiedXI</title>
<style>
  :root{
    --pitch-dark:#132A24; --pitch:#1F4B3F; --turf:#3A7D5C; --turf-light:#5CA680;
    --chalk:#F5F2E9; --paper:#FCFAF4; --ink:#152420; --ink-soft:#5B6B65;
    --gold:#C89B3C; --gold-soft:#E8D9B0; --line:#DCD6C4;
  }
  *{box-sizing:border-box;}
  body{margin:0;font-family:-apple-system,'Inter',Arial,sans-serif;background:var(--paper);color:var(--ink);}
  .topbar{background:var(--pitch-dark);color:var(--chalk);padding:14px 24px;display:flex;align-items:center;gap:10px;}
  .topbar .mark{width:26px;height:26px;border-radius:8px;background:linear-gradient(160deg,var(--turf),var(--pitch-dark));display:flex;align-items:center;justify-content:center;}
  .topbar a{color:var(--chalk);text-decoration:none;font-weight:600;font-size:14px;margin-left:18px;opacity:0.8;}
  .topbar a:hover{opacity:1;}
  .wrap{max-width:640px;margin:0 auto;padding:36px 20px 80px;}
  h1{font-size:24px;margin:0 0 6px;}
  .sub{color:var(--ink-soft);font-size:14px;margin-bottom:26px;line-height:1.5;}
  label{display:block;font-size:12px;font-weight:600;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 6px;}
  input, select{width:100%;padding:11px 13px;border:1.5px solid var(--line);border-radius:8px;font-size:14px;background:var(--chalk);color:var(--ink);}
  button, .btn{display:inline-block;background:var(--pitch);color:var(--chalk);border:none;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;margin-top:18px;}
  button.secondary, .btn.secondary{background:transparent;color:var(--pitch);border:1.5px solid var(--line);}
  button.danger{background:#C74B3D;}
  .card{background:var(--chalk);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:14px;}
  .badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;border-radius:20px;padding:4px 10px;font-family:monospace;}
  .badge.ok{background:#EAF3EC;color:var(--pitch);border:1px solid var(--turf-light);}
  .badge.wait{background:#FBF3DE;color:#8A6A22;border:1px solid var(--gold);}
  .badge.no{background:#FBEAEA;color:#A5352A;border:1px solid #E2A79E;}
  .row{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;}
  .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px;}
  .stat-box{background:var(--paper);border-radius:8px;padding:8px;text-align:center;}
  .stat-box b{display:block;font-size:16px;color:var(--pitch);}
  .stat-box span{font-size:9px;text-transform:uppercase;color:var(--ink-soft);}
  .hint{font-size:12px;color:var(--ink-soft);margin-top:6px;line-height:1.4;}
  .section-title{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--turf);font-weight:700;margin:30px 0 10px;}
  code{background:var(--paper);padding:2px 6px;border-radius:4px;font-size:12px;}
</style>
</head>
<body>
  <div class="topbar">
    <div class="mark"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#E8D9B0" stroke-width="2.6"><path d="M4 12l5 5L20 6"/></svg></div>
    VerifiedXI · Phase 0
    <a href="/player/new">Player signup</a>
    <a href="/scout/new">Scout signup</a>
    <a href="/scouts">Search players</a>
    <a href="/admin">Admin</a>
  </div>
  <div class="wrap">${bodyHtml}</div>
</body>
</html>`;
}

function statusBadge(status) {
  const map = {
    active: ['ok', 'ACTIVE'], verified: ['ok', 'VERIFIED'], approved: ['ok', 'APPROVED'],
    frozen: ['wait', 'FROZEN'], submitted: ['wait', 'SUBMITTED'], pending: ['wait', 'PENDING'],
    ai_reviewed: ['wait', 'AI REVIEWED'], matching: ['wait', 'MATCHING'],
    rejected: ['no', 'REJECTED'], unmatched: ['no', 'UNMATCHED'], flagged_for_human: ['no', 'FLAGGED']
  };
  const [cls, label] = map[status] || ['wait', status.toUpperCase()];
  return `<span class="badge ${cls}">${label}</span>`;
}

module.exports = { layout, escapeHtml, statusBadge };
