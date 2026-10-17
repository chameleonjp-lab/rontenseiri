/** Own only temporary branch hiding; preserve pre-existing and externally changed ARIA. */
export function observeBranchEdgeVisibility(
  root: HTMLElement,
  collapsed: boolean,
) {
  const owned = new Map<Element, string | null>();
  const restore = (edge: Element, original: string | null) => {
    if (edge.getAttribute("aria-hidden") !== "true") return;
    if (original === null) edge.removeAttribute("aria-hidden");
    else edge.setAttribute("aria-hidden", original);
  };
  const apply = () => {
    for (const [edge, original] of owned) {
      if (
        !root.contains(edge) ||
        !collapsed ||
        !edge.classList.contains("branch-edge")
      ) {
        restore(edge, original);
        owned.delete(edge);
      }
    }
    if (!collapsed) return;
    for (const edge of root.querySelectorAll(".react-flow__edge.branch-edge")) {
      if (!owned.has(edge)) owned.set(edge, edge.getAttribute("aria-hidden"));
      if (edge.getAttribute("aria-hidden") !== "true")
        edge.setAttribute("aria-hidden", "true");
    }
  };
  apply();
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.type === "childList" ||
          (record.target instanceof Element &&
            record.target.classList.contains("react-flow__edge")),
      )
    )
      apply();
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-hidden"],
  });
  return () => {
    observer.disconnect();
    for (const [edge, original] of owned) restore(edge, original);
    owned.clear();
  };
}
