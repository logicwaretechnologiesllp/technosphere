'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  KeyRound,
  Mail,
  ArrowLeft,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { requestPasswordResetOtp, resetPasswordWithOtp } from '@/actions/auth';
import { toast } from 'sonner';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

export default function ForgotPasswordPage() {
  const router = useRouter();

  // Multi-step state
  const [step, setStep] = useState<'request_otp' | 'verify_and_reset' | 'success'>('request_otp');

  // Form states
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Loading states
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Resend cooldown timer
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  // Password Strength Calculation
  const hasMinLength = newPassword.length >= 8;
  const hasNumberOrSymbol = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPassword);
  const hasUppercase = /[A-Z]/.test(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const strengthScore = [hasMinLength, hasNumberOrSymbol, hasUppercase].filter(Boolean).length;
  const strengthColor =
    strengthScore === 3
      ? 'bg-emerald-500'
      : strengthScore === 2
      ? 'bg-amber-500'
      : newPassword.length > 0
      ? 'bg-rose-500'
      : 'bg-slate-200 dark:bg-slate-700';

  const strengthText =
    strengthScore === 3
      ? 'Strong Password'
      : strengthScore === 2
      ? 'Moderate Password'
      : newPassword.length > 0
      ? 'Weak Password'
      : '';

  // 1. Submit Request for OTP
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      toast.error('Please enter your email address');
      return;
    }

    setIsSendingOtp(true);
    try {
      const res = await requestPasswordResetOtp(cleanEmail);
      setIsSendingOtp(false);

      if (res.success) {
        toast.success(res.message || 'Verification code sent to your email.');
        setStep('verify_and_reset');
        setCountdown(60);
      } else {
        toast.error(res.error || 'Failed to send verification code.');
      }
    } catch (err: any) {
      setIsSendingOtp(false);
      toast.error(err.message || 'An unexpected error occurred');
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (countdown > 0 || isSendingOtp) return;
    setIsSendingOtp(true);
    try {
      const res = await requestPasswordResetOtp(email.trim().toLowerCase());
      setIsSendingOtp(false);

      if (res.success) {
        toast.success('A new 6-digit verification code has been dispatched.');
        setCountdown(60);
      } else {
        toast.error(res.error || 'Failed to resend verification code.');
      }
    } catch (err: any) {
      setIsSendingOtp(false);
      toast.error(err.message || 'Failed to resend code');
    }
  };

  // 2. Submit Reset with OTP
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = otpCode.trim();

    if (!cleanCode || cleanCode.length !== 6) {
      toast.error('Please enter the 6-digit code sent to your email.');
      return;
    }

    if (!hasMinLength) {
      toast.error('Password must be at least 8 characters long.');
      return;
    }

    if (!hasNumberOrSymbol || !hasUppercase) {
      toast.error('Password must contain uppercase letters and at least one number or symbol.');
      return;
    }

    if (!passwordsMatch) {
      toast.error('Passwords do not match. Please re-enter.');
      return;
    }

    setIsResetting(true);
    try {
      const res = await resetPasswordWithOtp(email.trim().toLowerCase(), cleanCode, newPassword);
      setIsResetting(false);

      if (res.success) {
        toast.success(res.message || 'Password reset successfully!');
        setStep('success');
      } else {
        toast.error(res.error || 'Failed to reset password. Please check your code.');
      }
    } catch (err: any) {
      setIsResetting(false);
      toast.error(err.message || 'Failed to reset password');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 flex items-center justify-center p-4 relative transition-colors duration-200">
      {/* Top Right Theme Toggle */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-slate-800/80 rounded-2xl p-7 sm:p-8 space-y-6 shadow-sm dark:shadow-2xl">
        {/* Header Icon & Title */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 p-2 shadow-sm mx-auto flex items-center justify-center">
            {step === 'success' ? (
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            ) : (
              <Image
                src="/logo.png"
                alt="Technosphere Logo"
                width={48}
                height={48}
                className="w-full h-full object-contain"
                priority
              />
            )}
          </div>

          <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-slate-100">
            {step === 'request_otp' && 'Forgot Password'}
            {step === 'verify_and_reset' && 'Reset Your Password'}
            {step === 'success' && 'Password Reset Complete'}
          </h1>

          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {step === 'request_otp' && 'Enter your registered email to receive a 6-digit OTP verification code.'}
            {step === 'verify_and_reset' && 'Enter the 6-digit OTP code sent to your inbox and choose your new password.'}
            {step === 'success' && 'Your credentials have been securely updated. You can now sign in.'}
          </p>
        </div>

        {/* STEP 1: REQUEST OTP */}
        {step === 'request_otp' && (
          <form onSubmit={handleRequestOtp} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Registered Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@technosphere.in"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500 font-medium"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSendingOtp || !email.trim()}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold rounded-xl text-xs transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 shadow-md shadow-indigo-600/30"
            >
              {isSendingOtp ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Dispatching Code...</span>
                </>
              ) : (
                <span>Send Verification Code</span>
              )}
            </button>

            <div className="pt-2 text-center">
              <Link
                href="/login"
                className="inline-flex items-center space-x-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-bold transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Sign In</span>
              </Link>
            </div>
          </form>
        )}

        {/* STEP 2: VERIFY OTP & ENTER NEW PASSWORD */}
        {step === 'verify_and_reset' && (
          <form onSubmit={handleResetPassword} className="space-y-4 text-xs">
            {/* Email destination reminder */}
            <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between text-xs">
              <div className="truncate mr-2">
                <span className="text-slate-500 dark:text-slate-400 block text-[10px] uppercase font-bold tracking-wider">
                  Code sent to
                </span>
                <span className="font-extrabold text-slate-900 dark:text-slate-100 truncate block">
                  {email}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setStep('request_otp')}
                className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
              >
                Change
              </button>
            </div>

            {/* 6-Digit OTP Input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block font-bold text-slate-700 dark:text-slate-300">
                  6-Digit OTP Verification Code *
                </label>
                <button
                  type="button"
                  disabled={countdown > 0 || isSendingOtp}
                  onClick={handleResendOtp}
                  className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline disabled:text-slate-400 disabled:no-underline flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isSendingOtp ? 'animate-spin' : ''}`} />
                  <span>{countdown > 0 ? `Resend in ${countdown}s` : 'Resend Code'}</span>
                </button>
              </div>

              <input
                type="text"
                required
                maxLength={6}
                autoFocus
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center text-xl font-mono tracking-[0.4em] text-slate-900 dark:text-slate-100 font-black focus:outline-none focus:border-indigo-500 shadow-inner"
              />
            </div>

            {/* New Password */}
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                New Password *
              </label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500 font-medium"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Password Strength Visualizer */}
              {newPassword.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span className="text-slate-500">Security Strength:</span>
                    <span
                      className={
                        strengthScore === 3
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : strengthScore === 2
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-rose-500'
                      }
                    >
                      {strengthText}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${strengthColor}`}
                      style={{ width: `${(strengthScore / 3) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Confirm New Password */}
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Confirm New Password *
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your new password"
                  className={`w-full pl-3.5 pr-10 py-2.5 bg-slate-50 dark:bg-slate-900 border rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none font-medium ${
                    confirmPassword && !passwordsMatch
                      ? 'border-rose-500 focus:border-rose-500'
                      : 'border-slate-200 dark:border-slate-800 focus:border-indigo-500'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {confirmPassword.length > 0 && !passwordsMatch && (
                <p className="mt-1 text-[11px] text-rose-500 font-bold flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  <span>Passwords do not match</span>
                </p>
              )}
            </div>

            {/* Complexity Checklist */}
            <div className="p-3 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1.5 text-[11px]">
              <div className="flex items-center space-x-2">
                <CheckCircle2
                  className={`w-3.5 h-3.5 ${
                    hasMinLength ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-600'
                  }`}
                />
                <span className={hasMinLength ? 'text-slate-900 dark:text-slate-100 font-semibold' : 'text-slate-500'}>
                  At least 8 characters
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle2
                  className={`w-3.5 h-3.5 ${
                    hasUppercase ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-600'
                  }`}
                />
                <span className={hasUppercase ? 'text-slate-900 dark:text-slate-100 font-semibold' : 'text-slate-500'}>
                  Contains uppercase letter
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle2
                  className={`w-3.5 h-3.5 ${
                    hasNumberOrSymbol ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-600'
                  }`}
                />
                <span className={hasNumberOrSymbol ? 'text-slate-900 dark:text-slate-100 font-semibold' : 'text-slate-500'}>
                  Contains number or special symbol
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isResetting || otpCode.length < 6 || !hasMinLength || !passwordsMatch}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold rounded-xl text-xs transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 shadow-md shadow-indigo-600/30"
            >
              {isResetting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Updating Password...</span>
                </>
              ) : (
                <span>Reset Password</span>
              )}
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setStep('request_otp')}
                className="inline-flex items-center space-x-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-bold transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to previous step</span>
              </button>
            </div>
          </form>
        )}

        {/* STEP 3: SUCCESS CONFIRMATION */}
        {step === 'success' && (
          <div className="space-y-6 text-center text-xs">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-emerald-900 dark:text-emerald-200 space-y-1">
              <p className="font-extrabold text-sm">Credentials Updated</p>
              <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                You can now log in using your newly configured password.
              </p>
            </div>

            <button
              type="button"
              onClick={() => router.push('/login')}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold rounded-xl text-xs transition-colors flex items-center justify-center space-x-2 shadow-md shadow-indigo-600/30"
            >
              <span>Proceed to Sign In</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

