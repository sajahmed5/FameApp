import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Simple client-side cooldown timer, used to rate-limit resend-verification and
 * password-reset requests from the UI.
 *
 * NOTE: this is UI-side throttling only and is not a security control — Supabase Auth
 * also enforces server-side email rate limits (Dashboard → Authentication → Rate Limits,
 * and the SMTP provider's own caps). Both are required; the client cooldown just avoids
 * obvious double-taps and gives the user a countdown.
 */
export function useCooldown() {
  const [remaining, setRemaining] = useState(0);
  const endAt = useRef(0);
  const active = remaining > 0;

  // Runs a 4Hz ticker only while active; keyed on `active` (not `remaining`) so the
  // interval is created once when the countdown starts and torn down when it ends —
  // not re-created on every tick. The interval reads the ref, never `remaining`.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const secs = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
      setRemaining(secs);
      if (secs <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [active]);

  const start = useCallback((seconds: number) => {
    endAt.current = Date.now() + seconds * 1000;
    setRemaining(seconds);
  }, []);

  return { remaining, active, start };
}
