export type PerformancePreflightMode = "production" | "development";

export interface PerformancePreflightSignals {
  htmlDevClient: boolean;
  devClientEndpoint: boolean;
  runtimeDevClient: boolean;
  hmrWebSocket: boolean;
}

export interface PerformancePreflightCheck {
  baseURL: string;
  endpoint: string;
  status: number | null;
  response: unknown;
  expectedSha: string;
  expectedMode: PerformancePreflightMode;
  signals: PerformancePreflightSignals;
}

export function validatePerformancePreflight(check: unknown): string[];
