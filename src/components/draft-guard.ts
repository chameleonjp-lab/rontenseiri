import { createContext, useContext, useEffect, useId, useState } from "react";

export type DraftScope = "view" | "inspector";
export type RegisterDraft = (
  key: string,
  scope: DraftScope,
  dirty: boolean,
) => () => void;
export const DraftGuardContext = createContext<RegisterDraft>(() => () => {});

/** Only presence is registered; form contents stay in their owning component. */
export function useDraftGuard(dirty: boolean, scope: DraftScope) {
  const register = useContext(DraftGuardContext);
  const key = useId();
  useEffect(() => register(key, scope, dirty), [register, key, scope, dirty]);
}

/** Some editors intentionally keep applied values for the next operation. */
export function useFormDraftGuard(value: unknown, scope: DraftScope) {
  const signature = JSON.stringify(value);
  const [applied, setApplied] = useState(signature);
  useDraftGuard(signature !== applied, scope);
  return () => setApplied(signature);
}
