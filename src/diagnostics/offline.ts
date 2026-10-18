export type OfflineStatus = {
  version: string;
  cacheName: string;
  entries: number;
  expectedEntries: number;
  bytes: number;
  failures: string[];
  scope: string;
};

export type OfflineReadiness = {
  supported: boolean;
  production: boolean;
  registered: boolean;
  ready: boolean;
  scope?: string;
  status?: OfflineStatus;
  error?: string;
};

const production = import.meta.env.PROD;

function registrationUrl(): string {
  return new URL("service-worker.js", document.baseURI).href;
}

async function askStatus(worker: ServiceWorker): Promise<OfflineStatus> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(
      () => reject(new Error("Service Workerの応答がタイムアウトしました。")),
      5000,
    );
    channel.port1.onmessage = (event: MessageEvent<OfflineStatus>) => {
      window.clearTimeout(timer);
      resolve(event.data);
    };
    worker.postMessage({ type: "RONTENSEIRI_STATUS" }, [channel.port2]);
  });
}

export async function prepareOffline(): Promise<OfflineReadiness> {
  if (!production) {
    return {
      supported: "serviceWorker" in navigator,
      production,
      registered: false,
      ready: false,
      error: "開発モードでは登録しません。production buildで確認してください。",
    };
  }
  if (!("serviceWorker" in navigator)) {
    return {
      supported: false,
      production,
      registered: false,
      ready: false,
      error: "このブラウザはService Workerに対応していません。",
    };
  }
  try {
    const registration = await navigator.serviceWorker.register(
      registrationUrl(),
      {
        scope: new URL("./", document.baseURI).pathname,
        updateViaCache: "none",
      },
    );
    await registration.update();
    const ready = await navigator.serviceWorker.ready;
    const worker = ready.active || registration.active;
    if (!worker) throw new Error("Service Workerがactiveになりませんでした。");
    const status = await askStatus(worker);
    return {
      supported: true,
      production,
      registered: true,
      ready:
        status.failures.length === 0 &&
        status.entries >= status.expectedEntries,
      scope: ready.scope,
      status,
      error: status.failures.length ? status.failures.join(" ") : undefined,
    };
  } catch (error) {
    return {
      supported: true,
      production,
      registered: false,
      ready: false,
      error: String(error),
    };
  }
}

export async function readOfflineReadiness(): Promise<OfflineReadiness> {
  if (!production || !("serviceWorker" in navigator)) {
    return {
      supported: "serviceWorker" in navigator,
      production,
      registered: false,
      ready: false,
    };
  }
  const registration = await navigator.serviceWorker.getRegistration(
    new URL("./", document.baseURI).pathname,
  );
  if (!registration)
    return { supported: true, production, registered: false, ready: false };
  const worker = registration.active || registration.waiting;
  if (!worker)
    return { supported: true, production, registered: true, ready: false };
  const status = await askStatus(worker);
  return {
    supported: true,
    production,
    registered: true,
    ready:
      status.failures.length === 0 && status.entries >= status.expectedEntries,
    scope: registration.scope,
    status,
  };
}
