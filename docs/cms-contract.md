# SØLAR CMS implementation contract

Local Node.js 24+ HTTP server, built-in SQLite persistence in `data/solar.sqlite`.
No secrets or passwords in browser files. Static allowlist excludes data, backup,
scripts, source server, dot files. Existing storefront remains vanilla JS.

## Site document (GET /api/site and admin /api/admin/site)

`{ revision, config, products, i18n, content, design }`.
`config`, `products`, `i18n` start from existing browser JS globals via VM seed.
Products keep existing fields plus `images: string[]`, `published: boolean`.
Existing `gallery` placeholder variants remain fallback. Prices are numeric UAH.

`config`: existing values plus `defaultTheme`, `seoTitle`, `seoDescription`,
`contactEmail`, `contactPhone`, `address`, `checkoutEnabled: true`,
`newsletterEnabled: true`, `announcementEnabled: false`, `introEnabled: true`.
`demoMode: false` means orders persist, payment is cash on delivery, not card processing.

`content`:
- `brandTagline: "BEYOND THE LIGHT."`
- `marquee: ["SØLAR", "BEYOND THE LIGHT", "DROP 01 — ECLIPSE", "EST. 2026", "STARKON × SLAYER"]`
- `founders: [{id:"starkon", name:"STARKON", image:"/images/starkon.png", bio:""}, {id:"slayer", name:"SLAYER", image:"", bio:""}]`
- `hero: {image:"", ctaHref:"#/shop"}`
- `editorial: [{image:""},{image:""},{image:""}]`
- `dropImage: ""`
- `homepageSections: ["hero","marquee","featured","manifesto","editorial","newsletter"]`
- `hiddenSections: []`
- `navigation: [{labelKey:"nav.shop",href:"#/shop"}, {labelKey:"nav.drops",href:"#/drops"}, {labelKey:"nav.about",href:"#/about"}]`
- `footerNavigation`: same entries plus five existing static pages (`labelKey: footer.contact`, etc.)
- `pages: [{slug, title:{en,uk,ru,fr}, body:{en,uk,ru,fr}}]` optional custom static pages; built-ins use i18n.
- `customSections: [{id,title:{en,uk,ru,fr},body:{en,uk,ru,fr},image:"",buttonLabel:{en,uk,ru,fr},buttonHref:"#/shop"}]` may be referenced by homepageSections IDs.

`design: {dark:{},light:{},fontDisplay:"Unbounded",fontUi:"system-ui",customCss:""}`.
Theme maps use CSS custom property names without leading `--` (`bg`, `bg2`, `card`,
`text`, `muted`, `line`, `accent`, `body-text`, `strong-text`).

## API responses

Errors: status 4xx/5xx `{error: "human readable message", code?: "..."}`.
All mutations same-origin, JSON, `X-Solar-CSRF` from auth/me. API helper obtains me first.

- GET `/api/auth/me` => `{user: null|{id,username,email,displayName,phone,role},csrfToken}` (anonymous session supported)
- POST `/api/auth/login` `{username,password}` => `{user,csrfToken}`
- POST `/api/auth/register` `{username,email,password}` => `{user,csrfToken}`
- POST `/api/auth/logout` => `{ok:true}`
- POST `/api/auth/password` `{currentPassword,password}` => `{ok:true}`
- PATCH `/api/account/profile` `{displayName,email,phone}` => `{user}`
- GET `/api/account/orders` => `{orders}`
- POST `/api/orders` `{items:[{id,size,qty}],customer:{name,phone,email,city,method,branch},lang,idempotencyKey}` => `{order}`; optional authenticated user, validate prices/stock server-side, transactional stock decrement, no double-submit; cancelled orders restore stock.
- POST `/api/newsletter` `{email,lang}` => `{ok:true}`
- GET `/api/admin/overview` => `{stats:{products,orders,customers,subscribers,revenue,pendingOrders},recentOrders}`
- GET `/api/admin/site` => full site document
- PUT `/api/admin/site` => takes full document including revision, returns new full doc; 409 on revision conflict
- GET `/api/admin/orders` => `{orders}`
- PATCH `/api/admin/orders/:id` `{status,tracking,note}` => `{order}`; status new|confirmed|shipped|completed|cancelled
- GET `/api/admin/customers` => `{users}` (never password hashes)
- GET `/api/admin/subscribers` => `{subscribers}`
- GET `/api/admin/media` => `{media}`
- POST `/api/admin/media` `{name,dataUrl}` => `{media:{id,url,name,size,createdAt}}`; PNG/JPEG/WebP/GIF validated, max 8MB
- DELETE `/api/admin/media/:id` => `{ok:true}`; reject references/in-use, soft archive
- GET `/api/admin/export` => `{format:"solar-backup",site,orders,subscribers}` (content/order export, no auth secrets)
- POST `/api/admin/import` `{site}` => new full doc, validate + optimistic revision same as PUT (admin UI confirms locally)

Order shape: `{id,number,userId,items:[{id,name,size,qty,price,image}],customer,total,currency,status,paymentMethod:"cod",tracking,note,createdAt}`.
Never claim payment or email sending occurred: order and subscriber storage are local server features.

## Browser modules

`js/api.js` owns `window.SOLAR_API` with `request(path, options)`, `ready` promise,
`user`, `csrfToken`, and `upload(file)` helper (provided by storefront agent).
Admin may implement same helper internally to avoid initial storefront scripts.
`js/cms.js` fetches site before app.js runs and applies globals; storefront agent owns loading.
Admin files: `admin.html`, `js/admin.js`, `css/admin.css`, independent from storefront app.
Server & storage agent owns backend files only. Root owns package, launch, documentation,
seed patches and integration fixes, tests as needed. Do not write credentials to logs.
