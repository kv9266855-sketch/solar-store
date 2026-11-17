import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.mjs';
import { hashPassword, Store } from '../lib/store.mjs';

const rootDir=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const CITY='8d5a980d-391c-11dd-90d9-001a92567626',WH='1ec09d88-e1c2-11e3-8c4a-0050568002cf',POSTOMAT='2ec09d88-e1c2-11e3-8c4a-0050568002cf';
const fakeWarehouses=[{ref:WH,number:'1',type:'branch',name:'Відділення №1: вул. Пирогівський шлях, 135',nameRu:'Отделение №1',address:'Київ, Пирогівський шлях, 135',fitting:true,maxKg:1000},{ref:POSTOMAT,number:'5000',type:'postomat',name:'Поштомат №5000',nameRu:'Почтомат №5000',address:'Київ, Хрещатик, 1',fitting:false,maxKg:20}];
const fakeNovaPoshta={
  async searchCities(q){return String(q||'').length<2?[]:[{ref:CITY,settlementRef:CITY,name:'Київ',label:'м. Київ, Київська обл.',area:'Київська',warehouses:2}];},
  async warehouses({cityRef,q='',type='all'}){const items=cityRef===CITY?fakeWarehouses.filter(w=>(type==='all'||w.type===type)&&(w.name+w.number).toLowerCase().includes(String(q).toLowerCase())):[];return {total:items.length,counts:{all:2,branch:1,postomat:1,cargo:0},offset:0,items};},
  async findWarehouse(cityRef,ref){return cityRef===CITY?fakeWarehouses.find(w=>w.ref===ref)||null:null;},
  async track(number){return {number,found:true,statusCode:'7',status:'Прибув у відділення',url:'https://novaposhta.ua/tracking/?cargo_number='+number};}
};
async function fixture(){
  const dataDir=await mkdtemp(resolve(tmpdir(),'solar-backend-'));
  const app=createApp({rootDir,dataDir,logger:{error:()=>{}},novaPoshta:fakeNovaPoshta});
  const admin=app.store.createUser({username:'TestAdmin',passwordHash:await hashPassword('Test-Only-Password-47'),role:'admin'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  function client(){return {cookie:'',csrf:'',async request(path,{method='GET',body,headers={}}={}){const response=await fetch(base+path,{method,headers:{...this.cookie?{Cookie:this.cookie}:{},...body?{'Content-Type':'application/json'}:{},...method!=='GET'&&this.csrf?{'X-Solar-CSRF':this.csrf}:{},Origin:base,...headers},body:body?JSON.stringify(body):undefined});const set=response.headers.get('set-cookie');if(set)this.cookie=set.split(';')[0];let data;try{data=await response.json();}catch{data=null;}if(data?.csrfToken)this.csrf=data.csrfToken;return {status:response.status,data,response};},async ready(){return this.request('/api/auth/me');},async login(){await this.ready();return this.request('/api/auth/login',{method:'POST',body:{username:'TestAdmin',password:'Test-Only-Password-47'}});}};}
  return {app,admin,base,client,async close(){await app.close();assert.ok(dataDir.startsWith(resolve(tmpdir(),'solar-backend-')));await rm(dataDir,{recursive:true,force:true});}};
}

test('session cookies, CSRF, admin authorization and credential boundaries',async()=>{
  const f=await fixture();try{
    const anon=f.client();const me=await anon.ready();assert.equal(me.status,200);assert.equal(me.data.user,null);assert.match(me.response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
    assert.equal((await anon.request('/api/admin/site')).status,401);
    const noCsrf=await anon.request('/api/auth/login',{method:'POST',body:{username:'TestAdmin',password:'Test-Only-Password-47'},headers:{'X-Solar-CSRF':''}});assert.equal(noCsrf.status,403);assert.equal(noCsrf.data.code,'CSRF');
    assert.equal((await anon.request('/api/auth/login',{method:'POST',body:{username:'TestAdmin',password:'wrong'}})).status,401);
    const before=anon.cookie;const login=await anon.request('/api/auth/login',{method:'POST',body:{username:'TestAdmin',password:'Test-Only-Password-47'}});assert.equal(login.status,200);assert.equal(login.data.user.role,'admin');assert.notEqual(anon.cookie,before);assert.equal('password_hash' in login.data.user,false);
    assert.equal((await anon.request('/api/admin/site')).status,200);
    const crossOrigin=await anon.request('/api/admin/site',{method:'PUT',body:(await anon.request('/api/admin/site')).data,headers:{Origin:'https://attacker.example'}});assert.equal(crossOrigin.status,403);
    const customer=f.client();await customer.ready();const reg=await customer.request('/api/auth/register',{method:'POST',body:{username:'Customer',email:'customer@example.test',password:'Customer-Password-77',role:'admin'}});assert.equal(reg.status,201);assert.equal(reg.data.user.role,'customer');assert.equal((await customer.request('/api/admin/orders')).status,403);
    const logout=await anon.request('/api/auth/logout',{method:'POST',body:{}});assert.equal(logout.status,200);assert.equal((await anon.request('/api/admin/site')).status,401);
  }finally{await f.close();}
});

test('site revisions, drafts, complete content persistence and private file isolation',async()=>{
  const f=await fixture();try{
    const admin=f.client();await admin.login();const original=(await admin.request('/api/admin/site')).data;
    const changed=structuredClone(original);changed.config.brand='EDITED BRAND';changed.products[0].published=false;changed.content.founders[0].image='/images/starkon.png';changed.i18n.ru['hero.sub']='УПРАВЛЯЕМЫЙ ТЕКСТ';
    const saved=await admin.request('/api/admin/site',{method:'PUT',body:changed});assert.equal(saved.status,200);assert.equal(saved.data.revision,original.revision+1);
    assert.equal((await admin.request('/api/admin/site',{method:'PUT',body:original})).status,409);
    const publicDoc=(await admin.request('/api/site')).data;assert.equal(publicDoc.config.brand,'EDITED BRAND');assert.equal(publicDoc.products.length,original.products.length-1);assert.equal(publicDoc.i18n.ru['hero.sub'],'УПРАВЛЯЕМЫЙ ТЕКСТ');
    const malformed=structuredClone(saved.data);malformed.products[0].images='bad';assert.equal((await admin.request('/api/admin/site',{method:'PUT',body:malformed})).status,400);
    for(const path of ['/data/solar.sqlite','/_backup/v1-minimal/index.html','/server.mjs','/.env','/docs/cms-contract.md','/%2e%2e/server.mjs','/images/%2e%2e/server.mjs']){const res=await fetch(f.base+path);assert.equal(res.status,404,path);}
    const index=await fetch(f.base+'/');assert.equal(index.status,200);assert.match(index.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  }finally{await f.close();}
});

test('orders use server prices, reserve stock once, isolate customers and restock once',async()=>{
  const f=await fixture();try{
    const admin=f.client();await admin.login();const site=(await admin.request('/api/admin/site')).data;const p=site.products[0],size=Object.keys(p.sizes).find(s=>p.sizes[s]>1);assert.ok(size);
    const customer=f.client();await customer.ready();await customer.request('/api/auth/register',{method:'POST',body:{username:'Buyer',email:'buyer@example.test',password:'Buyer-Password-77'}});
    const orderInput={items:[{id:p.id,size,qty:1,price:0.01}],customer:{name:'Test Buyer',phone:'+380501234567',email:'buyer@example.test',city:'Київ',cityRef:CITY,method:'np',branch:'Відділення №1',warehouseRef:WH},lang:'uk',idempotencyKey:'test-order-unique-2026'};
    const placed=await customer.request('/api/orders',{method:'POST',body:orderInput});assert.equal(placed.status,201);assert.equal(placed.data.order.total,p.price);assert.equal(placed.data.order.items[0].price,p.price);assert.equal(placed.data.order.paymentMethod,'cod');
    const repeated=await customer.request('/api/orders',{method:'POST',body:orderInput});assert.equal(repeated.status,201);assert.equal(repeated.data.order.id,placed.data.order.id);
    let after=(await admin.request('/api/admin/site')).data;assert.equal(after.products[0].sizes[size],p.sizes[size]-1);assert.equal(after.revision,site.revision+1);
    assert.equal((await admin.request('/api/admin/site',{method:'PUT',body:site})).status,409);
    const wrong={...orderInput,idempotencyKey:'another-order-request',items:[{id:p.id,size,qty:100}]};assert.equal((await customer.request('/api/orders',{method:'POST',body:wrong})).status,409);
    const changed={...orderInput,customer:{...orderInput.customer,warehouseRef:POSTOMAT}};assert.equal((await customer.request('/api/orders',{method:'POST',body:changed})).status,409);
    assert.equal((await customer.request('/api/account/orders')).data.orders.length,1);
    const second=f.client();await second.ready();await second.request('/api/auth/register',{method:'POST',body:{username:'OtherBuyer',email:'other@example.test',password:'Other-Password-77'}});assert.equal((await second.request('/api/account/orders')).data.orders.length,0);
    const path='/api/admin/orders/'+placed.data.order.id;assert.equal((await customer.request(path,{method:'PATCH',body:{status:'completed'}})).status,403);
    assert.equal((await admin.request(path,{method:'PATCH',body:{status:'cancelled'}})).status,200);assert.equal((await admin.request(path,{method:'PATCH',body:{status:'cancelled'}})).status,200);
    after=(await admin.request('/api/admin/site')).data;assert.equal(after.products[0].sizes[size],p.sizes[size]);
    assert.equal((await admin.request(path,{method:'PATCH',body:{status:'confirmed'}})).status,200);after=(await admin.request('/api/admin/site')).data;assert.equal(after.products[0].sizes[size],p.sizes[size]-1);
    assert.equal((await admin.request(path,{method:'PATCH',body:{note:'Internal staff-only note'}})).status,200);
    const customerOrders=(await customer.request('/api/account/orders')).data.orders;assert.equal('note' in customerOrders[0],false);assert.equal('userId' in customerOrders[0],false);
    const retry=(await customer.request('/api/orders',{method:'POST',body:orderInput})).data.order;assert.equal('note' in retry,false);
    const disabledProvider=(await admin.request('/api/admin/site')).data;disabledProvider.config.deliveryProviders=['ukrposhta'];assert.equal((await admin.request('/api/admin/site',{method:'PUT',body:disabledProvider})).status,200);
    const unavailable=await customer.request('/api/orders',{method:'POST',body:{...orderInput,idempotencyKey:'disabled-delivery-request'}});assert.equal(unavailable.status,409);assert.equal(unavailable.data.code,'DELIVERY');
  }finally{await f.close();}
});

test('media rejects executable content and newsletter deduplicates storage',async()=>{
  const f=await fixture();try{
    const admin=f.client();await admin.login();
    const invalid=await admin.request('/api/admin/media',{method:'POST',body:{name:'bad.png',dataUrl:'data:image/png;base64,'+Buffer.from('<script>alert(1)</script>').toString('base64')}});assert.equal(invalid.status,400);
    const validPng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=';
    const upload=await admin.request('/api/admin/media',{method:'POST',body:{name:'photo.png',dataUrl:'data:image/png;base64,'+validPng}});assert.equal(upload.status,201);assert.match(upload.data.media.url,/^\/uploads\/[a-f0-9]{32}\.png$/);
    const asset=await fetch(f.base+upload.data.media.url);assert.equal(asset.status,200);assert.equal(asset.headers.get('content-type'),'image/png');
    const anon=f.client();await anon.ready();for(let i=0;i<2;i++)assert.equal((await anon.request('/api/newsletter',{method:'POST',body:{email:'reader@example.test',lang:'uk'}})).status,200);
    assert.equal((await admin.request('/api/admin/subscribers')).data.subscribers.length,1);
    assert.equal((await anon.request('/api/admin/media')).status,401);
    const doc=(await admin.request('/api/admin/site')).data;doc.products[0].images=[upload.data.media.url];assert.equal((await admin.request('/api/admin/site',{method:'PUT',body:doc})).status,200);
    assert.equal((await admin.request('/api/admin/media/'+upload.data.media.id,{method:'DELETE',body:{}})).status,409);
  }finally{await f.close();}
});

test('translation upgrades preserve edits and intentional empty text across restarts',async()=>{
  const dataDir=await mkdtemp(resolve(tmpdir(),'solar-defaults-'));
  let store;
  try {
    store=new Store({rootDir,dataDir});
    const site=store.getSite();
    const originalRevision=site.revision;
    site.i18n.ru['hero.sub']='MY EDITED COPY';
    site.i18n.ru['hero.cta']='';
    delete site.i18n.ru['intro.continue'];
    store.writeSite(site);
    store.close();
    store=new Store({rootDir,dataDir});
    const updated=store.getSite();
    assert.equal(updated.i18n.ru['hero.sub'],'MY EDITED COPY');
    assert.equal(updated.i18n.ru['hero.cta'],'');
    assert.equal(updated.i18n.ru['intro.continue'],'ПРОДОЛЖИТЬ');
    assert.equal(updated.revision,originalRevision+1);
    store.close();
    store=new Store({rootDir,dataDir});
    assert.equal(store.getSite().revision,updated.revision);
  } finally {
    store?.close();
    assert.ok(dataDir.startsWith(resolve(tmpdir(),'solar-defaults-')));
    await rm(dataDir,{recursive:true,force:true});
  }
});

test('nova poshta directory, delivery validation, saved address, history, customer cancel and analytics',async()=>{
  const f=await fixture();try{
    const anon=f.client();await anon.ready();
    const cities=await anon.request('/api/np/cities?q='+encodeURIComponent('Київ'));assert.equal(cities.status,200);assert.equal(cities.data.cities[0].ref,CITY);
    const wh=await anon.request('/api/np/warehouses?cityRef='+CITY+'&type=postomat');assert.equal(wh.status,200);assert.equal(wh.data.items.length,1);assert.equal(wh.data.counts.all,2);
    const admin=f.client();await admin.login();const site=(await admin.request('/api/admin/site')).data;const p=site.products.find(x=>Object.values(x.sizes).some(q=>q>2));const size=Object.keys(p.sizes).find(k=>p.sizes[k]>2);
    const buyer=f.client();await buyer.ready();await buyer.request('/api/auth/register',{method:'POST',body:{username:'NpBuyer',email:'np@example.test',password:'Np-Buyer-Password-1'}});
    const base={items:[{id:p.id,size,qty:1}],lang:'uk'};
    const person={name:'Np Buyer',phone:'+380501112233',email:'np@example.test'};
    assert.equal((await buyer.request('/api/orders',{method:'POST',body:{...base,idempotencyKey:'np-missing-ref-01',customer:{...person,city:'Київ',method:'np',branch:'Відділення №1'}}})).status,400);
    const forged=await buyer.request('/api/orders',{method:'POST',body:{...base,idempotencyKey:'np-forged-ref-001',customer:{...person,city:'Київ',cityRef:CITY,method:'np',branch:'X',warehouseRef:'3ec09d88-e1c2-11e3-8c4a-0050568002cf'}}});assert.equal(forged.status,400);assert.equal(forged.data.code,'NP_WAREHOUSE');
    const placed=await buyer.request('/api/orders',{method:'POST',body:{...base,idempotencyKey:'np-valid-order-01',saveDelivery:true,customer:{...person,city:'Київ',cityRef:CITY,method:'np',branch:'anything typed',warehouseRef:WH}}});
    assert.equal(placed.status,201);assert.equal(placed.data.order.customer.branch,fakeWarehouses[0].name);assert.equal(placed.data.order.customer.warehouseType,'branch');assert.equal(placed.data.order.history[0].status,'new');assert.equal('by' in placed.data.order.history[0],false);
    const me=(await buyer.request('/api/auth/me')).data.user;assert.equal(me.delivery.warehouseRef,WH);assert.equal(me.delivery.method,'np');
    const pickup=await buyer.request('/api/orders',{method:'POST',body:{...base,idempotencyKey:'pickup-order-0001',customer:{...person,method:'pickup'}}});assert.equal(pickup.status,201);
    const courierBad=await buyer.request('/api/orders',{method:'POST',body:{...base,idempotencyKey:'courier-order-001',customer:{...person,city:'Київ',method:'npCourier',branch:'ул'}}});assert.equal(courierBad.status,400);
    const cancel=await buyer.request('/api/account/orders/'+placed.data.order.id+'/cancel',{method:'POST',body:{}});assert.equal(cancel.status,200);assert.equal(cancel.data.order.status,'cancelled');assert.equal(cancel.data.order.history.at(-1).status,'cancelled');
    assert.equal((await buyer.request('/api/account/orders/'+placed.data.order.id+'/cancel',{method:'POST',body:{}})).status,409);
    const stranger=f.client();await stranger.ready();await stranger.request('/api/auth/register',{method:'POST',body:{username:'Stranger',email:'s@example.test',password:'Stranger-Password-1'}});
    assert.equal((await stranger.request('/api/account/orders/'+pickup.data.order.id+'/cancel',{method:'POST',body:{}})).status,404);
    const path='/api/admin/orders/'+pickup.data.order.id;
    assert.equal((await admin.request(path,{method:'PATCH',body:{status:'shipped',tracking:'20450000000000'}})).status,200);
    const trackingCustomer=await buyer.request('/api/account/orders/'+pickup.data.order.id+'/tracking');assert.equal(trackingCustomer.status,200);assert.equal(trackingCustomer.data.tracking.found,true);
    assert.equal((await stranger.request('/api/account/orders/'+pickup.data.order.id+'/tracking')).status,404);
    const lockedCancel=await buyer.request('/api/account/orders/'+pickup.data.order.id+'/cancel',{method:'POST',body:{}});assert.equal(lockedCancel.status,409);
    const overview=(await admin.request('/api/admin/overview')).data;assert.equal(overview.series.length,30);assert.equal(overview.statusCounts.cancelled,1);assert.equal(overview.statusCounts.shipped,1);assert.ok(overview.topProducts[0].qty>=1);assert.equal(overview.stats.ordersToday,2);
    const customers=(await admin.request('/api/admin/customers')).data.users;assert.equal(customers.find(u=>u.username==='NpBuyer').ordersCount,1);
    const profile=await buyer.request('/api/account/profile',{method:'PATCH',body:{displayName:'Np',email:'np@example.test',phone:'',delivery:{method:'ukr',city:'Львів',branch:'79000, вул. Словацького, 1'}}});assert.equal(profile.status,200);assert.equal(profile.data.user.delivery.method,'ukr');
  }finally{await f.close();}
});
