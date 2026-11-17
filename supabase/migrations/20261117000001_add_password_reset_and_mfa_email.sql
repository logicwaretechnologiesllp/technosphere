-- Migration: Password Reset OTP Challenges & MFA Custom Email

----------------------------------------------------
-- PASSWORD RESET CHALLENGES TABLE
----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.password_reset_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_email ON public.password_reset_challenges(email);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_user ON public.password_reset_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_code_hash ON public.password_reset_challenges(code_hash);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_used ON public.password_reset_challenges(used);

ALTER TABLE public.password_reset_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Password reset challenges viewable by owner"
ON public.password_reset_challenges FOR SELECT TO authenticated
USING ((select auth.uid()) = user_id);

----------------------------------------------------
-- USER MFA SETTINGS: ADD OTP_EMAIL COLUMN
----------------------------------------------------
ALTER TABLE public.user_mfa_settings ADD COLUMN IF NOT EXISTS otp_email TEXT;

----------------------------------------------------
-- EMAIL OTP CHALLENGES: ADD TARGET_EMAIL COLUMN
----------------------------------------------------
ALTER TABLE public.email_otp_challenges ADD COLUMN IF NOT EXISTS target_email TEXT;

