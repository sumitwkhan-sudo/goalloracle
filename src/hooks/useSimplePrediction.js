/**
 * useSimplePrediction
 *
 * Subscribes to /simplePredictions/{userId}, exposes the current snapshot,
 * and provides a debounced save() that merges partial updates.
 *
 * Usage:
 *   const { data, loading, save, saving, savedAt, error } = useSimplePrediction(userId);
 *   save({ groupPredictions: {...} });  // debounced ~1s, merges into Firestore
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { subscribeToSimplePrediction, saveSimplePrediction } from '../utils/db';

const SAVE_DEBOUNCE_MS = 1000;

export default function useSimplePrediction(userId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);

  const pendingRef = useRef({});
  const timerRef = useRef(null);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const unsub = subscribeToSimplePrediction(userId, (doc) => {
      setData(doc);
      setLoading(false);
    });
    return () => {
      unsub && unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [userId]);

  const flush = useCallback(async () => {
    if (!userId) return;
    const payload = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(payload).length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await saveSimplePrediction(userId, payload);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e.message || 'Failed to save');
      // Requeue so the user's in-flight edits aren't lost on retry
      pendingRef.current = { ...payload, ...pendingRef.current };
    } finally {
      setSaving(false);
    }
  }, [userId]);

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
