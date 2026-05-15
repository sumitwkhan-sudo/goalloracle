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
const DARK = '#06070d';
const NAVY = '#0e1430';
const DIM = '#9aa0a6';
const LIGHT = '#ffffff';
const GOLD = '#FFD66B';
const GOLD_BRIGHT = '#FFC107';

function Frame({ children }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: `radial-gradient(ellipse at top right, ${NAVY} 0%, ${DARK} 55%, #000000 100%)`,
        padding: '64px 80px',
        position: 'relative',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
        color: LIGHT,
      }}
    >
      {/* Atmospheric gold glow upper-right */}
      <div
        style={{
          position: 'absolute',
          top: -200, right: -200, width: 700, height: 700,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,193,7,0.18) 0%, rgba(255,193,7,0) 70%)',
        }}
      />
      {/* Atmospheric blue glow lower-left */}
      <div
        style={{
          position: 'absolute',
          bottom: -250, left: -150, width: 600, height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(64,156,255,0.12) 0%, rgba(64,156,255,0) 70%)',
        }}
      />
      {/* Top accent bar */}
      <div
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, height: 6,
          background: `linear-gradient(90deg, ${RED} 0%, ${GOLD} 100%)`,
        }}
      />
      {children}
      <div style={{ position: 'absolute', bottom: 48, left: 80, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5 }}>GoalOracle</div>
        <div style={{ color: DIM, fontSize: 22 }}>·</div>
        <div style={{ color: DIM, fontSize: 22 }}>goaloracle.io</div>
      </div>
      <div style={{ position: 'absolute', bottom: 48, right: 80, color: DIM, fontSize: 20, letterSpacing: 2, textTransform: 'uppercase' }}>
        World Cup 2026
      </div>
    </div>
  );
}

function PlayerSilhouette() {
  return (
    <svg
      width="540"
      height="640"
      viewBox="0 0 600 800"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="silhouetteGlow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFE082" />
          <stop offset="50%" stopColor="#FFC107" />
          <stop offset="100%" stopColor="#FF8F00" />
        </linearGradient>
        <radialGradient id="auraGlow" cx="0.5" cy="0.5" r="0.55">
          <stop offset="0%" stopColor="#FFD66B" stopOpacity="0.35" />
          <stop offset="60%" stopColor="#FFD66B" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#FFD66B" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Atmospheric aura behind player */}
      <circle cx="320" cy="400" r="380" fill="url(#auraGlow)" />

      {/* Head */}
      <circle cx="370" cy="135" r="46" fill="url(#silhouetteGlow)" />

      {/* Torso (slight forward lean for momentum) */}
      <path
        d="M 325 178 Q 370 165 415 180 L 430 380 Q 370 395 305 380 Z"
        fill="url(#silhouetteGlow)"
      />

      {/* Back arm raised behind (balance) */}
      <path
        d="M 420 200 Q 470 175 510 130 Q 525 115 538 128 Q 530 175 485 215 Q 445 245 420 250 Z"
        fill="url(#silhouetteGlow)"
      />

      {/* Front arm extended forward */}
      <path
        d="M 320 210 Q 260 250 215 295 Q 200 310 215 322 Q 260 305 305 275 Q 340 250 345 235 Z"
        fill="url(#silhouetteGlow)"
      />

      {/* Front leg (kicking, extended down-left) */}
      <path
        d="M 305 370 Q 280 390 200 470 Q 130 530 95 575 Q 80 590 100 600 Q 140 590 200 545 Q 280 490 360 420 Q 380 400 365 380 Z"
        fill="url(#silhouetteGlow)"
      />

      {/* Back leg (planted, supporting) */}
      <path
        d="M 395 380 Q 440 385 455 430 Q 475 540 490 700 Q 495 730 470 735 Q 445 730 430 700 Q 410 560 390 460 Q 380 410 385 385 Z"
        fill="url(#silhouetteGlow)"
      />

      {/* Soccer ball at striking foot */}
      <circle cx="80" cy="595" r="42" fill="#FFFFFF" />
      <circle cx="80" cy="595" r="42" fill="none" stroke="#1a1a1a" strokeWidth="2" />
      <polygon
        points="80,572 95,584 89,604 71,604 65,584"
        fill="#1a1a1a"
      />
      <path d="M 80 572 L 65 562" stroke="#1a1a1a" strokeWidth="2" fill="none" />
      <path d="M 80 572 L 95 562" stroke="#1a1a1a" strokeWidth="2" fill="none" />
      <path d="M 95 584 L 110 580" stroke="#1a1a1a" strokeWidth="2" fill="none" />
      <path d="M 65 584 L 50 580" stroke="#1a1a1a" strokeWidth="2" fill="none" />
      <path d="M 71 604 L 65 620" stroke="#1a1a1a" strokeWidth="2" fill="none" />
      <path d="M 89 604 L 95 620" stroke="#1a1a1a" strokeWidth="2" fill="none" />
    </svg>
  );
}

function renderDefault() {
  return (
    <Frame>
      {/* Player silhouette positioned on the right side */}
      <div style={{
        position: 'absolute',
        right: -40,
        top: 30,
        display: 'flex',
      }}>
        <PlayerSilhouette />
      </div>

      {/* Left-side text content */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 24, maxWidth: 680, position: 'relative' }}>
        <div style={{ fontSize: 24, color: GOLD, fontWeight: 700, letterSpacing: 6, textTransform: 'uppercase' }}>
          World Cup 2026
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 130, fontWeight: 900, lineHeight: 0.95, letterSpacing: -4, color: LIGHT }}>
          <div style={{ display: 'flex' }}>Predict.</div>
          <div style={{ display: 'flex', color: GOLD }}>Win.</div>
        </div>
        <div style={{ fontSize: 32, color: '#d4d4d8', fontWeight: 500, lineHeight: 1.25, marginTop: 4 }}>
          World Cup 2026 Bracket Predictions
        </div>
        {/* Free entry pill */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginTop: 22,
          padding: '16px 26px',
          background: `linear-gradient(90deg, ${GOLD_BRIGHT} 0%, ${GOLD} 100%)`,
          borderRadius: 999,
          alignSelf: 'flex-start',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.15)',
        }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#1a1300', letterSpacing: 0.3 }}>
            FREE ENTRY
          </div>
          <div style={{ fontSize: 24, color: '#3a2a00', fontWeight: 600 }}>·</div>
          <div style={{ fontSize: 24, color: '#1a1300', fontWeight: 700 }}>
            Win up to $150 in Stablecoins
          </div>
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
