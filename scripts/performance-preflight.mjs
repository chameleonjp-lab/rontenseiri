const IDENTITY_PATH = "/__rontenseiri_build_identity";

/**
 * Validate the build identity response and the signals observed by Playwright.
 * This function intentionally performs no I/O.
 *
 * @param {unknown} check
 * @returns {string[]}
 */
export function validatePerformancePreflight(check) {
  const errors = [];
  if (!isRecord(check)) return ["check must be an object"];

  const baseURL = check.baseURL;
  const endpoint = check.endpoint;
  const status = check.status;
  const response = check.response;
  const expectedSha = check.expectedSha;
  const expectedMode = check.expectedMode;

  const base = absoluteHttpUrl(baseURL);
  const actual = absoluteHttpUrl(endpoint);
  if (!base) errors.push("baseURL must be an absolute HTTP(S) URL");
  if (!actual) errors.push("endpoint must be an absolute HTTP(S) URL");
  if (base && actual) {
    if (actual.origin !== base.origin)
      errors.push("endpoint must be same-origin with baseURL");
    if (actual.pathname !== IDENTITY_PATH || actual.search || actual.hash) {
      errors.push(`endpoint must be the identity path ${IDENTITY_PATH}`);
    }
  }

  if (status !== 200) errors.push("identity endpoint must return HTTP 200");
  if (typeof expectedSha !== "string" || expectedSha.length === 0) {
    errors.push("expectedSha must be a non-empty string");
  }
  if (expectedMode !== "production" && expectedMode !== "development") {
    errors.push("expectedMode must be production or development");
  }

  if (!isRecord(response)) {
    errors.push("identity response must be an object");
  } else {
    if (response.sha !== expectedSha)
      errors.push("identity sha does not match expectedSha");
    if (response.buildSha !== expectedSha) {
      errors.push("identity buildSha does not match expectedSha");
    }
    if (response.dirty !== false) errors.push("identity dirty must be false");
    if (response.mode !== expectedMode)
      errors.push("identity mode does not match expectedMode");
  }

  const signals = check.signals;
  const signalNames = [
    "htmlDevClient",
    "devClientEndpoint",
    "runtimeDevClient",
    "hmrWebSocket",
  ];
  if (!isRecord(signals)) {
    errors.push("signals must be an object with all boolean fields");
  } else {
    for (const name of signalNames) {
      if (typeof signals[name] !== "boolean") {
        errors.push(`signals.${name} must be boolean`);
      }
    }
    if (
      expectedMode === "production" &&
      signalNames.some((name) => signals[name] === true)
    ) {
      errors.push(
        "development or HMR signal detected during production preflight",
      );
    }
  }

  return errors;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absoluteHttpUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
