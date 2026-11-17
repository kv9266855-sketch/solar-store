/* Same-origin session API. Credentials stay in HttpOnly cookies. */
(function () {
  "use strict";
  const api = window.SOLAR_API = { user: null, csrfToken: "" };
  async function send(path, options = {}) {
    if (!String(path).startsWith("/api/")) throw new Error("Invalid API path");
    const method = options.method || "GET";
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    let body = options.body;
    if (body !== undefined && typeof body !== "string") {
      body = JSON.stringify(body); headers["Content-Type"] = "application/json";
    }
    if (method !== "GET" && method !== "HEAD") headers["X-Solar-CSRF"] = api.csrfToken;
    const response = await fetch(path, { ...options, method, headers, body, credentials: "same-origin", cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Не удалось выполнить запрос. Попробуйте ещё раз.");
      error.status = response.status; error.code = data.code; throw error;
    }
    if (typeof data.csrfToken === "string") api.csrfToken = data.csrfToken;
    if (Object.prototype.hasOwnProperty.call(data, "user")) api.user = data.user;
    return data;
  }
  // GitHub Pages / file:// have no Node server: run as a read-only showcase without probing the API.
  window.SOLAR_STATIC = window.SOLAR_STATIC || /\.github\.io$/i.test(location.hostname) || location.protocol === "file:";
  api.ready = window.SOLAR_STATIC ? Promise.resolve({ user: null }) : send("/api/auth/me");
  api.ready.catch(() => {});
  api.request = async function (path, options = {}) {
    if (window.SOLAR_STATIC) {
      let lang = "en"; try { lang = localStorage.getItem("solar_lang") || "en"; } catch (_) {}
      const dict = (window.SOLAR && window.SOLAR.I18N) || {};
      const error = new Error((dict[lang] || {})["misc.staticDemo"] || (dict.en || {})["misc.staticDemo"] || "Showcase mode.");
      error.status = 503; error.code = "STATIC"; throw error;
    }
    await api.ready;
    let result;
    try { result = await send(path, options); }
    catch (error) {
      if (error.status !== 403 || !/csrf/i.test(String(error.code || "") + " " + error.message)) throw error;
      await send("/api/auth/me");
      result = await send(path, options);
    }
    if (path === "/api/auth/logout") { api.user = null; await send("/api/auth/me"); }
    if (path.startsWith("/api/auth/") || path === "/api/account/profile") {
      window.dispatchEvent(new CustomEvent("solar-auth", { detail: api.user }));
    }
    return result;
  };
  api.upload = async function (file) {
    if (!file || file.size > 8 * 1024 * 1024) throw new Error("Размер фото — до 8 МБ.");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
    });
    return (await api.request("/api/admin/media", { method: "POST", body: { name: file.name, dataUrl } })).media;
  };
})();
