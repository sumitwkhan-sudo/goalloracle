import { db, applyCors } from './_lib/firebase.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { type } = req.query;

  try {
    if (type === 'stats') {
      const [usersSnap, leaguesSnap, settingsSnap] = await Promise.all([
        db.collection('users').get(),
        db.collection('leagues').get(),
        db.collection('settings').doc('featureFlags').get(),
      ]);
      const leagues = leaguesSnap.docs.map(d => d.data());
      // Aggregate totalPrizePools (sum of entryFee × memberCount) ONLY
      // when the prize-leagues feature is on. With the flag off the
      // metric is meaningless — the create flow can't produce paid
      // leagues — so we report 0 to avoid surfacing inert legacy data.
      const flags = settingsSnap.exists ? (settingsSnap.data() || {}) : {};
      const prizeLeaguesEnabled = flags.enablePrizeLeagues === true;
      return res.status(200).json({
        totalPlayers: usersSnap.size,
        activeLeagues: leaguesSnap.size,
        totalPrizePools: prizeLeaguesEnabled
          ? leagues.reduce((s, l) => s + (l.entryFee || 0) * (l.memberCount || 0), 0)
          : 0,
      });

    } else if (type === 'results') {
      const snap = await db.collection('matchResults').get();
      const results = {};
      snap.docs.forEach(d => { results[d.id] = d.data(); });
      // Edge-cache: this now backs EVERY client's match-results state (the
      // old per-client Firestore listener is gone). One origin scan per
      // cache window serves all visitors.
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      return res.status(200).json({ results });

    } else if (type === 'winners') {
      // Winners page content — ONE doc, long edge cache. Published by the
      // admin Close out flow; per-view Firestore cost ≈ zero.
      const snap = await db.collection('siteContent').doc('winners').get();
      if (!snap.exists) {
        // Short negative cache — a publish should show up fast.
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=60');
        return res.status(200).json({ published: false });
      }
      const d = snap.data();
      // 5 min, not an hour: the doc updates when payouts land (receipts sync
      // their proof links in), and it's ONE read per window — cost is nil.
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ published: true, winners: d.winners || [], totalPlayers: d.totalPlayers || null });

    } else if (type === 'profile') {
      // Player profile — ONE frozen doc written at tournament finalization,
      // long edge cache. Public by design (display name + results only).
      const uid = String(req.query.u || '');
      if (!uid || uid.length > 128) return res.status(400).json({ error: 'Missing u' });
      const snap = await db.collection('profiles').doc(uid).get();
      if (!snap.exists) {
        // Short negative cache — otherwise a pre-finalization visit poisons
        // the URL for 15 minutes after profiles ARE written.
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=60');
        return res.status(404).json({ error: 'Profile not found' });
      }
      const { userId: pUid, displayName, country, wc2026 } = snap.data();
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ userId: pUid, displayName, country, wc2026 });

    } else if (type === 'league') {
      // Minimal public league meta for crawler-side OG/meta injection.
      // Only returns leagues that are public (or global). Private leagues
      // are omitted to avoid leaking their existence via unfurl previews.
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const snap = await db.collection('leagues').doc(id).get();
      if (!snap.exists) return res.status(404).json({ error: 'not found' });
      const data = snap.data();
      if (data.visibility && data.visibility !== 'public') {
        return res.status(404).json({ error: 'not found' });
      }
      // Cache league meta at the edge for an hour; stale OK for a day.
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({
        id: snap.id,
        name: data.name || 'League',
        memberCount: data.memberCount || 0,
        predictionMode: data.predictionMode || 'classic',
        type: data.type || 'free',
      });
    }

    if (type === 'flags') {
      // Admin-toggleable feature flags. Public so unauthenticated visitors
      // (landing page) get the same hide/show treatment as logged-in users.
      // Defaults: Quick Picks on, Classic off, Prize Leagues off. Once a
      // superadmin flips a flag it persists in /settings/featureFlags.
      const snap = await db.collection('settings').doc('featureFlags').get();
      const stored = snap.exists ? (snap.data() || {}) : {};
      // Short edge cache so changes propagate within a minute without
      // each client hammering Firestore.
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      return res.status(200).json({
        quickPicksEnabled: stored.quickPicksEnabled !== false,
        classicEnabled: stored.classicEnabled !== false,
        enablePrizeLeagues: stored.enablePrizeLeagues === true,
        knockoutRealReseed: stored.knockoutRealReseed !== false,
      });
    }

    if (type === 'bracket') {
      // Read-only Quick Picks summary for the public share page at
      // /u/{userId}/bracket. We expose the user's display name, country,
      // and bracket picks (winner / runner-up + every round's winner) but
      // never email, wallet address, or any other private field.
      const { userId } = req.query;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const userSnap = await db.collection('users').doc(userId).get();
      if (!userSnap.exists) return res.status(404).json({ error: 'user not found' });
      const u = userSnap.data();

      // Prefer the user's per-league Global Quick Picks doc; fall back to
      // the legacy single-doc path for users predating the per-league split.
      let predData = null;
      const composite = await db.collection('simplePredictions').doc(`${userId}__global-simple`).get();
      if (composite.exists) predData = composite.data();
      else {
        const legacy = await db.collection('simplePredictions').doc(userId).get();
        if (legacy.exists) predData = legacy.data();
      }
      if (!predData) return res.status(404).json({ error: 'no bracket' });

      const finalPick = predData?.knockoutPredictions?.final?.[0];
      const thirdPick = predData?.knockoutPredictions?.thirdPlace?.[0];

      // Cache bracket reads at the edge for 5 min so a viral share doesn't
      // hammer Firestore. Stale-while-revalidate keeps it fresh-feeling.
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({
        userId,
        displayName: u.displayName || userId.slice(0, 8),
        country: u.country || null,
        isComplete: !!(predData.isComplete || finalPick?.winnerId),
        groupPredictions: predData.groupPredictions || {},
        bestThirdPicks: Array.isArray(predData.bestThirdPicks) ? predData.bestThirdPicks : [],
        knockoutPredictions: predData.knockoutPredictions || {},
        winner: finalPick?.winnerId || null,
        runnerUp: finalPick?.loserId || null,
        thirdPlace: thirdPick?.winnerId || null,
      });
    }

    return res.status(400).json({ error: 'Invalid type param. Use ?type=stats, ?type=results, ?type=league&id=..., or ?type=bracket&userId=...' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
