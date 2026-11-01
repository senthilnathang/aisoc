-- Existing Memory has no independent-approval receipt. Pause future reuse until
-- reviewed; retain content, audit history and all earlier application snapshots.
UPDATE enterprise_insights SET document=document || '{"approval_state":"pending"}'::jsonb
WHERE NOT archived AND NOT (document ? 'approval_state');
