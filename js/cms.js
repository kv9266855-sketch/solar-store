/* Server content is authoritative; the old JS files are seed data only. */
(function () {
  "use strict";
  const defaults = structuredClone(window.SOLAR.I18N || {});
  const seed = structuredClone({ config: window.SOLAR.CONFIG || {}, products: window.SOLAR.PRODUCTS || [] });

  /* Static showcase (GitHub Pages, file://): no Node server, so the catalog comes from the seed files.
     Orders, accounts and payments stay on the main server; the storefront says so instead of failing. */
  function staticSite() {
    const abs = path => new URL(path, document.baseURI).href;
    const note = Object.fromEntries(["en", "uk", "ru", "fr"].map(l => [l, (defaults[l] || {})["misc.staticDemo"] || (defaults.en || {})["misc.staticDemo"] || ""]));
    const navigation = [{ labelKey: "nav.shop", href: "#/shop" }, { labelKey: "nav.drops", href: "#/drops" }, { labelKey: "nav.about", href: "#/about" }];
    return {
      revision: 0, static: true, payments: { cod: false, card: false },
      config: { ...seed.config, demoMode: false, checkoutEnabled: false, newsletterEnabled: false, cardPaymentsEnabled: false, introEnabled: true, defaultTheme: "dark", seoTitle: "SØLAR — Beyond The Light", seoDescription: "Independent streetwear label. DROP 01 — ECLIPSE. Est. 2026 by STARKON × SLAYER.", announcementEnabled: true, announcementText: note, deliveryProviders: ["nova-poshta", "ukrposhta", "pickup"] },
      products: seed.products.map(p => ({ ...p, images: [], published: true })),
      i18n: defaults,
      content: {
        brandTagline: "BEYOND THE LIGHT.", marquee: ["SØLAR", "BEYOND THE LIGHT", "DROP 01 — ECLIPSE", "EST. 2026", "STARKON × SLAYER"],
        founders: [{ id: "starkon", name: "STARKON", image: abs("images/starkon.png"), bio: "" }, { id: "slayer", name: "SLAYER", image: "", bio: "" }],
        hero: { image: "", ctaHref: "#/shop" }, editorial: [{ image: "" }, { image: "" }, { image: "" }], dropImage: "",
        homepageSections: ["hero", "marquee", "featured", "manifesto", "editorial"], hiddenSections: [],
        navigation, footerNavigation: [...navigation, ...["contact", "shipping", "returns", "privacy", "terms"].map(slug => ({ labelKey: "footer." + slug, href: "#/page/" + slug }))],
        pages: [], customSections: []
      },
      design: { dark: {}, light: {}, fontDisplay: "Unbounded", fontUi: "Manrope", customCss: "" }
    };
  }
  const safeUrl = value => {
    const str = String(value || "").trim();
    if (!str) return "";
    if (/^#\//.test(str) || /^\/(?!\/)/.test(str)) return str;
    try { const u = new URL(str, location.origin); return ["http:", "https:", "mailto:", "tel:"].includes(u.protocol) ? u.href : ""; } catch (_) { return ""; }
  };
  window.SOLAR_SAFE_URL = safeUrl;
  function apply(site) {
    if (!site || !site.config || !Array.isArray(site.products) || !site.i18n) throw new Error("Сервер вернул некорректные данные сайта.");
    window.SOLAR.SITE = site;
    window.SOLAR.CONFIG = site.config;
    window.SOLAR.PRODUCTS = site.products.filter(p => p.published !== false);
    window.SOLAR.I18N = Object.fromEntries(["en", "uk", "ru", "fr"].map(lang => [lang, { ...(defaults[lang] || {}), ...(site.i18n[lang] || {}) }]));
    window.SOLAR.CONTENT = site.content || {};
    const design = site.design || {};
    let css = "";
    for (const theme of ["dark", "light"]) {
      const values = design[theme] || {};
      const entries = Object.entries(values).filter(([key, value]) => /^[a-z][a-z-]*$/.test(key) && /^#[\da-f]{3,8}$/i.test(String(value)));
      css += ':root[data-theme="' + theme + '"]{' + entries.map(([key, value]) => "--" + key + ":" + value + ";").join("") + "}";
      if (values.bg && /^#[\da-f]{6}$/i.test(values.bg)) {
        const rgb = values.bg.slice(1).match(/../g).map(v => parseInt(v, 16)).join(",");
        css += ':root[data-theme="' + theme + '"]{--veil:' + rgb + ";}";
      }
    }
    const font = value => '"' + String(value || "").replace(/["\\\r\n;{}]/g, "") + '"';
    css += ':root{--font-display:' + font(design.fontDisplay || "Unbounded") + ',sans-serif;--font-ui:' + font(design.fontUi || "Manrope") + ',system-ui,sans-serif;}';
    let style = document.querySelector("#cmsDesign");
    if (!style) { style = document.createElement("style"); style.id = "cmsDesign"; document.head.append(style); }
    style.textContent = css + "\n" + String(design.customCss || "");
    try {
      if (!localStorage.getItem("solar_theme")) document.documentElement.dataset.theme = site.config.defaultTheme === "light" ? "light" : "dark";
    } catch (_) {}
    if (site.config.seoTitle) document.title = site.config.seoTitle;
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]']) {
      const el = document.querySelector(selector); if (el) el.content = site.config.seoDescription || "";
    }
    const title = document.querySelector('meta[property="og:title"]'); if (title) title.content = site.config.seoTitle || site.config.brand;
    const brand = document.querySelector('meta[property="og:site_name"]'); if (brand) brand.content = site.config.brand;
    return site;
  }
  window.SOLAR_REFRESH = async () => {
    if (window.SOLAR_STATIC) return apply(staticSite());
    let response;
    try { response = await fetch("/api/site", { cache: "no-store", credentials: "same-origin" }); }
    catch (_) { window.SOLAR_STATIC = true; return apply(staticSite()); }
    const json = /json/i.test(response.headers.get("content-type") || "");
    if (response.status === 404 || response.status === 405 || (response.ok && !json)) { window.SOLAR_STATIC = true; return apply(staticSite()); }
    if (!response.ok) throw new Error("Сервер сайта недоступен. Запустите npm start и обновите страницу.");
    return apply(await response.json());
  };
  window.SOLAR_READY = window.SOLAR_REFRESH()
    .then(site => Promise.resolve(window.SOLAR_API.ready).catch(error => { if (!window.SOLAR_STATIC) throw error; }).then(() => site));
  window.SOLAR_READY.catch(error => {
    document.querySelector("#intro")?.remove(); document.body.classList.remove("intro-lock");
    const main = document.querySelector("#app"); main.replaceChildren();
    const box = document.createElement("div"); box.className = "static-page";
    const title = document.createElement("h1"); title.textContent = "SØLAR";
    const message = document.createElement("p"); message.textContent = error.message;
    const retry = document.createElement("button"); retry.className = "btn"; retry.textContent = "Обновить страницу"; retry.onclick = () => location.reload();
    box.append(title, message, retry); main.append(box);
  });
})();
