(() => {
  if (window.__driftInjected) return;
  window.__driftInjected = true;

  const NUB = 38;      // bubble diameter
  const GAP = 14;      // min distance from viewport edge
  const DRAG_SLOP = 4; // px of movement before a click becomes a drag

  const DOCK_W = 15;   // docked sliver width
  const DOCK_H = 40;   // docked sliver height

  const DEFAULT_POS = { xPct: 0.97, yPct: 0.42 };

  const STYLES = `
    :host { all: initial; }

    * { box-sizing: border-box; }

    /* Light by default; the dark set swaps in under the OS preference.
       Both are tuned near 10:1 contrast — readable without glare. */
    .nub-wrap, .dock-tab, .panel {
      --surface: #F5F2EC;
      --surface-2: #EBE7DE;
      --surface-3: #DFDACF;
      --text: #35342F;
      --text-dim: #7C7970;
      --accent: #A07A38;
      --accent-dim: rgba(160,122,56,0.22);
      --hairline: rgba(53,52,47,0.10);
      --panel-shadow: 0 18px 46px -16px rgba(70,64,52,0.30);
      --badge-ink: #F5F2EC;

      --serif: ui-serif, "New York", "Iowan Old Style", Georgia, serif;
      --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
      --code: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    }

    @media (prefers-color-scheme: dark) {
      .nub-wrap, .dock-tab, .panel {
        --surface: #24262C;
        --surface-2: #2C2F36;
        --surface-3: #363941;
        --text: #DAD5CB;
        --text-dim: #9A9691;
        --accent: #C7A97B;
        --accent-dim: rgba(199,169,123,0.20);
        --hairline: rgba(218,213,203,0.09);
        --panel-shadow: 0 18px 46px -14px rgba(10,11,14,0.48);
        --badge-ink: #24262C;
      }
    }

    /* ---------- the bubble ---------- */
    .nub-wrap {
      position: fixed;
      z-index: 2147483647;
      width: ${NUB}px;
      height: ${NUB}px;
    }
    .nub-wrap[data-docked="true"] { display: none; }

    .nub {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: #2F3138;
      border: none;
      padding: 0;
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow:
        inset 0 0 0 1px rgba(199,169,123,0.30),
        0 3px 12px rgba(24,26,30,0.30);
      transition: box-shadow 0.18s ease;
      touch-action: none;
      user-select: none;
    }
    .nub:hover {
      box-shadow:
        inset 0 0 0 1px rgba(199,169,123,0.50),
        0 5px 16px rgba(24,26,30,0.36);
    }
    .nub svg { display: block; }
    .nub-wrap[data-dragging="true"] .nub { cursor: grabbing; }

    .nub-badge {
      position: absolute;
      top: -3px;
      right: -3px;
      min-width: 17px;
      height: 17px;
      padding: 0 5px;
      border-radius: 999px;
      background: #C7A97B;
      color: #2A2418;
      font-family: var(--code);
      font-size: 9.5px;
      font-weight: 500;
      line-height: 17px;
      text-align: center;
      box-shadow: 0 0 0 2px rgba(250,250,250,0.9);
      pointer-events: none;
    }
    .nub-badge[data-empty="true"] { display: none; }

    /* ---------- docked sliver ---------- */
    .dock-tab {
      position: fixed;
      z-index: 2147483647;
      width: ${DOCK_W}px;
      height: ${DOCK_H}px;
      background: #2F3138;
      border: none;
      padding: 0;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      color: #C7A97B;
      font-size: 11px;
      line-height: 1;
      transition: width 0.18s ease;
      touch-action: none;
    }
    .dock-tab[data-show="true"] { display: flex; }
    .dock-tab:hover { width: 23px; }
    .dock-tab[data-side="left"] {
      left: 0;
      border-radius: 0 10px 10px 0;
      box-shadow: inset -1px 0 0 rgba(199,169,123,0.26), 0 3px 12px rgba(24,26,30,0.28);
    }
    .dock-tab[data-side="right"] {
      right: 0;
      border-radius: 10px 0 0 10px;
      box-shadow: inset 1px 0 0 rgba(199,169,123,0.26), 0 3px 12px rgba(24,26,30,0.28);
    }
    .dock-dot {
      position: absolute;
      top: 5px;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: #C7A97B;
    }
    .dock-tab[data-side="left"] .dock-dot { right: 4px; }
    .dock-tab[data-side="right"] .dock-dot { left: 4px; }

    /* ---------- the digest panel ---------- */
    .panel {
      position: fixed;
      width: 352px;
      max-height: 480px;
      background: var(--surface);
      border-radius: 18px;
      box-shadow: var(--panel-shadow), inset 0 0 0 1px var(--hairline);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: var(--text);
      opacity: 0;
      pointer-events: none;
      transform: scale(0.98) translateY(4px);
      transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.22,1,0.36,1);
      z-index: 2147483646;
    }
    .panel[data-open="true"] {
      opacity: 1;
      pointer-events: auto;
      transform: scale(1) translateY(0);
    }

    .panel-header {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 17px 18px 14px;
      border-bottom: 1px solid var(--hairline);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: var(--serif);
      font-size: 18px;
      font-weight: 400;
      letter-spacing: 0.01em;
    }
    .brand-rule { width: 16px; height: 1px; background: var(--accent); }
    .header-right { display: flex; align-items: center; gap: 9px; }
    .clock {
      font-family: var(--code);
      font-size: 10.5px;
      letter-spacing: 0.04em;
      color: var(--text-dim);
    }
    .icon-btn {
      width: 26px;
      height: 26px;
      border-radius: 7px;
      border: none;
      background: transparent;
      color: var(--text-dim);
      font-size: 12.5px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.16s ease, color 0.16s ease;
    }
    .icon-btn:hover { background: var(--surface-2); color: var(--text); }

    /* one topic per tab — the strip scrolls sideways when there are many */
    .topic-tabs {
      flex: 0 0 auto;
      display: flex;
      gap: 2px;
      padding: 0 10px;
      overflow-x: auto;
      border-bottom: 1px solid var(--hairline);
      scrollbar-width: none;
    }
    .topic-tabs::-webkit-scrollbar { display: none; }
    .topic-tabs[hidden] { display: none; }

    .topic-tab {
      flex: 0 0 auto;
      position: relative;
      border: none;
      background: none;
      cursor: pointer;
      padding: 11px 10px 12px;
      font-family: var(--sans);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.01em;
      color: var(--text-dim);
      white-space: nowrap;
      transition: color 0.16s ease;
    }
    .topic-tab:hover { color: var(--text); }
    .topic-tab[aria-selected="true"] { color: var(--text); }
    .topic-tab[aria-selected="true"]::after {
      content: "";
      position: absolute;
      left: 8px;
      right: 8px;
      bottom: 0;
      height: 2px;
      border-radius: 2px 2px 0 0;
      background: var(--accent);
    }
    .topic-tab .unread {
      display: inline-block;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: var(--accent);
      margin-left: 6px;
      vertical-align: middle;
    }
    .topic-tab[aria-selected="true"] .unread { opacity: 0; }

    .panel-body {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 8px 0 10px;
      animation: driftFade 0.18s ease;
    }
    @keyframes driftFade {
      from { opacity: 0; transform: translateY(2px); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .panel-body { animation: none; }
    }
    .panel-body::-webkit-scrollbar { width: 9px; }
    .panel-body::-webkit-scrollbar-thumb { background: var(--surface-3); border-radius: 9px; }

    .story {
      display: block;
      width: 100%;
      text-align: left;
      padding: 10px 18px 11px;
      border: none;
      background: transparent;
      text-decoration: none;
      color: inherit;
      cursor: pointer;
      position: relative;
      transition: background 0.15s ease;
    }
    .story:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
      border-radius: 4px;
    }
    .story::before {
      content: "";
      position: absolute;
      left: 0;
      top: 8px;
      bottom: 8px;
      width: 2px;
      background: var(--accent);
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .story:hover { background: var(--surface-2); }
    .story:hover::before { opacity: 0.7; }

    .story-title {
      font-family: var(--serif);
      font-weight: 400;
      font-size: 14.5px;
      line-height: 1.5;
      color: var(--text);
      margin: 0 0 7px;
      letter-spacing: 0.004em;
    }
    .story.lead .story-title { font-size: 17px; line-height: 1.42; margin-bottom: 8px; }

    .story-wrap { display: block; }

    .story-text { min-width: 0; }
    .story-kicker {
      margin: 0 0 4px;
      font-family: var(--code);
      font-size: 9.5px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--accent);
    }
    .story-related { display: grid; grid-template-columns: minmax(0, 1fr); padding: 0 18px 10px; margin-top: -3px; }
    .related-angle {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      border-top: 1px solid var(--hairline);
      text-decoration: none;
      color: var(--text-dim);
      transition: color 0.15s ease;
    }
    .related-angle:hover { color: var(--text); }
    .related-mark { width: 12px; height: 12px; border-radius: 2px; object-fit: contain; flex: 0 0 auto; }
    .related-title {
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-family: var(--serif);
      font-size: 12.5px;
      line-height: 1.4;
    }

    .story-sources {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      padding: 0 18px 12px;
      margin-top: -3px;
    }
    .sources-label {
      font-family: var(--code);
      font-size: 9.5px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-dim);
    }
    .source-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px 3px 6px;
      border-radius: 999px;
      background: var(--surface-2);
      box-shadow: inset 0 0 0 1px var(--hairline);
      text-decoration: none;
      color: var(--text-dim);
      font-size: 11px;
      font-weight: 600;
      transition: color 0.15s ease, box-shadow 0.15s ease;
    }
    .source-chip:hover {
      color: var(--text);
      box-shadow: inset 0 0 0 1px var(--accent-dim);
    }
    .source-chip:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    .source-chip img {
      width: 11px;
      height: 11px;
      border-radius: 2px;
      object-fit: contain;
    }

    .story-lead {
      margin: 0 0 8px;
      font-family: var(--sans);
      font-size: 12px;
      line-height: 1.55;
      color: var(--text-dim);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .paywall-tag {
      font-family: var(--code);
      font-size: 8.5px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-dim);
      padding: 1px 5px;
      border-radius: 999px;
      box-shadow: inset 0 0 0 1px var(--hairline);
      white-space: nowrap;
    }

    .story-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      row-gap: 4px;
      font-family: var(--code);
      font-size: 10.5px;
      letter-spacing: 0.02em;
      color: var(--text-dim);
      margin: 0;
    }
    .topic-tab { user-select: none; touch-action: pan-y; }
    .topic-tab.is-dragging {
      opacity: 0.9;
      z-index: 2;
      cursor: grabbing;
    }
    .topic-tabs.is-reordering .topic-tab:not(.is-dragging) {
      transition: transform 0.16s ease;
    }
    .topic-tab.is-pinned { color: var(--accent); }
    .topic-tab.is-pinned[aria-selected="true"] { color: var(--accent); }

    .story-favicon {
      width: 12px;
      height: 12px;
      border-radius: 2px;
      object-fit: contain;
      flex: 0 0 auto;
      margin-right: -2px;
    }
    .story-meta .sep { width: 2px; height: 2px; border-radius: 50%; background: var(--surface-3); }
    .story-meta .fresh { display: inline-flex; align-items: center; gap: 6px; color: var(--accent); }
    .story-meta .fresh::before {
      content: "";
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: var(--accent);
    }

    .empty-state {
      padding: 42px 22px;
      text-align: center;
      color: var(--text-dim);
    }
    .empty-state p {
      margin: 0 0 16px;
      font-family: var(--serif);
      font-size: 15px;
      line-height: 1.6;
      color: var(--text);
    }
    .primary-btn {
      appearance: none;
      border: none;
      background: var(--accent);
      color: var(--badge-ink);
      font-family: var(--sans);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.03em;
      padding: 9px 16px;
      border-radius: 999px;
      cursor: pointer;
    }
    .primary-btn:hover { filter: brightness(1.08); }

    .panel-footer {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 18px;
      border-top: 1px solid var(--hairline);
    }
    .footer-link {
      font-family: var(--sans);
      font-size: 11.5px;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--text-dim);
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
      transition: color 0.16s ease;
    }
    .footer-link:hover { color: var(--accent); }
  `;

  // ---------- shadow root ----------
  const host = document.createElement("div");
  host.id = "__drift_host";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;
  shadow.appendChild(style);

  const nubWrap = document.createElement("div");
  nubWrap.className = "nub-wrap";
  nubWrap.innerHTML = `
    <button class="nub" aria-label="Open your Drift digest">
      <svg width="15" height="12" viewBox="0 0 15 12" fill="none" aria-hidden="true">
        <rect y="0" width="15" height="1.9" rx="0.95" fill="#DAD5CB"/>
        <rect y="5.05" width="11" height="1.9" rx="0.95" fill="#C7A97B"/>
        <rect y="10.1" width="7" height="1.9" rx="0.95" fill="#7C7E85"/>
      </svg>
    </button>
    <span class="nub-badge" data-empty="true"></span>
  `;

  const dockTab = document.createElement("button");
  dockTab.className = "dock-tab";
  dockTab.setAttribute("aria-label", "Bring Drift back on screen");
  dockTab.innerHTML = `<span class="dock-dot"></span><span class="dock-arrow">&#8249;</span>`;

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="panel-header">
      <div class="brand"><span class="brand-rule"></span>Drift</div>
      <div class="header-right">
        <span class="clock"></span>
        <button class="icon-btn" data-action="settings" title="Manage topics">&#9881;</button>
        <button class="icon-btn" data-action="close" title="Close">&#10005;</button>
      </div>
    </div>
    <div class="topic-tabs" role="tablist" aria-label="Your topics"></div>
    <div class="panel-body" role="tabpanel"></div>
    <div class="panel-footer">
      <button class="footer-link" data-action="settings">Manage topics</button>
      <button class="footer-link" data-action="dock">Tuck away</button>
    </div>
  `;

  shadow.append(panel, nubWrap, dockTab);
  (document.body || document.documentElement).appendChild(host);

  const nub = nubWrap.querySelector(".nub");
  const badge = nubWrap.querySelector(".nub-badge");
  const dockArrow = dockTab.querySelector(".dock-arrow");
  const panelBody = panel.querySelector(".panel-body");
  const topicTabs = panel.querySelector(".topic-tabs");
  const clock = panel.querySelector(".clock");

  function tickClock() {
    clock.textContent = new Date().toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // ---------- position ----------
  let pos = { x: 0, y: 0 };
  let docked = null; // null | "left" | "right"
  let dragging = false;
  let moved = 0;
  let grab = { x: 0, y: 0 };

  function clamp(x, y) {
    return {
      x: Math.min(Math.max(x, GAP), window.innerWidth - NUB - GAP),
      y: Math.min(Math.max(y, GAP), window.innerHeight - NUB - GAP),
    };
  }

  // While dragging the bubble may run past either edge — that's how it gets tucked away.
  function clampDraggable(x, y) {
    return {
      x: Math.min(Math.max(x, -NUB * 0.8), window.innerWidth - NUB * 0.2),
      y: Math.min(Math.max(y, GAP), window.innerHeight - NUB - GAP),
    };
  }

  function fromPct({ xPct, yPct }) {
    return clamp(xPct * (window.innerWidth - NUB), yPct * (window.innerHeight - NUB));
  }

  function toPct() {
    return {
      xPct: pos.x / Math.max(1, window.innerWidth - NUB),
      yPct: pos.y / Math.max(1, window.innerHeight - NUB),
    };
  }

  function applyPos() {
    nubWrap.style.left = pos.x + "px";
    nubWrap.style.top = pos.y + "px";
    if (isOpen()) placePanel();
  }

  function placePanel() {
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const centerX = pos.x + NUB / 2;

    let left = centerX > window.innerWidth / 2 ? pos.x - GAP - pw : pos.x + NUB + GAP;
    if (left < GAP) left = pos.x + NUB + GAP;
    if (left + pw > window.innerWidth - GAP) left = Math.max(GAP, window.innerWidth - pw - GAP);

    let top = pos.y + NUB / 2 - ph / 2;
    top = Math.min(Math.max(top, GAP), Math.max(GAP, window.innerHeight - ph - GAP));

    panel.style.left = left + "px";
    panel.style.top = top + "px";
  }

  // ---------- dock / undock ----------
  function setDocked(side, persist) {
    docked = side;
    nubWrap.setAttribute("data-docked", String(Boolean(side)));
    dockTab.setAttribute("data-show", String(Boolean(side)));

    if (side) {
      dockTab.setAttribute("data-side", side);
      dockArrow.innerHTML = side === "left" ? "&#8250;" : "&#8249;";
      dockTab.style.top =
        Math.min(Math.max(pos.y, GAP), window.innerHeight - DOCK_H - GAP) + "px";
      setOpen(false);
    }

    if (persist) chrome.storage.local.set({ bubble_docked: side, bubble_pos: toPct() });
  }

  function undock(clientY) {
    const side = docked;
    setDocked(null, false);
    pos = clamp(
      side === "left" ? GAP : window.innerWidth - NUB - GAP,
      clientY - NUB / 2
    );
    applyPos();
    chrome.storage.local.set({ bubble_docked: null, bubble_pos: toPct() });
  }

  // ---------- open / close ----------
  function isOpen() { return panel.getAttribute("data-open") === "true"; }

  function setOpen(open) {
    panel.setAttribute("data-open", String(open));
    if (open) {
      tickClock();
      placePanel();
      // Fresh on every open: the tab in front of you is refetched if its own
      // feeds have gone stale, which is far cheaper than refreshing all of them.
      refreshActiveTopic();
    }
  }

  // ---------- drag ----------
  nub.addEventListener("pointerdown", (event) => {
    dragging = true;
    moved = 0;
    grab = { x: event.clientX - pos.x, y: event.clientY - pos.y };
    nubWrap.setAttribute("data-dragging", "true");
    nub.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  nub.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const next = clampDraggable(event.clientX - grab.x, event.clientY - grab.y);
    moved += Math.abs(next.x - pos.x) + Math.abs(next.y - pos.y);
    pos = next;
    if (moved > DRAG_SLOP) setOpen(false);
    applyPos();
  });

  nub.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    dragging = false;
    nubWrap.removeAttribute("data-dragging");
    nub.releasePointerCapture(event.pointerId);

    if (pos.x < -NUB * 0.2) {
      pos.x = 0;
      setDocked("left", true);
      return;
    }
    if (pos.x > window.innerWidth - NUB * 0.8) {
      pos.x = window.innerWidth - NUB;
      setDocked("right", true);
      return;
    }

    pos = clamp(pos.x, pos.y);
    applyPos();

    if (moved <= DRAG_SLOP) {
      setOpen(!isOpen());
    } else {
      chrome.storage.local.set({ bubble_pos: toPct() });
    }
  });

  // Pull the docked sliver back on screen: click restores it, or keep dragging to place it.
  dockTab.addEventListener("pointerdown", (event) => {
    undock(event.clientY);
    dragging = true;
    moved = 99; // never read as a click-to-open
    grab = { x: NUB / 2, y: NUB / 2 };
    nubWrap.setAttribute("data-dragging", "true");
    nub.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  panel.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.getAttribute("data-action");
    if (action === "close") setOpen(false);
    if (action === "dock") {
      setDocked(pos.x + NUB / 2 > window.innerWidth / 2 ? "right" : "left", true);
    }
    if (action === "settings") chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
  });

  document.addEventListener("pointerdown", (event) => {
    if (isOpen() && !host.contains(event.target)) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) setOpen(false);
  });

  window.addEventListener("resize", () => {
    pos = clamp(pos.x, pos.y);
    applyPos();
    if (docked) setDocked(docked, false);
  });

  // ---------- render ----------
  // ---------- rendering ----------
  let selectedTopics = [];
  let tabIds = [];           // Trending first, then your topics in your order
  let articlesByTopic = {};
  let activeTopicId = null;
  let unreadTopics = new Set();
  let history = { opened: {}, seen: {} };

  function showNotice(text, actionLabel, action) {
    topicTabs.hidden = true;
    panelBody.textContent = "";

    const notice = document.createElement("div");
    notice.className = "empty-state";

    const copy = document.createElement("p");
    copy.textContent = text;
    notice.appendChild(copy);

    if (actionLabel) {
      const button = document.createElement("button");
      button.className = "primary-btn";
      button.setAttribute("data-action", action);
      button.textContent = actionLabel;
      notice.appendChild(button);
    }

    panelBody.appendChild(notice);
  }

  // Identity of a topic's stories, so we can tell a real update from a no-op.
  function topicSignature(articles) {
    return (articles || []).map((article) => article.url).join("|");
  }

  function sameArticles(a, b) {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    return [...keys].every((key) => topicSignature(a[key]) === topicSignature(b[key]));
  }

  function renderStories() {
    const articles = pickStories(articlesByTopic[activeTopicId], history, 3);

    panelBody.textContent = "";

    // An empty topic is a real answer, not a failure — say so plainly.
    if (articles.length === 0) {
      const notice = document.createElement("div");
      notice.className = "empty-state";
      const copy = document.createElement("p");
      const topic = getTopic(activeTopicId);
      copy.textContent = "Quiet in " + (topic?.short || "this topic") + " today.";
      notice.appendChild(copy);
      panelBody.appendChild(notice);
      return;
    }

    articles.forEach((article, index) => {
      panelBody.appendChild(renderStory(article, { lead: index === 0 }));
    });

    // You looked at this tab, so these have had their turn.
    chrome.runtime.sendMessage({
      type: "MARK_SEEN",
      urls: articles.map((article) => article.url),
    });

    // replay the fade so switching tabs reads as a change
    panelBody.style.animation = "none";
    void panelBody.offsetWidth;
    panelBody.style.animation = "";
  }

  function selectTopic(topicId) {
    activeTopicId = topicId;
    unreadTopics.delete(topicId);
    chrome.storage.local.set({ active_topic: topicId });
    renderTabs();
    renderStories();
    updateBadge();
    refreshActiveTopic();
  }

  // Refetch just the tab you're looking at — a few requests, not all 35.
  function refreshActiveTopic() {
    const topicId = activeTopicId;
    chrome.runtime.sendMessage({ type: "REFRESH_TOPIC", topicId }, (reply) => {
      if (chrome.runtime.lastError || !reply?.articles) return;
      if (topicId !== activeTopicId) return;
      if (sameArticles(reply.articles, articlesByTopic)) return;
      render(selectedTopics, reply.articles);
    });
  }

  function renderTabs() {
    topicTabs.hidden = false;
    topicTabs.textContent = "";

    tabIds.forEach((topicId) => {
      const topic = getTopic(topicId);
      if (!topic) return;

      const tab = document.createElement("button");
      tab.className = "topic-tab";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(topicId === activeTopicId));
      tab.dataset.topicId = topicId;
      if (topicId === TRENDING_ID) tab.classList.add("is-pinned");
      tab.textContent = topic.short || topic.label;

      if (unreadTopics.has(topicId)) {
        const dot = document.createElement("span");
        dot.className = "unread";
        tab.appendChild(dot);
      }

      tab.addEventListener("click", () => {
        selectTopic(topicId);
        tab.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      });

      topicTabs.appendChild(tab);
    });
  }

  // Drag a tab to rearrange your dashboard. Trending is pinned first.
  enableTabReorder({
    container: topicTabs,
    itemSelector: ".topic-tab",
    isFixed: (el) => el.dataset.topicId === TRENDING_ID,
    onReorder: (ids) => {
      selectedTopics = ids;
      tabIds = tabOrder(selectedTopics, articlesByTopic);
      chrome.storage.sync.set({ selected_topics: ids });
      renderTabs();
    },
  });

  // left/right arrows walk the tab strip
  topicTabs.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;

    const index = tabIds.indexOf(activeTopicId);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabIds.length
        : (index - 1 + tabIds.length) % tabIds.length;

    selectTopic(tabIds[next]);
    topicTabs.children[next]?.focus();
    event.preventDefault();
  });

  // The badge counts topics with something new, now that they aren't all visible at once.
  function updateBadge() {
    const count = unreadTopics.size;
    badge.textContent = String(count);
    badge.setAttribute("data-empty", count === 0 ? "true" : "false");
  }

  function render(topicIds, articles) {
    const previousArticles = articlesByTopic;
    articlesByTopic = articles || {};
    selectedTopics = (topicIds || []).filter((id) => getTopic(id));

    if (selectedTopics.length === 0) {
      activeTopicId = null;
      unreadTopics = new Set();
      showNotice(
        "Nothing to read yet — pick a few topics and Drift keeps a running digest here.",
        "Choose your topics",
        "settings"
      );
      updateBadge();
      return;
    }

    if (Object.keys(articlesByTopic).length === 0) {
      unreadTopics = new Set();
      showNotice("Gathering headlines…");
      updateBadge();
      return;
    }

    if (Object.keys(previousArticles).length === 0) {
      // first load — everything is new
      unreadTopics = new Set(
        selectedTopics.filter((id) =>
          pickStories(articlesByTopic[id], history, 3).some((a) => a.fresh)
        )
      );
    } else {
      // a refresh only marks the topics whose stories actually changed
      selectedTopics.forEach((id) => {
        if (topicSignature(articlesByTopic[id]) !== topicSignature(previousArticles[id])) {
          unreadTopics.add(id);
        }
      });
    }

    tabIds = tabOrder(selectedTopics, articlesByTopic);

    // Trending leads unless you were last reading something else.
    if (!tabIds.includes(activeTopicId)) {
      activeTopicId = tabIds[0];
    }
    unreadTopics.delete(activeTopicId);

    renderTabs();
    renderStories();
    updateBadge();
  }

  // ---------- display mode ----------
  // "bubble" puts the floating bubble on the page; "toolbar" leaves the page
  // untouched and the digest lives in the extension's toolbar popup instead.
  function applyMode(mode) {
    host.style.display = mode === "bubble" ? "" : "none";
    if (mode !== "bubble") setOpen(false);
  }

  // ---------- boot ----------
  chrome.storage.sync.get(
    { selected_topics: DEFAULT_TOPIC_IDS, display_mode: DEFAULT_DISPLAY_MODE },
    (synced) => {
      applyMode(synced.display_mode);

      chrome.storage.local.get({ articles: {} }, (cached) => {
        render(synced.selected_topics, cached.articles);
      });

      chrome.storage.local.get(
        {
          bubble_pos: DEFAULT_POS,
          bubble_docked: null,
          active_topic: null,
          opened_urls: {},
          seen_urls: {},
        },
        (local) => {
          history = { opened: local.opened_urls, seen: local.seen_urls };
          pos = fromPct(local.bubble_pos);
          applyPos();
          if (local.bubble_docked) setDocked(local.bubble_docked, false);
          if (local.active_topic) selectTopic(local.active_topic);
        }
      );
    }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {
      if (changes.selected_topics) {
        selectedTopics = changes.selected_topics.newValue;
        chrome.storage.local.get({ articles: {} }, (cached) => {
          render(selectedTopics, cached.articles);
        });
      }
      if (changes.display_mode) applyMode(changes.display_mode.newValue);
    }
    if (area === "local") {
      if (changes.articles) {
        const next = changes.articles.newValue || {};
        if (!sameArticles(next, articlesByTopic)) render(selectedTopics, next);
      }
      if (changes.bubble_pos) {
        pos = fromPct(changes.bubble_pos.newValue);
        applyPos();
      }
      if (changes.bubble_docked) setDocked(changes.bubble_docked.newValue, false);
      if (changes.opened_urls) history.opened = changes.opened_urls.newValue || {};
      if (changes.seen_urls) history.seen = changes.seen_urls.newValue || {};
    }
  });
})();
