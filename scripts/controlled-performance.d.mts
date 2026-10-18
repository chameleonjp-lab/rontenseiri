export type Operation = "selection" | "search" | "fold";
export const OPERATIONS: Operation[];
export const ROUNDS: Operation[][];
export const COUNT: 100;
export const WARMUP: 20;
export const THRESHOLD_MS: 200;
export interface HealthCheck {
  baseURL: string;
  endpoint: string;
  status: number | null;
  response: {
    sha: string;
    buildSha: string;
    dirty: boolean;
    mode: "production";
  };
  expectedSha: string;
  expectedMode: "production";
  signals: {
    htmlDevClient: boolean;
    devClientEndpoint: boolean;
    runtimeDevClient: boolean;
    hmrWebSocket: boolean;
  };
  completed: boolean;
  passed: boolean;
  errors: string[];
}
export interface RunnerOptions {
  root?: string;
  cwd?: string;
  port?: string;
}
export function validateResult(
  result: unknown,
  operation: Operation,
  expectedSha: string,
): string[];
export function schedule(options?: RunnerOptions): {
  root: string;
  cwd: string;
  port: string;
  rounds: Operation[][];
};
export function runControlledPerformance(
  options?: RunnerOptions,
): Promise<Record<string, unknown>>;
