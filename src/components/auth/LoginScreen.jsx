import React, { useState, useRef, useEffect } from 'react';
import { Mail, ChevronRight, RefreshCw, AlertTriangle, X, ArrowLeft } from 'lucide-react';
import { requestEmailCode, verifyEmailCode, exchangeGoogleCredential } from '../../utils/auth';
import { renderGoogleButton } from '../../utils/googleIdentity';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen({ onClose, onSignedIn, recoveryNotice }) {
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

  // Container the GIS button renders into. Google replaces the
  // contents with their official iframe-based button.
  const googleBtnRef = useRef(null);
  const [googleBtnError, setGoogleBtnError] = useState(null);

  // Render the Google Identity Services button when the choose step
  // mounts. Re-renders if we navigate away to 'code' / 'blocked' and
  // back. The renderGoogleButton promise resolves with a Google ID
  // token when the user completes the GIS flow — we then swap it for
  // a Firebase custom token via /api/auth/google.
  useEffect(() => {
    if (step !== 'choose') return;
    let cancelled = false;
    const el = googleBtnRef.current;
    if (!el) return;
    setGoogleBtnError(null);
    (async () => {
      try {
        const credential = await renderGoogleButton(el);
        if (cancelled) return;
        setBusy(true);
        try {
          await exchangeGoogleCredential(credential);
          if (!cancelled) onSignedIn?.();
        } catch (e) {
          console.error('[auth] exchangeGoogleCredential failed:', e?.code, e?.message, e);
          if (!cancelled) handleAuthError(e);
        } finally {
          if (!cancelled) setBusy(false);
        }
      } catch (e) {
        // GIS script failed to load (network, ad-blocker, CSP) or env
        // var missing. Fall back to email-only and surface a notice.
        console.warn('[auth] Google sign-in unavailable:', e?.message || e);
        if (!cancelled) setGoogleBtnError(e?.message || 'Google sign-in unavailable');
      }
    })();
    return () => { cancelled = true; };
  }, [step]);

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

            {recoveryNotice && (
              <div
                role="alert"
                style={{
                  padding: '10px 12px',
                  marginBottom: 14,
                  borderRadius: 8,
                  background: 'rgba(255, 200, 0, 0.10)',
                  border: '1px solid rgba(255, 200, 0, 0.32)',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                }}
              >
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{recoveryNotice}</span>
              </div>
            )}

            {/* Google's official Sign-in button, rendered by GIS into
                this div. Replaces our previous custom button — GIS
                uses FedCM where available and never depends on the
                cross-domain storage handoff that broke mobile in the
                old signInWithRedirect / signInWithPopup paths. */}
            <div
              ref={googleBtnRef}
              className="login-google-btn-host"
              style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }}
              aria-label="Sign in with Google"
            />
            {googleBtnError && (
              <div style={{ fontSize: 12, color: 'var(--text-sec)', marginTop: 6, textAlign: 'center' }}>
                Google sign-in is unavailable on this browser. Use email below.
              </div>
            )}

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
