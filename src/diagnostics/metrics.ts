export type MetricSample = { name: string; ms: number; at: string };
const samples: MetricSample[] = [];
const starts = new Map<string, number>();
export function startMetric(name: string): void {
  starts.set(name, performance.now());
}
export function endMetric(name: string): MetricSample | null {
  const started = starts.get(name);
  if (started === undefined) return null;
  starts.delete(name);
  const sample = {
    name,
    ms: Math.max(0, performance.now() - started),
    at: new Date().toISOString(),
  };
  samples.push(sample);
  if (samples.length > 200) samples.shift();
  return sample;
}
export function recordMetric(name: string, ms: number): MetricSample {
  if (!Number.isFinite(ms) || ms < 0)
    throw new Error("invalid metric duration");
  const sample = { name, ms: Math.max(0, ms), at: new Date().toISOString() };
  samples.push(sample);
  if (samples.length > 200) samples.shift();
  return sample;
}
export function getMetricSamples(): MetricSample[] {
  return samples.slice();
}
export function summarizeMetric(name: string) {
  const values = samples
    .filter((s) => s.name === name)
    .map((s) => s.ms)
    .sort((a, b) => a - b);
  if (!values.length) return { count: 0, median: null, p95: null };
  const percentile = (p: number) =>
    values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
  return {
    count: values.length,
    median: percentile(0.5),
    p95: percentile(0.95),
  };
}
