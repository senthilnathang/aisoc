-- Opt-in, note-only sandbox review gate. Existing escalation behavior is retained.
ALTER TABLE l1_escalations ADD COLUMN review_required boolean NOT NULL DEFAULT false;
ALTER TABLE l1_escalations ADD COLUMN reviewed_by text;
ALTER TABLE l1_escalations ADD COLUMN review_comment text;
ALTER TABLE l1_escalations ADD COLUMN reviewed_at timestamptz;
ALTER TABLE l1_escalations ADD CONSTRAINT l1_review_receipt CHECK (
 (reviewed_by IS NULL AND review_comment IS NULL AND reviewed_at IS NULL) OR
 (review_required AND reviewed_by IS NOT NULL AND length(reviewed_by) BETWEEN 1 AND 128 AND review_comment IS NOT NULL AND length(review_comment) BETWEEN 10 AND 2000 AND reviewed_at IS NOT NULL)
);
