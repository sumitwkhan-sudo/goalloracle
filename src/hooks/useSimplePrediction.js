import { useEffect, useRef, useState, useCallback } from 'react';
import { subscribeToSimplePrediction, saveSimplePrediction } from '../utils/db';

const SAVE_DEBOUNCE_MS = 1000;

export default function useSimplePrediction(userId, leagueId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);

  const pendingRef = useRef({});
  const timerRef = useRef(null);
  const userIdRef = useRef(userId);
  const leagueIdRef = useRef(leagueId);
  const mountedRef = useRef(true);
  userIdRef.current = userId;
  leagueIdRef.current = leagueId;

  useEffect(() => {
    mountedRef.current = true;
    if (!userId || !leagueId) { setLoading(false); return; }
    setLoading(true);
    const unsub = subscribeToSimplePrediction(userId, leagueId, (doc) => {
      setData(doc);
      setLoading(false);
    });
    return () => {
      mountedRef.current = false;
      unsub && unsub();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = pendingRef.current;
      pendingRef.current = {};
      if (userId && leagueId && Object.keys(pending).length > 0) {
        saveSimplePrediction(userId, leagueId, pending).catch(() => {});
      }
    };
  }, [userId, leagueId]);

  const flush = useCallback(async () => {
    const uid = userIdRef.current;
    const lid = leagueIdRef.current;
    if (!uid || !lid) return;
    const payload = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(payload).length === 0) return;
    if (mountedRef.current) { setSaving(true); setError(null); }
    try {
      await saveSimplePrediction(uid, lid, payload);
      if (mountedRef.current) setSavedAt(Date.now());
    } catch (e) {
      if (mountedRef.current) setError(e.message || 'Failed to save');
      pendingRef.current = { ...payload, ...pendingRef.current };
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, []);

  const save = useCallback((partial) => {
    pendingRef.current = { ...pendingRef.current, ...partial };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  const saveNow = useCallback(async (partial) => {
    if (partial) pendingRef.current = { ...pendingRef.current, ...partial };
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    await flush();
  }, [flush]);

  return { data, loading, saving, savedAt, error, save, saveNow };
}
