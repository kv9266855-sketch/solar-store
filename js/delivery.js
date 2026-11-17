/* SØLAR — delivery picker: method cards, Nova Poshta city search and every branch / parcel locker
   of the chosen city (server proxy /api/np/*). Used by checkout and the customer account. */
(function () {
  "use strict";

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const METHOD_INFO = {
    np: { key: "checkout.np", hint: "checkout.npHint", provider: "nova-poshta" },
    npCourier: { key: "checkout.npCourier", hint: "checkout.npCourierHint", provider: "nova-poshta" },
    ukr: { key: "checkout.ukr", hint: "checkout.ukrHint", provider: "ukrposhta" },
    pickup: { key: "checkout.pickup", hint: "checkout.pickupHint", provider: "pickup" }
  };
  let uid = 0;

  function debounce(fn, ms) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }; }

  function mount(root, opts) {
    const t = opts.t, api = opts.api, lang = () => (opts.lang ? opts.lang() : "uk");
    const providers = Array.isArray(opts.providers) ? opts.providers : ["nova-poshta", "ukrposhta", "pickup"];
    const methods = Object.keys(METHOD_INFO).filter(id => providers.includes(METHOD_INFO[id].provider));
    const id = "dlv" + (++uid);
    const initial = opts.value || {};
    const state = {
      method: methods.includes(initial.method) ? initial.method : methods[0],
      city: initial.city && initial.city !== "—" ? initial.city : "",
      cityRef: initial.cityRef || "",
      warehouse: initial.method === "np" && initial.warehouseRef ? { ref: initial.warehouseRef, name: initial.branch, type: initial.warehouseType || "branch", address: "" } : null,
      address: initial.method && initial.method !== "np" && initial.method !== "pickup" ? (initial.branch || "") : "",
      whType: "all", whQuery: "", whItems: [], whTotal: 0, whCounts: null, whOffset: 0, whLoading: false, whError: "",
      cities: [], cityOpen: false, cityActive: -1, citySeq: 0, whSeq: 0
    };

    root.classList.add("dlv");
    root.innerHTML = `
      <p class="dlv-label" id="${id}-mlabel">${esc(t("checkout.methodTitle"))}</p>
      <div class="dlv-methods" role="radiogroup" aria-labelledby="${id}-mlabel">
        ${methods.map(m => `<button type="button" class="dlv-method" role="radio" data-method="${m}" aria-checked="false"><i aria-hidden="true"></i><b>${esc(t(METHOD_INFO[m].key))}</b><small>${esc(t(METHOD_INFO[m].hint))}</small></button>`).join("")}
      </div>
      <div class="field dlv-city">
        <input type="text" name="city" id="${id}-city" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-cities" aria-label="${esc(t("checkout.city"))}" placeholder="${esc(t("checkout.cityPlaceholder"))}">
        <span class="dlv-city-check" aria-hidden="true">✓</span>
        <ul class="dlv-cities" id="${id}-cities" role="listbox" hidden></ul>
        <p class="f-err">${esc(t("checkout.errCitySelect"))}</p>
      </div>
      <div class="dlv-np" data-for="np">
        <p class="dlv-label">${esc(t("checkout.warehouse"))}</p>
        <div class="dlv-selected" hidden>
          <span class="dlv-selected-num"></span>
          <span class="dlv-selected-body"><b></b><small></small></span>
          <button type="button" class="link-u dlv-change">${esc(t("checkout.change"))}</button>
        </div>
        <div class="dlv-picker">
          <div class="dlv-tools">
            <input type="search" class="dlv-wh-search" aria-label="${esc(t("checkout.whSearch"))}" placeholder="${esc(t("checkout.whSearch"))}" autocomplete="off">
            <div class="dlv-chips" role="tablist"></div>
          </div>
          <div class="dlv-wh-list" role="listbox" aria-label="${esc(t("checkout.warehouse"))}" tabindex="-1"></div>
          <div class="dlv-wh-foot"><span class="dlv-wh-count"></span><button type="button" class="link-u dlv-more" hidden>${esc(t("checkout.whMore"))}</button></div>
        </div>
        <p class="f-err dlv-wh-err">${esc(t("checkout.errWarehouse"))}</p>
      </div>
      <div class="field dlv-address" data-for="npCourier ukr">
        <input type="text" name="address" autocomplete="street-address" aria-label="${esc(t("checkout.courierAddress"))}">
        <p class="f-err">${esc(t("checkout.errAddress"))}</p>
      </div>
      <p class="dlv-note" data-for="pickup">${esc(t("checkout.pickupNote"))}</p>`;

    const $ = s => root.querySelector(s);
    const cityInput = $(".dlv-city input"), cityList = $(".dlv-cities");
    const whSearch = $(".dlv-wh-search"), whList = $(".dlv-wh-list"), more = $(".dlv-more");
    const addressInput = $(".dlv-address input");
    cityInput.value = state.city; addressInput.value = state.address;

    const changed = () => opts.onChange && opts.onChange(value());
    const whName = w => (lang() === "ru" && w.nameRu ? w.nameRu : w.name) || "";
    const typeLabel = type => t(type === "postomat" ? "checkout.typePostomat" : type === "cargo" ? "checkout.typeCargo" : "checkout.typeBranch");

    /* ---------- method ---------- */
    function syncMethod() {
      root.querySelectorAll(".dlv-method").forEach(b => {
        const on = b.dataset.method === state.method;
        b.classList.toggle("active", on); b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1;
      });
      root.querySelectorAll("[data-for]").forEach(el => { el.hidden = !el.dataset.for.split(" ").includes(state.method); });
      $(".dlv-city").hidden = state.method === "pickup";
      addressInput.placeholder = t(state.method === "ukr" ? "checkout.ukrAddress" : "checkout.courierAddress");
      addressInput.setAttribute("aria-label", addressInput.placeholder);
      $(".dlv-city").classList.toggle("picked", !!state.cityRef);
      if (state.method === "np") syncWarehouse();
    }
    root.querySelector(".dlv-methods").addEventListener("click", e => {
      const b = e.target.closest(".dlv-method"); if (!b) return;
      state.method = b.dataset.method; state.whError = ""; clearErrors(); syncMethod(); changed();
    });
    root.querySelector(".dlv-methods").addEventListener("keydown", e => {
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
      e.preventDefault();
      const i = methods.indexOf(state.method), next = methods[(i + (["ArrowRight", "ArrowDown"].includes(e.key) ? 1 : methods.length - 1)) % methods.length];
      state.method = next; syncMethod(); root.querySelector(`.dlv-method[data-method="${next}"]`).focus(); changed();
    });

    /* ---------- city combobox ---------- */
    function renderCities(message) {
      if (message) { cityList.innerHTML = `<li class="dlv-hint">${esc(message)}</li>`; }
      else cityList.innerHTML = state.cities.map((c, i) => `<li role="option" id="${id}-c${i}" class="dlv-city-opt${i === state.cityActive ? " active" : ""}" data-i="${i}" aria-selected="${i === state.cityActive}"><b>${esc(c.name)}</b><span>${esc(c.label)}</span><em>${c.warehouses} ${esc(t("checkout.points"))}</em></li>`).join("");
      const open = state.cityOpen && (!!message || state.cities.length > 0);
      cityList.hidden = !open; cityInput.setAttribute("aria-expanded", String(open));
      if (state.cityActive >= 0) cityInput.setAttribute("aria-activedescendant", `${id}-c${state.cityActive}`); else cityInput.removeAttribute("aria-activedescendant");
    }
    const searchCities = debounce(async q => {
      const seq = ++state.citySeq;
      if (q.length < 2) { state.cities = []; renderCities(); return; }
      renderCities(t("checkout.citySearching"));
      try {
        const data = await api.request("/api/np/cities?q=" + encodeURIComponent(q));
        if (seq !== state.citySeq) return;
        state.cities = data.cities || []; state.cityActive = state.cities.length ? 0 : -1;
        renderCities(state.cities.length ? "" : t("checkout.cityNone"));
      } catch (error) { if (seq === state.citySeq) renderCities(error.status >= 500 ? t("checkout.npDown") : error.message); }
    }, 220);
    function pickCity(c) {
      state.city = c.name; state.cityRef = c.ref; state.cityLabel = c.label;
      cityInput.value = c.name; state.cityOpen = false; renderCities();
      $(".dlv-city").classList.remove("invalid"); $(".dlv-city").classList.add("picked");
      state.warehouse = null; state.whQuery = ""; whSearch.value = ""; state.whType = "all";
      state.whCounts = null; state.whItems = []; state.whError = "";
      if (state.method === "np") { syncWarehouse(); setTimeout(() => whSearch.focus(), 30); }
      changed();
    }
    cityInput.addEventListener("input", () => {
      state.city = cityInput.value.trim(); state.cityRef = ""; state.warehouse = null; state.whCounts = null; state.whItems = [];
      $(".dlv-city").classList.remove("picked", "invalid");
      state.cityOpen = true; searchCities(state.city);
      if (state.method === "np") syncWarehouse();
      changed();
    });
    cityInput.addEventListener("focus", () => { if (state.cities.length && !state.cityRef) { state.cityOpen = true; renderCities(); } });
    cityInput.addEventListener("keydown", e => {
      if (cityList.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); const n = state.cities.length; if (!n) return;
        state.cityActive = (state.cityActive + (e.key === "ArrowDown" ? 1 : n - 1)) % n; renderCities();
        cityList.querySelector(".active")?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") { if (state.cities[state.cityActive]) { e.preventDefault(); pickCity(state.cities[state.cityActive]); } }
      else if (e.key === "Escape") { e.stopPropagation(); state.cityOpen = false; renderCities(); }
    });
    cityList.addEventListener("mousedown", e => { const li = e.target.closest("[data-i]"); if (li) { e.preventDefault(); pickCity(state.cities[+li.dataset.i]); } });
    cityInput.addEventListener("blur", () => setTimeout(() => { state.cityOpen = false; renderCities(); }, 120));

    /* ---------- warehouses ---------- */
    function syncWarehouse() {
      const sel = $(".dlv-selected"), picker = $(".dlv-picker");
      if (state.warehouse) {
        sel.hidden = false; picker.hidden = true;
        $(".dlv-selected-num").textContent = state.warehouse.number ? "№" + state.warehouse.number : "✓";
        $(".dlv-selected-body b").textContent = typeLabel(state.warehouse.type) + (state.warehouse.fitting ? " · " + t("checkout.fitting") : "");
        $(".dlv-selected-body small").textContent = state.warehouse.address ? whName(state.warehouse) : state.warehouse.name;
        return;
      }
      sel.hidden = true; picker.hidden = false;
      if (!state.cityRef) {
        $(".dlv-chips").innerHTML = ""; whList.innerHTML = `<p class="dlv-empty">${esc(t("checkout.whFirst"))}</p>`;
        $(".dlv-wh-count").textContent = ""; more.hidden = true; whSearch.disabled = true; return;
      }
      whSearch.disabled = false;
      if (!state.whCounts && !state.whLoading && !state.whError) { loadWarehouses(true); return; }
      renderWarehouses();
    }
    function renderWarehouses() {
      const counts = state.whCounts;
      $(".dlv-chips").innerHTML = counts ? [["all", "checkout.whAll"], ["branch", "checkout.whBranch"], ["postomat", "checkout.whPostomat"], ["cargo", "checkout.whCargo"]]
        .filter(([k]) => k === "all" || counts[k] > 0)
        .map(([k, key]) => `<button type="button" role="tab" class="dlv-chip${state.whType === k ? " active" : ""}" aria-selected="${state.whType === k}" data-type="${k}">${esc(t(key))}<span>${counts[k]}</span></button>`).join("") : "";
      if (state.whError) { whList.innerHTML = `<p class="dlv-empty err">${esc(state.whError)}</p>`; more.hidden = true; $(".dlv-wh-count").textContent = ""; return; }
      if (state.whLoading && !state.whItems.length) { whList.innerHTML = `<div class="dlv-loading"><i></i>${esc(t("checkout.whLoading"))}</div>`; more.hidden = true; return; }
      if (!state.whItems.length) { whList.innerHTML = `<p class="dlv-empty">${esc(t("checkout.whEmpty"))}</p>`; more.hidden = true; $(".dlv-wh-count").textContent = ""; return; }
      whList.innerHTML = state.whItems.map((w, i) => `<button type="button" role="option" aria-selected="false" class="dlv-wh dlv-wh-${w.type}" data-i="${i}" style="--d:${Math.min(i % 60, 20)}">
          <span class="dlv-wh-num">№${esc(w.number)}</span>
          <span class="dlv-wh-body"><b>${esc(typeLabel(w.type))}${w.maxKg ? ` · ${esc(t("checkout.upTo"))} ${w.maxKg} ${esc(t("checkout.kg"))}` : ""}</b><span>${esc(w.address || whName(w))}</span></span>
          ${w.fitting ? `<span class="dlv-tag">${esc(t("checkout.fitting"))}</span>` : ""}
        </button>`).join("");
      $(".dlv-wh-count").textContent = `${t("checkout.whShown")} ${state.whItems.length} ${t("checkout.of")} ${state.whTotal}`;
      more.hidden = state.whItems.length >= state.whTotal;
      more.disabled = state.whLoading;
    }
    async function loadWarehouses(reset) {
      if (!state.cityRef) return;
      const seq = ++state.whSeq;
      if (reset) { state.whItems = []; state.whOffset = 0; }
      state.whLoading = true; state.whError = ""; renderWarehouses();
      try {
        const params = new URLSearchParams({ cityRef: state.cityRef, type: state.whType, q: state.whQuery, offset: String(state.whOffset), limit: "60" });
        const data = await api.request("/api/np/warehouses?" + params);
        if (seq !== state.whSeq) return;
        state.whItems = reset ? data.items : state.whItems.concat(data.items);
        state.whTotal = data.total; state.whCounts = data.counts; state.whOffset = state.whItems.length;
      } catch (error) { if (seq === state.whSeq) state.whError = error.status >= 500 ? t("checkout.npDown") : error.message; }
      finally { if (seq === state.whSeq) { state.whLoading = false; if (!state.warehouse) renderWarehouses(); } }
    }
    const searchWarehouses = debounce(() => loadWarehouses(true), 200);
    whSearch.addEventListener("input", () => { state.whQuery = whSearch.value.trim(); searchWarehouses(); });
    whSearch.addEventListener("keydown", e => { if (e.key === "ArrowDown") { e.preventDefault(); whList.querySelector(".dlv-wh")?.focus(); } });
    root.querySelector(".dlv-chips").addEventListener("click", e => {
      const chip = e.target.closest("[data-type]"); if (!chip) return;
      state.whType = chip.dataset.type; loadWarehouses(true);
    });
    more.addEventListener("click", () => loadWarehouses(false));
    whList.addEventListener("scroll", () => {
      if (!state.whLoading && state.whItems.length < state.whTotal && whList.scrollTop + whList.clientHeight > whList.scrollHeight - 160) loadWarehouses(false);
    }, { passive: true });
    whList.addEventListener("click", e => {
      const b = e.target.closest(".dlv-wh"); if (!b) return;
      state.warehouse = state.whItems[+b.dataset.i];
      root.querySelector(".dlv-np").classList.remove("invalid");
      syncWarehouse(); changed();
      $(".dlv-change").focus({ preventScroll: true });
    });
    whList.addEventListener("keydown", e => {
      const items = [...whList.querySelectorAll(".dlv-wh")], i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown" && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); (i > 0 ? items[i - 1] : whSearch).focus(); }
    });
    $(".dlv-change").addEventListener("click", () => {
      state.warehouse = null; syncWarehouse(); changed();
      whSearch.focus();
    });

    addressInput.addEventListener("input", () => { state.address = addressInput.value; root.querySelector(".dlv-address").classList.remove("invalid"); changed(); });

    /* ---------- public API ---------- */
    function value() {
      const v = { method: state.method, city: state.city, cityRef: state.cityRef, branch: "", warehouseRef: "", warehouseType: "" };
      if (state.method === "np" && state.warehouse) { v.branch = state.warehouse.address ? whName(state.warehouse) : state.warehouse.name; v.warehouseRef = state.warehouse.ref; v.warehouseType = state.warehouse.type; }
      else if (state.method === "npCourier" || state.method === "ukr") v.branch = state.address.trim();
      if (state.method === "pickup") { v.city = ""; v.cityRef = ""; }
      return v;
    }
    function clearErrors() { root.querySelectorAll(".invalid").forEach(el => el.classList.remove("invalid")); }
    function validate() {
      clearErrors();
      const fail = el => { el.classList.add("invalid"); return { ok: false, focus: el.querySelector("input:not([disabled]),button") || el }; };
      if (state.method === "pickup") return { ok: true };
      if (state.method === "np" ? !state.cityRef : state.city.length < 2) return fail($(".dlv-city"));
      if (state.method === "np" && !state.warehouse) return fail(root.querySelector(".dlv-np"));
      if (state.method !== "np" && state.address.trim().length < 5) return fail(root.querySelector(".dlv-address"));
      return { ok: true };
    }

    syncMethod();
    return { value, validate };
  }

  window.SOLAR_DELIVERY = { mount, METHOD_INFO };
})();
