'use strict';
const path = require('node:path');
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1']);
const manifestPath = path.resolve(__dirname, '../../private/local-demo.json');

function readLocalDemoConfig(env = process.env) {
  const flag = env.OFFICEHR_LOCAL_DEMO_ENABLED;
  if (!flag || flag === 'false') return { enabled: false };
  if (flag !== 'true') throw new Error('OFFICEHR_LOCAL_DEMO_ENABLED must be true or false.');
  if (env.NODE_ENV !== 'development') throw new Error('Local demo login requires development mode; production is prohibited.');
  if (!LOOPBACK.has(env.HOST || '127.0.0.1')) throw new Error('Local demo login requires a loopback bind address.');
  if (env.FRONTEND_ORIGIN !== 'http://localhost:5173') throw new Error('Local demo login requires the trusted localhost:5173 origin.');
  const database = new URL(env.DATABASE_URL);
  if (!LOOPBACK.has(database.hostname) || decodeURIComponent(database.pathname.slice(1)) !== 'AdRankoHRM') {
    throw new Error('Local demo login requires the intended loopback AdRankoHRM database.');
  }
  return { enabled: true, databaseName: 'AdRankoHRM', origin: env.FRONTEND_ORIGIN, manifestPath };
}

async function assertConnectedDatabase(prisma, expectedName) {
  const [connected] = await prisma.$queryRaw`SELECT current_database() AS name, host(inet_server_addr()) AS address`;
  if (connected.name !== expectedName || !LOOPBACK.has(connected.address)) throw new Error('Local demo database identity or loopback connection mismatch.');
}

module.exports = { readLocalDemoConfig, assertConnectedDatabase, LOOPBACK, manifestPath };
