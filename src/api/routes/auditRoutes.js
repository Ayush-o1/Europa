/**
 * @fileoverview Audit Ledger Verification REST Route
 *
 * Exposes a strictly read-only endpoint to verify the cryptographic integrity
 * of the hash-chained audit ledger from genesis to head.
 */

import { Router } from 'express';
import { verifyAuditLedger } from '../../modules/audit/auditLedger.js';

export const auditRouter = Router();

/**
 * GET /audit/verify
 * Runs read-only cryptographic verification of the audit ledger.
 */
auditRouter.get('/audit/verify', async (req, res, next) => {
  try {
    const result = await verifyAuditLedger();

    return res.status(200).json({
      success: true,
      data: {
        verified: result.valid,
        recordsChecked: result.totalEntries,
        firstBrokenRecordSequence: result.failedAtSequence,
        error: result.error,
      },
    });
  } catch (err) {
    next(err);
  }
});
