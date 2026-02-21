import { db, corsHeaders, verifyAuth } from './_lib/firebase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized', hasAuth: !!req.headers.authorization });

  const userId = claims.userId || claims.sub;
  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();

  return res.status(200).json({
    claimsUserId: claims.userId,
    claimsSub: claims.sub,
    resolvedId: userId,
    docExists: userSnap.exists,
    docData: userSnap.exists ? userSnap.data() : null,
    docId: userSnap.exists ? userSnap.id : null,
  });
}
