'use strict';
const fs = require('node:fs');
const { z } = require('zod');
const { assertConnectedDatabase } = require('../config/local-demo');
const ApiError = require('../utils/ApiError');
const accountSchema = z.strictObject({ id: z.uuid(), employeeId: z.uuid(), email: z.email().endsWith('@example.test'), password: z.string().min(20).max(72) });
const manifestSchema = z.object({ version: z.literal(1), complete: z.literal(true), databaseName: z.string(), createdAt: z.string(),
  records: z.record(z.string(), z.array(z.uuid())),
  accounts: z.strictObject(Object.fromEntries(['HR','MANAGER','EMPLOYEE'].map(role => [role, accountSchema.extend({email:z.literal(`officehr-local-demo-${role.toLowerCase()}@example.test`)} )]))) });

function readManifest(file) {
  // Never include validation details/file contents in errors: these contain credentials.
  try { return manifestSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { throw new ApiError(503, 'Local demo setup is missing or invalid. Run the local setup command.', 'LOCAL_DEMO_SETUP_REQUIRED'); }
}

async function resolveDemoCredentials({ prisma, config, role }) {
  await assertConnectedDatabase(prisma, config.databaseName);
  const manifest = readManifest(config.manifestPath);
  if (manifest.databaseName !== config.databaseName) throw new ApiError(503, 'Local demo registration does not match this database.', 'LOCAL_DEMO_SETUP_REQUIRED');
  const registered = manifest.accounts[role];
  const user = await prisma.user.findUnique({ where: { id: registered.id }, select: { id: true, email: true, role: true, employee: { select: { id: true } } } });
  if (!user || user.email !== registered.email || user.role !== role || user.employee?.id !== registered.employeeId) {
    throw new ApiError(403, 'Registered synthetic account no longer matches its demo identity.', 'LOCAL_DEMO_IDENTITY_CHANGED');
  }
  return { email: registered.email, password: registered.password };
}

module.exports = { readManifest, resolveDemoCredentials };
