import type { ReactElement } from "react";
import type { Utterance } from "../domain/types";

// Presentation-only cache: filtering/eligibility remains in Inspector.
// Immutable utterance identity changes on edits/import/Undo, preventing stale text.
const options = new WeakMap<Utterance, ReactElement>();
export function returnTargetOption(target: Utterance): ReactElement {
  const cached = options.get(target);
  if (cached) return cached;
  const option = (
    <option key={target.id} value={target.id}>
      {target.id} · {target.quote.slice(0, 25)}
    </option>
  );
  options.set(target, option);
  return option;
}
