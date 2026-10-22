-- PINs are stored as a server-side HMAC, never as a six-digit bearer secret.
-- Existing temporary PIN sessions must be issued again when this migration rolls out.
UPDATE public.scan_sessions
SET pin_code='RETIRED:'||id::text,
    status=CASE WHEN status IN ('waiting','connected','scanning','processing') THEN 'expired' ELSE status END,
    expires_at=CASE WHEN status IN ('waiting','connected','scanning','processing') THEN least(expires_at,now()) ELSE expires_at END,
    mobile_claim_token_hash=CASE WHEN status IN ('waiting','connected','scanning','processing') THEN NULL ELSE mobile_claim_token_hash END
WHERE pin_code !~ '^hmac-v1:[0-9a-f]{64}$';
ALTER TABLE public.scan_sessions ADD CONSTRAINT scan_sessions_pin_not_plaintext
CHECK (pin_code ~ '^(hmac-v1:[0-9a-f]{64}|RETIRED:[0-9a-f-]{36})$');
