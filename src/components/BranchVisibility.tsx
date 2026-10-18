import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

export type BranchVisibilityStore = {
  getSnapshot: () => boolean;
  subscribe: (listener: () => void) => () => void;
  set: (hidden: boolean) => void;
};

export function createBranchVisibilityStore(
  initial = false,
): BranchVisibilityStore {
  let hidden = initial;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => hidden,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (nextHidden) => {
      if (nextHidden === hidden) return;
      hidden = nextHidden;
      for (const listener of listeners) listener();
    },
  };
}

export const BranchVisibilityContext =
  createContext<BranchVisibilityStore | null>(null);

const alwaysFalse = () => false;
const noopSubscribe = (_listener: () => void) => () => {};

export function BranchVisibilityBoundary({
  isBranch,
  className,
  children,
}: {
  isBranch: boolean;
  className?: string;
  children: ReactNode;
}) {
  const store = useContext(BranchVisibilityContext);
  const subscribe =
    isBranch && store !== null ? store.subscribe : noopSubscribe;
  const getSnapshot =
    isBranch && store !== null ? store.getSnapshot : alwaysFalse;
  const hidden = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!hidden || !isBranch) return;
    const outerNode =
      rootRef.current?.closest<HTMLElement>(".react-flow__node");
    if (!outerNode) return;
    const oldInert = outerNode.inert,
      oldAttribute = outerNode.getAttribute("inert"),
      oldAria = outerNode.getAttribute("aria-hidden");
    outerNode.inert = true;
    outerNode.setAttribute("aria-hidden", "true");
    return () => {
      // Revert only values still owned by this boundary, not another writer's updates.
      if (outerNode.inert && outerNode.getAttribute("inert") === "") {
        outerNode.inert = oldInert;
        if (oldAttribute === null) outerNode.removeAttribute("inert");
        else outerNode.setAttribute("inert", oldAttribute);
      }
      if (outerNode.getAttribute("aria-hidden") === "true") {
        if (oldAria === null) outerNode.removeAttribute("aria-hidden");
        else outerNode.setAttribute("aria-hidden", oldAria);
      }
    };
  }, [hidden, isBranch]);

  return (
    <div
      ref={rootRef}
      className={className}
      inert={hidden && isBranch ? true : undefined}
      aria-hidden={hidden && isBranch ? true : undefined}
    >
      {children}
    </div>
  );
}
