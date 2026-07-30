import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * In-memory-only draft for the multi-step signup flow.
 *
 * Holds the account + identity data between screens so it never travels through route
 * params (which would leak email/password/DOB into URLs). It is NOT persisted anywhere —
 * the password lives only in React state for the duration of the flow, so the verify
 * screen can poll sign-in until the email is confirmed. It is cleared on completion.
 */
export type SignupDraft = {
  email: string;
  password: string;
  displayName: string;
  handle: string;
  /** ISO `YYYY-MM-DD`. */
  dateOfBirth: string;
};

interface SignupContextValue {
  draft: SignupDraft;
  update: (patch: Partial<SignupDraft>) => void;
  reset: () => void;
  /** True once the account step (email + password) has been completed. */
  hasAccountStep: boolean;
}

const EMPTY: SignupDraft = {
  email: '',
  password: '',
  displayName: '',
  handle: '',
  dateOfBirth: '',
};

const SignupContext = createContext<SignupContextValue | undefined>(undefined);

export function SignupProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<SignupDraft>(EMPTY);
  const [hasAccountStep, setHasAccountStep] = useState(false);

  const value = useMemo<SignupContextValue>(
    () => ({
      draft,
      update: (patch) => {
        if (patch.email !== undefined || patch.password !== undefined) {
          setHasAccountStep(true);
        }
        setDraft((prev) => ({ ...prev, ...patch }));
      },
      reset: () => {
        setHasAccountStep(false);
        setDraft(EMPTY);
      },
      hasAccountStep,
    }),
    [draft, hasAccountStep],
  );

  return <SignupContext.Provider value={value}>{children}</SignupContext.Provider>;
}

export function useSignup(): SignupContextValue {
  const ctx = useContext(SignupContext);
  if (!ctx) throw new Error('useSignup must be used within a SignupProvider');
  return ctx;
}
