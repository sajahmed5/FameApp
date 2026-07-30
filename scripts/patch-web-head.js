// Injects PWA / home-screen head tags into the Expo web export's index.html.
//
// Expo Router's `app/+html.tsx` is NOT applied when web `output` is "single"
// (our config) — the export ships Expo's default <head>. So the tags iOS needs
// for a proper standalone PWA (apple-touch-icon, manifest, viewport-fit=cover so
// the CSS safe-area-inset env vars resolve, theme-color) must be patched in here,
// after `expo export`. The referenced assets live in public/ (copied to dist/).
//
// Wired into the Vercel build: `expo export --platform web && node scripts/patch-web-head.js`.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'dist', 'index.html');
let html = fs.readFileSync(file, 'utf8');

// 1) viewport-fit=cover — required for env(safe-area-inset-*) to be non-zero on iOS.
html = html.replace(
  /<meta name="viewport"[^>]*\/?>/i,
  '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />',
);

// 2) PWA / home-screen head tags (idempotent — keyed on apple-touch-icon).
if (!/apple-touch-icon/i.test(html)) {
  const tags = [
    '<link rel="icon" type="image/png" href="/favicon.png" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    '<link rel="manifest" href="/manifest.json" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    '<meta name="apple-mobile-web-app-title" content="phixr" />',
    '<meta name="theme-color" content="#FF7A18" />',
  ].join('');
  html = html.replace('</head>', tags + '</head>');
}

fs.writeFileSync(file, html);
console.log('[patch-web-head] injected PWA head tags into dist/index.html');
