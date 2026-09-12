// Privacy Policy and Terms of Service content. English only for now — see
// the note embedded in each page; translating legal text accurately into
// Latvian/Russian is a real, separate effort that deserves care, not a
// mechanical pass through i18n.js like the rest of the UI.
//
// IMPORTANT: this is a genuine starting point, written to accurately reflect
// what this specific app actually does and which third parties it actually
// uses — it is NOT a substitute for review by an actual lawyer, especially
// given this service handles minors' personal data under GDPR. Update the
// [PLACEHOLDER] fields before relying on this for real.

const LAST_UPDATED = '12 September 2026';

function privacyPolicyHtml() {
  return `
    <div class="eyebrow">Legal</div>
    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: ${LAST_UPDATED} · English only for now — this document has not yet been translated into Latvian or Russian.</p>

    <div class="legal">
      <p><strong>This is a starting template, not a substitute for legal advice.</strong> VerifiedXI handles personal data belonging to minors (youth football players) and their guardians. Before relying on this document for a real, public product, have it reviewed by a lawyer familiar with GDPR and, specifically, the additional protections that apply to children's data (GDPR Article 8). The [PLACEHOLDER] fields below need to be filled in with real information.</p>

      <h2>Who runs this</h2>
      <p>VerifiedXI is operated by [PLACEHOLDER: your name or legal entity name], contactable at [PLACEHOLDER: a real email address]. For the purposes of GDPR, this entity is the "data controller" of the personal data described below.</p>

      <h2>What we collect</h2>
      <p>What we collect depends on which kind of account you have:</p>
      <ul>
        <li><strong>Players:</strong> full name, position, club, birth year, email address, and optionally a bio, a profile photo (as a link you provide), and highlight videos (either a link you paste, or a video file you upload).</li>
        <li><strong>Guardians</strong> (required for a player under 18): name and email address. Your government ID itself is <strong>never sent to or stored by VerifiedXI</strong> — when you complete identity verification, your documents go directly to Stripe, our identity verification provider, under their own privacy practices. VerifiedXI only ever receives Stripe's yes/no result.</li>
        <li><strong>Scouts:</strong> name, organization, role, email address, and optionally a bio, a profile photo, a public profile link, and a description of who you're looking for.</li>
        <li><strong>Everyone:</strong> the season/stats records you or others submit (including a public source link, e.g. to lff.lv, that anyone reviewing the record can already see), and basic technical data needed to keep you signed in (a session cookie, login link tokens).</li>
      </ul>

      <h2>Children's data and guardian consent</h2>
      <p>A player profile for someone under 18 cannot go live, or appear in scout search, until a guardian completes identity verification and approves it. This is the mechanism by which we obtain verifiable guardian consent for a minor's data before it's used or shown to anyone, as required by GDPR Article 8. A guardian can decline verification at any time, which keeps the profile frozen and invisible to scouts indefinitely.</p>

      <h2>Why we process this data</h2>
      <ul>
        <li><strong>Consent</strong> — you (or a player's guardian) explicitly signed up and agreed to this policy.</li>
        <li><strong>Contract</strong> — to actually provide the service you signed up for (a searchable, verified player profile; scout search access).</li>
      </ul>

      <h2>Who we share data with</h2>
      <p>We use a small number of specialist providers to run VerifiedXI, each of which processes a limited slice of your data on our behalf:</p>
      <ul>
        <li><strong>Stripe</strong> — identity verification for guardians (receives the guardian's ID document directly; VerifiedXI does not).</li>
        <li><strong>Resend</strong> — sends the sign-in link email to your address when you log in.</li>
        <li><strong>Cloudinary</strong> — stores uploaded highlight video files.</li>
        <li><strong>Supabase</strong> — hosts our database (everything described above).</li>
        <li><strong>Render</strong> — hosts the application itself.</li>
      </ul>
      <p>We do not sell personal data, and we do not share it with anyone for advertising purposes. A scout who finds a player through search never receives that player's direct contact details — any contact is directed to the player's club, not the player, by design.</p>

      <h2>How long we keep it</h2>
      <p>[PLACEHOLDER: define a real retention period — e.g. "for as long as your account is active, or until you ask us to delete it"]. <strong>Known gap:</strong> as of this writing, VerifiedXI does not yet have a self-service "delete my account" feature — if you want your data removed, contact [PLACEHOLDER: email] directly and it will be deleted manually. Building a real self-service deletion flow is a known open item, not something to promise as already working.</p>

      <h2>Your rights</h2>
      <p>Under GDPR, you have the right to access, correct, delete, or export your personal data, and to object to or restrict how it's processed. To exercise any of these, contact [PLACEHOLDER: email]. You also have the right to lodge a complaint with your national data protection authority — in Latvia, the <a href="https://www.dvi.gov.lv" target="_blank" rel="noopener">Data State Inspectorate (DVI)</a>; in Lithuania, the <a href="https://vdai.lrv.lt" target="_blank" rel="noopener">State Data Protection Inspectorate (VDAI)</a>; in Estonia, the <a href="https://www.aki.ee" target="_blank" rel="noopener">Data Protection Inspectorate (AKI)</a>.</p>

      <h2>Cookies</h2>
      <p>VerifiedXI uses one cookie to keep you signed in (<code>vxi_session</code>) and one to remember your language preference (<code>vxi_lang</code>). Both are strictly necessary for the site to function — we don't use analytics, advertising, or tracking cookies, so there's nothing here that needs a cookie-consent banner.</p>

      <h2>Changes to this policy</h2>
      <p>If this policy changes materially, the "last updated" date at the top will change accordingly.</p>
    </div>
  `;
}

function termsOfServiceHtml() {
  return `
    <div class="eyebrow">Legal</div>
    <h1>Terms of Service</h1>
    <p class="updated">Last updated: ${LAST_UPDATED} · English only for now — this document has not yet been translated into Latvian or Russian.</p>

    <div class="legal">
      <p><strong>This is a starting template, not a substitute for legal advice.</strong> Have it reviewed by a lawyer before relying on it for a real, public product. The [PLACEHOLDER] fields below need to be filled in with real information.</p>

      <h2>What VerifiedXI is</h2>
      <p>VerifiedXI is a platform where youth football players in Latvia, Lithuania, and Estonia can build a profile with stats checked against their federation's own records, and where scouts can search for players once their own account is reviewed and approved.</p>

      <h2>Accounts and eligibility</h2>
      <ul>
        <li>A player profile for someone under 18 requires a guardian to complete identity verification and approve it before the profile is usable. By submitting a guardian's details, you confirm you are that player's parent or legal guardian, or are acting with their authorization.</li>
        <li>Scouts must provide accurate information about themselves and their organization. Scout accounts are reviewed before search access is granted, and can be rejected or later revoked at our discretion.</li>
        <li>You're responsible for keeping your own account's sign-in email accessible, since that's how you log back in.</li>
      </ul>

      <h2>What you agree not to do</h2>
      <ul>
        <li>Submit stats, links, or information you know to be false.</li>
        <li>Create an account impersonating someone else, or a player profile for a real child without the actual guardian's knowledge and consent.</li>
        <li>Use a scout account to contact a player directly rather than through their club, or to use player data for any purpose other than genuine scouting.</li>
        <li>Attempt to scrape, bulk-download, or otherwise extract data from the platform outside of normal use.</li>
        <li>Upload video content you don't have the right to share, or that is otherwise unlawful, harassing, or inappropriate.</li>
      </ul>

      <h2>Verification is not a guarantee</h2>
      <p>A "verified" stat means a staff member manually checked the submitted figures against the linked federation page at the time of review. It reflects a real check, but VerifiedXI cannot guarantee that source data was itself never in error, or that it hasn't changed since. Guardian ID verification is performed by Stripe Identity; VerifiedXI relies on their result and does not independently re-verify identity documents.</p>

      <h2>Account termination</h2>
      <p>We may suspend or remove an account that violates these terms, submits fraudulent information, or where a guardian withdraws consent for a minor's profile. You may ask us to delete your account and data at any time by contacting [PLACEHOLDER: email] (see the Privacy Policy for the current state of account deletion).</p>

      <h2>No warranty, limitation of liability</h2>
      <p>VerifiedXI is provided "as is," in active early development, without warranty of any kind. [PLACEHOLDER: this section in particular should be drafted or reviewed by an actual lawyer for your jurisdiction rather than relied on as written here.]</p>

      <h2>Governing law</h2>
      <p>[PLACEHOLDER: state which country's law governs these terms — e.g. Latvia, if that's where the operating entity is based.]</p>

      <h2>Contact</h2>
      <p>Questions about these terms: [PLACEHOLDER: a real email address].</p>
    </div>
  `;
}

module.exports = { privacyPolicyHtml, termsOfServiceHtml };
