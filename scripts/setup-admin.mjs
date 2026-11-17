import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, hashPassword } from '../lib/store.mjs';

const rootDir=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const store=new Store({rootDir,dataDir:resolve(process.env.SOLAR_DATA_DIR || resolve(rootDir,'data'))});
try {
  const username=(process.env.SOLAR_ADMIN_USERNAME || 'Starkon').trim();
  const password=process.env.SOLAR_ADMIN_PASSWORD;
  if (!password) throw new Error('Set SOLAR_ADMIN_PASSWORD in the environment before running setup-admin.');
  if (!/^[\p{L}\p{N}_.-]{3,40}$/u.test(username)) throw new Error('Admin username must contain 3–40 letters, digits, dots, underscores or dashes.');
  const passwordHash=await hashPassword(password);
  const current=store.findUser(username);
  if (current) {
    store.db.prepare("UPDATE users SET password_hash=?,role='admin' WHERE id=?").run(passwordHash,current.id);
    store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(current.id);
    store.audit(current.id,'admin.reset');
  } else store.createUser({username,passwordHash,role:'admin'});
  console.log('Administrator account is ready.');
} finally {store.close();}
