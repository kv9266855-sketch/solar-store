import http from 'node:http';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Store, ApiError, check, token, digest, safeEqual, hashPassword, verifyPassword, publicUser, text, url, STATUSES, LANGS } from './lib/store.mjs';
import { createNovaPoshta, isRef } from './lib/novaposhta.mjs';
import { createMonobank, normalize as normalizeInvoice } from './lib/monobank.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const COOKIE='solar_session';
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.ico':'image/x-icon','.ttf':'font/ttf','.woff':'font/woff','.woff2':'font/woff2'};
const EMAIL=/^[^\s@<>"'\\]+@[^\s@<>"'\\]+\.[^\s@<>"'\\]{2,}$/;
const usernameOk=v=>typeof v==='string' && /^[\p{L}\p{N}_.-]{3,40}$/u.test(v);
function customerOrder(order) { const {note,userId,sessionHash,...visible}=order; if(visible.payment){const {error,...payment}=visible.payment;visible.payment=payment;} if(Array.isArray(visible.history))visible.history=visible.history.map(({by,...h})=>h); return visible; }
const METHODS=['np','npCourier','ukr','pickup'];
export function sanitizeDelivery(value) {
  if(value==null)return {};
  check(typeof value==='object'&&!Array.isArray(value),'Некорректный адрес доставки.');
  const d={method:text(value.method,20).trim(),city:text(value.city,120).trim(),cityRef:text(value.cityRef,36).trim(),branch:text(value.branch,300).trim(),warehouseRef:text(value.warehouseRef,36).trim(),warehouseType:text(value.warehouseType,20).trim()};
  check(!d.method||METHODS.includes(d.method),'Некорректный способ доставки.');
  if(!isRef(d.cityRef))d.cityRef='';if(!isRef(d.warehouseRef))d.warehouseRef='';
  if(!['branch','postomat','cargo'].includes(d.warehouseType))d.warehouseType='';
  return d;
}

async function readJson(req,max=2*1024*1024) {
  check(/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''),'Ожидается JSON.',415);
  const declared=Number(req.headers['content-length']);
  check(!Number.isFinite(declared)||declared<=max,'Запрос слишком большой.',413);
  let length=0; const parts=[];
  for await (const part of req) {length+=part.length;if(length>max)throw new ApiError(413,'Запрос слишком большой.');parts.push(part);}
  try {const value=JSON.parse(Buffer.concat(parts).toString('utf8'));check(value && typeof value==='object'&&!Array.isArray(value),'Ожидается JSON-объект.');return value;}
  catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'Некорректный JSON.');}
}
function identifyImage(bytes) {
  if(bytes.length>=24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return {ext:'png',mime:'image/png'};
  if(bytes.length>=4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return {ext:'jpg',mime:'image/jpeg'};
  if(bytes.length>=12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') return {ext:'webp',mime:'image/webp'};
  if(bytes.length>=10 && /^GIF8[79]a$/.test(bytes.toString('ascii',0,6))) return {ext:'gif',mime:'image/gif'};
  throw new ApiError(400,'Загрузите PNG, JPEG, WebP или GIF. SVG и исполняемые файлы не принимаются.');
}

export function createApp({rootDir=ROOT,dataDir=process.env.SOLAR_DATA_DIR || resolve(rootDir,'data'),secureCookie=process.env.SOLAR_SECURE_COOKIE==='1',logger=console,novaPoshta,monobank,publicUrl=process.env.SOLAR_PUBLIC_URL||''}={}) {
  rootDir=resolve(rootDir); dataDir=resolve(dataDir);
  const store=new Store({rootDir,dataDir});
  const np=novaPoshta||createNovaPoshta({logger});
  const mono=monobank||createMonobank({logger});
  const limits=new Map();
  let lastSessionCleanup=0;
  function limit(req,group,max,windowMs) {
    const now=Date.now(),key=`${group}:${req.socket.remoteAddress}`;
    let state=limits.get(key);if(!state||state.until<=now){state={count:0,until:now+windowMs};limits.set(key,state);}
    check(++state.count<=max,'Слишком много попыток. Попробуйте позже.',429,'RATE_LIMIT');
    if(limits.size>2000)for(const [k,v] of limits)if(v.until<now)limits.delete(k);
  }
  function json(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
  function cookie(res,session) {res.setHeader('Set-Cookie',`${COOKIE}=${session?.id || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${session?604800:0}${secureCookie?'; Secure':''}`);}
  function sessionFor(req) {const values=(req.headers.cookie||'').split(';').map(v=>v.trim());const cookieValue=values.find(v=>v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);return store.session(cookieValue);}
  function requireUser(session) {check(session?.userId,'Войдите в аккаунт.',401,'AUTH');const user=store.getUser(session.userId);check(user,'Сессия завершена. Войдите снова.',401,'AUTH');return user;}
  function requireAdmin(session) {const user=requireUser(session);check(user.role==='admin','Доступ разрешён только администратору.',403,'FORBIDDEN');return user;}
  function csrf(req,session) {
    const origin=req.headers.origin;
    const expected=`${secureCookie?'https':'http'}://${req.headers.host}`;
    check(!origin || origin===expected,'Запрос с другого сайта отклонён.',403,'CSRF');
    check(!req.headers['sec-fetch-site'] || ['same-origin','none'].includes(req.headers['sec-fetch-site']),'Запрос с другого сайта отклонён.',403,'CSRF');
    check(session && safeEqual(req.headers['x-solar-csrf'],session.csrf),'Сессия формы устарела. Обновите страницу.',403,'CSRF');
  }
  function rotateSession(res,current,userId) {store.deleteSession(current);const next=store.createSession(userId);cookie(res,next);return next;}
  function sitePublic() {const site=store.getSite();site.products=site.products.filter(p=>p.published!==false);site.payments={cod:true,card:cardAvailable(site)};return site;}
  function canAccessOrder(order,session){if(!session)return false;if(session.userId){if(order.userId===session.userId)return true;const u=store.getUser(session.userId);if(u?.role==='admin')return true;}return !!order.sessionHash&&order.sessionHash===digest(session.id);}
  function loadOrder(id){const row=store.db.prepare('SELECT document FROM orders WHERE id=?').get(id);check(row,'Заказ не найден.',404);return JSON.parse(row.document);}
  function mutateOrder(id,fn){return store.transaction(()=>{const row=store.db.prepare('SELECT document FROM orders WHERE id=?').get(id);check(row,'Заказ не найден.',404);const order=JSON.parse(row.document);const result=fn(order);store.db.prepare('UPDATE orders SET document=? WHERE id=?').run(JSON.stringify(order),id);return result===undefined?order:result;});}
  function cardAvailable(site){return mono.enabled&&site.config.cardPaymentsEnabled!==false;}
  function publicBase(req){const configured=String(publicUrl||'').trim().replace(/\/+$/,'');return /^https?:\/\/[^\s/]+$/.test(configured)?configured:`${secureCookie?'https':'http'}://${req.headers.host}`;}
  async function startPayment(order,req){
    check(order.paymentMethod==='card','Этот заказ оплачивается при получении.',409,'PAY_METHOD');
    check(order.status!=='cancelled','Заказ отменён.',409,'PAY_CANCELLED');
    check(!['paid','refunded','refunding'].includes(order.payment?.status),'Заказ уже оплачен.',409,'PAY_DONE');
    const site=store.getSite(),base=publicBase(req);
    const basket=order.items.map(i=>{const icon=/^https:\/\//.test(i.image)?i.image:/^\/(?!\/)/.test(i.image)&&base.startsWith('https://')?base+i.image:'';return {name:`${i.name} — ${i.size}`.slice(0,128),qty:i.qty,sum:Math.round(i.price*100),unit:'шт.',code:`${i.id}-${i.size}`.replace(/[^\w-]/g,'').slice(0,64),...(icon?{icon}:{})};});
    const webHookUrl=/^https:\/\//.test(String(publicUrl||''))?publicBase(req)+'/api/payments/monobank/webhook':'';
    try{
      const invoice=await mono.createInvoice({amount:Math.round(order.total*100),reference:order.id,destination:`Оплата замовлення #${order.number} — ${site.config.brand||'SØLAR'}`.slice(0,280),basket,redirectUrl:`${base}/#/payment/${order.id}`,webHookUrl});
      return mutateOrder(order.id,o=>{o.payment={...(o.payment||{}),provider:'monobank',status:'pending',providerStatus:'created',invoiceId:invoice.invoiceId,pageUrl:invoice.pageUrl,amount:o.total,error:'',startedAt:new Date().toISOString()};});
    }catch(error){mutateOrder(order.id,o=>{o.payment={...(o.payment||{}),provider:'monobank',status:'error',error:error.message};});throw error;}
  }
  function applyPayment(orderId,info,by,fromWebhook=false){
    return mutateOrder(orderId,o=>{
      const p=o.payment;if(!p||!info.invoiceId||p.invoiceId!==info.invoiceId)return o;
      if(fromWebhook&&p.modifiedDate&&info.modifiedDate&&Date.parse(info.modifiedDate)<Date.parse(p.modifiedDate))return o;
      const before=p.status,at=new Date().toISOString();
      if(info.status==='paid'&&info.amount&&info.amount!==Math.round(o.total*100)){p.status='error';p.error='Сумма платежа не совпадает с суммой заказа — проверьте в кабинете monobank.';return o;}
      Object.assign(p,{status:info.status,providerStatus:info.providerStatus,failureReason:info.failureReason,modifiedDate:info.modifiedDate||p.modifiedDate||'',checkedAt:at});
      if(before!==info.status&&['paid','refunded','failed','expired'].includes(info.status)){if(info.status==='paid')p.paidAt=at;o.history=Array.isArray(o.history)?o.history:[];o.history.push({status:'payment_'+info.status,at,by});}
    });
  }
  async function refreshPayment(order,by){
    if(order.paymentMethod!=='card'||!order.payment?.invoiceId)return order;
    try{return applyPayment(order.id,await mono.status(order.payment.invoiceId),by);}catch(error){if(['PAY_DOWN','PAY_ERROR','PAY_DISABLED'].includes(error.code))return order;throw error;}
  }
  function orderCreate(body,session) {
    const key=text(body.idempotencyKey,120);check(/^[a-zA-Z0-9_-]{12,120}$/.test(key),'Не удалось определить запрос заказа. Повторите попытку.');
    check(Array.isArray(body.items)&&body.items.length>0&&body.items.length<=100,'Корзина пуста или слишком большая.');
    const quantities=new Map();
    for(const line of body.items){check(line && typeof line.id==='string' && typeof line.size==='string' && Number.isInteger(line.qty) && line.qty>=1 && line.qty<=100,'Некорректная позиция заказа.');const k=`${line.id}\u0000${line.size}`;quantities.set(k,(quantities.get(k)||0)+line.qty);}
    const customer={};
    for(const k of ['name','phone','email','city','method','branch','cityRef','warehouseRef','warehouseType','comment'])customer[k]=text(body.customer?.[k],k==='email'?254:k==='comment'?1000:500).trim();
    check(customer.name.length>=2,'Укажите имя получателя.');
    check(/^\+?[\d\s\-()]{10,20}$/.test(customer.phone),'Проверьте номер телефона.');
    check(EMAIL.test(customer.email),'Проверьте email.'); customer.email=customer.email.toLowerCase();
    check(METHODS.includes(customer.method),'Выберите способ доставки.');
    if(customer.method==='np'){check(isRef(customer.cityRef),'Выберите город из списка Новой Почты.');check(isRef(customer.warehouseRef)&&customer.branch.length>=3,'Выберите отделение или почтомат из списка.');}
    else{customer.warehouseRef='';customer.warehouseType='';if(!isRef(customer.cityRef))customer.cityRef='';}
    if(customer.method==='pickup'){customer.city=customer.city||'—';customer.branch=customer.branch||'pickup';}
    else{check(customer.city.length>=2,'Укажите город.');check(customer.branch.length>=(customer.method==='np'?3:5),customer.method==='ukr'?'Укажите индекс и адрес отделения Укрпочты.':'Укажите адрес доставки.');}
    if(!customer.comment)delete customer.comment;
    const identity=session.userId || digest(session.id),idempotencyKey=`${identity}:${key}`;
    const normalizedItems=[...quantities.entries()].sort(([a],[b])=>a.localeCompare(b));
    const paymentMethod=body.paymentMethod==='card'?'card':'cod';
    const requestHash=digest(JSON.stringify(paymentMethod==='card'?{items:normalizedItems,customer,paymentMethod}:{items:normalizedItems,customer}));
    return store.transaction(()=>{
      const existing=store.db.prepare('SELECT document,request_hash FROM orders WHERE idempotency_key=?').get(idempotencyKey);
      if(existing){check(existing.request_hash===requestHash,'Этот запрос уже использован для другого заказа.',409,'IDEMPOTENCY');return JSON.parse(existing.document);}
      const site=store.getSite();check(site.config.checkoutEnabled!==false&&!site.config.demoMode,'Оформление заказов временно отключено.',403);
      if(paymentMethod==='card')check(cardAvailable(site),'Оплата картой сейчас недоступна. Выберите оплату при получении.',409,'PAY_DISABLED');
      const provider={np:'nova-poshta',npCourier:'nova-poshta',ukr:'ukrposhta',pickup:'pickup'}[customer.method];
      check(Array.isArray(site.config.deliveryProviders)&&site.config.deliveryProviders.includes(provider),'Выбранный способ доставки сейчас недоступен.',409,'DELIVERY');
      const items=[];let total=0;
      for(const [k,qty] of normalizedItems){const [id,size]=k.split('\u0000');const product=site.products.find(p=>p.id===id&&p.published!==false);check(product,'Товар больше недоступен.',409,'STOCK');check(qty<=100&&Object.hasOwn(product.sizes,size)&&product.sizes[size]>=qty,`Недостаточно товара ${product.name}, размер ${size}.`,409,'STOCK');product.sizes[size]-=qty;const price=product.price;total+=Math.round(price*100)*qty;items.push({id,name:product.name,size,qty,price,image:product.images?.[0]||''});}
      const next=store.db.prepare('SELECT COALESCE(MAX(number),0)+1 AS next FROM orders').get().next;
      const createdAt=new Date().toISOString();
      const order={id:randomBytes(16).toString('hex'),number:next,userId:session.userId||null,items,customer,total:total/100,currency:site.config.currency,status:'new',paymentMethod,...(paymentMethod==='card'?{payment:{provider:'monobank',status:'pending',invoiceId:'',pageUrl:'',amount:total/100}}:{}),sessionHash:digest(session.id),tracking:'',note:'',createdAt,history:[{status:'new',at:createdAt,by:'customer'}],lang:LANGS.includes(body.lang)?body.lang:'ru'};
      if(session.userId&&body.saveDelivery===true){const {name,phone,email,comment,...delivery}=customer;store.db.prepare('UPDATE users SET delivery=? WHERE id=?').run(JSON.stringify(sanitizeDelivery(delivery)),session.userId);}
      store.db.prepare('INSERT INTO orders(id,number,user_id,idempotency_key,request_hash,document,created_at)VALUES(?,?,?,?,?,?,?)').run(order.id,order.number,order.userId,idempotencyKey,requestHash,JSON.stringify(order),order.createdAt);
      site.revision++;store.writeSite(site);store.audit(session.userId,'order.create');return order;
    });
  }
  function updateOrder(id,body,userId,by='admin') {
    return store.transaction(()=>{
      const row=store.db.prepare('SELECT document FROM orders WHERE id=?').get(id);check(row,'Заказ не найден.',404);const order=JSON.parse(row.document);
      const next=body.status??order.status;check(STATUSES.includes(next),'Некорректный статус заказа.');
      const cancel=order.status!=='cancelled'&&next==='cancelled',reopen=order.status==='cancelled'&&next!=='cancelled';
      if(cancel||reopen){const site=store.getSite();for(const item of order.items){const product=site.products.find(p=>p.id===item.id);if(cancel){if(product&&Object.hasOwn(product.sizes,item.size))product.sizes[item.size]+=item.qty;}else{check(product&&Object.hasOwn(product.sizes,item.size)&&product.sizes[item.size]>=item.qty,'Нельзя восстановить заказ: недостаточно остатков.',409,'STOCK');product.sizes[item.size]-=item.qty;}}site.revision++;store.writeSite(site);}
      const at=new Date().toISOString();order.history=Array.isArray(order.history)?order.history:[{status:order.status,at:order.createdAt,by:'customer'}];
      if(next!==order.status)order.history.push({status:next,at,by});
      if(body.tracking!==undefined){const tracking=text(body.tracking,200).trim();if(tracking&&tracking!==order.tracking)order.history.push({status:'tracking',at,by,tracking});}
      order.status=next; if(body.tracking!==undefined)order.tracking=text(body.tracking,200).trim();if(body.note!==undefined)order.note=text(body.note,5000);order.updatedAt=new Date().toISOString();
      store.db.prepare('UPDATE orders SET document=? WHERE id=?').run(JSON.stringify(order),id);store.audit(userId,`order.${next}`);return order;
    });
  }
  async function placeOrder(body,session,req){
    const c=body?.customer;
    if(c&&c.method==='np'&&isRef(c.cityRef)&&isRef(c.warehouseRef)){
      try{const w=await np.findWarehouse(c.cityRef,c.warehouseRef);check(w,'Отделение не найдено в справочнике Новой Почты. Выберите его заново.',400,'NP_WAREHOUSE');body.customer={...c,branch:w.name,warehouseType:w.type};}
      catch(error){if(!['NP_DOWN','NP_ERROR'].includes(error.code))throw error;}
    }
    const order=orderCreate(body,session);
    if(order.paymentMethod!=='card'||order.payment?.status==='paid')return {order};
    if(order.payment?.pageUrl&&order.payment.status==='pending')return {order,pageUrl:order.payment.pageUrl};
    try{const started=await startPayment(order,req);return {order:started,pageUrl:started.payment.pageUrl};}
    catch(error){return {order:loadOrder(order.id),paymentError:error.message};}
  }
  function analytics(){
    const orders=store.orders(),site=store.getSite(),live=orders.filter(o=>o.status!=='cancelled');
    const day=d=>new Date(d).toISOString().slice(0,10);const today=day(Date.now());
    const series=[];for(let i=29;i>=0;i--){const d=day(Date.now()-i*86400000);series.push({date:d,orders:0,revenue:0});}
    const byDate=new Map(series.map(x=>[x.date,x]));
    const statusCounts=Object.fromEntries(STATUSES.map(x=>[x,0])),methods={},cities={},products=new Map();
    for(const o of orders)statusCounts[o.status]=(statusCounts[o.status]||0)+1;
    for(const o of live){
      const point=byDate.get(day(o.createdAt));if(point){point.orders++;point.revenue+=o.total;}
      const m=o.customer?.method||'—';methods[m]=(methods[m]||0)+1;
      if(m!=='pickup'){const city=(o.customer?.city||'—').trim();cities[city]=(cities[city]||0)+1;}
      for(const it of o.items||[]){const p=products.get(it.id)||{id:it.id,name:it.name,qty:0,revenue:0};p.qty+=it.qty;p.revenue+=it.price*it.qty;products.set(it.id,p);}
    }
    const sum=list=>Math.round(list.reduce((a,o)=>a+o.total,0)*100)/100;
    const lowStock=[];for(const p of site.products.filter(p=>p.published!==false))for(const [size,qty] of Object.entries(p.sizes))if(qty<=2)lowStock.push({id:p.id,name:p.name,size,qty});
    lowStock.sort((a,b)=>a.qty-b.qty);
    return {
      stats:{products:site.products.length,orders:orders.length,customers:store.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='customer'").get().n,subscribers:store.db.prepare('SELECT COUNT(*) AS n FROM subscribers').get().n,
        revenue:sum(orders.filter(o=>o.status==='completed')),pipeline:sum(live.filter(o=>o.status!=='completed')),grossRevenue:sum(live),paidOnline:sum(live.filter(o=>o.payment?.status==='paid')),awaitingPayment:live.filter(o=>o.paymentMethod==='card'&&o.payment?.status!=='paid').length,averageOrder:live.length?Math.round(sum(live)/live.length):0,
        pendingOrders:orders.filter(o=>['new','confirmed'].includes(o.status)).length,ordersToday:orders.filter(o=>day(o.createdAt)===today).length,
        unitsSold:live.reduce((a,o)=>a+(o.items||[]).reduce((b,i)=>b+i.qty,0),0),
        stockUnits:site.products.reduce((a,p)=>a+Object.values(p.sizes).reduce((b,c)=>b+c,0),0)},
      series:series.map(x=>({...x,revenue:Math.round(x.revenue)})),statusCounts,methods,
      topCities:Object.entries(cities).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,count])=>({name,count})),
      topProducts:[...products.values()].sort((a,b)=>b.qty-a.qty).slice(0,6),
      lowStock:lowStock.slice(0,12),recentOrders:orders.slice(0,8)
    };
  }
  async function api(req,res,path) {
    const query=new URL(req.url,'http://local').searchParams;
    let session=sessionFor(req);
    if(req.method==='GET'&&path==='/api/auth/me'){
      const now=Date.now();if(now-lastSessionCleanup>10*60000){store.db.prepare('DELETE FROM sessions WHERE expires<?').run(now);lastSessionCleanup=now;}
      if(!session){limit(req,'sessions',120,10*60000);session=store.createSession();cookie(res,session);}
      return json(res,200,{user:publicUser(session.userId?store.getUser(session.userId):null),csrfToken:session.csrf});
    }
    if(req.method==='GET'&&path==='/api/site')return json(res,200,sitePublic());
    if(req.method==='POST'&&path==='/api/payments/monobank/webhook'){
      limit(req,'webhook',600,60000);const parts=[];let size=0;for await(const part of req){size+=part.length;check(size<=65536,'Слишком большой запрос.',413);parts.push(part);}
      const raw=Buffer.concat(parts);check(await mono.verifyWebhook(raw,req.headers['x-sign']),'Неверная подпись.',401,'SIGNATURE');
      let data;try{data=JSON.parse(raw.toString('utf8'));}catch{throw new ApiError(400,'Некорректный JSON.');}
      const info=normalizeInvoice(data);const id=/^[a-f0-9]{32}$/.test(info.reference)?info.reference:'';
      if(id&&store.db.prepare('SELECT 1 FROM orders WHERE id=?').get(id))applyPayment(id,info,'monobank',true);
      return json(res,200,{ok:true});
    }
    const mutation=!['GET','HEAD'].includes(req.method);if(mutation)csrf(req,session);
    if(req.method==='POST'&&path==='/api/auth/login'){
      limit(req,'login',10,10*60000);const body=await readJson(req);const username=text(body.username,254).trim();const user=store.findUser(username);
      const verified=await verifyPassword(body.password,user?.password_hash || 'scrypt:32768:8:1:00000000000000000000000000000000:'+ '0'.repeat(128));
      check(user&&verified,'Неверное имя пользователя или пароль.',401,'CREDENTIALS');
      const next=rotateSession(res,session,user.id);store.audit(user.id,'auth.login');return json(res,200,{user:publicUser(user),csrfToken:next.csrf});
    }
    if(req.method==='POST'&&path==='/api/auth/register'){
      limit(req,'register',5,60*60000);const body=await readJson(req);const username=text(body.username,40).trim(),email=text(body.email,254).trim().toLowerCase();check(usernameOk(username),'Имя: 3–40 букв, цифр, точек, дефисов или подчёркиваний.');check(EMAIL.test(email),'Проверьте email.');
      const passwordHash=await hashPassword(body.password);const user=store.createUser({username,email,passwordHash,role:'customer'});const next=rotateSession(res,session,user.id);return json(res,201,{user:publicUser(user),csrfToken:next.csrf});
    }
    if(req.method==='POST'&&path==='/api/auth/logout'){store.deleteSession(session);cookie(res,null);return json(res,200,{ok:true});}
    if(req.method==='POST'&&path==='/api/auth/password'){
      const user=requireUser(session);limit(req,'password',8,15*60000);const body=await readJson(req);check(await verifyPassword(body.currentPassword,user.password_hash),'Текущий пароль неверный.',400);const hash=await hashPassword(body.password);
      store.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,user.id);store.db.prepare('DELETE FROM sessions WHERE user_id=? AND id_hash<>?').run(user.id,digest(session.id));store.audit(user.id,'auth.password');return json(res,200,{ok:true});
    }
    if(path==='/api/account/profile'&&req.method==='PATCH'){
      const user=requireUser(session);const body=await readJson(req);const displayName=text(body.displayName,100,user.display_name).trim(),email=text(body.email,254,user.email).trim().toLowerCase(),phone=text(body.phone,30,user.phone).trim();check(email===''||EMAIL.test(email),'Проверьте email.');check(phone===''||/^\+?[\d\s\-()]{6,30}$/.test(phone),'Проверьте номер телефона.');
      if(body.delivery!==undefined)store.db.prepare('UPDATE users SET delivery=? WHERE id=?').run(JSON.stringify(sanitizeDelivery(body.delivery)),user.id);
      try{store.db.prepare('UPDATE users SET display_name=?,email=?,phone=? WHERE id=?').run(displayName,email,phone,user.id);}catch(error){if(error.code?.startsWith('ERR_SQLITE'))throw new ApiError(409,'Этот email уже используется.');throw error;}
      return json(res,200,{user:publicUser(store.getUser(user.id))});
    }
    if(path==='/api/account/orders'&&req.method==='GET'){const user=requireUser(session);return json(res,200,{orders:store.orders(user.id).map(customerOrder)});}
    if(path==='/api/orders'&&req.method==='POST'){limit(req,'orders',30,10*60000);const body=await readJson(req);const placed=await placeOrder(body,session,req);return json(res,201,{...placed,order:customerOrder(placed.order)});}
    const payMatch=path.match(/^\/api\/orders\/([a-f0-9]{32})\/(pay|payment)$/);
    if(payMatch){
      const order=loadOrder(payMatch[1]);check(canAccessOrder(order,session),'Заказ не найден.',404);
      if(payMatch[2]==='payment'&&req.method==='GET'){limit(req,'paycheck',240,10*60000);const fresh=order.payment?.status==='pending'?await refreshPayment(order,'monobank'):order;return json(res,200,{order:customerOrder(fresh)});}
      if(payMatch[2]==='pay'&&req.method==='POST'){
        limit(req,'pay',30,10*60000);check(cardAvailable(store.getSite()),'Оплата картой сейчас недоступна.',409,'PAY_DISABLED');
        let current=order;
        if(current.payment?.status==='pending'&&current.payment.pageUrl){current=await refreshPayment(current,'monobank');if(current.payment.status==='pending'&&['created','processing'].includes(current.payment.providerStatus))return json(res,200,{order:customerOrder(current),pageUrl:current.payment.pageUrl});}
        const started=await startPayment(current,req);return json(res,200,{order:customerOrder(started),pageUrl:started.payment.pageUrl});
      }
    }
    if(path==='/api/np/cities'&&req.method==='GET'){limit(req,'np',400,10*60000);return json(res,200,{cities:await np.searchCities(query.get('q'))});}
    if(path==='/api/np/warehouses'&&req.method==='GET'){limit(req,'np',400,10*60000);const type=['all','branch','postomat','cargo'].includes(query.get('type'))?query.get('type'):'all';return json(res,200,await np.warehouses({cityRef:query.get('cityRef'),q:text(query.get('q')||'',100),type,offset:query.get('offset'),limit:query.get('limit')}));}
    const ownOrder=path.match(/^\/api\/account\/orders\/([a-f0-9]{32})\/(cancel|tracking)$/);
    if(ownOrder){
      const user=requireUser(session);const row=store.db.prepare('SELECT document FROM orders WHERE id=? AND user_id=?').get(ownOrder[1],user.id);check(row,'Заказ не найден.',404);const order=JSON.parse(row.document);
      if(ownOrder[2]==='cancel'&&req.method==='POST'){check(order.status==='new','Заказ уже обрабатывается — для отмены свяжитесь с нами.',409,'ORDER_LOCKED');check(!['paid','refunding'].includes(order.payment?.status),'Заказ уже оплачен — для отмены и возврата денег свяжитесь с нами.',409,'ORDER_PAID');return json(res,200,{order:customerOrder(updateOrder(order.id,{status:'cancelled'},user.id,'customer'))});}
      if(ownOrder[2]==='tracking'&&req.method==='GET'){check(order.tracking,'Номер отправления ещё не присвоен.',404);limit(req,'track',60,10*60000);return json(res,200,{tracking:await np.track(order.tracking,order.customer?.phone)});}
    }
    if(path==='/api/newsletter'&&req.method==='POST'){
      limit(req,'newsletter',20,60*60000);const body=await readJson(req),email=text(body.email,254).trim().toLowerCase();check(EMAIL.test(email),'Проверьте email.');check(store.getSite().config.newsletterEnabled!==false,'Подписка временно отключена.',403);
      store.db.prepare('INSERT INTO subscribers(id,email,lang,created_at)VALUES(?,?,?,?) ON CONFLICT(email) DO NOTHING').run(randomBytes(16).toString('hex'),email,LANGS.includes(body.lang)?body.lang:'ru',new Date().toISOString());return json(res,200,{ok:true});
    }
    if(path.startsWith('/api/admin/')){
      const admin=requireAdmin(session);
      if(path==='/api/admin/site'&&req.method==='GET')return json(res,200,store.getSite());
      if(path==='/api/admin/site'&&req.method==='PUT')return json(res,200,store.saveSite(await readJson(req,4*1024*1024),admin.id));
      if(path==='/api/admin/import'&&req.method==='POST'){const body=await readJson(req,4*1024*1024);return json(res,200,store.saveSite(body.site,admin.id));}
      if(path==='/api/admin/overview'&&req.method==='GET')return json(res,200,analytics());
      if(path==='/api/admin/orders'&&req.method==='GET')return json(res,200,{orders:store.orders()});
      const adminPay=path.match(/^\/api\/admin\/orders\/([a-f0-9]{32})\/(payment|refund)$/);
      if(adminPay&&req.method==='POST'){
        const order=loadOrder(adminPay[1]);check(order.paymentMethod==='card'&&order.payment?.invoiceId,'У заказа нет онлайн-платежа.',409);
        if(adminPay[2]==='payment')return json(res,200,{order:await refreshPayment(order,'admin')});
        check(order.payment.status==='paid','Вернуть можно только оплаченный заказ.',409,'REFUND_STATE');
        const result=await mono.refund(order.payment.invoiceId,order.id);const at=new Date().toISOString();
        const updated=mutateOrder(order.id,o=>{o.payment.status=result.status==='success'?'refunded':'refunding';o.payment.refundAt=at;o.history=Array.isArray(o.history)?o.history:[];o.history.push({status:o.payment.status==='refunded'?'payment_refunded':'payment_refunding',at,by:'admin'});});
        store.audit(admin.id,'order.refund');return json(res,200,{order:updated});
      }
      const adminTrack=path.match(/^\/api\/admin\/orders\/([a-f0-9]{32})\/tracking$/);
      if(adminTrack&&req.method==='GET'){const row=store.db.prepare('SELECT document FROM orders WHERE id=?').get(adminTrack[1]);check(row,'Заказ не найден.',404);const order=JSON.parse(row.document);check(order.tracking,'Сначала укажите номер ТТН.',404);return json(res,200,{tracking:await np.track(order.tracking,order.customer?.phone)});}
      const orderMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9]{32})$/);if(orderMatch&&req.method==='PATCH')return json(res,200,{order:updateOrder(orderMatch[1],await readJson(req),admin.id)});
      if(path==='/api/admin/customers'&&req.method==='GET'){const orders=store.orders();return json(res,200,{users:store.db.prepare('SELECT * FROM users ORDER BY created_at DESC').all().map(row=>{const own=orders.filter(o=>o.userId===row.id&&o.status!=='cancelled');return {...publicUser(row),ordersCount:own.length,spent:Math.round(own.reduce((a,o)=>a+o.total,0)*100)/100,lastOrderAt:own[0]?.createdAt||null};})});}
      if(path==='/api/admin/subscribers'&&req.method==='GET')return json(res,200,{subscribers:store.db.prepare('SELECT id,email,lang,created_at AS createdAt FROM subscribers ORDER BY created_at DESC').all()});
      if(path==='/api/admin/media'&&req.method==='GET')return json(res,200,{media:store.db.prepare('SELECT id,name,url,mime,size,created_at AS createdAt FROM media WHERE archived=0 ORDER BY created_at DESC').all()});
      if(path==='/api/admin/media'&&req.method==='POST'){
        limit(req,'uploads',100,60*60000);const body=await readJson(req,12*1024*1024);const name=text(body.name,200,'image');check(typeof body.dataUrl==='string','Изображение отсутствует.');const match=body.dataUrl.match(/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,([a-zA-Z0-9+/=\r\n]+)$/);check(match,'Некорректный формат изображения.');const bytes=Buffer.from(match[1],'base64');check(bytes.length>0&&bytes.length<=8*1024*1024,'Размер изображения: от 1 байта до 8 МБ.');const type=identifyImage(bytes),id=randomBytes(16).toString('hex'),imageUrl=`/uploads/${id}.${type.ext}`,createdAt=new Date().toISOString();
        writeFileSync(resolve(store.uploadsDir,`${id}.${type.ext}`),bytes,{flag:'wx'});store.db.prepare('INSERT INTO media(id,name,url,mime,size,created_at)VALUES(?,?,?,?,?,?)').run(id,name,imageUrl,type.mime,bytes.length,createdAt);return json(res,201,{media:{id,name,url:imageUrl,mime:type.mime,size:bytes.length,createdAt}});
      }
      const mediaMatch=path.match(/^\/api\/admin\/media\/([a-f0-9]{32})$/);if(mediaMatch&&req.method==='DELETE'){
        const media=store.db.prepare('SELECT * FROM media WHERE id=? AND archived=0').get(mediaMatch[1]);check(media,'Файл не найден.',404);check(!JSON.stringify(store.getSite()).includes(media.url)&&!store.orders().some(o=>JSON.stringify(o.items).includes(media.url)),'Изображение используется на сайте или в заказе. Сначала замените его.',409);store.db.prepare('UPDATE media SET archived=1 WHERE id=?').run(media.id);return json(res,200,{ok:true});
      }
      if(path==='/api/admin/export'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="solar-export.json"');return json(res,200,{format:'solar-backup',exportedAt:new Date().toISOString(),site:store.getSite(),orders:store.orders(),subscribers:store.db.prepare('SELECT id,email,lang,created_at AS createdAt FROM subscribers').all()});}
    }
    throw new ApiError(404,'API-метод не найден.');
  }
  function serveStatic(req,res,path){
    check(['GET','HEAD'].includes(req.method),'Метод не поддерживается.',405);
    check(!path.includes('\\')&&!path.includes('\u0000')&&!path.split('/').some(p=>p==='..'||p.startsWith('.')),'Файл не найден.',404);
    let file,mime;
    if(path.startsWith('/uploads/')){
      check(/^\/uploads\/[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(path),'Файл не найден.',404);const media=store.db.prepare('SELECT * FROM media WHERE url=? AND archived=0').get(path);check(media,'Файл не найден.',404);file=resolve(store.uploadsDir,basename(path));mime=media.mime;
    }else{
      const pathname=path==='/'?'/index.html':path==='/admin'||path==='/admin/'?'/admin.html':path;
      check(['/index.html','/admin.html'].includes(pathname)||/^\/(css|js|fonts|images)\/[A-Za-z0-9_./%+ -]+$/.test(pathname),'Файл не найден.',404);
      file=resolve(rootDir,`.${pathname}`);check(file.startsWith(rootDir+ '\\')||file.startsWith(rootDir+'/'),'Файл не найден.',404);mime=MIME[extname(file).toLowerCase()];check(mime,'Файл не найден.',404);
    }
    check(existsSync(file)&&statSync(file).isFile(),'Файл не найден.',404);const stat=statSync(file);res.setHeader('Content-Type',mime);res.setHeader('Content-Length',stat.size);res.setHeader('Cache-Control',mime.includes('html')||mime.includes('javascript')||mime.includes('css')?'no-cache':'public, max-age=3600');res.writeHead(200);if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    try{
      check(req.url.length<=4096,'Адрес слишком длинный.',414);
      const rawPath=req.url.split('?')[0];let path;try{path=decodeURIComponent(rawPath);}catch{throw new ApiError(400,'Некорректный адрес.');}
      if(path.startsWith('/api/'))await api(req,res,path);else serveStatic(req,res,path);
    }catch(error){if(res.headersSent){res.destroy();return;}const status=error instanceof ApiError?error.status:500;if(status===500)logger.error('SØLAR request failed:',error.message);if(req.url.startsWith('/api/'))json(res,status,{error:status===500?'Внутренняя ошибка сервера. Попробуйте позже.':error.message,...(error.code&&error instanceof ApiError?{code:error.code}:{})});else{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(status===500?'Ошибка сервера.':error.message);}}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
  return {server,store,async close(){await new Promise((resolve,reject)=>server.listening?server.close(error=>error?reject(error):resolve()):resolve());store.close();}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=createApp();const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||8787);
  app.server.listen(port,host,()=>console.log(`SØLAR ready at http://${host}:${port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});
}
