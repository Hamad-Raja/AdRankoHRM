"use strict";
const express = require('express');
const { z } = require('zod');
const { pipeline } = require('node:stream/promises');
const authenticate = require('../src/middleware/authenticate');
const authorize = require('../src/middleware/authorize');
const { csrfProtection } = require('../src/middleware/csrf');
const service = require('../src/services/employee-document.service');
const ApiError = require('../src/utils/ApiError');
const router = express.Router();
const metadataSchema = z.strictObject({ title: z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]+$/u), ownerVisible: z.enum(['true', 'false']).transform(v => v === 'true'), replacesId: z.uuid().optional() });
router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
router.use(authenticate());
router.param('employeeId', (req, res, next, value) => next(z.uuid().safeParse(value).success ? undefined : new ApiError(400, 'Invalid employee ID.', 'VALIDATION_ERROR')));
router.get('/:employeeId/documents', async (req, res, next) => { try { res.json({ success: true, data: await service.list(req.auth.user.id, req.params.employeeId) }); } catch (e) { next(e); } });
router.post('/:employeeId/documents', authorize('ADMIN', 'HR'), csrfProtection, express.raw({ type: ['text/plain', 'image/png'], limit: service.MAX_BYTES, inflate: false }), async (req, res, next) => {
  try {
    const parsed = metadataSchema.safeParse(req.query);
    if (!parsed.success) throw new ApiError(400, 'Invalid document metadata.', 'VALIDATION_ERROR');
    const data = await service.upload(req.auth.user.id, req.params.employeeId, parsed.data, req.body, req.get('content-type')?.split(';')[0]);
    res.status(201).json({ success: true, data });
  } catch (e) { next(e); }
});
router.get('/:employeeId/documents/:documentId/download', async (req, res, next) => {
  let handle;
  try {
    if (!z.uuid().safeParse(req.params.documentId).success) throw new ApiError(400, 'Invalid document ID.', 'VALIDATION_ERROR');
    const result = await service.download(req.auth.user.id, req.params.employeeId, req.params.documentId); handle = result.handle;
    res.setHeader('Content-Type', result.record.mediaType);
    res.setHeader('Content-Disposition', `attachment; filename="document-${result.record.id}.${result.record.mediaType === 'image/png' ? 'png' : 'txt'}"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', result.record.byteLength);
    await pipeline(handle.createReadStream(), res);
  } catch (e) { if (!res.destroyed) next(e); }
  finally { await handle?.close().catch(() => {}); }
});
module.exports = router;
