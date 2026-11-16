// Soundyard: loads stock from the Google Sheet (or the local fallback CSV)
// and renders the shop listing and item pages.
(function () {
  const cfg = window.SOUNDYARD;

  // RFC 4180-ish CSV parser: handles quoted fields, escaped quotes and newlines in quotes.
  function parseRows(text) {
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
    return rows;
  }

  function parseCsv(text) {
    const rows = parseRows(text);
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

  // A row needs an ID and a title before it shows anywhere (example rows never do).
  const isReal = (item) => item.id && item.title && item.status !== "example";
  // For sale: available or reserved, and in stock.
  const isListed = (item) => isReal(item) && ["available", "reserved"].includes(item.status) && item.quantity > 0;
  const isSold = (item) => isReal(item) && item.status === "sold";

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

  const tabUrl = (tab) =>
    `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:csv${tab ? `&sheet=${encodeURIComponent(tab)}` : ""}`;

  // Every real row from the stock tab, listed or sold.
  let itemsPromise;
  function loadItems() {
    itemsPromise ??= (async () => {
      let text;
      try {
        text = await fetchText(tabUrl());
      } catch (err) {
        console.warn("Soundyard: sheet unavailable, using fallback CSV.", err);
        text = await fetchText(cfg.fallbackCsv);
      }
      return parseCsv(text).map(normalise).filter(isReal);
    })();
    return itemsPromise;
  }

  // Rows from another tab. gviz returns the first tab when the named one doesn't
  // exist, so the tab only counts if it has the expected header column.
  async function loadTab(tab, column) {
    try {
      const rows = parseCsv(await fetchText(tabUrl(tab)));
      return rows.length && column in rows[0] ? rows : [];
    } catch (err) {
      return [];
    }
  }

  // First column of a one-column tab, header optional. A missing tab comes back as
  // the stock tab (first cell "id"), which counts as empty.
  async function loadList(tab, header) {
    try {
      const rows = parseRows(await fetchText(`${tabUrl(tab)}&headers=0`));
      if ((rows[0]?.[0] || "").trim().toLowerCase() === "id") return [];
      return rows.map((r) => (r[0] || "").trim()).filter((v) => v && v.toLowerCase() !== header);
    } catch (err) {
      return [];
    }
  }

  const byNewest = (a, b) => (b.date_added || "").localeCompare(a.date_added || "");

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

  const canBuy = (item) => isListed(item) && item.status !== "reserved" && item.paypal_link && item.price !== null;

  function buyButton(item) {
    if (item.status === "sold") return `<span class="tv-btn off">Sold</span>`;
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
    const items = await loadItems();
    const stock = items.filter(isListed);
    const sold = items.filter(isSold).sort(byNewest);
    const categories = [...new Set(stock.map((i) => i.category).filter(Boolean))].sort();
    let active = new URLSearchParams(location.search).get("cat") || "All";

    const news = [
      ...[...stock].sort(byNewest).slice(0, 6).map((i) => `NEW IN: ${esc(i.title)} — ${money(i.price)}`),
      ...sold.slice(0, 3).map((i) => `JUST SOLD: ${esc(i.title)}`),
    ];
    if (ticker && news.length) {
      const text = news.join(" &nbsp;★&nbsp; ");
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

    const soldWin = document.getElementById("sold");
    if (soldWin && sold.length) {
      soldWin.hidden = false;
      const soldRows = document.getElementById("sold-rows");
      soldRows.innerHTML = sold.map((item) => `
        <tr tabindex="0" data-href="${itemHref(item)}">
          <td class="c-id">${esc(item.id)}</td>
          <td class="c-title"><a href="${itemHref(item)}">${esc(item.title)}</a>
            <span class="c-sub">${esc(item.category)}</span></td>
          <td class="c-cat">${esc(item.category)}</td>
          <td class="c-price"><span class="flag">SOLD</span></td>
        </tr>`).join("");
      keyboardNav(soldRows);
    }
  }

  async function renderItem() {
    const el = document.getElementById("item");
    const id = new URLSearchParams(location.search).get("id");
    const item = (await loadItems()).find((i) => i.id === id && (isListed(i) || isSold(i)));
    if (!item) {
      el.innerHTML = `<p class="err">ERROR 404: item not found. It may have sold. <a href="index.html">Back to the yard</a></p>`;
      return;
    }
    document.title = `${item.title} · Soundyard`;
    document.getElementById("item-title").textContent = `${item.id}: ${item.title}`;
    const specs = [
      ["Brand", item.brand], ["Model", item.model], ["Condition", item.condition],
      ["Qty", isListed(item) && item.quantity > 1 ? `${item.quantity} available` : ""], ["Shipping", item.shipping || cfg.defaultShipping],
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
        <div class="big-price">${isSold(item) ? "SOLD" : money(item.price)}</div>
        <p class="desc">${esc(item.description)}</p>
        ${specs.length ? `<table class="specs">${specs.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join("")}</table>` : ""}
        <div class="actions">${buyButton(item)}${canBuy(item) ? `<a class="tv-btn" href="${enquireHref(item)}">Ask a question</a>` : ""}</div>
      </div>`;
    el.querySelector(".thumbs")?.addEventListener("click", (e) => {
      if (e.target.tagName === "IMG") el.querySelector(".item-img").src = e.target.src;
    });
  }

  // Splash quip: the sheet's "quips" tab (one per row in column A, "quip" header optional) plus our own list.
  async function showQuip() {
    const el = document.getElementById("quip");
    if (!el) return;
    // The sheet is the list; data/quips.txt is only a backup for when it can't be read.
    let lines = await loadList("quips", "quip");
    if (!lines.length) {
      try {
        lines = (await fetchText("data/quips.txt")).split("\n").map((l) => l.trim()).filter(Boolean);
      } catch (err) { /* backup list missing */ }
    }
    lines = [...new Set(lines)];
    if (lines.length) el.textContent = lines[Math.floor(Math.random() * lines.length)];
  }

  // Wanted: the sheet's "wanted" tab, columns item / notes / budget.
  async function renderWanted() {
    const el = document.getElementById("wanted");
    const rows = (await loadTab("wanted", "item")).filter((r) => r.item);
    el.innerHTML = rows.length
      ? `<table class="listing static">
          <thead><tr><th>Item</th><th class="c-cat">Notes</th><th class="c-price">Budget</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td class="c-title"><strong>${esc(r.item)}</strong>
            <span class="c-sub">${esc(r.notes)}</span></td><td class="c-cat">${esc(r.notes)}</td>
            <td class="c-price">${esc(r.budget) || "ask"}</td></tr>`).join("")}</tbody></table>`
      : `<p class="dim">Nothing on the list right now. Got something good anyway? Tell us.</p>`;
  }

  // Posts straight to a Google Form so the form can live on our own page.
  // Google doesn't send CORS headers back, so the reply is opaque: no error means sent.
  async function postForm(form, values) {
    const body = new URLSearchParams();
    for (const [key, entry] of Object.entries(form.fields)) body.append(entry, values[key] || "");
    await fetch(form.action, { method: "POST", mode: "no-cors", body });
  }

  const formReady = (form) => form && form.action && form.fields && Object.values(form.fields).every(Boolean);

  // Guestbook: signed through a Google Form whose responses land in the "guestbook" tab.
  // Type anything in a "hide" column to take a message down.
  async function renderGuestbook() {
    const list = document.getElementById("entries");
    const form = document.getElementById("sign");
    const draw = (rows) => {
      list.innerHTML = rows.length
        ? rows.map((r) => `
          <article class="entry">
            <header><strong>${esc(r.name) || "anon"}</strong>${r.where ? ` <span class="dim">from ${esc(r.where)}</span>` : ""}
              <span class="dim when">${esc(r.timestamp)}</span></header>
            <p>${esc(r.message)}</p>
          </article>`).join("")
        : `<p class="dim">No entries yet. Be the first. First post!</p>`;
    };
    const rows = (await loadTab("guestbook", "message"))
      .map((r) => ({ ...r, where: r["where from"] || r.where }))
      .filter((r) => r.message && !r.hide)
      .reverse();
    draw(rows);

    if (!formReady(cfg.guestbookForm)) {
      form.innerHTML = `<p class="dim">The guestbook pen is out of ink. Signing opens soon.</p>`;
      return;
    }
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      if (!values.message.trim()) return;
      form.querySelector("button").disabled = true;
      try {
        await postForm(cfg.guestbookForm, values);
        rows.unshift({ ...values, timestamp: "just now" });
        draw(rows);
        form.innerHTML = `<p><strong>Signed!</strong> Cheers. Your message is up.</p>`;
      } catch (err) {
        form.querySelector("button").disabled = false;
        form.insertAdjacentHTML("beforeend", `<p class="err">Couldn't send that. Try again?</p>`);
      }
    });
  }

  // New-stock alerts: an email box posting to a Google Form whose responses stay
  // private (NOT in the public stock spreadsheet).
  function initAlerts() {
    const form = document.getElementById("alerts");
    if (!form || !formReady(cfg.alertsForm)) return;
    form.hidden = false;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = form.email.value.trim();
      if (!email) return;
      form.querySelector("button").disabled = true;
      try {
        await postForm(cfg.alertsForm, { email });
        form.innerHTML = `<p><strong>You're on the list.</strong> We'll email when good stuff lands.</p>`;
      } catch (err) {
        form.querySelector("button").disabled = false;
      }
    });
  }

  // 1080×1080 social image for one item (tools/make-cards.sh screenshots it).
  async function renderCard() {
    const id = new URLSearchParams(location.search).get("id");
    const item = (await loadItems()).find((i) => i.id === id);
    const el = document.getElementById("card");
    if (!item) { el.textContent = `No item ${id}`; return; }
    el.classList.toggle("has-photo", item.photos.length > 0);
    el.innerHTML = `
      ${item.photos.length ? `<img class="card-photo" src="${esc(item.photos[0])}" alt="">` : ""}
      <div class="card-text">
        <div class="card-kicker">${isSold(item) ? "JUST SOLD" : "NEW IN"} · ${esc(item.id)}</div>
        <h1>${esc(item.title)}</h1>
        <div class="card-price">${isSold(item) ? "SOLD" : money(item.price)}</div>
        ${!item.photos.length && item.description ? `<p class="card-desc">${esc(item.description.length > 180 ? item.description.slice(0, 177) + "…" : item.description)}</p>` : ""}
        ${item.condition ? `<div class="card-meta">${esc(item.condition)}${item.category ? ` · ${esc(item.category)}` : ""}</div>` : ""}
      </div>`;
    document.body.dataset.ready = "1";
  }

  function fillContact() {
    document.querySelectorAll("[data-email]").forEach((a) => {
      a.href = `mailto:${cfg.contactEmail}`;
      a.textContent = cfg.contactEmail;
    });
    document.querySelectorAll("[data-location]").forEach((n) => (n.textContent = cfg.location));
    document.querySelectorAll("[data-email-subject]").forEach((a) => {
      a.href = `mailto:${cfg.contactEmail}?subject=${encodeURIComponent(a.dataset.emailSubject)}`;
    });
    document.querySelectorAll("[data-site]").forEach((n) => (n.textContent = cfg.siteUrl));
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
  if (page === "shop") { renderShop(); initAlerts(); }
  if (page === "item") renderItem();
  if (page === "wanted") renderWanted();
  if (page === "guestbook") renderGuestbook();
  if (page === "card") renderCard();

  window.SoundyardTest = { parseCsv, normalise, isListed, isSold, imageUrl };
})();
