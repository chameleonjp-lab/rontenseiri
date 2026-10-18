import { getMetricSamples } from "./metrics";
export type DiagnosticLog = {
  schemaVersion: 1;
  createdAt: string;
  metrics: ReturnType<typeof getMetricSamples>;
  notes: string[];
};
export function makeDiagnosticLog(notes: string[] = []): DiagnosticLog {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    metrics: getMetricSamples(),
    notes,
  };
}
export function downloadDiagnosticLog(notes: string[] = []): void {
  const blob = new Blob([JSON.stringify(makeDiagnosticLog(notes), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rontenseiri-diagnostics-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
