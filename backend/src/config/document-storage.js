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
  if (env.NODE_ENV === 'production' && configured && !path.isAbsolute(configured)) {
    throw new Error('DOCUMENT_STORAGE_DIR must be absolute in production.');
  }
  if (env.NODE_ENV === 'production' && env.RENDER === 'true' && !configured) {
    throw new Error('Render requires an explicit DOCUMENT_STORAGE_DIR inside its private disk mount, or an explicitly chosen temporary writable directory. Writability does not imply persistence.');
  }
  const backend = path.join(project, 'backend');
  const fallback = env.NODE_ENV === 'production' ? '/var/lib/adrankohrm/uploads' : path.join(backend, 'uploads');
  const storageRoot = configured ? path.resolve(backend, configured) : path.resolve(fallback);
  // Reject both public descendants and roots which would contain public/code trees.
  const publicRoots = ['frontend', 'backend/src', 'backend/routes', 'backend/prisma', 'backend/scripts', 'backend/node_modules', '.git'].map(p => path.join(project, p));
  if (storageRoot === path.parse(storageRoot).root || publicRoots.some(root => within(root, storageRoot) || within(storageRoot, root))) {
    throw new Error('Document storage must be a private directory outside public and application source roots.');
  }
  return {storageRoot, publicRoots};
}
async function verifyDocumentStorage(config = getDocumentStorage()) {
  try {
    await fs.mkdir(config.storageRoot, {recursive: true, mode: 0o700});
    const root = await fs.realpath(config.storageRoot);
    for (const publicRoot of config.publicRoots) {
      const resolved = await fs.realpath(publicRoot).catch(() => publicRoot);
      if (within(resolved, root) || within(root, resolved)) throw new Error('Document storage resolves into a public or application source root.');
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
  } catch (error) {
    // Startup logs are operator-facing; never propagate arbitrary path/OS error text to clients.
    throw new Error(`Private document storage initialization failed (${error.code || 'UNSAFE_PATH'}). Check DOCUMENT_STORAGE_DIR, directory permissions and the selected mount; no fallback was used.`);
  }
}
module.exports = {getDocumentStorage, verifyDocumentStorage};

