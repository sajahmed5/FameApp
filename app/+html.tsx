import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Web-only root HTML document (Expo Router injects the app into <body>). This is where
 * PWA/home-screen metadata lives — Expo doesn't emit an apple-touch-icon or manifest on
 * its own, so "Add to Home Screen" would otherwise fall back to a grey letter tile.
 * Icons + manifest are served from the project's `public/` directory at the web root.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover exposes the iOS safe-area-inset env vars that react-native-
            safe-area-context reads on web — without it the composer/bottom bar loses its
            home-indicator padding in the standalone PWA and gets clipped. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />

        {/* Browser tab + PWA home-screen icons (phixr mark) */}
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />

        {/* Standalone PWA on iOS: full-screen, phixr name + orange chrome */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="phixr" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#FF7A18" />

        {/* Disable body scrolling on web so the RN app owns scroll containers. */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
