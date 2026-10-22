"use strict";
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { inflateSync } = require('node:zlib');
const { actor, audit, transaction, fail } = require('./organization.service');
const MAX_BYTES = 5 * 1024 * 1024;
const storageRoot = path.resolve(process.env.DOCUMENT_STORAGE_DIR || path.join(__dirname, '../../../private/employee-documents'));
const publicRoots = ['../../../frontend/public', '../../../frontend/dist'].map(p => path.resolve(__dirname, p));
for (const root of publicRoots) {
  const relative = path.relative(root, storageRoot);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Document storage must be outside public roots.');
}
function filePath(name) {
  if (!/^[a-f0-9-]{36}\.(txt|png)$/.test(name)) fail(500, 'Document storage record is invalid.', 'STORAGE_ERROR');
  return path.join(storageRoot, name);
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function validateContent(buffer, mediaType) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES) fail(400, 'Upload a non-empty file up to 5 MiB.');
  if (mediaType === 'text/plain') {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { fail(400, 'Text documents must contain valid UTF-8.'); }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) fail(400, 'Text contains unsupported binary/control data.');
    return 'txt';
  }
  if (mediaType !== 'image/png' || !buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) fail(415, 'Only UTF-8 text and validated non-interlaced RGB/RGBA PNG documents are supported.');
  let offset = 8, width, height, channels, ended = false, idatEnded = false;
  const chunks = [];
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) fail(400, 'Truncated PNG.');
    const size = buffer.readUInt32BE(offset), end = offset + size + 12;
    if (end > buffer.length) fail(400, 'Invalid PNG chunk.');
    const type = buffer.toString('ascii', offset + 4, offset + 8), content = buffer.subarray(offset + 8, end - 4);
    if (crc32(buffer.subarray(offset + 4, end - 4)) !== buffer.readUInt32BE(end - 4)) fail(400, 'Invalid PNG checksum.');
    if (offset === 8 && type !== 'IHDR') fail(400, 'PNG header missing.');
    if (type === 'IHDR') {
      if (offset !== 8 || size !== 13) fail(400, 'Invalid PNG header.');
      width = content.readUInt32BE(0); height = content.readUInt32BE(4); channels = content[9] === 2 ? 3 : content[9] === 6 ? 4 : 0;
      if (!width || !height || width * height > 4000000 || content[8] !== 8 || !channels || content[10] || content[11] || content[12]) fail(400, 'Unsupported PNG dimensions or encoding.');
    } else if (type === 'IDAT') {
      if (idatEnded) fail(400, 'Invalid PNG data order.');
      chunks.push(content);
    } else if (type === 'IEND') {
      if (size || !chunks.length || end !== buffer.length) fail(400, 'Invalid PNG end.');
      ended = true;
    } else {
      // Reject metadata, embedded profiles, animation, and unknown chunks.
      fail(400, 'PNG metadata/animation is unsupported. Export a plain RGB/RGBA PNG.');
    }
    if (type !== 'IDAT' && chunks.length) idatEnded = true;
    offset = end;
  }
  if (!ended) fail(400, 'PNG end missing.');
  const expected = height * (width * channels + 1);
  let pixels;
  try { pixels = inflateSync(Buffer.concat(chunks), { maxOutputLength: expected }); } catch { fail(400, 'Invalid compressed PNG content.'); }
  if (pixels.length !== expected) fail(400, 'Invalid PNG pixel data.');
  for (let row = 0; row < height; row++) if (pixels[row * (width * channels + 1)] > 4) fail(400, 'Invalid PNG scanline.');
  return 'png';
}
const publicSelect = { id: true, employeeId: true, replacesId: true, title: true, mediaType: true, byteLength: true, ownerVisible: true, createdAt: true };
async function access(tx, actorId, employeeId, write = false) {
  const user = await actor(tx, actorId, false);
  const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { userId: true } });
  if (!employee) fail(404, 'Employee not found.', 'NOT_FOUND');
  if (['ADMIN', 'HR'].includes(user.role)) return true;
  if (write || user.role !== 'EMPLOYEE' || employee.userId !== actorId) fail(403, 'Document access denied.', 'FORBIDDEN');
  return false;
}
async function upload(actorId, employeeId, metadata, bytes, mediaType) {
  // Authorize before touching disk; recheck inside the committing transaction.
  await transaction(tx => access(tx, actorId, employeeId, true));
  const extension = validateContent(bytes, mediaType), storageName = `${randomUUID()}.${extension}`;
  await fs.mkdir(storageRoot, { recursive: true, mode: 0o700 });
  const realRoot = await fs.realpath(storageRoot);
  for (const root of publicRoots) {
    const resolved = await fs.realpath(root).catch(() => root);
    const relative = path.relative(resolved, realRoot);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) fail(500, 'Document storage resolves inside a public root.', 'STORAGE_ERROR');
  }
  const location = filePath(storageName);
  let committed = false, staged = false;
  try {
    await fs.writeFile(location, bytes, { flag: 'wx', mode: 0o600 });
    staged = true;
    const document = await transaction(async tx => {
      await access(tx, actorId, employeeId, true);
      if (metadata.replacesId) {
        const previous = await tx.employeeDocument.findFirst({ where: { id: metadata.replacesId, employeeId } });
        if (!previous) fail(400, 'Replacement must reference a document belonging to this employee.');
      }
      const result = await tx.employeeDocument.create({ data: { ...metadata, employeeId, storageName, mediaType, byteLength: bytes.length, actorUserId: actorId }, select: publicSelect });
      await audit(tx, actorId, 'EMPLOYEE_DOCUMENT_UPLOADED', employeeId, { documentId: result.id, replacesId: result.replacesId }); return result;
    });
    committed = true; return document;
  } finally { if (staged && !committed) await fs.rm(location, { force: true }); }
}
async function list(actorId, employeeId) {
  return transaction(async tx => {
    const management = await access(tx, actorId, employeeId);
    const documents = await tx.employeeDocument.findMany({ where: { employeeId, ...(management ? {} : { ownerVisible: true }) }, select: publicSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    // Do not leak IDs of restricted preceding versions to self-service.
    if (!management) { const visible = new Set(documents.map(d => d.id)); for (const d of documents) if (!visible.has(d.replacesId)) d.replacesId = null; }
    await audit(tx, actorId, 'EMPLOYEE_DOCUMENTS_LISTED', employeeId); return documents;
  });
}
async function download(actorId, employeeId, documentId) {
  const record = await transaction(async tx => {
    const management = await access(tx, actorId, employeeId);
    const document = await tx.employeeDocument.findFirst({ where: { id: documentId, employeeId, ...(management ? {} : { ownerVisible: true }) } });
    if (!document) fail(404, 'Document not found.', 'NOT_FOUND');
    await audit(tx, actorId, 'EMPLOYEE_DOCUMENT_DOWNLOAD_REQUESTED', employeeId, { documentId }); return document;
  });
  // O_NOFOLLOW blocks symlink file traversal on supporting platforms; storage directory must be private to the service account.
  const { constants } = require('node:fs');
  const handle = await fs.open(filePath(record.storageName), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  const stat = await handle.stat();
  if (!stat.isFile() || stat.size !== record.byteLength) { await handle.close(); fail(500, 'Document file unavailable.', 'STORAGE_ERROR'); }
  return { record, handle };
}
module.exports = { upload, list, download, validateContent, storageRoot, MAX_BYTES };
