import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import vm from 'node:vm';

const scrypt = promisify(scryptCallback);
export const LANGS = ['en', 'uk', 'ru', 'fr'];
export const STATUSES = ['new', 'confirmed', 'shipped', 'completed', 'cancelled'];
export class ApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
export function check(condition, message, status = 400, code) { if (!condition) throw new ApiError(status, message, code); }
export const token = () => randomBytes(32).toString('hex');
export const digest = value => createHash('sha256').update(value).digest('hex');
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
export async function hashPassword(password) {
  check(typeof password === 'string' && password.length >= 8 && password.length <= 128, 'Пароль должен содержать от 8 до 128 символов.');
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt:32768:8:1:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, saved) {
  if (typeof password !== 'string' || password.length > 128 || !saved) return false;
  const [kind, n, r, p, salt, expected] = saved.split(':');
  if (kind !== 'scrypt') return false;
  const hash = await scrypt(password, salt, 64, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return safeEqual(hash.toString('hex'), expected);
}
export function text(value, max = 1000, fallback = '') {
  check(value === undefined || value === null || typeof value === 'string', 'Некорректное текстовое поле.');
  const result = value == null ? fallback : value;
  check(result.length <= max, `Текст слишком длинный (максимум ${max}).`);
  return result.replace(/\u0000/g, '');
}
export function url(value, { image = false } = {}) {
  const result = text(value, 2048).trim();
  if (!result) return '';
  check(!/[\u0000-\u0020<>"'\\]/.test(result), 'Некорректный адрес ссылки или изображения.');
  if (/^\/(?!\/)/.test(result) || (!image && /^(#\/|mailto:|tel:)/i.test(result))) return result;
  if (/^https:\/\//i.test(result)) {
    let parsed; try { parsed = new URL(result); } catch (_) { throw new ApiError(400, 'Некорректный HTTPS-адрес.'); }
    check(parsed.hostname && !parsed.username && !parsed.password, 'Ссылка не должна содержать логин или пароль.');
    return result;
  }
  throw new ApiError(400, 'Используйте внутренний путь или HTTPS-ссылку.');
}
function plain(value, depth = 0) {
  check(depth < 12, 'Слишком глубокая структура данных.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return text(value, 100000);
  if (typeof value === 'number') { check(Number.isFinite(value), 'Некорректное число.'); return value; }
  if (Array.isArray(value)) { check(value.length <= 5000, 'Слишком большой список.'); return value.map(x => plain(x, depth + 1)); }
  check(value && typeof value === 'object', 'Некорректные данные.');
  const result = {};
  const keys = Object.keys(value); check(keys.length <= 3000, 'Слишком много полей.');
  for (const key of keys) {
    check(!['__proto__', 'prototype', 'constructor'].includes(key), 'Недопустимый ключ.');
    check(key.length <= 150, 'Ключ слишком длинный.');
    result[key] = plain(value[key], depth + 1);
  }
  return result;
}
function localized(value) {
  if (typeof value === 'string') return Object.fromEntries(LANGS.map(lang => [lang, text(value, 20000)]));
  check(value == null || (typeof value === 'object' && !Array.isArray(value)), 'Перевод должен быть текстом или объектом языков.');
  const result = {};
  for (const lang of LANGS) result[lang] = text(value?.[lang], 20000);
  return result;
}
export function validateSite(input) {
  const site = plain(input);
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  check(object(site), 'Документ сайта должен быть объектом.');
  check(Number.isInteger(site.revision) && site.revision >= 1, 'Укажите текущую версию сайта.');
  check(object(site.config) && object(site.i18n) && object(site.content) && object(site.design), 'Неполный документ сайта.');
  check(Array.isArray(site.products) && site.products.length <= 1000, 'Некорректный каталог.');
  const ids = new Set();
  site.config.brand = text(site.config.brand, 80, 'SØLAR').trim();
  check(site.config.brand.length > 0, 'Название бренда не может быть пустым.');
  site.config.currency = text(site.config.currency, 8, '₴');
  site.config.defaultTheme = site.config.defaultTheme === 'light' ? 'light' : 'dark';
  for (const key of ['est','founders','contactEmail','contactPhone','address','seoTitle','seoDescription']) if (key in site.config) site.config[key] = text(site.config[key], key === 'seoDescription' ? 5000 : 1000);
  for (const key of ['logoImage','favicon','ogImage']) if (key in site.config) site.config[key] = url(site.config[key], { image: true });
  if (site.config.social != null) check(object(site.config.social), 'Ссылки соцсетей должны быть объектом.');
  if (site.config.announcementText != null) site.config.announcementText = typeof site.config.announcementText === 'string' ? text(site.config.announcementText, 5000) : localized(site.config.announcementText);
  for (const key of ['checkoutEnabled', 'newsletterEnabled', 'announcementEnabled', 'introEnabled', 'demoMode', 'cardPaymentsEnabled']) if (key in site.config) check(typeof site.config[key] === 'boolean', `Поле ${key} должно быть переключателем.`);
  for (const key of ['instagram', 'tiktok', 'telegram']) if (site.config.social?.[key]) site.config.social[key] = url(site.config.social[key]);
  for (const p of site.products) {
    check(p && typeof p === 'object' && !Array.isArray(p), 'Некорректный товар.');
    check(typeof p.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,99}$/.test(p.id) && !ids.has(p.id), 'Артикулы товаров должны быть уникальными (латиница, цифры, дефис).'); ids.add(p.id);
    p.name = text(p.name, 150).trim(); check(p.name, 'Укажите название товара.');
    check(typeof p.price === 'number' && Number.isFinite(p.price) && p.price >= 0 && p.price <= 1000000, 'Цена должна быть числом от 0 до 1 000 000.'); p.price = Math.round(p.price * 100) / 100;
    p.cat = text(p.cat, 50, 'tshirts'); check(/^[a-z0-9_-]+$/.test(p.cat), 'Некорректная категория.');
    check(p.sizes && typeof p.sizes === 'object' && !Array.isArray(p.sizes) && Object.keys(p.sizes).length <= 30, 'Укажите размеры и остатки.');
    for (const [size, qty] of Object.entries(p.sizes)) check(size.length > 0 && size.length <= 30 && Number.isInteger(qty) && qty >= 0 && qty <= 100000, 'Остатки должны быть целыми неотрицательными числами.');
    check(p.images == null || Array.isArray(p.images), 'Фото товара должны быть списком адресов.');
    p.images = (p.images || []).map(image => url(image, { image: true })); check(p.images.length <= 20, 'Не более 20 фото на товар.');
    check(p.gallery == null || (Array.isArray(p.gallery) && p.gallery.length <= 20), 'Ракурсы должны быть списком до 20 элементов.');
    p.gallery = (Array.isArray(p.gallery) && p.gallery.length ? p.gallery : ['front']).map(v => { check(['front','back','detail','editorial'].includes(v), 'Некорректный демонстрационный ракурс.'); return v; });
    check(p.published === undefined || typeof p.published === 'boolean', 'Публикация товара должна быть переключателем.');
    p.published = p.published !== false;
    check(p.colorHex == null || (Array.isArray(p.colorHex) && p.colorHex.length <= 20), 'Цвета товара должны быть списком до 20 элементов.');
    p.colorHex = (p.colorHex || ['#111111']).map(v => { check(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v), 'Некорректный цвет товара.'); return v; });
    p.color = localized(p.color); p.desc = localized(p.desc); if (p.materials) p.materials = localized(p.materials);
    p.collection = text(p.collection, 150); p.fit = text(p.fit, 200); p.design = text(p.design, 500);
    p.ts = Number.isFinite(p.ts) ? p.ts : Date.now(); p.demo = p.demo === true; p.isNew = p.isNew === true;
  }
  for (const lang of LANGS) {
    check(site.i18n[lang] && typeof site.i18n[lang] === 'object' && !Array.isArray(site.i18n[lang]), 'Нужны переводы для четырёх языков.');
    for (const [key, value] of Object.entries(site.i18n[lang])) site.i18n[lang][key] = text(value, 20000);
  }
  const c = site.content;
  for (const [key, limit] of [['founders',20],['editorial',20],['pages',200],['customSections',100]]) {
    if (c[key] == null) c[key] = [];
    check(Array.isArray(c[key]) && c[key].length <= limit && c[key].every(object), `Некорректный список ${key}.`);
  }
  if (c.brandTagline !== undefined) c.brandTagline = text(c.brandTagline, 1000);
  if (c.marquee !== undefined) check(Array.isArray(c.marquee) && c.marquee.length <= 30 && c.marquee.every(v=>typeof v==='string' && v.length<=1000), 'Бегущая строка должна быть списком текстов.');
  if (c.hero != null) check(object(c.hero), 'Настройки hero должны быть объектом.');
  if (c.hero) { c.hero.image = url(c.hero.image, { image: true }); c.hero.ctaHref = url(c.hero.ctaHref || '#/shop'); }
  if (c.dropImage) c.dropImage = url(c.dropImage, { image: true });
  for (const f of c.founders || []) { f.name = text(f.name, 100); f.image = url(f.image, { image: true }); f.bio = typeof f.bio === 'object' ? localized(f.bio) : text(f.bio, 20000); }
  for (const e of c.editorial || []) e.image = url(e.image, { image: true });
  for (const nav of [c.navigation, c.footerNavigation]) if (nav != null) { check(Array.isArray(nav) && nav.length <= 30 && nav.every(object), 'Не более 30 ссылок в меню.'); for (const link of nav) { link.href = url(link.href); link.labelKey = text(link.labelKey,150); if (link.label) link.label = typeof link.label === 'object' ? localized(link.label) : text(link.label, 150); } }
  const pages = new Set();
  for (const page of c.pages) { check(typeof page.slug === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(page.slug) && !pages.has(page.slug), 'Адреса страниц должны быть уникальными (латиница, цифры, дефис).'); pages.add(page.slug); page.title = localized(page.title); page.body = localized(page.body); }
  const sections = new Set(['hero','marquee','featured','manifesto','editorial','newsletter']);
  for (const section of c.customSections) { check(typeof section.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(section.id) && !sections.has(section.id), 'ID секции должен быть уникальным (латиница, цифры, дефис).'); sections.add(section.id); section.title = localized(section.title); section.body = localized(section.body); section.image = url(section.image, { image:true }); section.buttonLabel = localized(section.buttonLabel); section.buttonHref = url(section.buttonHref); }
  for (const key of ['homepageSections', 'hiddenSections']) { check(Array.isArray(c[key]) && c[key].length <= 100 && c[key].every(v=>typeof v==='string' && sections.has(v)) && new Set(c[key]).size === c[key].length, 'Список секций содержит повторы или неизвестный ID.'); }
  for (const mode of ['dark','light']) {
    check(site.design[mode] && typeof site.design[mode] === 'object' && !Array.isArray(site.design[mode]), 'Некорректная палитра.');
    for (const [key, value] of Object.entries(site.design[mode])) check(/^[a-z][a-z0-9-]{0,50}$/.test(key) && typeof value === 'string' && value.length <= 100 && !/[{};<>]/.test(value), 'Некорректное значение палитры.');
  }
  site.design.customCss = text(site.design.customCss, 100000); site.design.fontDisplay = text(site.design.fontDisplay, 150, 'Unbounded'); site.design.fontUi = text(site.design.fontUi, 150, 'Manrope');
  return { revision:site.revision, config:site.config, products:site.products, i18n:site.i18n, content:c, design:site.design };
}

export function seedSite(rootDir) {
  const sandbox = { window: {} }; vm.createContext(sandbox);
  for (const file of ['js/config.js','js/i18n.js','js/live-i18n.js','js/commerce-i18n.js']) {
    if (/(live|commerce)-i18n.js$/.test(file) && !existsSync(resolve(rootDir,file))) continue;
    vm.runInContext(readFileSync(resolve(rootDir, file),'utf8'), sandbox, { timeout:1000 });
  }
  const {CONFIG, PRODUCTS, I18N} = JSON.parse(JSON.stringify(sandbox.window.SOLAR));
  const navigation = [{labelKey:'nav.shop',href:'#/shop'},{labelKey:'nav.drops',href:'#/drops'},{labelKey:'nav.about',href:'#/about'}];
  return validateSite({
    revision:1,
    config:{...CONFIG,demoMode:false,defaultTheme:'dark',seoTitle:'SØLAR — Beyond The Light',seoDescription:'Independent streetwear. Beyond the light.',contactEmail:'',contactPhone:'',address:'',checkoutEnabled:true,cardPaymentsEnabled:true,newsletterEnabled:true,announcementEnabled:false,introEnabled:true,paymentProvider:'cod'},
    products:PRODUCTS.map(p=>({...p,images:[],published:true})),i18n:I18N,
    content:{brandTagline:'BEYOND THE LIGHT.',marquee:['SØLAR','BEYOND THE LIGHT','DROP 01 — ECLIPSE','EST. 2026','STARKON × SLAYER'],founders:[{id:'starkon',name:'STARKON',image:'/images/starkon.png',bio:''},{id:'slayer',name:'SLAYER',image:'',bio:''}],hero:{image:'',ctaHref:'#/shop'},editorial:[{image:''},{image:''},{image:''}],dropImage:'',homepageSections:['hero','marquee','featured','manifesto','editorial','newsletter'],hiddenSections:[],navigation,footerNavigation:[...navigation,...['contact','shipping','returns','privacy','terms'].map(slug=>({labelKey:`footer.${slug}`,href:`#/page/${slug}`}))],pages:[],customSections:[]},
    design:{dark:{},light:{},fontDisplay:'Unbounded',fontUi:'Manrope',customCss:''}
  });
}

export function publicUser(row) { if (!row) return null; let delivery = {}; try { delivery = JSON.parse(row.delivery || '{}'); } catch (_) {} return {id:row.id,username:row.username,email:row.email,displayName:row.display_name,phone:row.phone,role:row.role,createdAt:row.created_at,delivery}; }
export class Store {
  constructor({dataDir,rootDir}) {
    mkdirSync(dataDir,{recursive:true}); this.dataDir=dataDir; this.uploadsDir=resolve(dataDir,'uploads'); mkdirSync(this.uploadsDir,{recursive:true});
    this.db=new DatabaseSync(resolve(dataDir,'solar.sqlite')); this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, email TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', role TEXT NOT NULL CHECK(role IN ('admin','customer')), password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS user_email ON users(email COLLATE NOCASE) WHERE email != '';
      CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS site(id INTEGER PRIMARY KEY CHECK(id=1),document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,number INTEGER UNIQUE NOT NULL,user_id TEXT REFERENCES users(id),idempotency_key TEXT UNIQUE NOT NULL,request_hash TEXT NOT NULL,document TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subscribers(id TEXT PRIMARY KEY,email TEXT NOT NULL COLLATE NOCASE UNIQUE,lang TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT NOT NULL UNIQUE,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT,action TEXT NOT NULL,created_at TEXT NOT NULL);
    `);
    if (!this.db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'delivery')) this.db.exec("ALTER TABLE users ADD COLUMN delivery TEXT NOT NULL DEFAULT '{}'");
    const defaults = seedSite(rootDir);
    this.transaction(() => {
      const row = this.db.prepare('SELECT document FROM site WHERE id=1').get();
      if (!row) {
        this.db.prepare('INSERT INTO site(id,document)VALUES(1,?)').run(JSON.stringify(defaults));
        return;
      }
      const current = JSON.parse(row.document);
      let changed = false;
      for (const lang of LANGS) {
        current.i18n[lang] ||= {};
        for (const [key, value] of Object.entries(defaults.i18n[lang])) {
          if (!Object.hasOwn(current.i18n[lang], key)) {
            current.i18n[lang][key] = value;
            changed = true;
          }
        }
      }
      if (current.config && current.config.cardPaymentsEnabled === undefined) { current.config.cardPaymentsEnabled = true; changed = true; }
      if (current.design && !current.design.fontsV2) { if (!current.design.fontUi || current.design.fontUi === 'system-ui') current.design.fontUi = 'Manrope'; current.design.fontsV2 = true; changed = true; }
      if (changed) {
        current.revision++;
        this.writeSite(current);
      }
    });
    this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result=fn(); this.db.exec('COMMIT'); return result; } catch(error) {this.db.exec('ROLLBACK');throw error;} }
  getSite() { return JSON.parse(this.db.prepare('SELECT document FROM site WHERE id=1').get().document); }
  writeSite(site) { this.db.prepare('UPDATE site SET document=? WHERE id=1').run(JSON.stringify(site)); }
  saveSite(input,userId) { const site=validateSite(input); return this.transaction(()=>{const current=this.getSite();check(site.revision===current.revision,'Сайт изменился. Обновите данные перед сохранением.',409,'revision_conflict');site.revision=current.revision+1;this.writeSite(site);this.audit(userId,'site.save');return site;}); }
  audit(userId,action) {this.db.prepare('INSERT INTO audit(user_id,action,created_at)VALUES(?,?,?)').run(userId??null,action,new Date().toISOString());}
  getUser(id) { return this.db.prepare('SELECT * FROM users WHERE id=?').get(id); }
  findUser(username) {return this.db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE').get(username,username);}
  createUser({username,email='',displayName='',passwordHash,role='customer'}) {
    const id=randomBytes(16).toString('hex');
    try {this.db.prepare('INSERT INTO users(id,username,email,display_name,role,password_hash,created_at)VALUES(?,?,?,?,?,?,?)').run(id,username,email,displayName||username,role,passwordHash,new Date().toISOString());}
    catch(error) {if(error.code?.startsWith('ERR_SQLITE')) throw new ApiError(409,'Такое имя или email уже используется.');throw error;}
    this.audit(id,'user.create');return this.getUser(id);
  }
  createSession(userId=null) {const id=token(),csrf=token();this.db.prepare('INSERT INTO sessions(id_hash,user_id,csrf,expires)VALUES(?,?,?,?)').run(digest(id),userId,csrf,Date.now()+7*86400000);return {id,csrf,userId};}
  session(cookie) { if(!cookie || !/^[a-f0-9]{64}$/.test(cookie))return null; const row=this.db.prepare('SELECT * FROM sessions WHERE id_hash=? AND expires>?').get(digest(cookie),Date.now());return row?{id:cookie,csrf:row.csrf,userId:row.user_id}:null; }
  deleteSession(session) {if(session)this.db.prepare('DELETE FROM sessions WHERE id_hash=?').run(digest(session.id));}
  orders(userId) {return this.db.prepare(userId?'SELECT document FROM orders WHERE user_id=? ORDER BY number DESC':'SELECT document FROM orders ORDER BY number DESC').all(...(userId?[userId]:[])).map(row=>JSON.parse(row.document));}
  close(){this.db.close();}
}
