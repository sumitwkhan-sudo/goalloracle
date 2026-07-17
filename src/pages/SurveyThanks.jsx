/**
 * SurveyThanks — landing page for the Wrapped email's one-tap survey
 * (route: /next?vote=cl&u=<userId>). Records the vote on mount (deduped per
 * browser via localStorage; per user server-side via the uid doc id), shows
 * a warm thank-you naming what they voted for, and offers an optional
 * freeform message to Sumit underneath. Works logged-out — the email link
 * opens wherever the user's mail client does.
 */

import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle, Send } from 'lucide-react';

const OPTION_LABELS = {
  cl: 'Champions League bracket',
  epl: 'Season-long Premier League game',
  cricket: 'Cricket predictions',
  wc2030: 'Wake me up for the next World Cup',
};

async function postSurvey(payload) {
  const res = await fetch('/api/survey', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Could not send');
  return res.json();
}

export default function SurveyThanks({ onGoHome }) {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const vote = OPTION_LABELS[params.get('vote')] ? params.get('vote') : null;
  const uid = params.get('u') || null;

  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const recordedRef = useRef(false);

  // Record the vote once per browser (refreshes don't double-count; with a
  // uid the server dedupes per user anyway).
  useEffect(() => {
    if (!vote || recordedRef.current) return;
    recordedRef.current = true;
    const key = `goaloracle_survey_${vote}_${uid || 'anon'}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch { /* private mode — server dedupe still applies */ }
    postSurvey({ vote, uid }).catch(() => {});
  }, [vote, uid]);

  const submitComment = async () => {
    const trimmed = comment.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setErr('');
    try {
      await postSurvey({ comment: trimmed, vote, uid });
      setSent(true);
    } catch {
      setErr('Could not send — try again in a moment.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="survey-thanks">
      <div className="survey-thanks-card">
        <div className="survey-thanks-emoji" aria-hidden="true">🙏</div>
        <h1>Thanks — your vote is in.</h1>
        {vote ? (
          <p className="survey-thanks-sub">
            You voted for <strong>{OPTION_LABELS[vote]}</strong>. The results genuinely decide what
            GoalOracle builds next — you&rsquo;ll be the first to hear.
          </p>
        ) : (
          <p className="survey-thanks-sub">
            The results genuinely decide what GoalOracle builds next — you&rsquo;ll be the first to hear.
          </p>
        )}

        <div className="survey-thanks-form">
          <label htmlFor="survey-comment">Anything else you&rsquo;d like to tell me? (optional)</label>
          {sent ? (
            <p className="survey-thanks-sent"><CheckCircle size={16} aria-hidden="true" /> Sent — I read every reply. Thank you!</p>
          ) : (
            <>
              <textarea
                id="survey-comment"
                rows={4}
                maxLength={2000}
                placeholder="What you loved, what drove you mad, what you'd play next year…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={sending}
              />
              {err && <p className="survey-thanks-err">{err}</p>}
              <button type="button" className="btn btn-primary" onClick={submitComment} disabled={sending || !comment.trim()}>
                <Send size={14} aria-hidden="true" /> {sending ? 'Sending…' : 'Send to Sumit'}
              </button>
            </>
          )}
        </div>

        <button type="button" className="btn btn-ghost survey-thanks-home" onClick={onGoHome}>
          ← Back to GoalOracle
        </button>
        <p className="survey-thanks-signoff">- Sumit, Founder of GoalOracle.io and Football Lover</p>
      </div>
    </div>
  );
}
