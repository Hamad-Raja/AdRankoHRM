'use strict';
const path = require('node:path');
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1']);
const manifestPath = path.resolve(__dirname, '../../private/local-demo.json');
// Loopback targets stay allowlisted. Neon requires its own exact endpoint pin;
// Production additionally requires its own explicit opt-in and HTTPS origin.
const APPROVED_LOCAL_DATABASES = new Set(['AdRankoHRM', 'OfficeHR_Clean_20261115']);

function readLocalDemoConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const flagName = production ? 'OFFICEHR_PRODUCTION_DEMO_ENABLED' : 'OFFICEHR_LOCAL_DEMO_ENABLED';
  const flag = env[flagName];
  if (!flag || flag === 'false') return { enabled: false };
  if (flag !== 'true') throw new Error(`${flagName} must be true or false.`);
  if (!production) {
    if (env.NODE_ENV !== 'development') throw new Error('Local demo login requires development mode.');
    if (!LOOPBACK.has(env.HOST || '127.0.0.1')) throw new Error('Local demo login requires a loopback bind address.');
    if (env.FRONTEND_ORIGIN !== 'http://localhost:5173') throw new Error('Local demo login requires the trusted localhost:5173 origin.');
  } else {
    let origin;
    try { origin = new URL(env.FRONTEND_ORIGIN); } catch { /* rejected below */ }
    if (!origin || origin.protocol !== 'https:' || origin.origin !== env.FRONTEND_ORIGIN || origin.username || origin.password) {
      throw new Error('Production demo login requires an exact HTTPS FRONTEND_ORIGIN.');
    }
  }
  let database;
  try { database = new URL(env.DATABASE_URL); }
  catch { throw new Error('Local demo database URL is invalid.'); }
  const databaseName = env.OFFICEHR_LOCAL_DEMO_DATABASE || 'AdRankoHRM';
  const databaseHost = database.hostname.toLowerCase();
  const local = LOOPBACK.has(databaseHost) && APPROVED_LOCAL_DATABASES.has(databaseName);
  const neon = /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(databaseHost)
    && databaseHost === env.OFFICEHR_LOCAL_DEMO_NEON_HOST
    && !!env.OFFICEHR_LOCAL_DEMO_DATABASE
    && ['require','verify-ca','verify-full'].includes(database.searchParams.get('sslmode'))
    && (!database.port || database.port === '5432')
    && !!database.username;
  if (!['postgres:','postgresql:'].includes(database.protocol) || (!local && !neon) || decodeURIComponent(database.pathname.slice(1)) !== databaseName) {
    throw new Error('Demo login requires the selected local database or explicitly pinned TLS Neon database.');
  }
  if (production && !neon) throw new Error('Production demo login requires the explicitly pinned TLS Neon database.');
  return { enabled: true, production, databaseName, origin: env.FRONTEND_ORIGIN,
    manifestPath: production && env.OFFICEHR_DEMO_MANIFEST_PATH ? path.resolve(env.OFFICEHR_DEMO_MANIFEST_PATH) : manifestPath,
    targetKind: local ? 'local' : 'neon',
    ...(local ? {} : { databaseHost, databaseRole: decodeURIComponent(database.username) }) };
}

async function assertConnectedDatabase(prisma, expected) {
  const config = typeof expected === 'string' ? { databaseName: expected } : expected;
  const [connected] = await prisma.$queryRaw`SELECT current_database() AS name, current_user AS role, host(inet_server_addr()) AS address`;
  if (connected.name !== config.databaseName || (config.targetKind === 'neon'
    ? !config.databaseHost || !config.databaseRole || connected.role !== config.databaseRole
    : !LOOPBACK.has(connected.address))) throw new Error('Demo database identity or connection mismatch.');
}

module.exports = { readLocalDemoConfig, assertConnectedDatabase, LOOPBACK, manifestPath, APPROVED_LOCAL_DATABASES };
