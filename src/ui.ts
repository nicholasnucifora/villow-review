export const reviewHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Villow extension review</title>
  <meta name="description" content="Private review queue for the Villow browser extension.">
  <link rel="stylesheet" href="/assets/review.css">
  <script src="/assets/review.js" defer></script>
</head>
<body>
  <header class="masthead">
    <a class="brand" href="/" aria-label="Villow extension review home">
      <span class="brand-mark" aria-hidden="true"><span></span><span></span></span>
      <span>Villow</span>
    </a>
    <span class="environment-label">Extension review</span>
  </header>

  <main>
    <section id="loading" class="center-card" aria-live="polite">
      <div class="loader" aria-hidden="true"></div>
      <p>Checking your review session…</p>
    </section>

    <section id="invite-view" class="invite-layout" hidden>
      <div class="intro-copy">
        <p class="eyebrow">Private test surface</p>
        <h1>Villow extension review</h1>
        <p class="lede">This limited queue is used to test the Villow browser extension. It is separate from the full Villow application.</p>
        <div class="privacy-note">
          <span aria-hidden="true">↗</span>
          <p>Google access is used only to identify you and read your YouTube subscriptions. Videos are saved only when you choose them in the extension.</p>
        </div>
      </div>
      <form id="invite-form" class="invite-card">
        <div>
          <p class="step-label">Invitation required</p>
          <h2>Open your review</h2>
          <p>Paste the private review invitation you were given. After signing in with Google, you’ll be able to connect the extension and see videos added during this review.</p>
        </div>
        <label for="invitation">Complete private invitation link</label>
        <input id="invitation" name="invitation" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://review.villow.app/#villow_invite=…" required>
        <p class="field-note">This link is private. Do not share it or paste it into another site.</p>
        <p id="invite-error" class="form-error" role="alert" hidden></p>
        <button class="primary-button" type="submit">Open invitation <span aria-hidden="true">→</span></button>
      </form>
      <div id="google-card" class="invite-card" hidden>
        <div>
          <p class="step-label">Invitation accepted</p>
          <h2>Continue to your review</h2>
          <p>Sign in with the dedicated review account to connect YouTube subscription access.</p>
        </div>
        <p id="google-error" class="form-error" role="alert" hidden></p>
        <button id="continue-google" class="primary-button" type="button">Continue with Google <span aria-hidden="true">→</span></button>
      </div>
    </section>

    <section id="review-view" class="review-shell" hidden>
      <div class="review-heading">
        <div>
          <p class="eyebrow">Private reviewer workspace</p>
          <h1>Your review queue</h1>
          <p id="reviewer-label" class="reviewer-label"></p>
        </div>
        <div class="heading-actions">
          <button id="refresh-queue" class="quiet-button" type="button">Refresh queue</button>
          <button id="sign-out" class="quiet-button" type="button">Sign out</button>
        </div>
      </div>

      <div id="notice" class="notice" role="status" hidden></div>

      <section class="connection-panel" aria-labelledby="connection-title">
        <div class="connection-status">
          <span id="google-status-dot" class="status-dot" aria-hidden="true"></span>
          <div>
            <p class="step-label">Google subscription access</p>
            <h2 id="connection-title">Checking connection…</h2>
            <p id="subscription-detail">Loading the last successful refresh.</p>
          </div>
        </div>
        <button id="reconnect-google" class="secondary-button" type="button" hidden>Reconnect Google</button>
      </section>

      <section class="connect-panel" aria-labelledby="connect-title">
        <div>
          <p class="step-label">Extension connection</p>
          <h2 id="connect-title">Connect Extension</h2>
          <p>Generate a one-time display of the private connect link, then paste it into the extension. Creating a new link does not expose Google credentials.</p>
        </div>
        <button id="create-connect-link" class="primary-button compact" type="button">Generate connect link</button>
        <div id="connect-link-box" class="connect-link-box" hidden>
          <label for="connect-link">Private extension connect link</label>
          <div class="copy-row">
            <input id="connect-link" type="text" readonly>
            <button id="copy-connect-link" class="secondary-button" type="button">Copy</button>
          </div>
          <p class="field-note">Shown once. Generate a new link if this one is lost.</p>
        </div>
        <div id="token-list" class="token-list" aria-live="polite"></div>
      </section>

      <section class="queue-section" aria-labelledby="queue-title">
        <div class="section-heading">
          <div>
            <p class="step-label">Saved from YouTube</p>
            <h2 id="queue-title">Videos</h2>
          </div>
          <span id="queue-count" class="count-pill">0</span>
        </div>
        <p class="queue-sync-note">Checks for new saves every 5 seconds while this tab is visible. <span id="queue-sync-status">Checking…</span></p>
        <div id="queue-error" class="inline-error" role="alert" hidden></div>
        <div id="queue-list" class="queue-grid"></div>
        <div id="queue-empty" class="empty-state" hidden>
          <span class="empty-icon" aria-hidden="true">＋</span>
          <h3>No videos saved yet</h3>
          <p>Connect the extension, then choose an eligible YouTube video. It will appear here after the extension confirms the save.</p>
        </div>
      </section>

      <aside class="privacy-strip">
        <p><strong>What is stored:</strong> subscription channel IDs with limited channel metadata, and videos you explicitly save to this temporary queue.</p>
        <p>Queue saves use only metadata sent by the extension. They do not call Google, YouTube APIs, oEmbed, or other enrichment services.</p>
      </aside>

      <section class="danger-zone" aria-labelledby="forget-title">
        <div><h2 id="forget-title">Finish this review</h2><p>“Forget this review” permanently deletes this reviewer’s queue, connection links, sessions, subscription cache, and encrypted Google tokens.</p></div>
        <button id="forget-review" class="danger-button" type="button">Forget this review</button>
      </section>
    </section>
  </main>

  <footer><span>Temporary, invite-only review environment</span><span>Villow is not affiliated with Google or YouTube.</span></footer>
</body>
</html>`;

export const reviewCss = `
:root { color-scheme: light; --ink:#18212b; --muted:#607080; --paper:#f7f8fa; --surface:#fff; --line:#dfe5e9; --accent:#c93632; --accent-dark:#9d2725; --navy:#162431; --mint:#3aa77e; --shadow:0 20px 60px rgba(15,32,45,.09); font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
* { box-sizing:border-box; }
body { margin:0; min-height:100vh; background:var(--paper); color:var(--ink); font-size:16px; line-height:1.55; }
button,input { font:inherit; }
button { cursor:pointer; }
button:focus-visible,input:focus-visible,a:focus-visible { outline:3px solid rgba(201,54,50,.28); outline-offset:2px; }
.masthead { height:76px; padding:0 clamp(20px,5vw,72px); display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--line); background:rgba(255,255,255,.9); }
.brand { display:inline-flex; gap:10px; align-items:center; color:var(--ink); font-weight:760; font-size:1.18rem; letter-spacing:-.02em; text-decoration:none; }
.brand-mark { position:relative; width:28px; height:28px; display:grid; place-items:center; border-radius:8px; background:var(--accent); overflow:hidden; transform:rotate(-3deg); }
.brand-mark span { position:absolute; width:6px; height:17px; border-radius:6px; background:#fff; transform:rotate(-25deg); }
.brand-mark span:first-child { translate:-4px -2px; }.brand-mark span:last-child { translate:5px 3px; height:12px; }
.environment-label { color:var(--muted); font-size:.82rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
main { width:min(1180px,calc(100% - 40px)); margin:0 auto; }
.center-card { min-height:70vh; display:grid; place-content:center; justify-items:center; color:var(--muted); }
.loader { width:30px;height:30px;border:3px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
.invite-layout { min-height:calc(100vh - 150px); display:grid; grid-template-columns:minmax(0,1.1fr) minmax(360px,.9fr); gap:clamp(40px,8vw,110px); align-items:center; padding:72px 0; }
.intro-copy { max-width:610px; }.intro-copy h1,.review-heading h1 { margin:.12em 0 .35em; font-size:clamp(2.8rem,6vw,5.5rem); line-height:.95; letter-spacing:-.065em; text-wrap:balance; }
.lede { max-width:560px; color:var(--muted); font-size:1.18rem; }
.eyebrow,.step-label { margin:0; color:var(--accent); font-size:.76rem; font-weight:800; letter-spacing:.115em; text-transform:uppercase; }
.privacy-note { margin-top:34px; padding-top:24px; border-top:1px solid var(--line); display:flex; gap:14px; color:var(--muted); max-width:560px; }.privacy-note span { color:var(--accent); font-weight:800; }.privacy-note p { margin:0; }
.invite-card,.connect-panel { background:var(--surface); border:1px solid var(--line); box-shadow:var(--shadow); border-radius:18px; padding:clamp(24px,4vw,42px); }
.invite-card { display:grid; gap:18px; }.invite-card h2,.connect-panel h2,.connection-panel h2,.section-heading h2,.danger-zone h2 { margin:.2rem 0 .3rem; font-size:1.42rem; letter-spacing:-.025em; }.invite-card p,.connect-panel p,.connection-panel p,.danger-zone p { margin:.25rem 0; color:var(--muted); }
label { font-size:.88rem; font-weight:750; }
input { min-width:0; width:100%; border:1px solid #cbd4da; border-radius:9px; padding:13px 14px; color:var(--ink); background:#fff; }
input::placeholder { color:#96a2ac; }
.field-note { font-size:.83rem; color:var(--muted); }
.form-error,.inline-error { color:#8d2421; background:#fff0ef; border:1px solid #f1c9c7; border-radius:8px; padding:10px 12px; margin:0; }
.primary-button,.secondary-button,.quiet-button,.danger-button { min-height:44px; border-radius:9px; padding:10px 16px; font-weight:750; border:1px solid transparent; transition:transform .15s ease,background .15s ease; }
.primary-button { background:var(--accent); color:white; display:flex; justify-content:space-between; align-items:center; }.primary-button:hover { background:var(--accent-dark); transform:translateY(-1px); }.primary-button.compact { justify-content:center; white-space:nowrap; align-self:start; }
.secondary-button,.quiet-button { background:#fff; border-color:#cfd7dc; color:var(--ink); }.secondary-button:hover,.quiet-button:hover { background:#f3f5f6; }
.review-shell { padding:54px 0 90px; }
.review-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; margin-bottom:34px; }.review-heading h1 { font-size:clamp(2.5rem,5vw,4.8rem); }.reviewer-label { color:var(--muted); margin:0; }.heading-actions { display:flex; gap:10px; flex-wrap:wrap; }
.notice { margin-bottom:18px; padding:12px 14px; border-radius:9px; background:#eaf7f1; border:1px solid #bfe3d4; color:#1f6f53; }
.notice.error { color:#8d2421; background:#fff0ef; border-color:#f1c9c7; }
.connection-panel { background:var(--navy); color:#fff; border-radius:18px; padding:28px 30px; display:flex; justify-content:space-between; align-items:center; gap:24px; }.connection-status { display:flex; gap:18px; align-items:flex-start; }.connection-panel p { color:#b7c4cd; }.connection-panel .step-label { color:#82d4b4; }
.status-dot { width:12px; height:12px; border-radius:50%; background:#e6ab3c; box-shadow:0 0 0 6px rgba(230,171,60,.13); margin-top:9px; flex:0 0 auto; }.status-dot.good { background:#50c696; box-shadow:0 0 0 6px rgba(80,198,150,.14); }.status-dot.bad { background:#ff716b; box-shadow:0 0 0 6px rgba(255,113,107,.14); }
.connect-panel { margin-top:18px; display:grid; grid-template-columns:1fr auto; gap:22px 28px; align-items:center; box-shadow:none; }.connect-link-box,.token-list { grid-column:1/-1; }.connect-link-box { border-top:1px solid var(--line); padding-top:20px; }.copy-row { display:grid; grid-template-columns:1fr auto; gap:8px; margin-top:8px; }
.token-list { display:grid; gap:8px; }.token-row { display:grid; grid-template-columns:1fr auto; gap:14px; align-items:center; padding:12px 0; border-top:1px solid var(--line); }.token-row p { margin:0; }.token-meta { font-size:.82rem; color:var(--muted); }.token-row button { min-height:36px; padding:6px 10px; }
.queue-section { margin-top:52px; }.section-heading { display:flex; align-items:end; justify-content:space-between; border-bottom:1px solid var(--line); padding-bottom:14px; margin-bottom:18px; }.count-pill { min-width:34px; padding:5px 10px; text-align:center; color:#fff; background:var(--navy); border-radius:999px; font-size:.86rem; font-weight:800; }
.queue-sync-note { margin:-6px 0 18px; color:var(--muted); font-size:.83rem; }
.queue-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }.video-card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:12px; display:grid; grid-template-columns:150px minmax(0,1fr); gap:16px; }.video-thumb { width:150px; aspect-ratio:16/9; object-fit:cover; border-radius:9px; background:#e6eaed; }.video-copy { min-width:0; display:flex; flex-direction:column; }.video-copy h3 { margin:2px 0 4px; font-size:1rem; line-height:1.35; }.video-copy h3 a { color:var(--ink); text-decoration:none; }.video-copy h3 a:hover { text-decoration:underline; }.video-copy p { margin:0; color:var(--muted); font-size:.86rem; }.video-actions { display:flex; justify-content:space-between; align-items:end; gap:8px; margin-top:auto; padding-top:12px; }.remove-video { border:0; background:transparent; color:#8f3431; padding:4px; font-weight:700; font-size:.82rem; }
.empty-state { min-height:300px; border:1px dashed #cbd4da; border-radius:16px; display:grid; place-content:center; justify-items:center; text-align:center; padding:40px; }.empty-state h3 { margin:10px 0 4px; }.empty-state p { max-width:480px; margin:0; color:var(--muted); }.empty-icon { display:grid; place-items:center; width:44px; height:44px; border-radius:50%; background:#eef1f3; color:var(--accent); font-size:1.5rem; }
.privacy-strip { margin-top:52px; padding:22px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); display:grid; grid-template-columns:1fr 1fr; gap:32px; color:var(--muted); font-size:.9rem; }.privacy-strip p { margin:0; }.privacy-strip strong { color:var(--ink); }
.danger-zone { margin-top:36px; display:flex; align-items:center; justify-content:space-between; gap:28px; }.danger-zone div { max-width:700px; }.danger-button { background:#fff; border-color:#dfaaa8; color:#8d2421; white-space:nowrap; }.danger-button:hover { background:#fff0ef; }
footer { min-height:74px; border-top:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; gap:20px; padding:18px clamp(20px,5vw,72px); color:var(--muted); font-size:.8rem; }
[hidden] { display:none !important; }
@media (max-width:800px) { .invite-layout { grid-template-columns:1fr; gap:40px; padding:48px 0 70px; }.review-heading { align-items:flex-start; flex-direction:column; }.connection-panel,.danger-zone { align-items:flex-start; flex-direction:column; }.connect-panel { grid-template-columns:1fr; }.connect-panel .primary-button { justify-self:start; }.queue-grid { grid-template-columns:1fr; }.privacy-strip { grid-template-columns:1fr; }.video-card { grid-template-columns:120px minmax(0,1fr); }.video-thumb { width:120px; } }
@media (max-width:520px) { main { width:min(100% - 28px,1180px); }.masthead { height:66px; }.environment-label { font-size:.68rem; }.intro-copy h1 { font-size:2.8rem; }.invite-card { padding:22px; }.connection-panel { padding:24px 20px; }.connect-panel { padding:22px; }.copy-row { grid-template-columns:1fr; }.video-card { grid-template-columns:1fr; }.video-thumb { width:100%; }.heading-actions { width:100%; }.heading-actions button { flex:1; }.privacy-strip { gap:14px; } footer { align-items:flex-start; flex-direction:column; } }
@media (prefers-reduced-motion:reduce) { * { scroll-behavior:auto!important; transition:none!important; animation-duration:.01ms!important; } }
`;

export const reviewJs = String.raw`
(() => {
  const state = { csrf: "", poller: null, queueLoading: false, queueSnapshot: null };
  const byId = (id) => document.getElementById(id);
  const show = (id, value = true) => { byId(id).hidden = !value; };
  const message = (text, kind = "success") => {
    const node = byId("notice"); node.textContent = text; node.className = "notice " + kind; node.hidden = false;
    window.setTimeout(() => { node.hidden = true; }, 5000);
  };
  const api = async (path, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (options.body) headers.set("Content-Type", "application/json");
    if (state.csrf && !["GET", "HEAD"].includes(options.method || "GET")) headers.set("X-CSRF-Token", state.csrf);
    const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
    const body = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.message || "Request failed."), { status: response.status });
    return body;
  };
  const cleanText = (value) => typeof value === "string" ? value : "";
  const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle:"medium", timeStyle:"short" }).format(new Date(value)) : "Never";

  function showEntry(invited) {
    state.invited = invited;
    show("loading", false); show("review-view", false); show("invite-view");
    show("invite-form", !invited); show("google-card", invited);
  }

  function invitationParts(raw) {
    const url = new URL(raw);
    if (url.origin !== window.location.origin || (url.pathname !== "/" && url.pathname !== "")) throw new Error("Use the complete private review.villow.app invitation link.");
    const fragment = new URLSearchParams(url.hash.slice(1));
    const token = fragment.get("villow_invite");
    if (!token || token.length > 2048) throw new Error("This invitation link is incomplete or invalid.");
    return { token };
  }

  async function validateInvitation(token) {
    await api("/api/invitations/validate", { method:"POST", body:JSON.stringify({ token }) });
    showEntry(true);
  }

  async function beginInvitation(event) {
    event.preventDefault();
    const error = byId("invite-error"); error.hidden = true;
    const submit = event.currentTarget.querySelector("button[type=submit]"); submit.disabled = true;
    try {
      const parts = invitationParts(byId("invitation").value.trim());
      await validateInvitation(parts.token);
    } catch (cause) {
      error.textContent = cause.message || "This invitation could not be used."; error.hidden = false; submit.disabled = false;
    }
  }

  async function continueWithGoogle() {
    const error = byId("google-error"); error.hidden = true;
    const button = byId("continue-google"); button.disabled = true;
    try {
      const result = await api("/api/oauth/start", { method:"POST", body:"{}" });
      window.location.assign(result.authorizeUrl);
    } catch (cause) {
      error.textContent = cause.message || "Google sign-in could not be started."; error.hidden = false; button.disabled = false;
    }
  }

  async function loadStatus() {
    const status = await api("/api/subscriptions/status");
    const dot = byId("google-status-dot");
    dot.classList.toggle("good", status.googleConnected); dot.classList.toggle("bad", !status.googleConnected);
    byId("connection-title").textContent = status.googleConnected ? "Subscription access connected" : "Google needs to be reconnected";
    byId("subscription-detail").textContent = status.lastSuccessfulRefresh
      ? status.count + " channels cached · last successful refresh " + formatDate(status.lastSuccessfulRefresh)
      : "No successful subscription refresh yet.";
    show("reconnect-google", !status.googleConnected);
  }

  function renderTokens(tokens) {
    const list = byId("token-list"); list.replaceChildren();
    const active = tokens.filter((token) => !token.revoked_at);
    if (!active.length) return;
    for (const token of active) {
      const row = document.createElement("div"); row.className = "token-row";
      const copy = document.createElement("div");
      const title = document.createElement("p"); title.textContent = cleanText(token.label) || "Review extension";
      const meta = document.createElement("p"); meta.className = "token-meta"; meta.textContent = "Created " + formatDate(token.created_at) + (token.last_used_at ? " · last used " + formatDate(token.last_used_at) : " · not used yet");
      copy.append(title, meta);
      const revoke = document.createElement("button"); revoke.className = "quiet-button"; revoke.type = "button"; revoke.textContent = "Revoke";
      revoke.addEventListener("click", () => revokeToken(token.id));
      row.append(copy, revoke); list.append(row);
    }
  }

  async function loadTokens() { const result = await api("/api/extension-tokens"); renderTokens(result.tokens || []); }
  async function revokeToken(id) {
    if (!window.confirm("Revoke this extension connect link? The paired extension will stop working.")) return;
    await api("/api/extension-tokens/" + encodeURIComponent(id), { method:"DELETE" });
    message("Extension link revoked."); await loadTokens();
  }
  async function createConnectLink() {
    const button = byId("create-connect-link"); button.disabled = true;
    try {
      const result = await api("/api/extension-tokens", { method:"POST", body:JSON.stringify({ label:"Chrome Web Store review" }) });
      byId("connect-link").value = result.connectLink; show("connect-link-box"); await loadTokens();
    } catch (error) { message(error.message, "error"); } finally { button.disabled = false; }
  }

  function videoCard(video) {
    const card = document.createElement("article"); card.className = "video-card";
    const thumb = document.createElement("img"); thumb.className = "video-thumb"; thumb.loading = "lazy"; thumb.alt = ""; thumb.src = cleanText(video.thumbnail_url);
    const copy = document.createElement("div"); copy.className = "video-copy";
    const title = document.createElement("h3"); const link = document.createElement("a");
    link.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(video.youtube_video_id); link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = cleanText(video.title) || "Untitled YouTube video"; title.append(link);
    const channel = document.createElement("p"); channel.textContent = cleanText(video.channel_name) || "Channel not supplied";
    const actions = document.createElement("div"); actions.className = "video-actions";
    const added = document.createElement("p"); added.textContent = formatDate(video.saved_at);
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-video"; remove.textContent = "Remove"; remove.addEventListener("click", () => removeVideo(video.youtube_video_id));
    actions.append(added, remove); copy.append(title, channel, actions); card.append(thumb, copy); return card;
  }
  async function loadQueue({ quiet = false } = {}) {
    if (state.queueLoading) return;
    state.queueLoading = true;
    const error = byId("queue-error"); error.hidden = true;
    const status = byId("queue-sync-status"); status.textContent = "Checking…";
    const refresh = byId("refresh-queue"); refresh.disabled = true;
    try {
      const result = await api("/api/queue"); const videos = result.videos || [];
      const snapshot = JSON.stringify(videos);
      if (snapshot !== state.queueSnapshot) {
        byId("queue-count").textContent = String(videos.length);
        byId("queue-list").replaceChildren(...videos.map(videoCard));
        show("queue-empty", videos.length === 0);
        state.queueSnapshot = snapshot;
      }
      status.textContent = "Last checked " + new Date().toLocaleTimeString([], { hour:"numeric", minute:"2-digit", second:"2-digit" }) + ".";
      if (!quiet) message("Queue refreshed.");
    } catch (cause) {
      status.textContent = "Check failed. Retrying automatically.";
      error.textContent = cause.message || "The queue could not be loaded. Try again."; error.hidden = false;
    } finally {
      state.queueLoading = false;
      refresh.disabled = false;
    }
  }
  async function removeVideo(id) {
    if (!window.confirm("Remove this video from the review queue?")) return;
    try { await api("/api/queue/" + encodeURIComponent(id), { method:"DELETE" }); await loadQueue({ quiet:true }); message("Video removed."); }
    catch (error) { message(error.message, "error"); }
  }
  async function reconnectGoogle() {
    try { const result = await api("/api/google/reconnect", { method:"POST", body:"{}" }); window.location.assign(result.authorizeUrl); }
    catch (error) { message(error.message, "error"); }
  }
  async function signOut() { await api("/api/logout", { method:"POST", body:"{}" }); window.location.reload(); }
  async function forgetReview() {
    const confirmation = window.prompt('Type FORGET to permanently delete this review data.');
    if (confirmation !== "FORGET") return;
    try { await api("/api/review", { method:"DELETE", body:JSON.stringify({ confirmation }) }); window.location.reload(); }
    catch (error) { message(error.message, "error"); }
  }
  function startPolling() {
    window.clearInterval(state.poller);
    state.poller = window.setInterval(() => { if (!document.hidden) loadQueue({ quiet:true }); }, 5_000);
  }
  async function boot() {
    const query = new URLSearchParams(location.search);
    const oauthResult = query.get("oauth");
    const rawReference = query.get("ref");
    const oauthReference = rawReference && /^[A-Z0-9_]{1,64}$/.test(rawReference) ? rawReference : "";
    const oauthMessages = {
      scope: "Google sign-in did not grant all required permissions. Try again and approve YouTube read-only access.",
      expired: "Google sign-in took too long to complete. Please try again.",
      account: "This Google account cannot be used for this review. Use the same dedicated review account as before.",
      failed: "Google sign-in could not be completed. Please try again.",
    };
    const oauthMessage = oauthResult
      ? (oauthMessages[oauthResult] || oauthMessages.failed) + (oauthReference ? " Reference: " + oauthReference + "." : "")
      : "";
    if (oauthResult || query.has("connected")) {
      query.delete("oauth"); query.delete("ref"); query.delete("connected");
      history.replaceState(null, "", location.pathname + (query.size ? "?" + query : "") + location.hash);
    }
    const fragment = new URLSearchParams(location.hash.slice(1));
    const invite = fragment.get("villow_invite");
    let invitationError = "";
    if (invite) {
      history.replaceState(null, "", location.pathname + location.search);
      try { await validateInvitation(invite); }
      catch (error) { invitationError = error.message || "This invitation could not be used."; }
    }
    try {
      const me = await api("/api/me"); state.csrf = me.csrfToken;
      byId("reviewer-label").textContent = me.user.email || me.user.displayName || "Authenticated reviewer";
      show("loading", false); show("invite-view", false); show("review-view");
      await Promise.all([loadStatus(), loadTokens(), loadQueue({ quiet:true })]); startPolling();
    } catch (error) {
      if (error.status !== 401) {
        show("invite-view", false); show("loading");
        byId("loading").querySelector("p").textContent = "The review environment is temporarily unavailable.";
        return;
      }
      if (!state.invited) {
        try { state.invited = Boolean((await api("/api/invitations/status")).invited); }
        catch { /* the fallback remains available */ }
      }
      showEntry(state.invited);
      if (oauthMessage && state.invited) {
        const node = byId("google-error"); node.textContent = oauthMessage; node.hidden = false;
      }
      if (invitationError && !state.invited) {
        const node = byId("invite-error"); node.textContent = invitationError; node.hidden = false;
      }
    }
  }
  byId("invite-form").addEventListener("submit", beginInvitation);
  byId("continue-google").addEventListener("click", continueWithGoogle);
  byId("refresh-queue").addEventListener("click", () => loadQueue());
  byId("create-connect-link").addEventListener("click", createConnectLink);
  byId("copy-connect-link").addEventListener("click", async () => { await navigator.clipboard.writeText(byId("connect-link").value); message("Connect link copied."); });
  byId("reconnect-google").addEventListener("click", reconnectGoogle);
  byId("sign-out").addEventListener("click", signOut);
  byId("forget-review").addEventListener("click", forgetReview);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.csrf) loadQueue({ quiet:true }); });
  boot();
})();
`;
