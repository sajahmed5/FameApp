import type { AgeBand } from '@/types';

/** A validation result: null means valid, a string is the user-facing error. */
export type FieldError = string | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HANDLE_RE = /^[a-z0-9_]{3,30}$/;

export const PASSWORD_MIN_LENGTH = 10;

export function validateEmail(value: string): FieldError {
  const v = value.trim();
  if (!v) return 'Enter your email address.';
  if (!EMAIL_RE.test(v)) return 'Enter a valid email address.';
  return null;
}

/**
 * Password rule per spec: minimum length only, no arbitrary character-class requirements.
 * Strength (below) is separate, advisory feedback.
 */
export function validatePassword(value: string): FieldError {
  if (!value) return 'Enter a password.';
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}

export function validatePasswordConfirm(password: string, confirm: string): FieldError {
  if (!confirm) return 'Re-enter your password.';
  if (password !== confirm) return 'Passwords do not match.';
  return null;
}

export type PasswordStrength = {
  /** 0–4. */
  score: number;
  label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong';
};

/**
 * Advisory strength estimate — length-led, with a small bonus for character variety and
 * distinct characters. Deliberately NOT a set of pass/fail class rules; it only guides.
 */
export function estimatePasswordStrength(value: string): PasswordStrength {
  if (value.length < PASSWORD_MIN_LENGTH) return { score: 0, label: 'Too short' };

  let score = 0;
  if (value.length >= PASSWORD_MIN_LENGTH) score++;
  if (value.length >= 14) score++;
  if (value.length >= 20) score++;

  const variety =
    (/[a-z]/.test(value) ? 1 : 0) +
    (/[A-Z]/.test(value) ? 1 : 0) +
    (/[0-9]/.test(value) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(value) ? 1 : 0);
  if (variety >= 3) score++;

  const distinct = new Set(value).size;
  if (distinct < 5) score = Math.min(score, 1); // "aaaaaaaaaa" should not read as strong

  score = Math.max(1, Math.min(4, score));
  const label = (['Too short', 'Weak', 'Fair', 'Good', 'Strong'] as const)[score];
  return { score, label };
}

export function validateDisplayName(value: string): FieldError {
  const v = value.trim();
  if (!v) return 'Enter a display name.';
  if (v.length < 2) return 'Display name is too short.';
  if (v.length > 50) return 'Display name is too long (max 50).';
  return null;
}

/** Format-only handle check (availability is a separate async server call). */
export function validateHandleFormat(value: string): FieldError {
  if (!value) return 'Choose a handle.';
  if (!HANDLE_RE.test(value)) {
    return 'Handles are 3–30 characters: lowercase letters, numbers, underscore.';
  }
  return null;
}

/** Whole completed years between `dob` and `now`. */
export function ageInYears(dob: Date, now: Date = new Date()): number {
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export type DobStatus = 'under13' | 'minor' | 'adult';

export function dobStatus(dob: Date, now: Date = new Date()): DobStatus {
  const age = ageInYears(dob, now);
  if (age < 13) return 'under13';
  if (age < 18) return 'minor';
  return 'adult';
}

export function ageBandFromDob(dob: Date, now: Date = new Date()): AgeBand {
  return ageInYears(dob, now) < 18 ? 'minor' : 'adult';
}

/** `YYYY-MM-DD` in local time, for storing a date-only DOB without timezone drift. */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
