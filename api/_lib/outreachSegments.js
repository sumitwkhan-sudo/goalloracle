/**
 * outreachSegments.js — shared segment resolver for outreach automation (B2d).
 *
 * ONE source of truth for "which users are in segment X", used by both the
 * dry-run preview (B2d-1) and the automation cron (B2d-2). Keeping the
 * resolution here means the preview an operator approves is byte-for-byte the
 * population the cron will actually email.
 *
 * Segments are intentionally explicit + named (not free-form predicates) so a
 * rule's targeting is auditable and can't accidentally select "everyone":
 *
 *   no_picks              — in global-simple, has email, has made ZERO picks
 *   started_incomplete    — has started a bracket somewhere but none isComplete
 *   global_incomplete     — global-simple bracket is not complete (started or not)
 *   completed_global      — global-simple bracket is complete
 *
 * Every segment is implicitly filtered to: has an email on file AND has not
 * opted out (emailOptOut !== true AND unsubscribedFromReminders !== true).
 * The caller layers the recent-contact guardrail on top.
 */

export const SEGMENTS = {
  no_picks: {
    id: 'no_picks',
    label: 'No picks yet',
    description: 'In the Global league, has email, has made zero picks in any bracket.',
  },
  started_incomplete: {
    id: 'started_incomplete',
    label: 'Started but incomplete',
    description: 'Has made some picks somewhere but no bracket is complete.',
  },
  global_incomplete: {
    id: 'global_incomplete',
    label: 'Global bracket incomplete',
    description: 'Global-simple bracket is not finished (whether or not they started).',
  },
  completed_global: {
    id: 'completed_global',
    label: 'Completed Global bracket',
    description: 'Global-simple bracket is complete.',
  },
  global_all: {
    id: 'global_all',
    label: 'Everyone in the Global league',
    description: 'Every user with an email who has not opted out — regardless of pick status. Use for tournament-wide announcements (e.g. the knockout lock reminder).',
  },
};

function hasAnyPicks(d) {
  const g = d.groupPredictions || {};
  if (Object.values(g).some((v) => Array.isArray(v?.ranking) && v.ranking.filter(Boolean).length > 0)) return true;
  if (Array.isArray(d.bestThirdPicks) && d.bestThirdPicks.length > 0) return true;
  const ko = d.knockoutPredictions || {};
  if (Object.values(ko).some((a) => Array.isArray(a) && a.length > 0)) return true;
  return false;
}

function isOptedOut(user) {
  return user.emailOptOut === true || user.unsubscribedFromReminders === true;
}

/**
 * Resolve a segment to the list of eligible userIds.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} segmentId  one of SEGMENTS
 * @returns {Promise<{ userIds: string[], scanned: number }>}
 */
export async function resolveSegment(db, segmentId) {
  if (!SEGMENTS[segmentId]) throw new Error(`Unknown segment: ${segmentId}`);

  const [usersSnap, predsSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('simplePredictions').get(),
  ]);

  // Per-user rollup of prediction state.
  const agg = {};
  const ensure = (uid) => (agg[uid] || (agg[uid] = {
    startedAny: false, completeAny: false, globalHasPicks: false, globalComplete: false,
  }));
  predsSnap.docs.forEach((doc) => {
    const id = doc.id;
    const data = doc.data() || {};
    let userId, leagueId;
    const sep = id.indexOf('__');
    if (sep >= 0) { userId = id.slice(0, sep); leagueId = id.slice(sep + 2); }
    else { userId = id; leagueId = 'global-simple'; }
    userId = data.userId || userId;
    leagueId = data.leagueId || leagueId;
    const a = ensure(userId);
    const picks = hasAnyPicks(data);
    const complete = data.isComplete === true;
    if (picks) a.startedAny = true;
    if (complete) a.completeAny = true;
    if (leagueId === 'global-simple') {
      if (picks) a.globalHasPicks = true;
      if (complete) a.globalComplete = true;
    }
  });

  const userIds = [];
  let scanned = 0;
  usersSnap.docs.forEach((d) => {
    const user = { id: d.id, ...d.data() };
    scanned += 1;
    if (!user.email || isOptedOut(user)) return;
    const a = agg[user.id] || { startedAny: false, completeAny: false, globalHasPicks: false, globalComplete: false };

    let inSegment = false;
    switch (segmentId) {
      case 'no_picks':
        inSegment = !a.startedAny;
        break;
      case 'started_incomplete':
        inSegment = a.startedAny && !a.completeAny;
        break;
      case 'global_incomplete':
        inSegment = !a.globalComplete;
        break;
      case 'completed_global':
        inSegment = a.globalComplete;
        break;
      case 'global_all':
        // Everyone past the email + opt-out gate already applied above.
        inSegment = true;
        break;
      default:
        inSegment = false;
    }
    if (inSegment) userIds.push(user.id);
  });

  return { userIds, scanned };
}
