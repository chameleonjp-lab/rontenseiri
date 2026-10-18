import type { Page } from "@playwright/test";

/** Delay delivery, not execution/data, of one native project read's success. */
export async function installProjectReadGate(page: Page) {
  await page.addInitScript(() => {
    const held = new WeakSet<IDBRequest>();
    const pending: Array<() => void> = [];
    const gate = {
      armed: false,
      blocked: false,
      reads: 0,
      release() {
        gate.armed = false;
        for (const deliver of pending.splice(0)) deliver();
      },
    };
    Object.assign(window, { __projectReadGate: gate });
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (query) {
      const request = get.call(this, query);
      if (
        gate.armed &&
        this.name === "projects" &&
        typeof query === "string" &&
        query.startsWith("project:")
      ) {
        held.add(request);
        gate.reads++;
      }
      return request;
    };
    const listen = IDBRequest.prototype.addEventListener;
    IDBRequest.prototype.addEventListener = function (type, listener, options) {
      if (type === "success" && listener && held.has(this)) {
        const request = this;
        listen.call(
          this,
          type,
          (event) => {
            gate.blocked = true;
            pending.push(() => {
              if (typeof listener === "function") listener.call(request, event);
              else listener.handleEvent(event);
            });
          },
          options,
        );
      } else listen.call(this, type, listener, options);
    };
  });
}
export async function armProjectReadGate(page: Page) {
  await page.evaluate(() => {
    const gate = (
      window as unknown as { __projectReadGate: { armed: boolean } }
    ).__projectReadGate;
    gate.armed = true;
  });
}
export async function projectReadGateState(page: Page) {
  return page.evaluate(() => {
    const gate = (
      window as unknown as {
        __projectReadGate: { blocked: boolean; reads: number };
      }
    ).__projectReadGate;
    return { blocked: gate.blocked, reads: gate.reads };
  });
}
export async function releaseProjectReadGate(page: Page) {
  await page.evaluate(() => {
    (
      window as unknown as { __projectReadGate: { release(): void } }
    ).__projectReadGate.release();
  });
}
