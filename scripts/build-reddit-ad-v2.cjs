#!/usr/bin/env node
/**
 * Build the Reddit ad slide 1 with embedded Manrope and enhanced
 * design. Outputs both the SVG (with base64 woff2 inline) and a
 * 1440x1080 PNG via sharp.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const FONT_PATH = path.join(
  '/home/user/goalloracle',
  'node_modules',
  '@fontsource-variable',
  'manrope',
  'files',
  'manrope-latin-wght-normal.woff2'
);
const fontBase64 = fs.readFileSync(FONT_PATH).toString('base64');
const fontDataUrl = `data:font/woff2;base64,${fontBase64}`;

const svg = `<svg width="1440" height="1080" viewBox="0 0 1440 1080" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style type="text/css"><![CDATA[
      @font-face {
        font-family: 'Manrope';
        font-style: normal;
        font-weight: 200 800;
        font-display: block;
        src: url('${fontDataUrl}') format('woff2-variations');
      }
      text, tspan {
        font-family: 'Manrope', system-ui, -apple-system, sans-serif;
        font-synthesis: none;
      }
    ]]></style>
    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00D4FF"/>
      <stop offset="50%" stop-color="#FF2D87"/>
      <stop offset="100%" stop-color="#FFB800"/>
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFE066"/>
      <stop offset="35%" stop-color="#F5C400"/>
      <stop offset="75%" stop-color="#C8930C"/>
      <stop offset="100%" stop-color="#8B6914"/>
    </linearGradient>
    <linearGradient id="goldGradLight" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FFE066"/>
      <stop offset="50%" stop-color="#F5C400"/>
      <stop offset="100%" stop-color="#A87C00"/>
    </linearGradient>
    <linearGradient id="goldBaseGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#F5C400"/>
      <stop offset="100%" stop-color="#8B6914"/>
    </linearGradient>
    <linearGradient id="topAccentBar" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FF3B30"/>
      <stop offset="100%" stop-color="#FFD66B"/>
    </linearGradient>
    <linearGradient id="headlineGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFE066"/>
      <stop offset="100%" stop-color="#FFC107"/>
    </linearGradient>
    <radialGradient id="bgGrad" cx="0.4" cy="0.3" r="0.85">
      <stop offset="0%" stop-color="#1a1f4a"/>
      <stop offset="55%" stop-color="#06070d"/>
      <stop offset="100%" stop-color="#000000"/>
    </radialGradient>
    <radialGradient id="trophyAura" cx="0.5" cy="0.45" r="0.55">
      <stop offset="0%" stop-color="#FFC107" stop-opacity="0.32"/>
      <stop offset="55%" stop-color="#FFC107" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#FFC107" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="globeSheen" cx="0.3" cy="0.3" r="0.55">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="1440" height="1080" fill="url(#bgGrad)"/>

  <!-- Atmospheric trophy aura (replaces flat circle for more depth) -->
  <circle cx="1140" cy="500" r="540" fill="url(#trophyAura)"/>
  <circle cx="180" cy="920" r="420" fill="#409CFF" opacity="0.07"/>

  <!-- Top accent bar -->
  <rect x="0" y="0" width="1440" height="8" fill="url(#topAccentBar)"/>

  <!-- ============ TOP STRIP ============ -->
  <g transform="translate(60, 50) scale(1.1)">
    <path d="M50 4 L88 22 Q96 26 96 35 L96 65 Q96 74 88 78 L50 96 L12 78 Q4 74 4 65 L4 35 Q4 26 12 22 Z" fill="none" stroke="url(#brandGrad)" stroke-width="5"/>
    <path d="M30 38 Q30 28 42 28 L52 28" stroke="url(#brandGrad)" stroke-width="7" stroke-linecap="round" fill="none"/>
    <path d="M30 38 L30 58 Q30 68 42 68 L52 68 L52 55 L44 55" stroke="url(#brandGrad)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="66" cy="48" r="18" stroke="url(#brandGrad)" stroke-width="7" fill="none"/>
  </g>

  <!-- KICKOFF date pill (right side) with live activity dot for urgency -->
  <g transform="translate(630, 70)">
    <rect x="0" y="0" width="400" height="60" rx="30" fill="#FFC107" fill-opacity="0.14" stroke="#FFC107" stroke-width="2.5"/>
    <circle cx="32" cy="30" r="5" fill="#FF3B30"/>
    <circle cx="32" cy="30" r="10" fill="none" stroke="#FF3B30" stroke-width="1.5" opacity="0.4"/>
    <text x="218" y="40" text-anchor="middle" fill="#FFE066" font-size="22" font-weight="800" letter-spacing="2.5">KICKOFF · JUNE 11, 2026</text>
  </g>

  <!-- ============ LEFT COLUMN: TEXT ============ -->
  <!-- Eyebrow with leading accent line -->
  <line x1="60" y1="260" x2="100" y2="260" stroke="#FFD66B" stroke-width="3" stroke-linecap="round"/>
  <text x="110" y="270" fill="#FFD66B" font-size="28" font-weight="800" letter-spacing="6">WORLD CUP 2026 PREDICTIONS</text>

  <!-- Hero line 1: "Predict the" — Manrope ExtraBold for maximum
       weight contrast vs the body copy -->
  <text x="60" y="450" fill="#FFFFFF" font-size="170" font-weight="800" letter-spacing="-5">Predict the</text>

  <!-- Hero line 2: "World Cup." — gold with subtle gradient -->
  <text x="60" y="620" fill="url(#headlineGrad)" font-size="170" font-weight="800" letter-spacing="-5">World Cup.</text>

  <!-- Subtitle with a stronger weight for legibility at the small size -->
  <text x="60" y="700" fill="#d4d4d8" font-size="32" font-weight="500">Skill-based prediction game · 10 minutes</text>
  <text x="60" y="745" fill="#d4d4d8" font-size="32" font-weight="500">to build your bracket · Compete globally</text>

  <!-- ============ FEATURE CHIPS ============ -->
  <g transform="translate(60, 800)">
    <rect x="0" y="0" width="240" height="92" rx="16" fill="#FFFFFF" fill-opacity="0.06" stroke="#FFC107" stroke-width="2.5"/>
    <text x="20" y="40" fill="#FFC107" font-size="22" font-weight="900">✓</text>
    <text x="50" y="40" fill="#FFE066" font-size="22" font-weight="800" letter-spacing="2">100% FREE</text>
    <text x="20" y="74" fill="#d4d4d8" font-size="18" font-weight="500">No card. No fees.</text>

    <rect x="260" y="0" width="240" height="92" rx="16" fill="#FFFFFF" fill-opacity="0.06" stroke="#FFC107" stroke-width="2.5"/>
    <text x="280" y="40" fill="#FFC107" font-size="22" font-weight="900">✓</text>
    <text x="310" y="40" fill="#FFE066" font-size="22" font-weight="800" letter-spacing="2">SKILL-BASED</text>
    <text x="280" y="74" fill="#d4d4d8" font-size="18" font-weight="500">Predict 104 matches.</text>

    <rect x="520" y="0" width="240" height="92" rx="16" fill="#FFFFFF" fill-opacity="0.06" stroke="#FFC107" stroke-width="2.5"/>
    <text x="540" y="40" fill="#FFC107" font-size="22" font-weight="900">✓</text>
    <text x="570" y="40" fill="#FFE066" font-size="22" font-weight="800" letter-spacing="2">NO PURCHASE</text>
    <text x="540" y="74" fill="#d4d4d8" font-size="18" font-weight="500">Ever necessary.</text>
  </g>

  <!-- ============ RIGHT COLUMN: TROPHY ============ -->
  <g transform="translate(1040, 230) scale(2.6)">
    <ellipse cx="80" cy="190" rx="68" ry="8" fill="url(#goldGradLight)"/>
    <rect x="12" y="190" width="136" height="32" fill="url(#goldBaseGrad)"/>
    <ellipse cx="80" cy="222" rx="68" ry="8" fill="#6b4f0e"/>
    <rect x="12" y="197" width="136" height="4" fill="#1f7a3a"/>
    <rect x="12" y="211" width="136" height="4" fill="#1f7a3a"/>
    <rect x="12" y="190" width="136" height="2" fill="#FFE066" opacity="0.85"/>

    <path d="M 52,92 C 58,108 72,116 72,138 C 72,156 52,170 46,190 L 114,190 C 108,170 88,156 88,138 C 88,116 102,108 108,92 Z" fill="url(#goldGrad)"/>
    <path d="M 80,92 C 78,120 78,160 80,190" stroke="#6b4f0e" stroke-width="1.5" fill="none" opacity="0.55"/>
    <path d="M 80,92 C 88,116 100,130 100,150 C 100,168 92,180 86,190 L 80,190 Z" fill="#000000" opacity="0.08"/>

    <rect x="56" y="86" width="48" height="8" rx="2" fill="url(#goldBaseGrad)"/>
    <rect x="56" y="86" width="48" height="2" fill="#FFE066" opacity="0.85"/>

    <circle cx="80" cy="46" r="42" fill="url(#goldGrad)"/>
    <ellipse cx="80" cy="46" rx="42" ry="11" fill="none" stroke="#6b4f0e" stroke-width="1.6" opacity="0.7"/>
    <path d="M 80,4 Q 98,46 80,88" fill="none" stroke="#6b4f0e" stroke-width="1.6" opacity="0.65"/>
    <path d="M 80,4 Q 62,46 80,88" fill="none" stroke="#6b4f0e" stroke-width="1.6" opacity="0.65"/>
    <ellipse cx="80" cy="46" rx="28" ry="42" fill="none" stroke="#6b4f0e" stroke-width="1" opacity="0.35"/>
    <ellipse cx="64" cy="32" rx="14" ry="18" fill="url(#globeSheen)"/>
  </g>

  <!-- ============ BOTTOM STRIP ============ -->
  <line x1="60" y1="950" x2="1380" y2="950" stroke="#FFC107" stroke-width="1.5" opacity="0.25"/>

  <text x="60" y="1015" fill="#FFFFFF" font-size="56" font-weight="800" letter-spacing="-1.5">goaloracle.io</text>
  <text x="60" y="1058" fill="#a8acb5" font-size="22" font-weight="500">Free skill-based prediction game · No purchase necessary · 18+</text>

  <!-- CTA button with a softer outer glow for visual prominence -->
  <g transform="translate(1130, 970)">
    <rect x="-4" y="-4" width="258" height="98" rx="49" fill="url(#topAccentBar)" opacity="0.35"/>
    <rect x="0" y="0" width="250" height="90" rx="45" fill="url(#topAccentBar)"/>
    <text x="125" y="60" text-anchor="middle" fill="#0a0a0a" font-size="30" font-weight="900" letter-spacing="1">PLAY FREE</text>
  </g>
</svg>
`;

const outSvg = '/tmp/goaloracle-reddit-ad-slide1-v2.svg';
const outPng = '/tmp/goaloracle-reddit-ad-slide1-v2.png';

fs.writeFileSync(outSvg, svg);

sharp(Buffer.from(svg), { density: 300 })
  .resize(1440, 1080)
  .png()
  .toFile(outPng)
  .then((info) => {
    console.log('SVG:', outSvg, fs.statSync(outSvg).size + 'b');
    console.log('PNG:', outPng, info.width + 'x' + info.height, info.size + 'b');
  })
  .catch((e) => { console.error(e); process.exit(1); });
