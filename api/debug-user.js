import { db, corsHeaders, verifyAuth } from './_lib/firebase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).json({});
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized', hasAuth: !!req.headers.authorization });

  const userId = claims.userId || claims.sub;
  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();

  // Return full user data in the same format as /api/user
  if (userSnap.exists) {
    return res.status(200).json({ user: { id: userSnap.id, ...userSnap.data() } });
  }
  return res.status(200).json({ user: null, docExists: false, resolvedId: userId });
}
