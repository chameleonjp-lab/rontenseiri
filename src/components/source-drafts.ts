export interface SourceEditDraft {
  quote: string;
  reason: string;
}
export interface SourceDraftContext {
  projectId: string;
  utteranceId: string;
  sourceId: string;
  bodyId: string;
  originalQuote: string;
}
/** Positions/version can rebase after an unrelated cue edit. Exact body identity
 * and original text must still match; changed text gets a fresh context. */
export function sourceDraftKey(context: SourceDraftContext): string {
  return JSON.stringify([
    context.projectId,
    context.utteranceId,
    context.sourceId,
    context.bodyId,
    context.originalQuote,
  ]);
}
export function changeSourceDraft(
  cache: Map<string, SourceEditDraft>,
  context: SourceDraftContext,
  patch: Partial<SourceEditDraft>,
): void {
  const key = sourceDraftKey(context);
  const next = {
    quote: context.originalQuote,
    reason: "",
    ...cache.get(key),
    ...patch,
  };
  if (next.quote === context.originalQuote && next.reason === "")
    cache.delete(key);
  else cache.set(key, next);
}
