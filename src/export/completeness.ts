import type { Project } from "../domain/types";
import { labels } from "../domain/types";

/** Use only the already-scoped project: limited exports omit private reports. */
export function completenessLines(project: Project, limited = false): string[] {
  const lines = [`記録範囲: ${labels.extent[project.extent]}`];
  if (limited)
    lines.push("欠落申告: この限定出力には含めません（申告有無は不明）");
  else if (project.omissions === undefined) lines.push("欠落申告: 未申告");
  else if (project.omissions.length === 0)
    lines.push("欠落申告: なし（利用者申告）");
  else {
    lines.push(`欠落申告: ${project.omissions.length}件（利用者申告）`);
    project.omissions.forEach((omission, index) => {
      lines.push(`${index + 1}. ${omission.description}`);
      lines.push(`理由: ${omission.reason}`);
      if (omission.location !== undefined)
        lines.push(`位置: ${omission.location}`);
    });
  }
  lines.push(
    "判定は提供記録内に限ります。全文・欠落なしは利用者の申告であり、独立確認ではありません。",
  );
  return lines;
}

/** Plain text, not active Markdown images, links or embedded HTML. */
export function markdownLiteral(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+\-.!|]/g, "\\$&");
}
