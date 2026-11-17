/* ============================================================
   SØLAR — app: router, i18n, cart, animations
   Vanilla JS, no build step.
   ============================================================ */
(async function () {
  "use strict";

  try { await window.SOLAR_READY; } catch (_) { return; }

  let CFG = window.SOLAR.CONFIG;
  let PRODUCTS = window.SOLAR.PRODUCTS;
  let I18N = window.SOLAR.I18N;
  let CONTENT = window.SOLAR.CONTENT || {};
  const API = window.SOLAR_API;
  const LANGS = ["en", "uk", "ru", "fr"];

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------------- state ---------------- */
  const state = {
    lang: (function () {
      try {
        const saved = localStorage.getItem("solar_lang");
        if (saved && LANGS.includes(saved)) return saved;
      } catch (e) {}
      const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
      return LANGS.includes(nav) ? nav : "en";
    })(),
    cart: (function () {
      try { return JSON.parse(localStorage.getItem("solar_cart_v1")) || []; }
      catch (e) { return []; }
    })(),
    shop: { cat: "all", sort: "new", size: "all", onlyAvailable: false },
    acct: { userId: null, tab: "orders", orders: null, loading: false, open: {}, tracking: {}, error: "" },
    checkoutDelivery: null, checkoutContact: {}, checkoutPayment: "cod", lastPaymentError: "", payView: null,
    route: null
  };

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------------- i18n ---------------- */
  function rawT(key) {
    const current = I18N[state.lang] || {};
    if (Object.prototype.hasOwnProperty.call(current, key)) return String(current[key] ?? "");
    const fallback = I18N.en || {};
    return Object.prototype.hasOwnProperty.call(fallback, key) ? String(fallback[key] ?? "") : key;
  }
  function t(key) { return esc(rawT(key)); }
  function applyI18n(root) {
    $$("[data-i18n]", root || document).forEach(el => {
      el.textContent = rawT(el.getAttribute("data-i18n"));
    });
    $$("[data-i18n-aria-label]", root || document).forEach(el => {
      el.setAttribute("aria-label", rawT(el.getAttribute("data-i18n-aria-label")));
    });
    document.documentElement.lang = state.lang;
    $$(".lang-btn").forEach(b => b.classList.toggle("active", b.dataset.lang === state.lang));
    syncTheme();
    applyShell();
  }
  function setLang(lang) {
    if (!LANGS.includes(lang) || lang === state.lang) return;
    state.lang = lang;
    try { localStorage.setItem("solar_lang", lang); } catch (e) {}
    applyI18n();
    render(false); // re-render current page without transition
    renderCartDrawer();
    if ($("#accountPanel").classList.contains("open")) renderAccount();
  }

  function syncTheme() {
    const dark = document.documentElement.dataset.theme !== "light";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const button = $("#themeBtn");
    button.setAttribute("aria-label", rawT("theme.dark"));
    button.setAttribute("aria-pressed", String(dark));
    button.title = rawT(dark ? "theme.switchLight" : "theme.switchDark");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || (dark ? "#080808" : "#F4F4F2");
  }

  /* ---------------- helpers ---------------- */
  function fmt(n) { return esc(CFG.currency) + " " + Number(n).toLocaleString("uk-UA"); }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function localized(value) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    if (Object.prototype.hasOwnProperty.call(value, state.lang)) return String(value[state.lang] ?? "");
    return String(value.en ?? Object.values(value)[0] ?? "");
  }
  function href(value, fallback = "#/") { return esc(window.SOLAR_SAFE_URL(value) || fallback); }
  function image(value) { const url = window.SOLAR_SAFE_URL(value); return /^(https?:|\/)/.test(url) ? url : ""; }
  function gallery(p) { return Array.isArray(p.images) && p.images.length ? p.images : (Array.isArray(p.gallery) && p.gallery.length ? p.gallery : ["front"]); }
  function brand() { return esc(CFG.brand || "SØLAR"); }
  function validColor(value) { return /^#[0-9a-f]{3,8}$/i.test(value || "") ? value : "#111111"; }
  function stockTotal(p) { return Object.values(p.sizes).reduce((a, b) => a + b, 0); }
  function stockLabel(p) {
    const s = stockTotal(p);
    if (s === 0) return { k: "misc.soldOut", cls: "sold" };
    if (s <= 4) return { k: "misc.lowStock", cls: "low" };
    return { k: "misc.inStock", cls: "ok" };
  }

  function applyShell() {
    $$(".logo,.footer-logo,.modal-eyebrow,.account-brand").forEach(el => { el.textContent = CFG.brand || "SØLAR"; });
    if (image(CFG.logoImage)) $$(".logo,.footer-logo").forEach(el => { const logo = document.createElement("img"); logo.src = image(CFG.logoImage); logo.alt = CFG.brand; logo.className = "cms-logo"; el.replaceChildren(logo); });
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) { if (!favicon.dataset.original) favicon.dataset.original = favicon.href; favicon.href = image(CFG.favicon) || favicon.dataset.original; }
    let ogImage = document.querySelector('meta[property="og:image"]');
    if (image(CFG.ogImage)) { if (!ogImage) { ogImage = document.createElement("meta"); ogImage.setAttribute("property", "og:image"); document.head.append(ogImage); } ogImage.content = image(CFG.ogImage); }
    else if (ogImage) ogImage.remove();
    $(".logo").setAttribute("aria-label", (CFG.brand || "SØLAR") + " — " + rawT("a11y.home"));
    const introLogo = $(".intro-logo");
    if (introLogo) {
      introLogo.innerHTML = Array.from(CFG.brand || "SØLAR").map((ch, i) => `<span style="--d:${i}">${esc(ch)}</span>`).join("");
      introLogo.setAttribute("aria-label", CFG.brand || "SØLAR");
    }
    const tagline = CONTENT.brandTagline === undefined ? "BEYOND THE LIGHT." : localized(CONTENT.brandTagline);
    $$(".footer-slogan,.intro-tag").forEach(el => { el.textContent = tagline; });
    const introChoose = $(".intro-choose");
    if (introChoose) introChoose.textContent = CONTENT.introLanguagePrompt === undefined ? rawT("intro.languagePrompt") : localized(CONTENT.introLanguagePrompt);
    $$("[data-intro-lang]").forEach(el => { el.textContent = rawT("language." + el.dataset.introLang); });
    const menuFoot = $(".mobile-menu-foot p"); if (menuFoot) menuFoot.textContent = tagline + " EST. " + (CFG.est || "2026");
    const navEntries = Array.isArray(CONTENT.navigation) ? CONTENT.navigation : [];
    const navHTML = entries => entries.map((entry, i) => {
      const label = entry.label ? localized(entry.label) : rawT(entry.labelKey || "");
      const target = window.SOLAR_SAFE_URL(entry.href) || "#/";
      const route = target.replace(/^#\//, "").split("/")[0];
      return `<a href="${esc(target)}" data-nav="${esc(route)}" style="--i:${i}"${/^https?:/.test(target) ? ' target="_blank" rel="noopener noreferrer"' : ""}>${esc(label)}</a>`;
    }).join("");
    if (navEntries.length || Array.isArray(CONTENT.navigation)) {
      $(".main-nav").innerHTML = navHTML(navEntries); $(".mobile-nav").innerHTML = navHTML(navEntries);
    }
    if (Array.isArray(CONTENT.footerNavigation)) $(".footer-nav").innerHTML = navHTML(CONTENT.footerNavigation);
    const socialLinks = Object.entries(CFG.social || {}).filter(([, url]) => !!window.SOLAR_SAFE_URL(url));
    $(".footer-social").innerHTML = socialLinks.length ? `<span class="footer-social-label">${t("footer.social")}</span>` + socialLinks.map(([name, url]) => `<a class="soc-item" href="${href(url)}" target="_blank" rel="noopener noreferrer">${esc(name.toUpperCase())} ↗</a>`).join("") : "";
    const admin = API.user && API.user.role === "admin" ? `<a class="footer-admin" href="/admin.html">${t("account.admin")} ↗</a>` : "";
    $(".footer-bottom").innerHTML = `<span>© ${esc(CFG.est || "2026")} ${brand()}. ${t("footer.rights")}</span><span>${esc(CFG.founders || "")}</span>${admin}`;
    const ribbon = $(".test-ribbon");
    const showRibbon = CFG.announcementEnabled === true;
    ribbon.hidden = !showRibbon;
    document.body.classList.toggle("no-ribbon", !showRibbon);
    if (showRibbon) ribbon.firstElementChild.textContent = CFG.announcementText ? localized(CFG.announcementText) : rawT("misc.announcement");
    $("#searchInput").placeholder = rawT("nav.search") + "…";
    $("#accountBtn").setAttribute("aria-label", rawT("nav.account"));
  }

  async function refreshSite() {
    await window.SOLAR_REFRESH();
    CFG = window.SOLAR.CONFIG; PRODUCTS = window.SOLAR.PRODUCTS; I18N = window.SOLAR.I18N; CONTENT = window.SOLAR.CONTENT || {};
    sanitizeCart(); applyI18n(); updateCartBadge(false); renderCartDrawer();
  }

  /* ---------------- account ---------------- */
  let accountMode = "login", accountSeq = 0;
  async function openAccount() {
    lastFocus = document.activeElement;
    openMenu(false);
    const panel = $("#accountPanel");
    panel.classList.add("open"); panel.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    $("#accountClose").focus();
    $("#accountBody").textContent = rawT("account.loading");
    try {
      await API.request("/api/auth/me"); await renderAccount();
      if (panel.classList.contains("open")) ($("#accountBody input") || $("#accountClose")).focus();
    }
    catch (error) { $("#accountBody").textContent = error.message; }
  }
  function closeAccount() {
    accountSeq++;
    const panel = $("#accountPanel");
    panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
  }
  function accountField(name, key, type, value = "", autocomplete = "", required = true) {
    return `<label>${t(key)}<input name="${name}" type="${type}" value="${esc(value || "")}" autocomplete="${autocomplete}" ${required ? "required" : ""} ${type === "password" && name !== "currentPassword" ? 'minlength="8" maxlength="128"' : 'maxlength="160"'}></label>`;
  }
  async function renderAccount(notice = "") {
    const seq = ++accountSeq;
    const user = API.user;
    if (!user) {
      const register = accountMode === "register";
      $("#accountBody").innerHTML = `<h2 class="account-title">${t("account.title")}</h2><p class="account-sub">${t("account.text")}</p><div class="account-tabs"><button class="${!register ? "active" : ""}" data-account-mode="login">${t("account.login")}</button><button class="${register ? "active" : ""}" data-account-mode="register">${t("account.register")}</button></div><form class="account-form" data-account-action="${register ? "register" : "login"}">${accountField("username", register ? "account.newUsername" : "account.username", "text", "", "username")}${register ? accountField("email", "account.email", "email", "", "email") : ""}${accountField("password", "account.password", "password", "", register ? "new-password" : "current-password")}<button class="btn solid" type="submit">${t(register ? "account.register" : "account.login")}</button></form><p class="account-notice" role="status">${esc(notice)}</p><p class="account-sub">${t("account.authHint")}</p>`;
      return;
    }
    if (seq !== accountSeq) return;
    $("#accountBody").innerHTML = `<p class="sec-eyebrow">${esc(user.role === "admin" ? "ADMIN" : rawT("account.customer"))}</p><h2 class="account-title">${esc(user.displayName || user.username)}</h2><p class="account-sub">${t("account.signInText")}</p><div class="account-actions"><a class="btn solid" href="#/account" data-account-cabinet>${t("account.openCabinet")} →</a>${user.role === "admin" ? `<a class="btn" href="/admin.html">${t("account.admin")} ↗</a>` : ""}<button class="link-u" data-account-logout>${t("account.logout")}</button></div><p class="account-notice" role="status">${esc(notice)}</p>`;
  }
  function bindAccount() {
    $("#accountClose").addEventListener("click", closeAccount);
    $("#accountPanel").addEventListener("click", e => { if (e.target.id === "accountPanel") closeAccount(); });
    $("#accountBody").addEventListener("click", async e => {
      if (e.target.closest("[data-account-cabinet]")) { closeAccount(); return; }
      const mode = e.target.closest("[data-account-mode]");
      if (mode) { accountMode = mode.dataset.accountMode; renderAccount(); }
      const logout = e.target.closest("[data-account-logout]");
      if (logout) {
        logout.disabled = true;
        try { await API.request("/api/auth/logout", { method: "POST", body: {} }); accountMode = "login"; await renderAccount(); }
        catch (error) { toast(error.message); logout.disabled = false; }
      }
    });
    $("#accountBody").addEventListener("submit", async e => {
      const form = e.target.closest("[data-account-action]"); if (!form) return;
      e.preventDefault(); if (!form.reportValidity() || form.classList.contains("submit-busy")) return;
      const action = form.dataset.accountAction;
      const data = Object.fromEntries(new FormData(form));
      const message = form.nextElementSibling;
      form.classList.add("submit-busy"); form.querySelector('button[type="submit"]').disabled = true;
      if (message) { message.textContent = ""; message.classList.remove("error"); }
      try {
        const path = action === "profile" ? "/api/account/profile" : "/api/auth/" + action;
        await API.request(path, { method: action === "profile" ? "PATCH" : "POST", body: data });
        if (action === "password") {
          form.reset(); if (message) message.textContent = rawT("account.passwordChanged");
        } else if (action === "login" || action === "register") {
          closeAccount(); state.acct = { userId: null, tab: "orders", orders: null, loading: false, open: {}, tracking: {}, error: "" };
          if (location.hash === "#/account") render(false); else location.hash = "#/account";
        } else await renderAccount(action === "profile" ? rawT("account.saved") : "");
      } catch (error) { if (message) { message.textContent = error.message; message.classList.add("error"); } }
      finally { form.classList.remove("submit-busy"); const button = form.querySelector('button[type="submit"]'); if (button) button.disabled = false; }
    });
    $("#accountPanel").addEventListener("keydown", e => {
      if (e.key === "Escape") { e.stopPropagation(); closeAccount(); }
      if (e.key !== "Tab") return;
      const controls = $$("a[href],button,input,summary", $("#accountPanel")).filter(el => !el.disabled && el.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    addEventListener("solar-auth", () => { applyShell(); if (state.route && state.route.page === "account" && !state.acct.busy) render(false); });
  }

  /* ---------------- placeholder visuals (no stock photos) ---------------- */
  /* Генерирует тёмные студийные SVG-заглушки с мотивом затмения.
     Помечены DEMO VISUAL — заменить на реальные фото при их появлении. */
  function ph(variant, title, sub, seed) {
    seed = seed || 0;
    const cx = 300, cy = 330 + ((seed * 37) % 40) - 20;
    let art = "";
    if (variant === "front") {
      art = `<circle cx='${cx}' cy='${cy}' r='118' fill='none' stroke='#3a3a3a' stroke-width='1'/>
             <circle cx='${cx}' cy='${cy}' r='117' fill='#0b0b0b'/>
             <circle cx='${cx}' cy='${cy}' r='118' fill='none' stroke='#8f8f8f' stroke-opacity='.75' stroke-width='1.5' stroke-dasharray='560 190' transform='rotate(${(seed * 53) % 360} ${cx} ${cy})'/>
             <text x='${cx}' y='${cy + 6}' text-anchor='middle' font-family='monospace' font-size='15' letter-spacing='9' fill='#6d6d6d'>SØLAR</text>`;
    } else if (variant === "back") {
      art = `<circle cx='${cx}' cy='${cy - 10}' r='150' fill='none' stroke='#2f2f2f' stroke-width='1'/>
             <circle cx='${cx}' cy='${cy - 10}' r='150' fill='none' stroke='#9a9a9a' stroke-opacity='.8' stroke-width='2' stroke-dasharray='230 720' transform='rotate(-55 ${cx} ${cy - 10})'/>
             <line x1='150' y1='${cy + 120}' x2='450' y2='${cy + 120}' stroke='#2c2c2c'/>
             <text x='${cx}' y='${cy + 150}' text-anchor='middle' font-family='monospace' font-size='11' letter-spacing='7' fill='#5a5a5a'>BEYOND THE LIGHT</text>
             <text x='${cx}' y='${cy - 2}' text-anchor='middle' font-family='monospace' font-size='44' letter-spacing='4' fill='#1f1f1f' stroke='#4e4e4e' stroke-width='.6'>Ø</text>`;
    } else if (variant === "detail") {
      art = `<circle cx='${430 + (seed % 3) * 20}' cy='${cy + 60}' r='260' fill='none' stroke='#383838' stroke-width='1'/>
             <circle cx='${430 + (seed % 3) * 20}' cy='${cy + 60}' r='260' fill='none' stroke='#8a8a8a' stroke-opacity='.6' stroke-width='2' stroke-dasharray='180 1500'/>
             <line x1='120' y1='170' x2='320' y2='170' stroke='#2e2e2e'/>
             <text x='120' y='150' font-family='monospace' font-size='10' letter-spacing='6' fill='#5d5d5d'>DETAIL — ${(seed % 9) + 1}00</text>`;
    } else { // editorial
      art = `<circle cx='${cx}' cy='300' r='${130 + (seed % 4) * 26}' fill='#0a0a0a' stroke='#3c3c3c'/>
             <circle cx='${cx}' cy='300' r='${131 + (seed % 4) * 26}' fill='none' stroke='#a0a0a0' stroke-opacity='.55' stroke-width='1.6' stroke-dasharray='420 480' transform='rotate(${seed * 77} ${cx} 300)'/>
             <line x1='60' y1='${560 + (seed % 3) * 30}' x2='540' y2='${520 + (seed % 5) * 20}' stroke='#2a2a2a'/>`;
    }
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='750' viewBox='0 0 600 750'>
        <defs>
          <radialGradient id='g' cx='50%' cy='42%' r='75%'>
            <stop offset='0%' stop-color='#1d1d1d'/><stop offset='55%' stop-color='#141414'/><stop offset='100%' stop-color='#0d0d0d'/>
          </radialGradient>
          <filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/><feComponentTransfer><feFuncA type='linear' slope='0.05'/></feComponentTransfer><feComposite operator='over' in2='SourceGraphic'/></filter>
        </defs>
        <rect width='600' height='750' fill='url(#g)'/>
        <rect width='600' height='750' fill='#000' opacity='0' filter='url(#n)'/>
        ${art}
        <text x='40' y='706' font-family='monospace' font-size='13' letter-spacing='5' fill='#8c8c8c'>${esc(title || "")}</text>
        <text x='40' y='684' font-family='monospace' font-size='9' letter-spacing='4' fill='#4f4f4f'>${esc(sub || "")}</text>
        <text x='560' y='48' text-anchor='end' font-family='monospace' font-size='9' letter-spacing='3' fill='#444'>DEMO VISUAL</text>
      </svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace(/\s{2,}/g, " "));
  }
  function productImg(p, i) {
    if (!p) return ph("editorial", CFG.brand, "", 1);
    if (p.images && image(p.images[i] || p.images[0])) return image(p.images[i] || p.images[0]);
    const variant = (p.gallery && p.gallery[i]) || "front";
    const seed = p.id.length * 7 + i * 13;
    return ph(variant, p.name, p.collection + " — " + variant.toUpperCase(), seed);
  }

  /* ---------------- cart ---------------- */
  function saveCart() {
    try { localStorage.setItem("solar_cart_v1", JSON.stringify(state.cart)); } catch (e) {}
  }
  function sanitizeCart() {
    const cleaned = new Map();
    for (const line of Array.isArray(state.cart) ? state.cart : []) {
      if (!line || typeof line.id !== "string" || typeof line.size !== "string") continue;
      const p = PRODUCTS.find(x => x.id === line.id);
      const available = p && Number(p.sizes && p.sizes[line.size]);
      if (!Number.isInteger(available) || available < 1) continue;
      const key = line.id + ":" + line.size;
      const existing = cleaned.get(key);
      const qty = Math.max(1, Math.min(available, Math.floor(Number(line.qty) || 1) + (existing ? existing.qty : 0)));
      cleaned.set(key, { id: line.id, size: line.size, qty });
    }
    state.cart = [...cleaned.values()]; saveCart();
  }
  function cartCount() { return state.cart.reduce((a, i) => a + i.qty, 0); }
  function cartTotal() {
    return state.cart.reduce((sum, i) => {
      const p = PRODUCTS.find(x => x.id === i.id);
      return p ? sum + p.price * i.qty : sum;
    }, 0);
  }
  function addToCart(id, size) {
    const p = PRODUCTS.find(x => x.id === id);
    if (!p || !(size in p.sizes) || p.sizes[size] === 0) return false;
    const line = state.cart.find(i => i.id === id && i.size === size);
    const max = p.sizes[size];
    if (line) line.qty = Math.min(line.qty + 1, max);
    else state.cart.push({ id, size, qty: 1 });
    saveCart(); updateCartBadge(true); renderCartDrawer();
    return true;
  }
  function setQty(id, size, qty) {
    const p = PRODUCTS.find(x => x.id === id);
    const line = state.cart.find(i => i.id === id && i.size === size);
    if (!line || !p) return;
    line.qty = Math.max(1, Math.min(qty, p.sizes[size] || 1));
    saveCart(); updateCartBadge(false); renderCartDrawer();
    if (state.route && state.route.page === "checkout") render(false);
  }
  function removeLine(id, size) {
    state.cart = state.cart.filter(i => !(i.id === id && i.size === size));
    saveCart(); updateCartBadge(false); renderCartDrawer();
    if (state.route && state.route.page === "checkout") render(false);
  }
  function updateCartBadge(bump) {
    const el = $("#cartCount");
    el.textContent = cartCount();
    if (bump && !reduceMotion.matches) {
      el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
    }
  }
  function renderCartDrawer() {
    const body = $("#cartBody"), foot = $("#cartFoot");
    if (!state.cart.length) {
      body.innerHTML =
        `<div class="cart-empty">
          <p>${t("cart.empty")}</p>
          <a href="#/shop" class="btn ghost" data-close-cart>${t("cart.emptyCta")}</a>
        </div>`;
      foot.innerHTML = "";
      return;
    }
    body.innerHTML = state.cart.map((line, idx) => {
      const p = PRODUCTS.find(x => x.id === line.id);
      if (!p) return "";
      return `<div class="cart-item" style="animation-delay:${idx * 60}ms">
        <a class="cart-item-img" href="#/product/${esc(p.id)}" data-close-cart><img src="${esc(productImg(p, 0))}" alt="${esc(p.name)}"></a>
        <div class="cart-item-info">
          <b>${esc(p.name)}</b>
          <span>${t("product.size")}: ${esc(line.size)} · ${fmt(p.price)}</span>
          <div class="qty">
            <button data-qty="-1" data-id="${esc(p.id)}" data-size="${esc(line.size)}" aria-label="${t("a11y.decreaseQuantity")}">−</button>
            <b>${line.qty}</b>
            <button data-qty="1" data-id="${esc(p.id)}" data-size="${esc(line.size)}" aria-label="${t("a11y.increaseQuantity")}">+</button>
          </div>
        </div>
        <div class="cart-item-side">
          <b>${fmt(p.price * line.qty)}</b>
          <button class="rm-btn" data-rm data-id="${esc(p.id)}" data-size="${esc(line.size)}">${t("cart.remove")}</button>
        </div>
      </div>`;
    }).join("");
    foot.innerHTML =
      `<div class="cart-sub"><span>${t("cart.subtotal")}</span><b>${fmt(cartTotal())}</b></div>
       <p class="cart-note">${t("cart.shippingNote")}</p>
        <a href="${CFG.checkoutEnabled === false ? "#/page/contact" : "#/checkout"}" class="btn solid" data-close-cart>${t(CFG.checkoutEnabled === false ? "footer.contact" : "cart.checkout")}</a>`;
  }

  /* ---------------- overlays ---------------- */
  let lastFocus = null;
  function openCart() {
    lastFocus = document.activeElement;
    renderCartDrawer();
    $("#cartDrawer").classList.add("open");
    $("#drawerBackdrop").classList.add("open");
    $("#cartDrawer").setAttribute("aria-hidden", "false");
    $("#cartClose").focus();
  }
  function closeCart() {
    $("#cartDrawer").classList.remove("open");
    $("#drawerBackdrop").classList.remove("open");
    $("#cartDrawer").setAttribute("aria-hidden", "true");
    if (lastFocus) lastFocus.focus();
  }
  function openSearch() {
    lastFocus = document.activeElement;
    $("#searchOverlay").classList.add("open");
    $("#searchOverlay").setAttribute("aria-hidden", "false");
    $("#searchResults").innerHTML = `<p class="search-note">${t("search.hint")}</p>`;
    setTimeout(() => $("#searchInput").focus(), 60);
  }
  function closeSearch() {
    $("#searchOverlay").classList.remove("open");
    $("#searchOverlay").setAttribute("aria-hidden", "true");
    $("#searchInput").value = "";
    if (lastFocus) lastFocus.focus();
  }
  function openMenu(open) {
    const m = $("#mobileMenu");
    m.classList.toggle("open", open);
    m.setAttribute("aria-hidden", String(!open));
    $("#burgerBtn").setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("menu-open", open);
    document.body.style.overflow = open ? "hidden" : "";
  }
  function openModal(id, open) {
    const m = $(id);
    m.classList.toggle("open", open);
    m.setAttribute("aria-hidden", String(!open));
  }
  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  /* ---------------- reveal on scroll ---------------- */
  let io = null;
  function initReveals() {
    if (io) io.disconnect();
    const targets = $$("[data-reveal], .img-reveal, .manifesto-line");
    if (reduceMotion.matches) { targets.forEach(el => el.classList.add("in")); return; }
    io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    targets.forEach(el => io.observe(el));
  }

  /* ---------------- page templates ---------------- */
  function cardHTML(p, i) {
    const st = stockLabel(p);
    const sold = stockTotal(p) === 0;
    const hover = gallery(p).length > 1
      ? `<img class="img-b" src="${esc(productImg(p, 1))}" alt="" loading="lazy" aria-hidden="true">` : "";
    return `<article class="card anim" style="--i:${i}">
      <a class="card-media" href="#/product/${esc(p.id)}" aria-label="${esc(p.name)}">
        ${hover}
        <img class="img-a" src="${esc(productImg(p, 0))}" alt="${esc(p.name)}" loading="lazy">
        <div class="card-badges">
          ${p.isNew ? `<span class="badge new">${t("misc.new")}</span>` : ""}
          ${p.demo ? `<span class="badge">${t("misc.demo")}</span>` : ""}
          ${sold ? `<span class="badge soldout">${t("misc.soldOut")}</span>` : ""}
        </div>
        <span class="card-quick">${t("misc.viewAll")} →</span>
      </a>
      <div class="card-info">
        <h3 class="card-name">${esc(p.name)}</h3>
        <div class="card-meta">
          <span class="card-price ${sold ? "sold" : ""}">${fmt(p.price)}</span>
          <span class="card-colors">${(p.colorHex || []).map(c => `<i style="background:${validColor(c)}"></i>`).join("")}</span>
        </div>
        <span class="card-status">${t(st.k)}</span>
      </div>
    </article>`;
  }

  function marqueeHTML() {
    const items = Array.isArray(CONTENT.marquee) ? CONTENT.marquee : [CFG.brand, CONTENT.brandTagline, CFG.founders];
    const chunk = items.map(text => `<span>${esc(localized(text))}</span>`).join("");
    return `<div class="marquee" data-home-section="marquee" aria-hidden="true"><div class="marquee-track">${chunk.repeat(4)}</div></div>`;
  }

  function newsletterHTML() {
    if (CFG.newsletterEnabled === false) return "";
    return `<section class="newsletter" data-home-section="newsletter" data-reveal="fade">
      <h2 class="news-title" data-reveal>${t("news.title")}</h2>
      <p class="news-desc" data-reveal>${t("news.desc")}</p>
      <form class="news-form" id="newsForm" novalidate data-reveal>
        <input type="email" id="newsEmail" placeholder="${t("news.placeholder")}" aria-label="${t("account.email")}" autocomplete="email">
        <button type="submit">${t("news.join")}</button>
      </form>
      <p class="form-msg" id="newsMsg" aria-live="polite"></p>
    </section>`;
  }

  function pageHome() {
    const featured = PRODUCTS.slice().sort((a, b) => b.ts - a.ts).slice(0, 4);
    const chars = Array.from(CFG.brand || "SØLAR").map((c, i) => `<span class="ch" style="--d:${i}">${esc(c)}</span>`).join("");
    const html = `<div class="page">
      <section class="hero" data-home-section="hero">
        <div class="hero-bg">${image(CONTENT.hero && CONTENT.hero.image) ? `<img class="hero-photo" src="${esc(image(CONTENT.hero.image))}" alt="">` : `<div class="eclipse"></div>`}<div class="hero-vignette"></div></div>
        <div class="hero-content">
          <p class="hero-eyebrow">${t("hero.eyebrow")}</p>
          <h1 class="hero-title" aria-label="${brand()}">${chars}</h1>
          <p class="hero-sub">${t("hero.sub")}</p>
          <a href="${href(CONTENT.hero && CONTENT.hero.ctaHref, "#/shop")}" class="btn hero-cta">${t("hero.cta")}</a>
        </div>
        <div class="scroll-hint"><span>${t("hero.scroll")}</span><i></i></div>
      </section>
      ${marqueeHTML()}
      <section class="section" data-home-section="featured">
        <div class="section-head">
          <div data-reveal>
            <span class="sec-eyebrow">${t("drops.current")}</span>
            <h2 class="sec-title">${t("drop.title1")}<small>${t("drop.title2")}</small></h2>
          </div>
          <p class="sec-desc" data-reveal>${t("drop.desc")}</p>
        </div>
        <div class="grid featured" id="featuredGrid">
          ${featured.map((p, i) => cardHTML(p, i)).join("")}
        </div>
        <div style="text-align:center;margin-top:56px" data-reveal>
          <a href="#/shop" class="btn ghost">${t("misc.viewAll")}</a>
        </div>
      </section>
      <section class="manifesto" data-home-section="manifesto">
        <h2>
          <span class="manifesto-line"><span>${t("manifesto.l1")}</span></span>
          <span class="manifesto-line"><span>${t("manifesto.l2")}</span></span>
        </h2>
        <p class="manifesto-sub" data-reveal>${t("manifesto.sub")}</p>
      </section>
      <section class="section" data-home-section="editorial">
        <div class="section-head">
          <div data-reveal><span class="sec-eyebrow">${brand()} — ${esc(CFG.est)}</span>
          <h2 class="sec-title">${t("editorial.title")}</h2></div>
        </div>
        <div class="editorial-grid">
          <figure class="ed-cell ed-a img-reveal"><img src="${esc(editorialImg(0))}" alt="${t("editorial.caption1")}" loading="lazy"><figcaption class="ed-cap">${t("editorial.caption1")}</figcaption></figure>
          <figure class="ed-cell ed-b img-reveal"><img src="${esc(editorialImg(1))}" alt="${t("editorial.caption2")}" loading="lazy"><figcaption class="ed-cap">${t("editorial.caption2")}</figcaption></figure>
          <figure class="ed-cell ed-c img-reveal"><img src="${esc(editorialImg(2))}" alt="${t("editorial.caption3")}" loading="lazy"><figcaption class="ed-cap">${t("editorial.caption3")}</figcaption></figure>
          <p class="ed-text" data-reveal>${t("editorial.text")}</p>
        </div>
      </section>
      ${newsletterHTML()}
    </div>`;
    const template = document.createElement("template"); template.innerHTML = html;
    const page = template.content.firstElementChild;
    const sections = new Map(Array.from(page.children).map(el => [el.dataset.homeSection, el]));
    for (const section of CONTENT.customSections || []) {
      if (!section || !section.id) continue;
      const box = document.createElement("template");
      box.innerHTML = `<section class="section custom-section ${image(section.image) ? "has-image" : ""}">${image(section.image) ? `<img src="${esc(image(section.image))}" alt="${esc(localized(section.title))}" loading="lazy">` : ""}<div><h2 class="sec-title" data-reveal>${esc(localized(section.title))}</h2><p data-reveal>${esc(localized(section.body))}</p>${localized(section.buttonLabel) ? `<a class="btn" href="${href(section.buttonHref)}">${esc(localized(section.buttonLabel))}</a>` : ""}</div></section>`;
      sections.set(section.id, box.content.firstElementChild);
    }
    page.replaceChildren();
    const order = Array.isArray(CONTENT.homepageSections) ? CONTENT.homepageSections : ["hero", "marquee", "featured", "manifesto", "editorial", "newsletter"];
    const hidden = new Set(CONTENT.hiddenSections || []);
    for (const id of order) if (!hidden.has(id) && sections.has(id)) page.append(sections.get(id));
    return page.outerHTML;
  }
  function editorialImg(i) {
    const custom = CONTENT.editorial && CONTENT.editorial[i];
    if (custom && image(custom.image)) return image(custom.image);
    return [() => ph("editorial", "LIGHT STUDIES", "001", 1), () => ph("detail", "TEXTURE", "WASHED BLACK", 4), () => ph("editorial", "FORM", "OVERSIZE", 7)][i]();
  }

  function filteredProducts() {
    let list = PRODUCTS.slice();
    const f = state.shop;
    if (f.cat !== "all") list = list.filter(p => p.cat === f.cat);
    if (f.size !== "all") list = list.filter(p => f.size in p.sizes && p.sizes[f.size] > 0);
    if (f.onlyAvailable) list = list.filter(p => stockTotal(p) > 0);
    if (f.sort === "new") list.sort((a, b) => b.ts - a.ts);
    if (f.sort === "priceAsc") list.sort((a, b) => a.price - b.price);
    if (f.sort === "priceDesc") list.sort((a, b) => b.price - a.price);
    return list;
  }

  function pageShop() {
    const configured = Array.isArray(CONTENT.categories) ? CONTENT.categories : [];
    const catIds = [...new Set([...configured.map(category => category.id), ...PRODUCTS.map(p => p.cat)])].filter(id => id && id !== "all");
    const builtinLabels = { tshirts: "shop.tshirts", hoodies: "shop.hoodies", bottoms: "shop.bottoms", accessories: "shop.accessories" };
    const cats = [{ id: "all", label: rawT("shop.all") }].concat(catIds.map(id => {
      const category = configured.find(c => c.id === id);
      return { id, label: category && category.label ? localized(category.label) : builtinLabels[id] ? rawT(builtinLabels[id]) : id };
    }));
    const sizes = ["all", ...new Set(PRODUCTS.flatMap(p => Object.keys(p.sizes || {})))];
    const f = state.shop;
    if (!cats.some(cat => cat.id === f.cat)) f.cat = "all";
    if (!sizes.includes(f.size)) f.size = "all";
    const list = filteredProducts();
    return `<div class="page">
      <section class="section shop-head">
        <span class="sec-eyebrow" data-reveal="fade">${brand()} — ${t("drop.title1")}</span>
        <h1 class="shop-title" data-reveal>${t("shop.title")}</h1>
        <div class="shop-toolbar">
          <div class="cat-tabs" role="tablist">
            ${cats.map(c => `<button class="cat-tab ${f.cat === c.id ? "active" : ""}" data-cat="${esc(c.id)}" role="tab" aria-selected="${f.cat === c.id}">${esc(c.label)}</button>`).join("")}
          </div>
          <div class="toolbar-right">
            <label class="tool-select" aria-label="${t("shop.size")}">
              <select id="sizeSel">
                ${sizes.map(s => `<option value="${esc(s)}" ${f.size === s ? "selected" : ""}>${s === "all" ? t("shop.size") + ": " + t("shop.all") : t("shop.size") + ": " + esc(s)}</option>`).join("")}
              </select>
            </label>
            <label class="tool-select" aria-label="${t("shop.sort")}">
              <select id="sortSel">
                <option value="new" ${f.sort === "new" ? "selected" : ""}>${t("shop.sortNew")}</option>
                <option value="priceAsc" ${f.sort === "priceAsc" ? "selected" : ""}>${t("shop.sortPriceAsc")}</option>
                <option value="priceDesc" ${f.sort === "priceDesc" ? "selected" : ""}>${t("shop.sortPriceDesc")}</option>
              </select>
            </label>
            <label class="chk"><input type="checkbox" id="availChk" ${f.onlyAvailable ? "checked" : ""}><i></i>${t("shop.available")}</label>
            <span class="shop-count">${list.length} ${t("shop.items")}</span>
          </div>
        </div>
        <div class="shop-grid-wrap">
          ${list.length
            ? `<div class="grid">${list.map((p, i) => cardHTML(p, i)).join("")}</div>`
            : `<p class="shop-empty">${t("shop.empty")}</p>`}
        </div>
      </section>
    </div>`;
  }

  function pageProduct(id) {
    const p = PRODUCTS.find(x => x.id === id);
    if (!p) return `<div class="page"><div class="static-page"><h1>404</h1><p><a class="link-u" href="#/shop">${t("product.back")}</a></p></div></div>`;
    const sold = stockTotal(p) === 0;
    const related = PRODUCTS.filter(x => x.id !== p.id && x.cat === p.cat)
      .concat(PRODUCTS.filter(x => x.id !== p.id && x.cat !== p.cat))
      .slice(0, 4);
    const details = [
      p.fit, p.design, p.collection
    ].filter(Boolean).map(esc).join("<br>");
    return `<div class="page">
      <section class="section">
        <p style="margin-bottom:34px" data-reveal="fade"><a class="link-u" href="#/shop">← ${t("product.back")}</a></p>
        <div class="pdp">
          <div class="pdp-gallery">
            <div class="pdp-thumbs" id="pdpThumbs">
              ${gallery(p).map((g, i) => `<button class="pdp-thumb ${i === 0 ? "active" : ""}" data-gidx="${i}" aria-label="${t("a11y.image")} ${i + 1}"><img src="${esc(productImg(p, i))}" alt=""></button>`).join("")}
            </div>
            <div class="pdp-main img-reveal"><img id="pdpMainImg" src="${esc(productImg(p, 0))}" alt="${esc(p.name)}"></div>
          </div>
          <div class="pdp-info">
            <p class="pdp-collection" data-reveal="fade">${t("product.collection")} — ${esc(p.collection)}</p>
            <h1 class="pdp-name" data-reveal>${esc(p.name)}</h1>
            <p class="pdp-price" data-reveal>${fmt(p.price)}</p>
            ${p.demo ? `<p class="pdp-demo-note" data-reveal="fade">${t("product.demoNote")}</p>` : ""}
            <p class="pdp-desc" data-reveal>${esc(localized(p.desc))}</p>
            <div class="pdp-opt" data-reveal>
              <div class="pdp-opt-head"><span class="pdp-opt-label">${t("product.color")}</span><span class="color-name">${esc(localized(p.color))}</span></div>
              <div class="color-row">${(p.colorHex || []).map(c => `<span class="color-dot" style="background:${validColor(c)}"></span>`).join("")}</div>
            </div>
            <div class="pdp-opt" data-reveal>
              <div class="pdp-opt-head">
                <span class="pdp-opt-label">${t("product.size")}</span>
                <button class="link-u" id="sizeGuideBtn" type="button">${t("product.sizeGuide")}</button>
              </div>
              <div class="size-row" id="sizeRow">
                ${Object.entries(p.sizes).map(([s, q]) =>
                  `<button class="size-btn ${q === 0 ? "off" : ""}" data-sz="${esc(s)}" ${q === 0 ? "disabled aria-disabled='true'" : ""}>${esc(s)}</button>`).join("")}
              </div>
            </div>
            <div class="pdp-actions" data-reveal>
              <p class="pdp-err" id="pdpErr" aria-live="polite"></p>
              <button class="btn solid" id="addBtn" data-pid="${esc(p.id)}" ${sold ? "disabled" : ""}>${sold ? t("misc.soldOut") : t("product.add")}</button>
            </div>
            <div class="pdp-acc" data-reveal="fade">
              ${accItem(t("product.details"), details)}
              ${accItem(t("product.materials"), esc((p.materials && (p.materials[state.lang] || p.materials.en)) || rawT("product.materialsDefault")))}
              ${accItem(t("product.fit"), t("product.fitText"))}
              ${accItem(t("product.shipping"), t("product.shippingText"))}
            </div>
          </div>
        </div>
        <div class="pdp-related">
          <div class="section-head"><h2 class="sec-title" style="font-size:clamp(22px,3vw,40px)" data-reveal>${t("drop.title1")} — ${t("misc.viewAll")}</h2></div>
          <div class="grid">${related.map((x, i) => cardHTML(x, i)).join("")}</div>
        </div>
      </section>
    </div>`;
  }
  function accItem(title, body) {
    return `<div class="acc-item">
      <button class="acc-head" aria-expanded="false"><span>${title}</span><i></i></button>
      <div class="acc-body"><div class="acc-body-in">${body}</div></div>
    </div>`;
  }

  function pageDrops() {
    const heroP = PRODUCTS[0];
    return `<div class="page">
      <section class="section shop-head">
        <span class="sec-eyebrow" data-reveal="fade">${brand()}</span>
        <h1 class="shop-title" data-reveal>${t("drops.title")}</h1>
        <div class="drop-hero" style="margin-top:50px" data-reveal>
          <div class="drop-hero-info">
            <span class="sec-eyebrow">${t("drops.current")}</span>
            <h2 class="sec-title" style="font-size:clamp(28px,4.4vw,62px)">${t("drop.title1")}<small>${t("drop.title2")}</small></h2>
            <p class="sec-desc">${t("drop.desc")}</p>
            <div><a href="#/shop" class="btn">${t("drops.explore")}</a></div>
          </div>
          <div class="drop-hero-media img-reveal"><img src="${esc(image(CONTENT.dropImage) || productImg(heroP, 1))}" alt="${esc(heroP ? heroP.name : CFG.brand)}"></div>
        </div>
        <div class="drop-next" data-reveal>
          <h3>${t("drops.next")}</h3>
          <p>${t("drops.nextText")}</p>
        </div>
      </section>
      ${newsletterHTML()}
    </div>`;
  }

  function pageAbout() {
    return `<div class="page">
      <section class="about-hero">
        <h1 class="about-title">
          <span class="manifesto-line"><span>${t("about.title1")}</span></span>
          <span class="manifesto-line"><span><em>${t("about.title2")}</em></span></span>
        </h1>
      </section>
      <section class="about-body">
        ${["about.p1", "about.p2", "about.p3", "about.p4", "about.p5"].map(k => `<p data-reveal>${t(k)}</p>`).join("")}
      </section>
      <section class="founders">
        <span class="sec-eyebrow" data-reveal="fade">${t("about.founders")}</span>
        <h2 class="sec-title" data-reveal>${esc(CFG.founders)}</h2>
        <div class="founders-grid">
          ${(CONTENT.founders || []).map(f => `<div class="founder-card ${image(f.image) ? "has-photo" : ""}" data-reveal>${image(f.image) ? `<img class="founder-photo" src="${esc(image(f.image))}" alt="${esc(f.name)}" loading="lazy">` : `<div class="founder-ph">${t("about.photoSoon")}</div>`}<div class="founder-name">${esc(f.name)}${f.bio ? `<p class="founder-bio">${esc(localized(f.bio))}</p>` : ""}</div></div>`).join("")}
        </div>
      </section>
      ${marqueeHTML()}
      ${newsletterHTML()}
    </div>`;
  }

  function dateFmt(iso, withTime) {
    const locale = { uk: "uk-UA", ru: "ru-RU", en: "en-GB", fr: "fr-FR" }[state.lang] || "uk-UA";
    try { return new Date(iso).toLocaleString(locale, withTime ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "long", year: "numeric" }); } catch (_) { return ""; }
  }
  function methodLabel(method) {
    const info = window.SOLAR_DELIVERY && window.SOLAR_DELIVERY.METHOD_INFO[method];
    return info ? rawT(info.key) : method || "";
  }
  function deliveryText(c) {
    if (!c) return "";
    if (c.method === "pickup") return methodLabel("pickup");
    return [methodLabel(c.method), c.city && c.city !== "—" ? c.city : "", c.branch].filter(Boolean).join("\n");
  }
  function itemImage(item) {
    const p = PRODUCTS.find(x => x.id === item.id);
    return image(item.image) || (p ? productImg(p, 0) : ph("front", item.name || "", "", 3));
  }

  function pageCheckout() {
    if (!state.cart.length && state.lastOrder) {
      const order = state.lastOrder;
      if (order.paymentMethod === "card") return pagePaymentHTML(order, state.lastPaymentError ? state.lastPaymentError : "");
      const actions = API.user
        ? `<a class="btn solid" href="#/account">${t("checkout.viewOrder")} →</a><a class="btn" href="#/shop">${t("cart.emptyCta")}</a>`
        : `<a class="btn" href="#/shop">${t("cart.emptyCta")}</a><button class="link-u" type="button" data-open-account>${t("account.register")}</button>`;
      return `<div class="page"><section class="section"><span class="sec-eyebrow">${brand()}</span><div class="order-confirmation"><h2>${t("checkout.successTitle")}</h2><p>${t("checkout.orderNumber")} <b>#${esc(order.number || order.id)}</b></p><p>${t("checkout.successText")}</p><p class="detail-text" style="white-space:pre-line">${esc(deliveryText(order.customer))}</p><p>${t("checkout.total")}: <b>${esc(order.currency || CFG.currency)} ${esc(Number(order.total).toLocaleString("uk-UA"))}</b><br>${t("checkout.cod")}</p>${API.user ? "" : `<p class="account-sub">${t("checkout.guestHint")}</p>`}<div class="confirm-actions">${actions}</div></div></section></div>`;
    }
    const providers = Array.isArray(CFG.deliveryProviders) ? CFG.deliveryProviders : ["nova-poshta", "ukrposhta", "pickup"];
    const anyMethod = ["nova-poshta", "ukrposhta", "pickup"].some(p => providers.includes(p));
    if (CFG.checkoutEnabled === false || !anyMethod) return `<div class="page"><div class="static-page"><h1>${t("checkout.title")}</h1><p>${t("checkout.disabled")}</p><a class="btn" href="#/page/contact">${t("footer.contact")}</a></div></div>`;
    if (!state.cart.length) {
      return `<div class="page"><div class="static-page" style="text-align:center">
        <h1>${t("checkout.title")}</h1>
        <p style="margin-bottom:34px">${t("checkout.emptyCart")}</p>
        <a href="#/shop" class="btn ghost">${t("cart.emptyCta")}</a>
      </div></div>`;
    }
    const rows = state.cart.map(line => {
      const p = PRODUCTS.find(x => x.id === line.id);
      if (!p) return "";
      return `<div class="order-row">
        <img src="${esc(productImg(p, 0))}" alt="">
        <div class="or-info"><b>${esc(p.name)}</b><span>${t("product.size")}: ${esc(line.size)} × ${line.qty}</span></div>
        <b>${fmt(p.price * line.qty)}</b>
      </div>`;
    }).join("");
    const c = state.checkoutContact;
    return `<div class="page">
      <section class="section">
        <span class="sec-eyebrow" data-reveal="fade">${brand()}</span>
        <h1 class="shop-title" style="font-size:clamp(34px,6vw,84px)" data-reveal>${t("checkout.title")}</h1>
        <div class="checkout-grid" style="margin-top:54px">
          <form id="checkoutForm" novalidate>
            <div class="form-sec">
              <h3>${t("checkout.contact")}</h3>
              <div class="field"><input type="text" name="name" value="${esc(c.name || "")}" aria-label="${t("checkout.name")}" placeholder="${t("checkout.name")}" autocomplete="name"><p class="f-err">${t("checkout.errName")}</p></div>
              <div class="field"><input type="tel" name="phone" value="${esc(c.phone || "")}" aria-label="${t("checkout.phone")}" placeholder="${t("checkout.phone")} (+380…)" autocomplete="tel"><p class="f-err">${t("checkout.errPhone")}</p></div>
              <div class="field"><input type="email" name="email" value="${esc(c.email || "")}" aria-label="${t("checkout.email")}" placeholder="${t("checkout.email")}" autocomplete="email"><p class="f-err">${t("checkout.errEmail")}</p></div>
            </div>
            <div class="form-sec">
              <h3>${t("checkout.delivery")}</h3>
              <div id="deliveryMount"></div>
            </div>
            ${paymentSectionHTML()}
            <div class="form-sec">
              <div class="field"><textarea name="comment" maxlength="1000" rows="3" aria-label="${t("checkout.comment")}" placeholder="${t("checkout.comment")}">${esc(c.comment || "")}</textarea></div>
              ${API.user ? `<label class="check-row"><input type="checkbox" name="saveDelivery" checked>${t("checkout.saveDelivery")}</label>` : ""}
            </div>
            <button class="btn solid" type="submit" id="checkoutSubmit" style="width:100%">${t(payMethod() === "card" ? "checkout.submitCard" : "checkout.submit")}</button>
            <p class="checkout-msg" id="checkoutMsg" aria-live="polite"></p>
          </form>
          <aside class="order-side" data-reveal="right">
            <h3>${t("checkout.order")}</h3>
            ${rows}
            <div class="order-total"><span>${t("checkout.total")}</span><b>${fmt(cartTotal())}</b></div>
            <p class="test-note">${t("checkout.testNote")}</p>
          </aside>
        </div>
      </section>
    </div>`;
  }

  /* ---------------- online payment (monobank) ---------------- */
  function cardEnabled() { return !!(window.SOLAR.SITE && window.SOLAR.SITE.payments && window.SOLAR.SITE.payments.card); }
  function payMethod() { return cardEnabled() && state.checkoutPayment === "card" ? "card" : "cod"; }
  function paymentSectionHTML() {
    if (!cardEnabled()) return "";
    const m = payMethod();
    return `<div class="form-sec">
      <h3>${t("checkout.payment")}</h3>
      <div class="dlv-methods pay-methods" role="radiogroup" aria-label="${t("checkout.payment")}">
        <button type="button" class="dlv-method${m === "cod" ? " active" : ""}" role="radio" aria-checked="${m === "cod"}" data-pay="cod"><i aria-hidden="true"></i><b>${t("checkout.payCod")}</b><small>${t("checkout.payCodHint")}</small></button>
        <button type="button" class="dlv-method${m === "card" ? " active" : ""}" role="radio" aria-checked="${m === "card"}" data-pay="card"><i aria-hidden="true"></i><b>${t("checkout.payCard")}</b><small>${t("checkout.payCardHint")}</small></button>
      </div>
      <p class="pay-secure"${m === "card" ? "" : " hidden"}>${t("checkout.paySecure")}</p>
    </div>`;
  }
  function payStatusLabel(order) {
    if (!order || order.paymentMethod !== "card") return rawT("checkout.cod");
    return rawT("pay.card") + " — " + rawT("pay.status." + ((order.payment && order.payment.status) || "pending"));
  }
  function canPay(order) {
    return order && order.paymentMethod === "card" && order.status !== "cancelled" && cardEnabled() && !["paid", "refunding", "refunded"].includes(order.payment && order.payment.status);
  }
  async function startPay(orderId, button) {
    if (button) button.disabled = true;
    try {
      const result = await API.request("/api/orders/" + orderId + "/pay", { method: "POST", body: {} });
      toast(rawT("checkout.redirecting"));
      location.href = result.pageUrl;
    } catch (error) { toast(error.message); if (button) button.disabled = false; }
  }
  function pagePaymentHTML(order, error) {
    const st = order ? ((order.payment && order.payment.status) || "pending") : "pending";
    const title = !order ? rawT("account.loading") : error ? rawT("pay.error") : st === "paid" ? rawT("pay.paid") : st === "pending" ? rawT("pay.pending") : st === "expired" ? rawT("pay.expired") : ["refunded", "refunding"].includes(st) ? rawT("pay.refunded") : rawT("pay.failed");
    const text = !order ? "" : error ? error : st === "paid" ? rawT("pay.paidText") : st === "pending" ? rawT("pay.pendingText") : ["refunded", "refunding"].includes(st) ? "" : rawT("pay.failedText");
    const icon = st === "paid" ? "✓" : st === "pending" && !error ? "" : "!";
    const actions = !order ? "" : [
      canPay(order) && (st !== "pending" || error) ? `<button class="btn solid" type="button" data-pay-order="${esc(order.id)}">${t("pay.retry")} →</button>` : "",
      API.user ? `<a class="btn${canPay(order) && st !== "pending" ? "" : " solid"}" href="#/account">${t("checkout.viewOrder")}</a>` : "",
      `<a class="btn ghost" href="#/shop">${t("cart.emptyCta")}</a>`
    ].join("");
    return `<div class="page"><section class="section"><span class="sec-eyebrow">${brand()} — ${t("pay.title")}</span>
      <div class="order-confirmation pay-result pay-${esc(error ? "error" : st)}">
        <div class="pay-icon" aria-hidden="true">${icon ? esc(icon) : "<i></i>"}</div>
        <h2>${esc(title)}</h2>
        ${order ? `<p>${t("pay.order")} <b>#${esc(order.number || order.id)}</b> · ${esc(order.currency || CFG.currency)} ${esc(Number(order.total).toLocaleString("uk-UA"))}</p>` : ""}
        ${text ? `<p>${esc(text)}</p>` : ""}
        ${order ? `<p class="detail-text" style="white-space:pre-line">${esc(deliveryText(order.customer))}</p>` : ""}
        <div class="confirm-actions">${actions}</div>
      </div></section></div>`;
  }
  function pagePayment(id) {
    const cached = state.payView && state.payView.id === id ? state.payView : null;
    return pagePaymentHTML(cached ? cached.order : null, cached ? cached.error : "");
  }
  function bindPaymentPage(id) {
    const retry = $("[data-pay-order]", $("#app"));
    if (retry) retry.addEventListener("click", () => startPay(retry.dataset.payOrder, retry));
    const view = state.payView && state.payView.id === id ? state.payView : (state.payView = { id, order: null, error: "", tries: 0 });
    if (view.timer || (view.order && view.order.payment && view.order.payment.status !== "pending")) return;
    view.timer = setTimeout(async () => {
      view.timer = null; view.tries++;
      try { view.order = (await API.request("/api/orders/" + id + "/payment")).order; view.error = ""; }
      catch (error) { view.error = error.message; view.tries = 99; }
      if (view.order && view.order.payment && view.order.payment.status === "paid") state.acct.orders = null;
      if (state.route && state.route.page === "payment" && state.route.id === id) {
        if (view.order && view.order.payment && view.order.payment.status === "pending" && view.tries >= 20) view.tries = 20; // stop polling after ~1 minute
        render(false);
      }
    }, view.order ? 3000 : 0);
    if (view.tries >= 20) { clearTimeout(view.timer); view.timer = null; }
  }

  /* ---------------- customer account (cabinet) ---------------- */
  function acctReset() { state.acct = { userId: API.user ? API.user.id : null, tab: state.acct.tab || "orders", orders: null, loading: false, open: {}, tracking: {}, error: "" }; }
  function orderCard(o, i) {
    const steps = ["new", "confirmed", "shipped", "completed"];
    const idx = steps.indexOf(o.status);
    const open = !!state.acct.open[o.id];
    const progress = o.status === "cancelled" ? "" : `<div class="ord-progress">${steps.map((st, k) => `<div class="ord-step${k <= idx ? " done" : ""}${k === idx && st !== "completed" ? " current" : ""}"><i></i><span>${t("account.status." + st)}</span></div>`).join("")}</div>`;
    const thumbs = (o.items || []).slice(0, 6).map(item => `<img src="${esc(itemImage(item))}" alt="${esc(item.name)}" loading="lazy">`).join("");
    const tr = state.acct.tracking[o.id];
    const trackBox = tr ? (tr.error ? `<div class="ord-track">${esc(tr.error)}</div>` : tr.loading ? `<div class="ord-track">${t("account.loading")}</div>` : `<div class="ord-track"><b>${esc(tr.found ? tr.status : rawT("account.trackNotFound"))}</b>${tr.warehouse ? esc(tr.city + ", " + tr.warehouse) + "<br>" : ""}${tr.scheduledDelivery ? esc(tr.scheduledDelivery) + "<br>" : ""}<a href="${esc(tr.url)}" target="_blank" rel="noopener noreferrer">${t("account.trackOpen")}</a></div>`) : "";
    const history = (o.history && o.history.length ? o.history : [{ status: "new", at: o.createdAt }]).map(h => `<li>${t("account.timeline." + h.status)}${h.tracking ? " · " + esc(h.tracking) : ""}<small>${esc(dateFmt(h.at, true))}</small></li>`).join("");
    const body = open ? `<div class="ord-body">
        <div>
          <div class="ord-block"><h4>${t("account.items")}</h4>${(o.items || []).map(item => `<div class="ord-line"><img src="${esc(itemImage(item))}" alt=""><div>${esc(item.name)}<small>${t("product.size")}: ${esc(item.size)} × ${esc(item.qty)}</small></div><b>${esc(o.currency || CFG.currency)} ${esc(Number(item.price * item.qty).toLocaleString("uk-UA"))}</b></div>`).join("")}</div>
          <div class="ord-block"><h4>${t("account.delivery")}</h4><p style="white-space:pre-line">${esc(deliveryText(o.customer))}</p>${o.tracking ? `<p>${t("account.tracking")}: <b>${esc(o.tracking)}</b></p>` : ""}${trackBox}</div>
          <div class="ord-block"><h4>${t("account.payment")}</h4><p>${esc(payStatusLabel(o))}</p></div>
          ${o.customer && o.customer.comment ? `<div class="ord-block"><h4>${t("checkout.comment")}</h4><p>${esc(o.customer.comment)}</p></div>` : ""}
        </div>
        <div class="ord-block"><h4>${t("account.history")}</h4><ul class="ord-timeline">${history}</ul></div>
      </div>` : "";
    return `<article class="ord" style="--i:${i}">
      <div class="ord-head">
        <div><div class="ord-num">#${esc(o.number || o.id)}</div><span class="ord-badge ${esc(o.status)}">${t("account.status." + o.status)}</span>${o.paymentMethod === "card" ? ` <span class="ord-badge pay ${esc((o.payment && o.payment.status) || "pending")}">${t("pay.status." + ((o.payment && o.payment.status) || "pending"))}</span>` : ""}</div>
        <div class="ord-meta">${esc(dateFmt(o.createdAt, true))}<br>${esc(methodLabel(o.customer && o.customer.method))}${o.customer && o.customer.city && o.customer.city !== "—" ? " · " + esc(o.customer.city) : ""}</div>
        <div class="ord-total">${esc(o.currency || CFG.currency)} ${esc(Number(o.total).toLocaleString("uk-UA"))}</div>
      </div>
      ${progress}
      <div class="ord-thumbs">${thumbs}</div>
      ${body}
      <div class="ord-foot">
        <button class="link-u" type="button" data-ord-toggle="${esc(o.id)}" aria-expanded="${open}">${t(open ? "account.hideDetails" : "account.details")}</button>
        ${o.tracking ? `<button class="link-u" type="button" data-ord-track="${esc(o.id)}">${t("account.track")}</button>` : ""}
        <span class="spacer"></span>
        ${o.status === "new" ? `<button class="link-u" type="button" data-ord-cancel="${esc(o.id)}">${t("account.cancel")}</button>` : ""}
        ${canPay(o) ? `<button class="btn solid" type="button" data-ord-pay="${esc(o.id)}">${t("pay.now")} →</button>` : ""}
        <button class="btn" type="button" data-ord-repeat="${esc(o.id)}">${t("account.repeat")}</button>
      </div>
    </article>`;
  }
  function acctPanel(user) {
    const tab = state.acct.tab;
    if (tab === "profile") return `<form class="acct-form" data-acct-form="profile">
        <label>${t("account.name")}<input name="displayName" value="${esc(user.displayName || "")}" maxlength="100" autocomplete="name" required></label>
        <label>${t("account.email")}<input name="email" type="email" value="${esc(user.email || "")}" maxlength="254" autocomplete="email"></label>
        <label>${t("account.phone")}<input name="phone" type="tel" value="${esc(user.phone || "")}" maxlength="30" autocomplete="tel" placeholder="+380"></label>
        <label>${t("account.username")}<input value="${esc(user.username)}" disabled></label>
        <div class="full"><button class="btn solid" type="submit">${t("account.save")}</button><p class="acct-msg" role="status"></p></div>
      </form>`;
    if (tab === "address") return `<div class="acct-address"><p class="acct-intro">${t("account.addressText")}</p><div id="acctDelivery"></div><div style="margin-top:22px"><button class="btn solid" type="button" data-acct-save-address>${t("account.saveAddress")}</button><p class="acct-msg" role="status"></p></div></div>`;
    if (tab === "security") return `<form class="acct-form" data-acct-form="password">
        <label class="full">${t("account.currentPassword")}<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></label>
        <label class="full">${t("account.newPassword")}<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></label>
        <div class="full"><button class="btn solid" type="submit">${t("account.changePassword")}</button><p class="acct-msg" role="status"></p></div>
      </form>`;
    if (state.acct.error) return `<p class="acct-msg err">${esc(state.acct.error)}</p>`;
    if (!state.acct.orders) return `<div class="dlv-loading"><i></i>${t("account.loading")}</div>`;
    if (!state.acct.orders.length) return `<div class="acct-empty"><p>${t("account.emptyOrders")}</p><a class="btn" href="#/shop">${t("account.shopNow")}</a></div>`;
    return state.acct.orders.map(orderCard).join("");
  }
  function pageAccount() {
    const user = API.user;
    if (!user) return `<div class="page"><section class="acct-guest">
        <span class="sec-eyebrow">${brand()}</span>
        <h1>${t("account.signInTitle")}</h1><p>${t("account.signInText")}</p>
        <button class="btn solid" type="button" data-open-account>${t("account.signIn")}</button>
      </section></div>`;
    if (state.acct.userId !== user.id) acctReset();
    const orders = state.acct.orders;
    const live = (orders || []).filter(o => o.status !== "cancelled");
    const active = (orders || []).filter(o => ["new", "confirmed", "shipped"].includes(o.status)).length;
    const spent = live.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const tabs = [["orders", "account.tabOrders", orders ? orders.length : ""], ["profile", "account.tabProfile"], ["address", "account.tabAddress"], ["security", "account.tabSecurity"]];
    return `<div class="page"><section class="acct">
      <div class="acct-head">
        <div><p class="acct-hello">${t("account.hello")}</p><h1 class="acct-name">${esc(user.displayName || user.username)}</h1>${user.createdAt ? `<p class="acct-since">${t("account.memberSince")} ${esc(dateFmt(user.createdAt))}</p>` : ""}</div>
        <div class="acct-actions">${user.role === "admin" ? `<a class="btn solid" href="/admin.html">${t("account.admin")} ↗</a>` : ""}<button class="link-u" type="button" data-acct-logout>${t("account.logout")}</button></div>
      </div>
      <div class="acct-stats">
        <div class="acct-stat"><b>${orders ? orders.length : "—"}</b><span>${t("account.summaryOrders")}</span></div>
        <div class="acct-stat"><b>${orders ? active : "—"}</b><span>${t("account.summaryActive")}</span></div>
        <div class="acct-stat"><b>${orders ? fmt(spent) : "—"}</b><span>${t("account.summarySpent")}</span></div>
      </div>
      <div class="acct-tabs" role="tablist">${tabs.map(([id, key, n]) => `<button type="button" role="tab" aria-selected="${state.acct.tab === id}" class="${state.acct.tab === id ? "active" : ""}" data-acct-tab="${id}">${t(key)}${n !== undefined && n !== "" ? `<span>${n}</span>` : ""}</button>`).join("")}</div>
      <div class="acct-panel" id="acctPanel">${acctPanel(user)}</div>
    </section></div>`;
  }
  async function loadAccountOrders() {
    if (state.acct.loading || state.acct.orders) return;
    state.acct.loading = true; state.acct.error = "";
    try { state.acct.orders = (await API.request("/api/account/orders")).orders || []; }
    catch (error) { state.acct.error = error.message; }
    finally { state.acct.loading = false; }
    if (state.route && state.route.page === "account") render(false);
  }
  function bindAccountPage() {
    const root = $(".acct") || $(".acct-guest");
    if (!root) return;
    if (!API.user) return;
    loadAccountOrders();
    let delivery = null;
    if (state.acct.tab === "address" && $("#acctDelivery")) {
      delivery = window.SOLAR_DELIVERY.mount($("#acctDelivery"), { t: rawT, api: API, lang: () => state.lang, providers: CFG.deliveryProviders, value: API.user.delivery || {} });
    }
    root.addEventListener("click", async e => {
      const tab = e.target.closest("[data-acct-tab]");
      if (tab) { state.acct.tab = tab.dataset.acctTab; render(false); return; }
      if (e.target.closest("[data-acct-logout]")) {
        try { state.acct.busy = true; await API.request("/api/auth/logout", { method: "POST", body: {} }); } catch (error) { toast(error.message); }
        finally { state.acct.busy = false; acctReset(); render(false); }
        return;
      }
      const toggle = e.target.closest("[data-ord-toggle]");
      if (toggle) { const id = toggle.dataset.ordToggle; state.acct.open[id] = !state.acct.open[id]; render(false); return; }
      const track = e.target.closest("[data-ord-track]");
      if (track) {
        const id = track.dataset.ordTrack; state.acct.open[id] = true; state.acct.tracking[id] = { loading: true }; render(false);
        try { state.acct.tracking[id] = (await API.request("/api/account/orders/" + id + "/tracking")).tracking; }
        catch (error) { state.acct.tracking[id] = { error: error.message }; }
        if (state.route.page === "account") render(false);
        return;
      }
      const cancel = e.target.closest("[data-ord-cancel]");
      if (cancel) {
        if (!confirm(rawT("account.cancelConfirm"))) return;
        cancel.disabled = true;
        try {
          const { order } = await API.request("/api/account/orders/" + cancel.dataset.ordCancel + "/cancel", { method: "POST", body: {} });
          state.acct.orders = state.acct.orders.map(o => o.id === order.id ? order : o);
          toast(rawT("account.cancelledNotice")); await refreshSite().catch(() => {}); render(false);
        } catch (error) { toast(error.message); cancel.disabled = false; }
        return;
      }
      const pay = e.target.closest("[data-ord-pay]");
      if (pay) { startPay(pay.dataset.ordPay, pay); return; }
      const repeat = e.target.closest("[data-ord-repeat]");
      if (repeat) {
        const order = state.acct.orders.find(o => o.id === repeat.dataset.ordRepeat);
        let added = 0;
        for (const item of (order && order.items) || []) for (let k = 0; k < item.qty; k++) if (addToCart(item.id, item.size)) added++;
        toast(rawT(added ? "account.repeatDone" : "account.repeatNone"));
        if (added) openCart();
        return;
      }
      const save = e.target.closest("[data-acct-save-address]");
      if (save && delivery) {
        const msg = save.nextElementSibling; msg.className = "acct-msg";
        const check = delivery.validate(); if (!check.ok) { check.focus && check.focus.focus(); return; }
        save.disabled = true;
        try {
          state.acct.busy = true;
          await API.request("/api/account/profile", { method: "PATCH", body: { displayName: API.user.displayName, email: API.user.email, phone: API.user.phone, delivery: delivery.value() } });
          msg.textContent = rawT("account.addressSaved");
        } catch (error) { msg.textContent = error.message; msg.className = "acct-msg err"; }
        finally { state.acct.busy = false; save.disabled = false; }
      }
    });
    root.addEventListener("submit", async e => {
      const form = e.target.closest("[data-acct-form]"); if (!form) return;
      e.preventDefault(); if (!form.reportValidity()) return;
      const kind = form.dataset.acctForm, msg = form.querySelector(".acct-msg"), button = form.querySelector('button[type="submit"]');
      msg.className = "acct-msg"; msg.textContent = ""; button.disabled = true; state.acct.busy = true;
      try {
        const data = Object.fromEntries(new FormData(form));
        if (kind === "profile") { await API.request("/api/account/profile", { method: "PATCH", body: data }); msg.textContent = rawT("account.saved"); $(".acct-name").textContent = API.user.displayName || API.user.username; }
        else { await API.request("/api/auth/password", { method: "POST", body: data }); form.reset(); msg.textContent = rawT("account.passwordChanged"); }
      } catch (error) { msg.textContent = error.message; msg.className = "acct-msg err"; }
      finally { button.disabled = false; state.acct.busy = false; }
    });
  }

  function pageStatic(slug) {
    const known = ["contact", "shipping", "returns", "privacy", "terms"];
    const custom = (CONTENT.pages || []).find(page => page.slug === slug);
    if (!known.includes(slug) && !custom) return `<div class="page"><div class="static-page"><h1>404</h1><a class="btn" href="#/">${brand()}</a></div></div>`;
    const contact = slug === "contact" ? `<div class="contact-channels">${CFG.contactEmail ? `<a href="${href("mailto:" + CFG.contactEmail)}">${esc(CFG.contactEmail)}</a>` : ""}${CFG.contactPhone ? `<a href="${href("tel:" + CFG.contactPhone)}">${esc(CFG.contactPhone)}</a>` : ""}${CFG.address ? `<p>${esc(localized(CFG.address))}</p>` : ""}${Object.entries(CFG.social || {}).filter(([, value]) => image(value)).map(([name, value]) => `<a href="${href(value)}" target="_blank" rel="noopener noreferrer">${esc(name)} ↗</a>`).join("")}</div>` : "";
    return `<div class="page"><div class="static-page">
      <span class="sec-eyebrow" data-reveal="fade">${brand()} — ${esc(CFG.est)}</span>
      <h1 data-reveal>${custom ? esc(localized(custom.title)) : t("page." + slug + ".title")}</h1>
      <p class="static-copy" data-reveal>${custom ? esc(localized(custom.body)) : t("page." + slug + ".body")}</p>
      ${contact}
      <p style="margin-top:46px" data-reveal><a class="link-u" href="#/">← ${brand()}</a></p>
    </div></div>`;
  }

  /* ---------------- router ---------------- */
  function parseRoute() {
    const h = location.hash.replace(/^#\/?/, "");
    const parts = h.split("/").filter(Boolean);
    if (!parts.length) return { page: "home" };
    if (parts[0] === "shop") return { page: "shop" };
    if (parts[0] === "drops") return { page: "drops" };
    if (parts[0] === "about") return { page: "about" };
    if (parts[0] === "checkout") return { page: "checkout" };
    if (parts[0] === "account") return { page: "account" };
    if (parts[0] === "payment" && /^[a-f0-9]{32}$/.test(parts[1] || "")) return { page: "payment", id: parts[1] };
    if (parts[0] === "product" && parts[1]) return { page: "product", id: parts[1] };
    if (parts[0] === "page" && parts[1]) return { page: "static", slug: parts[1] };
    return { page: "home" };
  }

  const TITLES = {
    home: () => CFG.seoTitle || CFG.brand,
    shop: () => CFG.brand + " — " + rawT("shop.title"),
    drops: () => CFG.brand + " — " + rawT("drops.title"),
    about: () => CFG.brand + " — " + rawT("nav.about"),
    checkout: () => CFG.brand + " — " + rawT("checkout.title"),
    account: () => CFG.brand + " — " + rawT("account.cabinet"),
    payment: () => CFG.brand + " — " + rawT("pay.title"),
    product: (r) => {
      const p = PRODUCTS.find(x => x.id === r.id);
      return p ? CFG.brand + " — " + p.name : CFG.brand;
    },
    static: (r) => { const page = (CONTENT.pages || []).find(p => p.slug === r.slug); return CFG.brand + " — " + (page ? localized(page.title) : rawT("page." + r.slug + ".title")); }
  };

  let renderSeq = 0;
  function render(withTransition) {
    const app = $("#app");
    const seq = ++renderSeq;
    const route = parseRoute();
    state.route = route;
    const html = (
      route.page === "home" ? pageHome() :
      route.page === "shop" ? pageShop() :
      route.page === "drops" ? pageDrops() :
      route.page === "about" ? pageAbout() :
      route.page === "checkout" ? pageCheckout() :
      route.page === "account" ? pageAccount() :
      route.page === "payment" ? pagePayment(route.id) :
      route.page === "product" ? pageProduct(route.id) :
      pageStatic(route.slug)
    );
    const commit = () => {
      if (seq !== renderSeq) return; // устаревший рендер — отменён более новым
      app.classList.remove("leaving");
      app.innerHTML = html;
      document.title = (TITLES[route.page] || TITLES.home)(route);
      bindPage(route);
      initReveals();
      updateNav(route);
    };
    if (withTransition && !reduceMotion.matches && app.firstChild) {
      app.classList.add("leaving");
      setTimeout(commit, 240);
    } else commit();
  }

  function updateNav(route) {
    $$(".main-nav a").forEach(a => {
      a.classList.toggle("active", a.dataset.nav === route.page);
    });
  }

  /* ---------------- per-page bindings ---------------- */
  function bindPage(route) {
    // newsletter (home/drops/about)
    const nf = $("#newsForm");
    if (nf) {
      nf.addEventListener("submit", async e => {
        e.preventDefault();
        const email = $("#newsEmail").value.trim();
        const msg = $("#newsMsg");
        const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
        if (!ok) { msg.textContent = rawT("news.invalid"); msg.className = "form-msg err"; return; }
        const button = nf.querySelector("button"); if (button.disabled) return;
        button.disabled = true; msg.textContent = rawT("account.loading");
        try {
          await API.request("/api/newsletter", { method: "POST", body: { email, lang: state.lang } });
          msg.textContent = rawT("news.saved"); msg.className = "form-msg ok"; nf.reset();
        } catch (error) { msg.textContent = error.message; msg.className = "form-msg err"; }
        finally { button.disabled = false; }
      });
    }

    if (route.page === "shop") {
      $$(".cat-tab").forEach(b => b.addEventListener("click", () => {
        state.shop.cat = b.dataset.cat; render(false);
        }));
      $("#sortSel").addEventListener("change", e => { state.shop.sort = e.target.value; render(false); });
      $("#sizeSel").addEventListener("change", e => { state.shop.size = e.target.value; render(false); });
      $("#availChk").addEventListener("change", e => { state.shop.onlyAvailable = e.target.checked; render(false); });
    }

    if (route.page === "product") {
      const p = PRODUCTS.find(x => x.id === route.id);
      if (!p) return;
      let selectedSize = null;
      // gallery
      $$(".pdp-thumb").forEach(th => th.addEventListener("click", () => {
        $$(".pdp-thumb").forEach(x => x.classList.remove("active"));
        th.classList.add("active");
        const img = $("#pdpMainImg");
        const idx = +th.dataset.gidx;
        img.style.animation = "none"; void img.offsetWidth; img.style.animation = "";
        img.src = productImg(p, idx);
      }));
      // sizes
      $$("#sizeRow .size-btn:not(.off)").forEach(b => b.addEventListener("click", () => {
        $$("#sizeRow .size-btn").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        selectedSize = b.dataset.sz;
        $("#pdpErr").textContent = "";
      }));
      // add to cart
      const addBtn = $("#addBtn");
      if (addBtn) addBtn.addEventListener("click", () => {
        if (!selectedSize) { $("#pdpErr").textContent = rawT("product.selectSize"); return; }
        if (addToCart(p.id, selectedSize)) {
          toast(rawT("product.added") + " — " + p.name);
          openCart();
        }
      });
      // size guide
      const sg = $("#sizeGuideBtn");
      if (sg) sg.addEventListener("click", () => {
        $("#accountModal h3").textContent = rawT("sizeGuide.title");
        $("#accountModal .modal-text").textContent = rawT("sizeGuide.text");
        openModal("#accountModal", true);
      });
      // accordions
      $$(".acc-head").forEach(h => h.addEventListener("click", () => {
        const item = h.parentElement;
        const body = $(".acc-body", item);
        const open = item.classList.toggle("open");
        h.setAttribute("aria-expanded", String(open));
        body.style.maxHeight = open ? body.scrollHeight + "px" : "0px";
      }));
    }

    const payRetry = route.page === "checkout" && $("[data-pay-order]", $("#app"));
    if (payRetry) payRetry.addEventListener("click", () => startPay(payRetry.dataset.payOrder, payRetry));
    if (route.page === "payment") bindPaymentPage(route.id);
    const openAccountBtn = $("[data-open-account]", $("#app"));
    if (openAccountBtn) openAccountBtn.addEventListener("click", openAccount);
    if (route.page === "account") bindAccountPage();

    if (route.page === "checkout") {
      const form = $("#checkoutForm");
      if (!form) return;
      const f = form.elements;
      if (API.user && !state.checkoutContact.touched) {
        f.name.value = f.name.value || API.user.displayName || "";
        f.email.value = f.email.value || API.user.email || "";
        f.phone.value = f.phone.value || API.user.phone || "";
      }
      const delivery = window.SOLAR_DELIVERY.mount($("#deliveryMount"), {
        t: rawT, api: API, lang: () => state.lang, providers: CFG.deliveryProviders,
        value: state.checkoutDelivery || (API.user && API.user.delivery) || {},
        onChange: v => { state.checkoutDelivery = v; }
      });
      state.checkoutDelivery = delivery.value();
      const payGroup = $(".pay-methods", form);
      if (payGroup) payGroup.addEventListener("click", e => {
        const b = e.target.closest("[data-pay]"); if (!b) return;
        state.checkoutPayment = b.dataset.pay;
        payGroup.querySelectorAll("[data-pay]").forEach(x => { const on = x === b; x.classList.toggle("active", on); x.setAttribute("aria-checked", String(on)); });
        $(".pay-secure", form).hidden = payMethod() !== "card";
        $("#checkoutSubmit").textContent = rawT(payMethod() === "card" ? "checkout.submitCard" : "checkout.submit");
      });
      form.addEventListener("input", e => {
        const el = e.target;
        if (["name", "phone", "email", "comment"].includes(el.name)) { state.checkoutContact[el.name] = el.value; state.checkoutContact.touched = true; }
        const field = el.closest(".field"); if (field && !field.closest(".dlv")) field.classList.remove("invalid");
      });
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const checks = [
          ["name", v => v.trim().length >= 2],
          ["phone", v => /^\+?[\d\s\-()]{10,17}$/.test(v.trim())],
          ["email", v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())]
        ];
        let first = null;
        checks.forEach(([name, fn]) => {
          const el = f[name], ok = fn(el.value);
          el.closest(".field").classList.toggle("invalid", !ok);
          if (!ok && !first) first = el;
        });
        const msg = $("#checkoutMsg");
        const dv = delivery.validate();
        if (first || !dv.ok) { (first || dv.focus).focus(); (first || dv.focus).scrollIntoView({ block: "center", behavior: "smooth" }); msg.textContent = ""; return; }
        const button = form.querySelector('button[type="submit"]'); if (button.disabled) return;
        button.disabled = true; form.classList.add("submit-busy"); msg.className = "checkout-msg"; msg.textContent = rawT("account.loading");
        const customer = { name: f.name.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(), ...delivery.value(), comment: f.comment.value.trim() };
        const items = state.cart.map(({ id, size, qty }) => ({ id, size, qty }));
        try {
          const bytes = new TextEncoder().encode(JSON.stringify({ customer, items, paymentMethod: payMethod() }));
          const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(n => n.toString(16).padStart(2, "0")).join("");
          let previous = null;
          try { previous = JSON.parse(sessionStorage.getItem("solar_checkout_request")); } catch (_) {}
          const request = previous && previous.fingerprint === fingerprint ? previous : { fingerprint, key: crypto.randomUUID() };
          try { sessionStorage.setItem("solar_checkout_request", JSON.stringify(request)); } catch (_) {}
          const result = await API.request("/api/orders", { method: "POST", body: { customer, items, lang: state.lang, idempotencyKey: request.key, saveDelivery: !!(f.saveDelivery && f.saveDelivery.checked), paymentMethod: payMethod() } });
          state.lastOrder = result.order; state.lastPaymentError = result.paymentError || "";
          state.cart = []; saveCart(); updateCartBadge(false); renderCartDrawer();
          if (result.pageUrl) {
            try { sessionStorage.removeItem("solar_checkout_request"); } catch (_) {}
            state.checkoutContact = {}; state.checkoutDelivery = null; state.acct.orders = null;
            msg.className = "checkout-msg ok"; msg.textContent = rawT("checkout.redirecting");
            location.href = result.pageUrl; return;
          }
          state.checkoutContact = {}; state.checkoutDelivery = null; state.acct.orders = null;
          try { sessionStorage.removeItem("solar_checkout_request"); } catch (_) {}
          if (API.user) await API.request("/api/auth/me").catch(() => {});
          await refreshSite().catch(() => {});
          render(false); $("#app").focus({ preventScroll: true }); scrollTo({ top: 0, behavior: "smooth" });
        } catch (error) {
          msg.textContent = error.message; msg.className = "checkout-msg err";
          if (error.status === 409) refreshSite().catch(() => {});
        } finally { button.disabled = false; form.classList.remove("submit-busy"); }
      });
    }
  }

  /* ---------------- global bindings ---------------- */
  function bindGlobal() {
    // header scroll
    let lastY = 0;
    addEventListener("scroll", () => {
      const y = scrollY;
      $("#siteHeader").classList.toggle("scrolled", y > 24);
      // progress
      const h = document.documentElement.scrollHeight - innerHeight;
      $(".scroll-progress span").style.transform = `scaleX(${h > 0 ? y / h : 0})`;
      // hero parallax
      const ecl = $(".eclipse");
      if (ecl && !reduceMotion.matches && y < innerHeight) {
        ecl.style.marginTop = y * 0.18 + "px";
        ecl.style.opacity = Math.max(0, 1 - y / (innerHeight * .85));
      }
      lastY = y;
    }, { passive: true });

    // theme
    $("#themeBtn").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("solar_theme", next); } catch (e) {}
      syncTheme();
    });

    // lang
    $$(".lang-btn").forEach(b => b.addEventListener("click", () => { setLang(b.dataset.lang); }));

    // burger / menu
    $("#burgerBtn").addEventListener("click", () => openMenu(!$("#mobileMenu").classList.contains("open")));
    $("#mobileMenu").addEventListener("click", e => { if (e.target.closest("a")) openMenu(false); });

    // search
    $("#searchBtn").addEventListener("click", openSearch);
    $("#searchClose").addEventListener("click", closeSearch);
    $("#searchInput").addEventListener("input", e => {
      const q = e.target.value.trim().toLowerCase();
      const box = $("#searchResults");
      if (!q) { box.innerHTML = `<p class="search-note">${t("search.hint")}</p>`; return; }
      const hits = PRODUCTS.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.collection.toLowerCase().includes(q) ||
        (localized(p.desc)).toLowerCase().includes(q));
      box.innerHTML = hits.length
        ? hits.map(p => `<a class="search-hit" href="#/product/${esc(p.id)}"><b>${esc(p.name)}</b><span>${fmt(p.price)}</span></a>`).join("")
        : `<p class="search-note">${t("search.empty")}</p>`;
      $$(".search-hit", box).forEach(a => a.addEventListener("click", closeSearch));
    });

    // account and product information
    $("#accountBtn").addEventListener("click", () => { if (API.user) { if (location.hash === "#/account") render(false); else location.hash = "#/account"; } else openAccount(); });
    bindAccount();
    $$("[data-close-modal]").forEach(b => b.addEventListener("click", () => openModal("#accountModal", false)));
    $("#accountModal").addEventListener("click", e => { if (e.target.id === "accountModal") openModal("#accountModal", false); });

    // cart
    $("#cartBtn").addEventListener("click", openCart);
    $("#cartClose").addEventListener("click", closeCart);
    $("#drawerBackdrop").addEventListener("click", closeCart);
    $("#cartDrawer").addEventListener("click", e => {
      const tEl = e.target.closest("[data-qty],[data-rm],[data-close-cart]");
      if (!tEl) return;
      if (tEl.hasAttribute("data-close-cart")) { closeCart(); return; }
      const id = tEl.dataset.id, size = tEl.dataset.size;
      if (tEl.hasAttribute("data-rm")) { removeLine(id, size); return; }
      const line = state.cart.find(i => i.id === id && i.size === size);
      if (line) setQty(id, size, line.qty + (+tEl.dataset.qty));
    });

    // esc closes everything
    addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      closeCart(); closeSearch(); openMenu(false); openModal("#accountModal", false);
    });

    // custom cursor
    if (matchMedia("(pointer:fine)").matches && !reduceMotion.matches) {
      const dot = $(".cursor-dot"), ring = $(".cursor-ring");
      let rx = 0, ry = 0, tx = 0, ty = 0, raf = null;
      addEventListener("mousemove", e => {
        tx = e.clientX; ty = e.clientY;
        dot.style.transform = `translate(${tx - 3}px,${ty - 3}px)`;
        document.body.classList.add("cursor-on");
        const over = e.target.closest("a,button,input,select,label,[role=button]");
        document.body.classList.toggle("cursor-hover", !!over);
        if (!raf) loop();
      }, { passive: true });
      function loop() {
        rx += (tx - rx) * 0.16; ry += (ty - ry) * 0.16;
        ring.style.transform = `translate(${rx - 17}px,${ry - 17}px)`;
        raf = (Math.abs(tx - rx) > .3 || Math.abs(ty - ry) > .3) ? requestAnimationFrame(loop) : null;
      }
      addEventListener("mouseleave", () => document.body.classList.remove("cursor-on"));
    }

    addEventListener("hashchange", () => {
      openMenu(false);
      render(true);
      scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    });
  }

  /* ---------------- intro / language gate ---------------- */
  function initIntro() {
    const intro = $("#intro");
    if (CFG.introEnabled === false) { if (intro) intro.remove(); document.body.classList.remove("intro-lock"); document.body.classList.add("intro-ready"); return; }
    if (!intro) { document.body.classList.add("intro-ready"); return; }
    let dismissed = false;
    const choices = $$("[data-intro-lang]", intro);
    const continueButton = $("#introContinue", intro);
    const siblings = Array.from(document.body.children)
      .filter(el => el !== intro && el.tagName !== "SCRIPT")
      .map(el => [el, el.inert]);
    intro.setAttribute("role", "dialog");
    intro.setAttribute("aria-modal", "true");
    intro.setAttribute("aria-label", (CFG.brand || "SØLAR") + " — " + rawT("intro.chooseTitle"));
    intro.tabIndex = -1;
    choices.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.introLang === state.lang)));
    if (continueButton) {
      continueButton.textContent = rawT("intro.continue") + " →";
    }
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      try { localStorage.setItem("solar_lang", state.lang); } catch (e) {}
      intro.classList.add("hide");
      siblings.forEach(([el, inert]) => { el.inert = inert; });
      document.body.classList.remove("intro-lock");
      document.body.classList.add("intro-ready");
      $("#app").focus({ preventScroll: true });
      intro.setAttribute("aria-hidden", "true");
      setTimeout(() => intro.remove(), 1100);
    };
    document.body.classList.add("intro-lock");
    siblings.forEach(([el]) => { el.inert = true; });
    intro.focus({ preventScroll: true });
    // The full intro and language choice appear on every page load.
    choices.forEach(button => button.addEventListener("click", () => {
      setLang(button.dataset.introLang);
      dismiss();
    }));
    if (continueButton) continueButton.addEventListener("click", dismiss);
    intro.addEventListener("keydown", e => {
      if (e.key === "Escape" || (e.key === "Enter" && e.target === intro)) {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      } else if (e.key === "Tab") {
        const controls = continueButton ? choices.concat(continueButton) : choices;
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === intro)) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    });
  }

  /* ---------------- init ---------------- */
  sanitizeCart();
  applyI18n();
  bindGlobal();
  updateCartBadge(false);
  renderCartDrawer();
  render(false);
  initIntro();
})();
