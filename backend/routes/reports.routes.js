'use strict';

const express = require('express');
const authenticate = require('../src/middleware/authenticate');
const service = require('../src/services/reports.service');
const { encodeReport } = require('../src/utils/reports-export');
const ApiError = require('../src/utils/ApiError');

function createReportsRouter({ reports = service } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  router.use(authenticate());

  const endpoint = work => async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await work(req),
      });
    } catch (error) {
      next(error);
    }
  };

  router.get(
    '/monthly',
    endpoint(req =>
      reports.getMonthlyReport(req.auth.user.id, req.query)
    )
  );

  router.get(
    '/attendance',
    endpoint(req =>
      reports.getAttendanceReport(req.auth.user.id, req.query)
    )
  );

  router.get(
    '/corrections',
    endpoint(req =>
      reports.getCorrectionsReport(req.auth.user.id, req.query)
    )
  );

  router.get('/:report/export', async (req, res, next) => {
    try {
      if (
        !['monthly', 'attendance', 'corrections'].includes(
          req.params.report
        )
      ) {
        throw new ApiError(404, 'Report not found.', 'NOT_FOUND');
      }

      const data = await reports.getExportData(
        req.auth.user.id,
        req.params.report,
        req.query
      );

      const file = await encodeReport(data);

      if (req.aborted || res.destroyed) return;

      res.setHeader('Content-Type', file.contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${file.filename}"`
      );

      res.status(200).send(file.buffer);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createReportsRouter();
module.exports.createReportsRouter = createReportsRouter;