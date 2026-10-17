import { useEffect } from "react";

/** Trap only modal focus, never canvas focus. Tab can always exit the canvas. */
export function useModalFocus(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const background = [
      ...document.querySelectorAll<HTMLElement>(".app-shell > *"),
    ].filter((el) => !el.contains(dialog) && !el.classList.contains("toast"));
    const states = background.map((el) => ({ el, inert: el.inert }));
    states.forEach(({ el }) => {
      el.inert = true;
    });
    const focusables = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length > 0);
    dialog.tabIndex = -1;
    (focusables()[0] || dialog).focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      states.forEach(({ el, inert }) => {
        el.inert = inert;
      });
      if (previous?.isConnected) previous.focus();
    };
  }, [active]);
}
