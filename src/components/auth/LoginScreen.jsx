import React, { useState, useRef, useEffect } from 'react';
import { Mail, ChevronRight, RefreshCw, AlertTriangle, X, ArrowLeft } from 'lucide-react';
import { requestEmailCode, verifyEmailCode, signInWithGoogle } from '../../utils/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen({ onClose, onSignedIn }) {
  const [step, setStep] = useState('choose'); // choose | code | blocked
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [blocked, setBlocked] = useState(null); // { scope, maskedEmail, existingEmail, supportEmail, message }
  const codeInputRef = useRef(null);

  // Map a thrown auth error to either the device/IP block screen or a flat
  // inline error string.
  const handleAuthError = (e) => {
    const code = e?.payload?.error;
    if (code === 'device_account_exists' || code === 'ip_account_exists') {
      setBlocked({
        scope: code === 'device_account_exists' ? 'device' : 'network',
        maskedEmail: e.payload.maskedEmail || null,
        existingEmail: e.payload.existingEmail || null,
        supportEmail: e.payload.supportEmail || 'support@goaloracle.io',
        message: e.payload.message || e.message,
      });
      setStep('blocked');
      return;
    }
    setErr(e?.message || 'Sign-in failed');
  };

  useEffect(() => {
    if (step === 'code' && codeInputRef.current) codeInputRef.current.focus();
  }, [step]);

  const handleSendCode = async (e) => {
    e?.preventDefault?.();
    setErr('');
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) { setErr('Enter a valid email address.'); return; }
    setBusy(true);
    try {
      await requestEmailCode(trimmed);
      setEmail(trimmed);
      setStep('code');
    } catch (e) {
      setErr(e.message || 'Failed to send code');
    } finally { setBusy(false); }
  };

  const handleVerifyCode = async (e) => {
    e?.preventDefault?.();
    setErr('');
    if (!/^\d{6}$/.test(code)) { setErr('Enter the 6-digit code.'); return; }
    setBusy(true);
    try {
      await verifyEmailCode(email, code);
      onSignedIn?.();
    } catch (e) {
      handleAuthError(e);
    } finally { setBusy(false); }
  };

  const handleGoogle = async () => {
    setErr('');
    setBusy(true);
    try {
      const user = await signInWithGoogle();
      // Two non-error null cases: (a) mobile / popup-killed → fell back
      // to redirect, navigates away, page reloads on return.
      // (b) user closed the popup before completing — we already swallowed
      // that in signInWithGoogle on the redirect retry, so a null here
      // means a redirect is in flight. Don't show an error.
      if (user) onSignedIn?.();
    } catch (e) {
      handleAuthError(e);
    } finally { setBusy(false); }
  };

  const handleResend = async () => {
    setErr('');
    setBusy(true);
    try {
      await requestEmailCode(email);
    } catch (e) {
      setErr(e.message || 'Failed to resend code');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="login-modal" onClick={e => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>

        {step === 'choose' && (
          <>
            <div className="login-modal-header">
              <h2 className="login-modal-title">Sign in to GoalOracle</h2>
              <p className="login-modal-desc">Use your email or Google account.</p>
            </div>

            <button
              type="button"
              className="btn btn-google login-google-btn"
              onClick={handleGoogle}
              disabled={busy}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
              </svg>
              Continue with Google
            </button>

            <div className="login-divider"><span>or</span></div>

            <form onSubmit={handleSendCode}>
              <label className="login-label">Email address</label>
              <div className="login-input-wrap">
                <Mail size={16} className="login-input-icon" />
                <input
                  type="email"
                  className="login-input"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setErr(''); }}
                  placeholder="you@example.com"
                  maxLength={120}
                  autoFocus
                  disabled={busy}
                />
              </div>
              {err && <div className="login-error"><AlertTriangle size={14} /> {err}</div>}
              <button
                type="submit"
                className="btn btn-primary btn-lg login-submit"
                disabled={busy || !email.trim()}
              >
                {busy ? <><RefreshCw size={16} className="spin" /> Sending…</> : <>Send 6-digit code <ChevronRight size={16} /></>}
              </button>
            </form>
          </>
        )}

        {step === 'blocked' && blocked && (
          <>
            <div className="login-modal-header">
              <h2 className="login-modal-title">Account already exists</h2>
              <p className="login-modal-desc">
                {blocked.scope === 'device'
                  ? "Looks like you've already got an account from this device."
                  : "Looks like you've already got an account from this network."}
              </p>
            </div>

            {(blocked.existingEmail || blocked.maskedEmail) && (
              <div className="login-blocked-email" style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: 'rgba(255, 200, 0, 0.08)',
                border: '1px solid rgba(255, 200, 0, 0.25)',
                marginBottom: 14,
                fontSize: 14,
              }}>
                {/* Surface the FULL email when the server provides it so the
                    user can sign back in immediately. The masked address is
                    kept as a fallback for older deploys / unknown shapes. */}
                Existing account: <strong>{blocked.existingEmail || blocked.maskedEmail}</strong>
                {blocked.existingEmail && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        setEmail(blocked.existingEmail);
                        setBlocked(null);
                        setStep('email');
                      }}
                    >
                      Sign in as {blocked.existingEmail}
                    </button>
                  </div>
                )}
              </div>
            )}

            <p className="login-modal-desc" style={{ fontSize: 13 }}>
              Sign in with that email to continue. Still having trouble?{' '}
              Email{' '}
              <a href={`mailto:${blocked.supportEmail}`} style={{ color: 'var(--accent, #f60)' }}>
                {blocked.supportEmail}
              </a>{' '}
              and we'll help you out.
            </p>

            <button
              type="button"
              className="btn btn-primary btn-lg login-submit"
              onClick={() => {
                setBlocked(null);
                setErr('');
                setCode('');
                setStep('choose');
              }}
            >
              Back to sign in
            </button>
          </>
        )}

        {step === 'code' && (
          <>
            <div className="login-modal-header">
              <button type="button" className="login-back" onClick={() => { setStep('choose'); setCode(''); setErr(''); }}>
                <ArrowLeft size={14} /> Back
              </button>
              <h2 className="login-modal-title">Check your email</h2>
              <p className="login-modal-desc">We sent a 6-digit code to <strong>{email}</strong>. It expires in 5 minutes.</p>
            </div>

            <form onSubmit={handleVerifyCode}>
              <label className="login-label">6-digit code</label>
              <div className="login-input-wrap">
                <input
                  ref={codeInputRef}
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  className="login-input login-code-input"
                  value={code}
                  onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(''); }}
                  placeholder="000000"
                  disabled={busy}
                  autoComplete="one-time-code"
                />
              </div>
              {err && <div className="login-error"><AlertTriangle size={14} /> {err}</div>}
              <button
                type="submit"
                className="btn btn-primary btn-lg login-submit"
                disabled={busy || code.length !== 6}
              >
                {busy ? <><RefreshCw size={16} className="spin" /> Verifying…</> : <>Sign in <ChevronRight size={16} /></>}
              </button>
              <button
                type="button"
                className="btn btn-ghost login-resend"
                onClick={handleResend}
                disabled={busy}
              >
                Resend code
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
