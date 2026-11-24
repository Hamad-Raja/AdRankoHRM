-- Retry identities share the immutable Payroll audit transaction with the save.
-- Existing audit rows and payroll snapshots are preserved.
CREATE UNIQUE INDEX payroll_batch_operation_identity
ON audit_logs ("actorUserId", "targetId", (metadata->>'operationKey'))
WHERE "targetType" = 'Payroll' AND action IN ('PAYROLL_BATCH_EDIT', 'PAYROLL_ADJUSTMENT_IDENTITY');
