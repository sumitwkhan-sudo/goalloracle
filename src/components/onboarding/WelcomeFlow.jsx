/**
 * WelcomeFlow.jsx — single-card onboarding for brand-new users.
 *
 * Combines what used to be two consecutive modals (UsernamePrompt +
 * PasscodePromptModal) into one screen. Reduces friction (one fewer
 * navigation, no modal-on-top-of-wizard) without losing any data
 * collection — the parent still receives username, country, and
 * optionally a private-league passcode + matched league.
 *
 * Country is IP-pre-populated but stays visible and editable — the user
 * can change it without hunting through 160 rows because it's already
 * the right answer for ~90% of users.
 *
 * Passcode is optional and clearly labelled as such; submit works with
 * just username + country.
 */

import React, { useState, useEffect } from 'react';
import { Check, RefreshCw, AlertTriangle } from 'lucide-react';
import { validateUsername } from '../../utils/profanity';
import { lookupLeagueByPasscode } from '../../utils/db';
import COUNTRIES, { getCachedDetectedCountry, detectCountryByIP } from '../../utils/countries';
import EligibilityCheckbox from '../EligibilityCheckbox';
import { RULES_VERSION } from '../../config/legal';

export default function WelcomeFlow({
  emailPrefix,
  allLeagues,
  onSubmit,        // async ({ username, country, passcodeMatchedLeague, passcode, consent }) => void
  onSeeRules,      // function — opens Official Rules in a new tab
}) {
  const [username, setUsername] = useState(emailPrefix || '');
  // Seed country from the synchronous cache (warmed at app boot) so the
  // picker shows the user's country on first paint instead of flashing
  // empty while the async IP lookup resolves.
  const [country, setCountry] = useState(() => getCachedDetectedCountry() || '');
  const [passcode, setPasscode] = useState('');
  const [eligible, setEligible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Country list is bundled with the modal — no async import needed.
  // The earlier dynamic import was a code-splitting micro-optimization
  // that contributed to the empty-picker flash.
  const countries = COUNTRIES;

  // Cold-load fallback: if the cache wasn't warm at mount, kick off the
  // async detection now and adopt the result if the user hasn't picked
  // anything yet.
  useEffect(() => {
    if (country) return;
    let cancelled = false;
    detectCountryByIP()
      .then((detected) => {
        if (!cancelled && detected) {
          setCountry((curr) => curr || detected);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setErr('');
    const trimmedName = username.trim();
    const validErr = validateUsername(trimmedName);
    if (validErr) { setErr(validErr); return; }
    if (!country) { setErr('Pick your home country.'); return; }

    // Passcode is optional. If provided, find a matching league before
    // submitting so we can show a clear error in-card rather than only
    // after the parent's join attempt fails. Lookup is server-side
    // because new private leagues store passcodes in a subcollection
    // (allLeagues won't have the field populated).
    let passcodeMatchedLeague = null;
    const trimmedPass = passcode.trim().toUpperCase();
    if (trimmedPass) {
      try {
        passcodeMatchedLeague = await lookupLeagueByPasscode(trimmedPass);
      } catch (lookupErr) {
        setErr(`No league found with passcode "${trimmedPass}". Double-check with your friend, or leave it blank.`);
        return;
      }
      if (!passcodeMatchedLeague) {
        setErr(`No league found with passcode "${trimmedPass}". Double-check with your friend, or leave it blank.`);
        return;
      }
    }

    if (!eligible) { setErr('Please confirm eligibility to finish.'); return; }

    setBusy(true);
    try {
      await onSubmit({
        username: trimmedName,
        country,
        passcode: trimmedPass || null,
        passcodeMatchedLeague,
        // Captured at the earliest possible moment — the user can't
        // finish onboarding without checking the box. Persisted on the
        // user doc by the parent's createOrUpdateUser flow.
        consent: {
          rulesVersion: RULES_VERSION,
          ageAttested: true,
          jurisdictionAttested: true,
        },
      });
    } catch (e2) {
      setErr(e2?.message || 'Could not finish setup — try again.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="wf-title" style={{ zIndex: 2000 }}>
      <div className="welcome-flow" onClick={(e) => e.stopPropagation()}>
        <div className="wf-hero">
          <div className="wf-hero-emoji" aria-hidden="true">⚽</div>
          <h2 id="wf-title" className="wf-title">Welcome to GoalOracle</h2>
          <p className="wf-sub">Pick a username + your country and you're in. (Got a friend's passcode? Drop it in too.)</p>
        </div>

        <form onSubmit={handleSubmit} className="wf-form">
          <label className="wf-label">
            <span>Username</span>
            <input
              type="text"
              className="input-field"
              value={username}
              onChange={(e) => { setUsername(e.target.value); if (err) setErr(''); }}
              maxLength={20}
              autoFocus
              disabled={busy}
              placeholder="e.g. leoM"
              aria-describedby="wf-username-hint"
            />
            <span id="wf-username-hint" className="wf-hint">3–20 chars · letters, numbers, underscores</span>
          </label>

          <label className="wf-label">
            <span>Home country</span>
            <select
              className="input-field"
              value={country}
              onChange={(e) => { setCountry(e.target.value); if (err) setErr(''); }}
              disabled={busy || countries.length === 0}
            >
              <option value="">Choose…</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>{c.flag ? `${c.flag} ` : ''}{c.name}</option>
              ))}
            </select>
            <span className="wf-hint">We pre-fill from your network — change if needed.</span>
          </label>

          <label className="wf-label">
            <span>Friend's league passcode <span className="wf-optional">(optional)</span></span>
            <input
              type="text"
              className="input-field"
              value={passcode}
              onChange={(e) => { setPasscode(e.target.value.toUpperCase()); if (err) setErr(''); }}
              maxLength={12}
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy}
              placeholder="e.g. GOAL2026"
            />
            <span className="wf-hint">Auto-joins their private league. Skip if you don't have one.</span>
          </label>

          {/* Single-line eligibility consent. Required for the submit
              button to enable. Captured the moment the user finishes
              their account so we never have to re-prompt for the same
              rules version unless they truly need to re-consent. */}
          <EligibilityCheckbox
            checked={eligible}
            onChange={(v) => { setEligible(v); if (err) setErr(''); }}
            disabled={busy}
            onSeeRules={onSeeRules}
            className="wf-eligibility"
          />

          {err && <div className="wf-err" role="alert"><AlertTriangle size={14} /> {err}</div>}

          <button
            type="submit"
            className="btn btn-primary btn-lg wf-submit"
            disabled={busy || !username.trim() || !country || !eligible}
          >
            {busy ? <><RefreshCw size={16} className="spin" /> Setting up…</> : <><Check size={16} /> Let's go</>}
          </button>
        </form>
      </div>
    </div>
  );
}
