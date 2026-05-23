#!/usr/bin/env node
/**
 * Build slide 2 of the Reddit carousel (private-leagues angle) with
 * embedded Manrope. Reads the existing slide 2 SVG from /public/,
 * injects the Manrope @font-face into <defs>, then rasterizes.
 */

const fs = require('fs');
const sharp = require('sharp');

const FONT_PATH =
  '/home/user/goalloracle/node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2';
const SRC = '/home/user/goalloracle/public/reddit-ad-slide2-free.svg';
const OUT_SVG = '/tmp/goaloracle-reddit-ad-slide2-v2.svg';
const OUT_PNG = '/tmp/goaloracle-reddit-ad-slide2-v2.png';

const fontBase64 = fs.readFileSync(FONT_PATH).toString('base64');
const fontDataUrl = `data:font/woff2;base64,${fontBase64}`;

let svg = fs.readFileSync(SRC, 'utf8');

// 1. Inject the @font-face style block right after <defs>.
const fontFaceBlock = `
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
    ]]></style>`;
svg = svg.replace('<defs>', `<defs>${fontFaceBlock}`);

// 2. Strip per-text font-family attributes so the global rule wins.
svg = svg.replace(
  /\s*font-family="Helvetica Neue, Helvetica, Arial, sans-serif"/g,
  ''
);

fs.writeFileSync(OUT_SVG, svg);

sharp(Buffer.from(svg), { density: 300 })
  .resize(1440, 1080)
  .png()
  .toFile(OUT_PNG)
  .then((info) => {
    console.log('SVG:', OUT_SVG, fs.statSync(OUT_SVG).size + 'b');
    console.log('PNG:', OUT_PNG, info.width + 'x' + info.height, info.size + 'b');
  })
  .catch((e) => { console.error(e); process.exit(1); });
