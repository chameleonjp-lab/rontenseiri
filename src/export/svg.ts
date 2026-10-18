import { relationLabel } from "../domain/relation-label";
import type { Project } from "../domain/types";
import { labels } from "../domain/types";
import { layoutProject } from "../domain/layout";
const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const color = {
  main: "#147e83",
  derived: "#7e64c8",
  drift: "#a77314",
  unknown: "#64748b",
  return: "#147e83",
};
/** Self-contained SVG. No scripts, foreignObject, links or remote fonts/resources. */
export function projectSvg(
  project: Project,
  names?: Map<string, string>,
): string {
  const layout = layoutProject(project);
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]));
  const minX =
    (layout.blocks.length ? Math.min(...layout.blocks.map((b) => b.x)) : 0) -
    20;
  const maxX = Math.max(400, ...layout.blocks.map((b) => b.x + b.width)) + 20;
  const maxY = Math.max(300, ...layout.blocks.map((b) => b.y + b.height)) + 20;
  const width = maxX - minX;
  const frames = layout.blocks
    .map((b) => {
      const agenda = project.agendas.find((a) => a.id === b.agendaId)!;
      return `<g><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="12" fill="#f5fafb" stroke="#a5bfc3"/><text x="${b.x + 14}" y="${b.y + 25}" font-size="14" fill="#284851">${esc(`${agenda.id} ${agenda.title}${b.occurrence > 1 ? "（再登場）" : ""}`)}</text><text x="${b.x + 14}" y="${b.y + 47}" font-size="11" fill="#5b737a">${esc(labels.decision[agenda.decision])} · 発言順 →</text></g>`;
    })
    .join("");
  const edges = project.relations
    .map((r) => {
      const from = nodes.get(r.from),
        to = nodes.get(r.to);
      if (!from || !to) return "";
      const x1 = from.x + 225,
        y1 = from.y + 48,
        x2 = to.x,
        y2 = to.y + 48,
        mid = (x1 + x2) / 2;
      const label = relationLabel(r, from.agendaId, to.agendaId);
      return `<g><path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" fill="none" stroke="${color[r.kind]}" stroke-width="2"${r.kind === "drift" ? ' stroke-dasharray="6 5"' : ""}/><path d="M ${x2 - 6} ${y2 - 4} L ${x2} ${y2} L ${x2 - 6} ${y2 + 4}" fill="none" stroke="${color[r.kind]}"/><text x="${mid}" y="${(y1 + y2) / 2 - 7}" font-size="10" fill="${color[r.kind]}">${esc(label)}</text></g>`;
    })
    .join("");
  const cards = layout.nodes
    .map((n) => {
      const u = project.utterances.find((item) => item.id === n.id)!;
      const chars = Array.from(u.quote);
      const lines: string[] = [];
      for (let i = 0; i < Math.min(chars.length, 36); i += 18)
        lines.push(
          chars.slice(i, i + 18).join("") +
            (i === 18 && chars.length > 36 ? "…" : ""),
        );
      const speaker = names?.get(u.speaker) || u.speaker;
      return `<g><title>${esc(`${u.id} ${speaker}: ${u.quote}`)}</title><rect x="${n.x}" y="${n.y}" width="225" height="96" rx="9" fill="white" stroke="${color[u.classification]}"/><text x="${n.x + 12}" y="${n.y + 22}" font-size="11" fill="#546e78">${esc(`${u.id} · ${speaker}`)}</text><text x="${n.x + 12}" y="${n.y + 46}" font-size="11" fill="#234653">${lines.map((line, i) => `<tspan x="${n.x + 12}" dy="${i ? 19 : 0}">${esc(line)}</tspan>`).join("")}</text><text x="${n.x + 12}" y="${n.y + 84}" font-size="11" fill="${color[u.classification]}">${esc(labels.classification[u.classification])} · 原文ID ${esc(u.id)}</text></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${Math.ceil((1200 * maxY) / width)}" viewBox="${minX} 0 ${width} ${maxY}" role="img" aria-label="${esc(project.title)}"><title>${esc(project.title)} — 発言順は左から右。本文の全文は各要素のtitle、またはJSON/Markdownで確認できます。</title><rect x="${minX}" width="${width}" height="${maxY}" fill="#edf4f6"/>${frames}${edges}${cards}</svg>`;
}
