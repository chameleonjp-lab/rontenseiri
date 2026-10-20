export interface OwnershipLease {
  ownerId: string;
  lockName: string;
  /** Aborted on expiry or caller cancellation; the lock remains held until release(). */
  signal: AbortSignal;
  release(): Promise<void>;
}
export interface OwnershipOptions {
  lockName?: string;
  ownerId?: string;
  timeoutMs?: number;
  leaseMs?: number;
  signal?: AbortSignal;
  locks?: { request: LockRequest };
  now?: () => number;
}
export class OwnershipUnavailableError extends Error {
  constructor(message = "この環境では解析の同時実行を安全に制御できません") {
    super(message);
    this.name = "OwnershipUnavailableError";
  }
}
export class OwnershipTimeoutError extends Error {
  constructor() {
    super("別タブが解析資源を使用中です");
    this.name = "OwnershipTimeoutError";
  }
}

type LockRequest = (
  name: string,
  options: LockOptions,
  callback: (lock: Lock | null) => Promise<void> | void,
) => Promise<void>;
const active = new Map<
  string,
  { ownerId: string; expires: number; release: () => void }
>();

function browserLocks(): LockManager | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { locks?: LockManager }).locks;
}
export async function acquireAnalysisOwnership(
  options: OwnershipOptions = {},
): Promise<OwnershipLease> {
  const lockName = options.lockName ?? "rontenseiri-analysis";
  const ownerId = options.ownerId ?? crypto.randomUUID();
  const timeout = options.timeoutMs ?? 0;
  const leaseMs = options.leaseMs ?? 30_000;
  const now = options.now ?? (() => Date.now());
  if (leaseMs <= 0 || timeout < 0) throw new Error("invalid ownership timeout");
  const locks = options.locks ?? browserLocks();
  if (!locks?.request) {
    // Do not fall back to localStorage or an in-memory lock: they cannot protect another tab.
    throw new OwnershipUnavailableError();
  }
  let released = false;
  const leaseController = new AbortController();
  const acquisitionController = new AbortController();
  let acquisitionTimer: ReturnType<typeof setTimeout> | undefined;
  let leaseTimer: ReturnType<typeof setTimeout> | undefined;
  const request = locks.request.bind(locks) as unknown as LockRequest;
  const started = now();
  const acquisition = new Promise<OwnershipLease>((resolve, reject) => {
    let settled = false;
    let resolveHold: (() => void) | undefined;
    const cleanupAcquisition = (detachCaller = true) => {
      if (acquisitionTimer) {
        clearTimeout(acquisitionTimer);
        acquisitionTimer = undefined;
      }
      if (detachCaller) options.signal?.removeEventListener("abort", abort);
    };
    const rejectAcquisition = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanupAcquisition();
      reject(error);
    };
    const abort = () => {
      if (!settled) {
        acquisitionController.abort();
        rejectAcquisition(
          new DOMException("ownership acquisition aborted", "AbortError"),
        );
      } else {
        leaseController.abort(
          new DOMException("ownership lease aborted", "AbortError"),
        );
      }
    };
    if (options.signal?.aborted) return abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (timeout > 0)
      acquisitionTimer = setTimeout(() => {
        acquisitionController.abort();
        rejectAcquisition(new OwnershipTimeoutError());
      }, timeout);
    try {
      void request(
        lockName,
        { signal: acquisitionController.signal },
        async (lock) => {
          if (!lock) {
            rejectAcquisition(new OwnershipTimeoutError());
            return;
          }
          if (settled) return;
          const entry = active.get(lockName);
          if (entry && entry.ownerId !== ownerId) {
            rejectAcquisition(new OwnershipTimeoutError());
            return;
          }
          const hold = new Promise<void>((r) => {
            resolveHold = r;
          });
          const releaseHold = resolveHold!;
          active.set(lockName, {
            ownerId,
            expires: now() + leaseMs,
            release: releaseHold,
          });
          const release = async () => {
            if (released) return;
            released = true;
            if (leaseTimer) {
              clearTimeout(leaseTimer);
              leaseTimer = undefined;
            }
            options.signal?.removeEventListener("abort", abort);
            if (active.get(lockName)?.ownerId === ownerId)
              active.delete(lockName);
            releaseHold();
          };
          // The acquisition timer is finished, but the caller must still be able
          // to abort the held lease until actual work cleanup calls release().
          cleanupAcquisition(false);
          leaseTimer = setTimeout(() => {
            if (!released)
              leaseController.abort(
                new DOMException("ownership lease expired", "AbortError"),
              );
          }, leaseMs);
          settled = true;
          resolve({
            ownerId,
            lockName,
            signal: leaseController.signal,
            release,
          });
          await hold;
        },
      ).catch((error) => {
        if (!settled) {
          rejectAcquisition(error);
        }
      });
    } catch (error) {
      rejectAcquisition(error);
    }
  });
  // Avoid a synchronous unused variable warning while retaining the time captured for diagnostics/debuggers.
  void started;
  return acquisition;
}

export async function withAnalysisOwnership<T>(
  work: (lease: OwnershipLease) => Promise<T>,
  options: OwnershipOptions = {},
): Promise<T> {
  const lease = await acquireAnalysisOwnership(options);
  try {
    const result = await work(lease);
    // A callback may finish cleanup after expiry without throwing. Never
    // expose that late value as a successful owned run.
    if (lease.signal.aborted) throw lease.signal.reason;
    return result;
  } finally {
    await lease.release();
  }
}
