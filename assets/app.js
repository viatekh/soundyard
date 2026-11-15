// Soundyard: loads stock from the Google Sheet (or the local fallback CSV)
// and renders the shop listing and item pages.
(function () {
  const cfg = window.SOUNDYARD;

  // RFC 4180-ish CSV parser: handles quoted fields, escaped quotes and newlines in quotes.
  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    const header = (rows.shift() || []).map((h) => h.trim().toLowerCase());
    return rows
      .filter((r) => r.some((v) => v.trim() !== ""))
      .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || "").trim()])));
  }

  // Drive share links don't embed as images; rewrite them to the thumbnail endpoint.
  function imageUrl(url) {
    const m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
    return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1200` : url;
  }

  function normalise(item) {
    const qty = parseInt(item.quantity, 10);
    const price = parseFloat(String(item.price).replace(/[^0-9.]/g, ""));
    return {
      ...item,
      status: (item.status || "available").toLowerCase(),
      quantity: Number.isNaN(qty) ? 1 : qty,
      price: Number.isNaN(price) ? null : price,
      photos: (item.photo_urls || "").split(/\s+/).filter(Boolean).map(imageUrl),
    };
  }

  // Sold, hidden and example rows never show; neither does anything out of stock
  // or a row that's been given an ID but not filled in yet.
  function isListed(item) {
    return ["available", "reserved"].includes(item.status) && item.quantity > 0 && item.id && item.title;
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const text = await res.text();
    // An unshared sheet redirects to a Google sign-in page instead of CSV.
    if (/^\s*</.test(text)) throw new Error(`not CSV: ${url}`);
    // A sheet with no header row yet comes back empty.
    if (!text.trim()) throw new Error(`empty: ${url}`);
    return text;
  }

  async function loadStock() {
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:csv`;
    let text;
    try {
      text = await fetchText(sheetUrl);
    } catch (err) {
      console.warn("Soundyard: sheet unavailable, using fallback CSV.", err);
      text = await fetchText(cfg.fallbackCsv);
    }
    return parseCsv(text).map(normalise).filter(isListed);
  }

  const money = (n) =>
    n === null ? "P.O.A."
      : new Intl.NumberFormat(cfg.locale, { style: "currency", currency: cfg.currency }).format(n);

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const itemHref = (item) => `item.html?id=${encodeURIComponent(item.id)}`;

  function enquireHref(item) {
    const subject = `Soundyard enquiry: ${item.title} (${item.id})`;
    return `mailto:${cfg.contactEmail}?subject=${encodeURIComponent(subject)}`;
  }

  const canBuy = (item) => item.status !== "reserved" && item.paypal_link && item.price !== null;

  function buyButton(item) {
    if (item.status === "reserved") return `<span class="tv-btn off">Reserved</span>`;
    if (canBuy(item)) {
      return `<a class="tv-btn go" href="${esc(item.paypal_link)}" target="_blank" rel="noopener">Buy with PayPal</a>`;
    }
    return `<a class="tv-btn" href="${enquireHref(item)}">Enquire</a>`;
  }

  function row(item) {
    const flag = item.status === "reserved" ? ` <span class="flag">RSVD</span>` : "";
    return `
      <tr tabindex="0" data-href="${itemHref(item)}">
        <td class="c-id">${esc(item.id)}</td>
        <td class="c-title"><a href="${itemHref(item)}">${esc(item.title)}</a>${flag}
          <span class="c-sub">${[item.category, item.condition].filter(Boolean).map(esc).join(" · ")}</span></td>
        <td class="c-cat">${esc(item.category)}</td>
        <td class="c-qty">${item.quantity}</td>
        <td class="c-price">${money(item.price)}</td>
      </tr>`;
  }

  // Up/down/Enter move through the listing like a file manager.
  function keyboardNav(tbody) {
    tbody.addEventListener("keydown", (e) => {
      const tr = e.target.closest("tr");
      if (!tr) return;
      if (e.key === "ArrowDown") { tr.nextElementSibling?.focus(); e.preventDefault(); }
      if (e.key === "ArrowUp") { tr.previousElementSibling?.focus(); e.preventDefault(); }
      if (e.key === "Enter") location.href = tr.dataset.href;
    });
    tbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr");
      if (tr && !e.target.closest("a")) location.href = tr.dataset.href;
    });
  }

  async function renderShop() {
    const tbody = document.getElementById("rows");
    const filters = document.getElementById("filters");
    const status = document.getElementById("status-count");
    const ticker = document.getElementById("ticker");
    const stock = await loadStock();
    const categories = [...new Set(stock.map((i) => i.category).filter(Boolean))].sort();
    let active = new URLSearchParams(location.search).get("cat") || "All";

    if (ticker && stock.length) {
      const newest = [...stock].sort((a, b) => (b.date_added || "").localeCompare(a.date_added || "")).slice(0, 6);
      const text = newest.map((i) => `NEW IN: ${esc(i.title)} — ${money(i.price)}`).join(" &nbsp;★&nbsp; ");
      ticker.innerHTML = `<span>${text} &nbsp;★&nbsp; </span><span aria-hidden="true">${text} &nbsp;★&nbsp; </span>`;
    }

    function draw() {
      filters.innerHTML = ["All", ...categories]
        .map((c) => `<button class="tab${c === active ? " on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`)
        .join("");
      const shown = active === "All" ? stock : stock.filter((i) => i.category === active);
      tbody.innerHTML = shown.length
        ? shown.map(row).join("")
        : `<tr class="empty"><td colspan="5">Nothing in the yard right now. Check back soon.</td></tr>`;
      if (status) status.textContent = `${shown.length} item${shown.length === 1 ? "" : "s"}`;
    }

    filters.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat]");
      if (!btn) return;
      active = btn.dataset.cat;
      history.replaceState(null, "", active === "All" ? location.pathname : `?cat=${encodeURIComponent(active)}`);
      draw();
    });
    keyboardNav(tbody);
    draw();
  }

  async function renderItem() {
    const el = document.getElementById("item");
    const id = new URLSearchParams(location.search).get("id");
    const item = (await loadStock()).find((i) => i.id === id);
    if (!item) {
      el.innerHTML = `<p class="err">ERROR 404: item not found. It may have sold. <a href="index.html">Back to the yard</a></p>`;
      return;
    }
    document.title = `${item.title} · Soundyard`;
    document.getElementById("item-title").textContent = `${item.id}: ${item.title}`;
    const specs = [
      ["Brand", item.brand], ["Model", item.model], ["Condition", item.condition],
      ["Qty", item.quantity > 1 ? `${item.quantity} available` : ""], ["Shipping", item.shipping || cfg.defaultShipping],
      ["Category", item.category],
    ].filter(([, v]) => v);
    // Items without photos get a single-column layout instead of a placeholder.
    el.classList.toggle("no-media", !item.photos.length);
    el.innerHTML = `
      ${item.photos.length ? `<div class="item-media">
        <div class="frame"><img class="item-img" src="${esc(item.photos[0])}" alt="${esc(item.title)}"></div>
        ${item.photos.length > 1 ? `<div class="thumbs">${item.photos.map((p) => `<img src="${esc(p)}" alt="" loading="lazy">`).join("")}</div>` : ""}
      </div>` : ""}
      <div class="item-info">
        <h1>${esc(item.title)}</h1>
        <div class="big-price">${money(item.price)}</div>
        <p class="desc">${esc(item.description)}</p>
        ${specs.length ? `<table class="specs">${specs.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join("")}</table>` : ""}
        <div class="actions">${buyButton(item)}${canBuy(item) ? `<a class="tv-btn" href="${enquireHref(item)}">Ask a question</a>` : ""}</div>
      </div>`;
    el.querySelector(".thumbs")?.addEventListener("click", (e) => {
      if (e.target.tagName === "IMG") el.querySelector(".item-img").src = e.target.src;
    });
  }

  // Splash quip: the sheet's "quips" tab (one per row, header "quip") plus our own list.
  async function showQuip() {
    const el = document.getElementById("quip");
    if (!el) return;
    const lines = [];
    try {
      // gviz returns the first tab when "quips" doesn't exist, so check the header.
      const rows = parseCsv(await fetchText(`https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:csv&sheet=quips`));
      if (rows.length && "quip" in rows[0]) lines.push(...rows.map((r) => r.quip).filter(Boolean));
    } catch (err) { /* no quips tab yet */ }
    try {
      lines.push(...(await fetchText("data/quips.txt")).split("\n").map((l) => l.trim()).filter(Boolean));
    } catch (err) { /* built-in list missing */ }
    if (lines.length) el.textContent = lines[Math.floor(Math.random() * lines.length)];
  }

  function fillContact() {
    document.querySelectorAll("[data-email]").forEach((a) => {
      a.href = `mailto:${cfg.contactEmail}`;
      a.textContent = cfg.contactEmail;
    });
    document.querySelectorAll("[data-location]").forEach((n) => (n.textContent = cfg.location));
  }

  function clock() {
    const el = document.getElementById("clock");
    if (!el) return;
    const tick = () => (el.textContent = new Date().toLocaleTimeString(cfg.locale, { hour: "2-digit", minute: "2-digit" }));
    tick();
    setInterval(tick, 30000);
  }

  const page = document.body.dataset.page;
  fillContact();
  clock();
  showQuip();
  if (page === "shop") renderShop();
  if (page === "item") renderItem();

  window.SoundyardTest = { parseCsv, normalise, isListed, imageUrl };
})();
