-- Migration 291: Add needs_review flag to cash_sheet_transactions
-- 02/11/2026: When the coordinate-based PDF parser saves a sheet whose
-- line items don't sum to the section total, it marks those lines
-- needs_review = true so they're visible on the cash-sheet detail page.
-- The 4 summary figures (opening/receipts/payments/closing) still block
-- on error; only line-item discrepancies are demoted to warnings.

ALTER TABLE cash_sheet_transactions
  ADD COLUMN IF NOT EXISTS needs_review boolean DEFAULT false;

COMMENT ON COLUMN cash_sheet_transactions.needs_review IS
  'true when the line-item amount could not be verified against the section total — check the PDF before trusting this row';
