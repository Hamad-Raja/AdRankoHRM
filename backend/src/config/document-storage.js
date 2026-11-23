'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const {randomUUID} = require('node:crypto');
function within(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function getDocumentStorage(env = process.env, project = path.resolve(__dirname, '../../..')) {
  const configured = env.DOCUMENT_STORAGE_DIR?.trim();
  if (env.NODE_ENV === 'production' && (!configured || !path.isAbsolute(configured))) {
    throw new Error('Production requires an absolute DOCUMENT_STORAGE_DIR on a private persistent volume.');
  }
  const storageRoot = path.resolve(configured || path.join(project, 'backend/private/employee-documents'));
  const publicRoots = ['frontend/public', 'frontend/dist'].map(p => path.join(project, p));
  if (publicRoots.some(root => within(root, storageRoot))) throw new Error('Document storage must be outside public roots.');
  return {storageRoot, publicRoots};
}
async function verifyDocumentStorage(config = getDocumentStorage()) {
  await fs.mkdir(config.storageRoot, {recursive: true, mode: 0o700});
  const root = await fs.realpath(config.storageRoot);
  for (const publicRoot of config.publicRoots) {
    const resolved = await fs.realpath(publicRoot).catch(() => publicRoot);
    if (within(resolved, root)) throw new Error('Document storage resolves inside a public root.');
  }
  // Probe only our own temporary file. This verifies access, not disk durability.
  const probe = path.join(root, '.storage-check-' + randomUUID());
  let handle, created = false;
  try {
    handle = await fs.open(probe, 'wx', 0o600); created = true;
    await handle.writeFile('private storage readiness\n'); await handle.sync();
  } finally {
    if (handle) await handle.close();
    if (created) await fs.unlink(probe);
  }
  return {writable: true};
}
module.exports = {getDocumentStorage, verifyDocumentStorage};

