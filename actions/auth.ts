'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSystemSettings } from '@/actions/settings';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function hashOtpCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim()).digest('hex');
}

function generateRandomNumericCode(): string {
  const bytes = crypto.randomBytes(3);
  const num = (bytes.readUIntBE(0, 3) % 900000) + 100000;
  return num.toString();
}

// Ensure password_reset_challenges table exists
async function ensurePasswordResetTableExists() {
  const adminSupabase = createAdminClient();
  try {
    await (adminSupabase.rpc as any)('exec_sql', {
      sql_query: `
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
        CREATE INDEX IF NOT EXISTS idx_pwd_reset_code_hash ON public.password_reset_challenges(code_hash);
      `,
    });
  } catch {
    // Ignore if rpc not present
  }
}

export async function loginAdmin(formData: FormData) {
  const email = (formData.get('email') as string || '').trim();
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { success: false, error: 'Email and password are required' };
  }

  try {
    const supabase = await createClient();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { success: false, error: error.message || 'Invalid login credentials' };
    }

    // Check if user requires MFA (aal2 or Email OTP / Backup Codes)
    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { createAdminClient } = await import('@/lib/supabase/admin');
      const adminSupabase = createAdminClient();

      const { data: mfaSettings } = await adminSupabase
        .from('user_mfa_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      const { data: backupCodes } = await adminSupabase
        .from('mfa_backup_codes')
        .select('id')
        .eq('user_id', user.id)
        .eq('used', false);

      const hasTotp = aalData?.nextLevel === 'aal2';
      const hasEmailOtp = Boolean(mfaSettings?.email_otp_enabled);
      const hasBackupCodes = Boolean(backupCodes && backupCodes.length > 0);

      const requiresMfa = hasTotp || hasEmailOtp;

      if (requiresMfa && aalData?.currentLevel !== 'aal2') {
        const availableMethods: ('totp' | 'email' | 'backup')[] = [];
        if (hasTotp) availableMethods.push('totp');
        if (hasEmailOtp) availableMethods.push('email');
        if (hasBackupCodes) availableMethods.push('backup');

        return {
          success: true,
          requiresMfa: true,
          email: user.email,
          availableMethods,
        };
      }
    }

    return { success: true, requiresMfa: false };
  } catch (err: any) {
    console.error('Login action error:', err);
    return { success: false, error: err.message || 'An unexpected error occurred' };
  }
}

export async function checkUserMfaStatus() {
  try {
    const supabase = await createClient();
    const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();

    if (aalError || factorsError) {
      return { success: false, error: aalError?.message || factorsError?.message };
    }

    const verifiedTotpFactors = (factorsData?.totp || []).filter((f) => (f.status as string) === 'verified');

    return {
      success: true,
      currentLevel: aalData?.currentLevel,
      nextLevel: aalData?.nextLevel,
      hasMfaEnabled: verifiedTotpFactors.length > 0,
      factors: factorsData?.totp || [],
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function logoutAdmin() {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * 1. Request Password Reset OTP
 * Dispatches a 6-digit numeric OTP to the user's verified registered email.
 */
export async function requestPasswordResetOtp(email: string) {
  try {
    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      return { success: false, error: 'Please enter a valid email address' };
    }

    const adminSupabase = createAdminClient();
    const { data: usersData, error: userError } = await adminSupabase.auth.admin.listUsers();
    if (userError || !usersData?.users) {
      return { success: false, error: 'Unable to query user accounts at this time' };
    }

    const user = usersData.users.find((u) => u.email?.toLowerCase() === cleanEmail);
    if (!user) {
      // In production security, return error cleanly
      return { success: false, error: 'No user account found matching this email address' };
    }

    // Check system SMTP configuration
    const settingsRes = await getSystemSettings();
    const smtp = settingsRes.settings;
    if (!smtp?.smtp_host?.trim() || !smtp?.smtp_port || !smtp?.smtp_from_email?.trim()) {
      return {
        success: false,
        error: 'System SMTP server is not configured. Please contact your system administrator.',
      };
    }

    const code = generateRandomNumericCode();
    const codeHash = hashOtpCode(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    await ensurePasswordResetTableExists();

    // Invalidate existing unused password reset challenges for this user/email
    await adminSupabase
      .from('password_reset_challenges')
      .update({ used: true })
      .eq('email', cleanEmail)
      .eq('used', false);

    // Insert new challenge
    const { error: insertErr } = await adminSupabase.from('password_reset_challenges').insert({
      user_id: user.id,
      email: cleanEmail,
      code_hash: codeHash,
      expires_at: expiresAt,
      used: false,
    });

    if (insertErr) {
      console.error('Error inserting password reset challenge:', insertErr);
      return { success: false, error: 'Failed to initiate password reset challenge' };
    }

    // Send email using Nodemailer
    const transporter = nodemailer.createTransport({
      host: smtp.smtp_host.trim(),
      port: Number(smtp.smtp_port),
      secure: Boolean(smtp.smtp_secure),
      auth: smtp.smtp_user?.trim()
        ? { user: smtp.smtp_user.trim(), pass: smtp.smtp_pass || '' }
        : undefined,
    });

    const fromName = smtp.smtp_from_name || 'Technosphere Security';
    const fromEmail = smtp.smtp_from_email.trim();

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: cleanEmail,
      subject: 'Technosphere Password Reset — Verification Code',
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #0f172a;">
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="width: 48px; height: 48px; background: #4f46e5; border-radius: 14px; display: inline-flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 800; font-size: 22px; margin-bottom: 12px; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);">T</div>
            <h2 style="margin: 0; color: #0f172a; font-size: 20px; font-weight: 800; letter-spacing: -0.02em;">Password Reset Verification</h2>
            <p style="margin: 6px 0 0 0; color: #64748b; font-size: 13px;">Use the verification code below to reset your password.</p>
          </div>

          <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 12px; padding: 22px; text-align: center; margin: 24px 0;">
            <span style="font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 900; letter-spacing: 10px; color: #4f46e5;">${code}</span>
            <p style="margin: 10px 0 0 0; font-size: 11px; color: #64748b; font-weight: 600;">Valid for 10 minutes</p>
          </div>

          <p style="font-size: 12px; color: #475569; line-height: 1.6; margin: 0 0 16px 0;">
            You received this email because a password reset request was submitted for your Technosphere account (<strong>${cleanEmail}</strong>).
          </p>

          <p style="font-size: 11px; color: #94a3b8; line-height: 1.5; margin: 16px 0 0 0; border-top: 1px solid #f1f5f9; pt: 12px;">
            If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.
          </p>
        </div>
      `,
    });

    return {
      success: true,
      message: `Verification code sent to ${cleanEmail}`,
    };
  } catch (err: unknown) {
    console.error('requestPasswordResetOtp error:', err);
    return { success: false, error: getErrorMessage(err) || 'An unexpected error occurred while sending reset code' };
  }
}

/**
 * 2. Verify Password Reset OTP
 * Checks whether an entered 6-digit code is valid and unexpired before asking for new password.
 */
export async function verifyPasswordResetOtp(email: string, code: string) {
  try {
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.trim();

    if (!cleanEmail || !cleanCode || cleanCode.length !== 6) {
      return { success: false, error: 'Please enter a valid 6-digit verification code' };
    }

    const codeHash = hashOtpCode(cleanCode);
    const adminSupabase = createAdminClient();

    const { data: challenge, error } = await adminSupabase
      .from('password_reset_challenges')
      .select('*')
      .eq('email', cleanEmail)
      .eq('code_hash', codeHash)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !challenge) {
      return { success: false, error: 'Invalid or expired verification code. Please request a new code.' };
    }

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err) || 'Verification failed' };
  }
}

/**
 * 3. Reset Password With OTP
 * Validates the OTP challenge, ensures password meets complexity standards, and updates auth password.
 */
export async function resetPasswordWithOtp(email: string, code: string, newPassword: string) {
  try {
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.trim();

    if (!cleanEmail || !cleanCode || cleanCode.length !== 6) {
      return { success: false, error: 'Valid email and 6-digit verification code are required' };
    }

    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters long' };
    }

    const hasNumberOrSymbol = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPassword);
    const hasLetters = /[a-zA-Z]/.test(newPassword);
    if (!hasNumberOrSymbol || !hasLetters) {
      return { success: false, error: 'Password must include both letters and at least one number or special symbol' };
    }

    const codeHash = hashOtpCode(cleanCode);
    const adminSupabase = createAdminClient();

    // Verify challenge
    const { data: challenge, error: challengeErr } = await adminSupabase
      .from('password_reset_challenges')
      .select('*')
      .eq('email', cleanEmail)
      .eq('code_hash', codeHash)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (challengeErr || !challenge) {
      return { success: false, error: 'Invalid or expired verification code. Please request a new code.' };
    }

    // Mark challenge as used
    await adminSupabase
      .from('password_reset_challenges')
      .update({ used: true })
      .eq('id', challenge.id);

    // Update password in Supabase Auth via Admin Client
    const { error: updateErr } = await adminSupabase.auth.admin.updateUserById(challenge.user_id, {
      password: newPassword,
    });

    if (updateErr) {
      console.error('Error updating password via admin client:', updateErr);
      return { success: false, error: updateErr.message || 'Failed to update password' };
    }

    return {
      success: true,
      message: 'Password reset successfully! You can now sign in with your new password.',
    };
  } catch (err: unknown) {
    console.error('resetPasswordWithOtp error:', err);
    return { success: false, error: getErrorMessage(err) || 'Failed to reset password' };
  }
}

/**
 * 4. Change Password (For Authenticated Users in Settings)
 * Re-authenticates current password before committing the new password.
 */
export async function changePassword({
  currentPassword,
  newPassword,
}: {
  currentPassword: string;
  newPassword: string;
}) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userErr } = await supabase.auth.getUser();

    if (userErr || !user || !user.email) {
      return { success: false, error: 'Unauthorized. Please sign in to change your password.' };
    }

    if (!currentPassword) {
      return { success: false, error: 'Please enter your current password' };
    }

    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'New password must be at least 8 characters long' };
    }

    if (currentPassword === newPassword) {
      return { success: false, error: 'New password cannot be identical to your current password' };
    }

    const hasNumberOrSymbol = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPassword);
    const hasLetters = /[a-zA-Z]/.test(newPassword);
    if (!hasNumberOrSymbol || !hasLetters) {
      return { success: false, error: 'New password must include both letters and at least one number or special symbol' };
    }

    // Verify current password by signing in with it
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (verifyErr) {
      return { success: false, error: 'Current password is incorrect. Please try again.' };
    }

    // Update user password
    const { error: updateErr } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateErr) {
      return { success: false, error: updateErr.message || 'Failed to update password' };
    }

    return { success: true, message: 'Password updated successfully!' };
  } catch (err: unknown) {
    console.error('changePassword error:', err);
    return { success: false, error: getErrorMessage(err) || 'An unexpected error occurred' };
  }
}

