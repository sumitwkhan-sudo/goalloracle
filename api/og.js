import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

// Dynamic Open Graph image generator for GoalOracle. Renders a 1200x630
// PNG at request time. Shared across all social unfurls (FB / X / Slack /
// Discord / iMessage / WhatsApp / LinkedIn) and AI answer engines that
// pick up og:image.
//
// Query params:
//   ?type=default                                 -> GoalOracle wordmark + tagline
//   ?type=league&name=My+Office+Pool&members=12   -> per-league card
//   ?type=bracket&champ=Brazil&champFlag=%F0%9F%87%A7%F0%9F%87%B7&runner=Germany&runnerFlag=...&third=Argentina&thirdFlag=...&user=LeoM
//
// The edge runtime can't use Node APIs, so no Firebase Admin here. League
// data is looked up in middleware.js (which fetches /api/public?type=league)
// and passed here as query params — keeps this function cache-friendly.

const RED = '#FF3B30';
const DARK = '#0a0a0a';
const DIM = '#9aa0a6';
const LIGHT = '#ffffff';
const GOLD = '#FFD66B';

function Frame({ children }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(135deg, ${DARK} 0%, #1a1a1a 60%, #2a0a08 100%)`,
        padding: '64px 80px',
        position: 'relative',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
        color: LIGHT,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, height: 8,
          background: `linear-gradient(90deg, ${RED} 0%, ${GOLD} 100%)`,
        }}
      />
      {children}
      <div style={{ position: 'absolute', bottom: 48, left: 80, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>GoalOracle</div>
        <div style={{ color: DIM, fontSize: 22 }}>·</div>
        <div style={{ color: DIM, fontSize: 22 }}>goaloracle.io</div>
      </div>
      <div style={{ position: 'absolute', bottom: 48, right: 80, color: DIM, fontSize: 20 }}>
        World Cup 2026
      </div>
    </div>
  );
}

function renderDefault() {
  return (
    <Frame>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 40 }}>
        <div style={{ fontSize: 28, color: RED, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' }}>
          Predict the World Cup
        </div>
        <div style={{ fontSize: 88, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, maxWidth: 900 }}>
          Free World Cup 2026<br />prediction game.
        </div>
        <div style={{ fontSize: 30, color: DIM, maxWidth: 900, marginTop: 16, lineHeight: 1.35 }}>
          Build your bracket, join leagues, compete with friends. No gambling. FIFA-rules compliant.
        </div>
      </div>
    </Frame>
  );
}

function renderLeague({ name, members }) {
  const memberCount = Number(members) || 0;
  return (
    <Frame>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 40 }}>
        <div style={{ fontSize: 28, color: RED, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' }}>
          League on GoalOracle
        </div>
        <div style={{ fontSize: 80, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, maxWidth: 1040 }}>
          {name || 'League'}
        </div>
        <div style={{ fontSize: 28, color: DIM, marginTop: 18, display: 'flex', gap: 20 }}>
          <span style={{ color: GOLD, fontWeight: 700 }}>{memberCount} {memberCount === 1 ? 'member' : 'members'}</span>
          <span>·</span>
          <span>Join the league and predict the tournament</span>
        </div>
      </div>
    </Frame>
  );
}

function renderBracket({ user, champ, champFlag, runner, runnerFlag, third, thirdFlag }) {
  const rows = [
    { icon: '🏆', label: 'Champion', name: champ, flag: champFlag, accent: GOLD },
    { icon: '🥈', label: 'Runner-up', name: runner, flag: runnerFlag, accent: '#cfcfcf' },
    ...(third ? [{ icon: '🥉', label: 'Third', name: third, flag: thirdFlag, accent: '#d4a373' }] : []),
  ];
  return (
    <Frame>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 30 }}>
        <div style={{ fontSize: 26, color: RED, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' }}>
          {user ? `${user}'s bracket` : 'My bracket'}
        </div>
        <div style={{ fontSize: 58, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.5, marginBottom: 8 }}>
          World Cup 2026 predictions
        </div>
        {rows.map((r) => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 40, color: LIGHT }}>
            <span style={{ fontSize: 48 }}>{r.icon}</span>
            <span style={{ width: 210, color: r.accent, fontWeight: 700 }}>{r.label}</span>
            <span style={{ fontSize: 54 }}>{r.flag || '🏳️'}</span>
            <span style={{ fontWeight: 700 }}>{r.name || 'TBD'}</span>
          </div>
        ))}
        <div style={{ fontSize: 26, color: DIM, marginTop: 16 }}>
          Can you beat {user ? user : 'this bracket'}?  goaloracle.io
        </div>
      </div>
    </Frame>
  );
}

export default function handler(req) {
  const { searchParams } = new URL(req.url);
  const type = (searchParams.get('type') || 'default').toLowerCase();

  let element;
  if (type === 'league') {
    element = renderLeague({
      name: searchParams.get('name') || 'League',
      members: searchParams.get('members') || '0',
    });
  } else if (type === 'bracket') {
    element = renderBracket({
      user: searchParams.get('user') || '',
      champ: searchParams.get('champ') || '',
      champFlag: searchParams.get('champFlag') || '',
      runner: searchParams.get('runner') || '',
      runnerFlag: searchParams.get('runnerFlag') || '',
      third: searchParams.get('third') || '',
      thirdFlag: searchParams.get('thirdFlag') || '',
    });
  } else {
    element = renderDefault();
  }

  return new ImageResponse(element, {
    width: 1200,
    height: 630,
    headers: {
      // 7 days in browser, 1 year at the edge; bracket/league permutations
      // are finite enough that this is safe. Callers that need a refresh can
      // bust via a query param.
      'Cache-Control': 'public, max-age=604800, s-maxage=31536000, immutable',
    },
  });
}
