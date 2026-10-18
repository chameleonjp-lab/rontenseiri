import { test, expect } from "@playwright/test";
import { createProject } from "../src/domain/project";
import { parseInputs } from "../src/input/parse";
import {
  addEvidence,
  addQuestion,
  linkResponse,
} from "../src/domain/reasoning";
import { exportProject } from "../src/export/project";
import type { Project } from "../src/domain/types";

type Destination = "left" | "right" | "both" | "unresolved";
const time = {
  asOf: "2020-01-01T00:00:00.000Z",
  recordedAt: "2020-01-01T00:00:00.000Z",
};

async function makeFixture() {
  let project = createProject(
    await parseInputs([
      {
        name: "conversation.txt",
        format: "txt",
        role: "conversation",
        text: "A: left right\nB: unrelated evidence\nC: response",
      },
    ]),
    "e2e-split-evidence",
    "full",
  );
  const target = project.utterances[0];
  project = addQuestion(project, "left or right?", "original", [target.id]);
  const questionVersionId = project.reasoning!.questionVersions[0].id;
  project = addEvidence(project, {
    utteranceIds: [target.id],
    sourceIds: [target.sourceId],
    actor: "manual",
    certainty: "confirmed",
    time,
  });
  const evidenceId = project.reasoning!.evidence[0].id;
  project = linkResponse(project, {
    questionVersionId,
    utteranceIds: [target.id],
    kind: "answer",
    fulfillment: "fulfilled",
    actor: "manual",
    time,
    counterargumentToClaimIds: [],
    evidenceIds: [evidenceId],
  });
  return {
    project,
    target,
    evidenceId,
    questionVersionId,
    responseId: project.reasoning!.responses[0].id,
  };
}

test.describe("発言分割の実選択・保存・復元", () => {
  test.describe.configure({ mode: "serial" });
  for (const destination of [
    "left",
    "right",
    "both",
    "unresolved",
  ] as Destination[])
    test(`${destination} 選択を実UIで完了する`, async ({ page }) => {
      const { project, target, evidenceId, questionVersionId, responseId } =
        await makeFixture();
      const originalUtteranceIds = project.utterances.map((u) => u.id);
      const originalOtherUtterances = project.utterances.filter(
        (u) => u.id !== target.id,
      );
      const originalEvidence = project.reasoning!.evidence.find(
        (e) => e.id === evidenceId,
      )!;
      const originalQuestionVersion = project.reasoning!.questionVersions.find(
        (q) => q.id === questionVersionId,
      )!;
      const originalResponse = project.reasoning!.responses.find(
        (r) => r.id === responseId,
      )!;
      const json = exportProject(project, "json");
      await page.goto("/");
      await page.getByLabel("JSONから復元").setInputFiles({
        name: "fixture.rontenseiri.json",
        mimeType: "application/json",
        buffer: Buffer.from(json),
      });
      await expect(
        page
          .getByRole("banner")
          .getByText("e2e-split-evidence", { exact: true }),
      ).toBeVisible();

      await page
        .getByRole("button", { name: "発言と原文", exact: true })
        .click();
      const targetRow = page
        .getByRole("button")
        .filter({ hasText: "left right" })
        .first();
      await expect(targetRow).toBeVisible();
      await targetRow.click();
      const detail = page.getByRole("complementary", {
        name: "選択した発言の詳細",
      });
      await expect(detail).toBeVisible();
      await expect(detail).toContainText(target.id);
      await detail.getByText("発言本文の区切りを編集", { exact: true }).click();
      await expect(
        detail.getByText("分割後の解釈参照先", { exact: true }),
      ).toBeVisible();
      const selects = detail.locator('select[aria-label$="の分割先"]');
      await expect(selects).toHaveCount(3);
      for (const id of [evidenceId, responseId, questionVersionId]) {
        const select = detail.locator(`select[aria-label="${id} の分割先"]`);
        await expect(select).toBeVisible();
        await select.selectOption(destination);
      }
      await detail
        .getByLabel("区切り・関係の変更理由")
        .fill(`E2E ${destination} 選択`);
      await detail.getByLabel("先頭から何文字で分けるか").fill("4");
      await detail
        .getByRole("button", { name: "この発言を2つに分ける", exact: true })
        .click();
      await expect(detail).toContainText("A: l");
      if (destination === "left") {
        // Keep the real write transaction open until the test releases it.
        // A generic toast match must not be mistaken for durable completion.
        await page.evaluate((title) => {
          const state = { started: false, release: false };
          (window as Window & { splitSaveGate?: typeof state }).splitSaveGate =
            state;
          const originalPut = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (value, key) {
            const request = originalPut.call(this, value, key);
            if (this.name === "projects" && value?.title === title) {
              const store = this;
              const keepAlive = () => {
                state.started = true;
                if (!state.release) store.get(key!).onsuccess = keepAlive;
              };
              store.get(key!).onsuccess = keepAlive;
            }
            return request;
          };
        }, project.title);
      }
      await page
        .getByRole("button", { name: "この端末に保存", exact: true })
        .click();
      if (destination === "left") {
        await page.waitForFunction(
          () =>
            (window as Window & { splitSaveGate?: { started: boolean } })
              .splitSaveGate?.started,
        );
        await expect(
          page.getByText("このブラウザに保存しました", { exact: false }),
        ).toHaveCount(0);
        await page.evaluate(() => {
          (
            window as Window & { splitSaveGate?: { release: boolean } }
          ).splitSaveGate!.release = true;
        });
      }
      // The import toast also contains 「保存」. Only the completed-save
      // message plus the committed IndexedDB record authorizes reload.
      await expect(page.getByRole("status")).toContainText(
        "このブラウザに保存しました",
      );
      await expect
        .poll(async () => {
          return page.evaluate(
            async ({ title, oldId, destination, referenceIds }) => {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open("rontenseiri-projects-v1", 1);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              try {
                const tx = db.transaction("projects", "readonly");
                const done = new Promise<void>((resolve, reject) => {
                  tx.oncomplete = () => resolve();
                  tx.onerror = () => reject(tx.error);
                  tx.onabort = () => reject(tx.error);
                });
                const request = tx.objectStore("projects").getAll();
                const saved = await new Promise<Project | undefined>(
                  (resolve, reject) => {
                    request.onsuccess = () =>
                      resolve(
                        (request.result as Project[]).find(
                          (p) => p.title === title,
                        ),
                      );
                    request.onerror = () => reject(request.error);
                  },
                );
                await done;
                const record = saved?.lineage?.records.find(
                  (r) => r.operation === "split" && r.oldIds.includes(oldId),
                );
                const expected = !record
                  ? []
                  : destination === "left"
                    ? [record.newIds[0]]
                    : destination === "right"
                      ? [record.newIds[1]]
                      : record.newIds;
                return {
                  saved: saved?.saved,
                  storageRevisionValid: (saved?.storageRevision ?? 0) >= 1,
                  oldUtteranceAbsent:
                    !!saved && !saved.utterances.some((u) => u.id === oldId),
                  splitCount: record?.newIds.length,
                  exactReferences: referenceIds.every((id) => {
                    const ref = record?.references.find(
                      (item) => item.referenceId === id,
                    );
                    return (
                      !!ref &&
                      JSON.stringify(ref.targetIds) ===
                        JSON.stringify(expected) &&
                      ref.status ===
                        (destination === "unresolved"
                          ? "unresolved"
                          : "applied")
                    );
                  }),
                };
              } finally {
                db.close();
              }
            },
            {
              title: project.title,
              oldId: target.id,
              destination,
              referenceIds: [evidenceId, responseId, questionVersionId],
            },
          );
        })
        .toEqual({
          saved: true,
          storageRevisionValid: true,
          oldUtteranceAbsent: true,
          splitCount: 2,
          exactReferences: true,
        });

      await page.reload();
      await expect(page.getByText("最近の作業", { exact: true })).toBeVisible();
      const recent = page
        .locator(".recent-open")
        .filter({ hasText: "e2e-split-evidence" })
        .first();
      await expect(recent).toBeVisible();
      await recent.click();
      await expect(
        page
          .getByRole("banner")
          .getByText("e2e-split-evidence", { exact: true }),
      ).toBeVisible();

      await page.getByRole("button", { name: "出力", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "資料を出力する" }),
      ).toBeVisible();
      const dialog = page.getByRole("dialog", { name: "資料を出力する" });
      await dialog
        .getByRole("button", { name: "出力内容をプレビュー", exact: true })
        .click();
      const preview = dialog.locator("pre.export-preview");
      const parsedEnvelope = JSON.parse((await preview.textContent()) ?? "");
      const parsed = parsedEnvelope.project;
      const record = [...(parsed.lineage?.records ?? [])]
        .reverse()
        .find(
          (candidate: { operation?: string; oldIds?: string[] }) =>
            candidate.operation === "split" &&
            candidate.oldIds?.includes(target.id),
        );
      expect(record).toBeDefined();
      const newIds = record.newIds as [string, string];
      const expectedReferenceIds = {
        evidence: newIds,
        response: newIds,
        questionVersion: newIds,
      };
      const expectedIds =
        destination === "left"
          ? [newIds[0]]
          : destination === "right"
            ? [newIds[1]]
            : newIds;
      const expectedUnresolved = destination === "unresolved";
      const expectedReasoningIds = expectedUnresolved ? newIds : expectedIds;
      const responseUtteranceIds = (parsed.reasoning.responses.find(
        (r: { id: string }) => r.id === responseId,
      ) as { utteranceIds?: string[]; sourceUtteranceIds?: string[] })!;
      expect(
        new Set(parsed.utterances.map((u: { id: string }) => u.id)),
      ).toEqual(
        new Set([
          ...originalUtteranceIds.filter((id) => id !== target.id),
          ...newIds,
        ]),
      );
      for (const original of originalOtherUtterances) {
        const expected = {
          ...JSON.parse(JSON.stringify(original)),
          order:
            original.order > target.order ? original.order + 1 : original.order,
        };
        expect(
          parsed.utterances.find((u: { id: string }) => u.id === original.id),
        ).toEqual(expected);
      }
      expect(
        parsed.reasoning.evidence.find(
          (e: { id: string }) => e.id === evidenceId,
        ).utteranceIds,
      ).toEqual(expectedReasoningIds);
      expect(
        parsed.reasoning.questionVersions.find(
          (q: { id: string }) => q.id === questionVersionId,
        ).sourceUtteranceIds,
      ).toEqual(expectedReasoningIds);
      expect(
        responseUtteranceIds.sourceUtteranceIds ??
          responseUtteranceIds.utteranceIds,
      ).toEqual(expectedReasoningIds);
      expect(
        parsed.reasoning.responses.find(
          (r: { id: string }) => r.id === responseId,
        ).fulfillment,
      ).toBe("unassessed");
      expect(record.status).toBe("pending");
      for (const [referenceId, referenceIds] of Object.entries(
        expectedReferenceIds,
      )) {
        const reasoningId =
          referenceId === "evidence"
            ? evidenceId
            : referenceId === "response"
              ? responseId
              : questionVersionId;
        const ref = record.references.find(
          (candidate: { referenceId: string }) =>
            candidate.referenceId === reasoningId,
        );
        expect(ref).toBeDefined();
        expect(ref.targetIds).toEqual(
          expectedUnresolved ? referenceIds : expectedIds,
        );
        expect(ref.status).toBe(expectedUnresolved ? "unresolved" : "applied");
      }

      await dialog.getByRole("button", { name: "ダイアログを閉じる" }).click();
      await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
      const undo = page.getByRole("button", {
        name: "直前の訂正を元に戻す",
        exact: true,
      });
      await expect(undo).toBeEnabled();
      await undo.click();
      await expect(page.getByRole("status")).toContainText("元に戻しました");
      await page.getByRole("button", { name: "出力", exact: true }).click();
      const undoDialog = page.getByRole("dialog", { name: "資料を出力する" });
      await undoDialog
        .getByRole("button", { name: "出力内容をプレビュー", exact: true })
        .click();
      const undoParsedEnvelope = JSON.parse(
        (await undoDialog.locator("pre.export-preview").textContent()) ?? "",
      );
      const undoParsed = undoParsedEnvelope.project;
      expect(undoParsed.utterances.map((u: { id: string }) => u.id)).toEqual(
        originalUtteranceIds,
      );
      expect(
        undoParsed.reasoning.evidence.find(
          (e: { id: string }) => e.id === evidenceId,
        ).utteranceIds,
      ).toEqual(originalEvidence.utteranceIds);
      expect(
        undoParsed.reasoning.questionVersions.find(
          (q: { id: string }) => q.id === questionVersionId,
        ).sourceUtteranceIds,
      ).toEqual(originalQuestionVersion.sourceUtteranceIds);
      const undoResponse = undoParsed.reasoning.responses.find(
        (r: { id: string }) => r.id === responseId,
      );
      expect(undoResponse.utteranceIds).toEqual(originalResponse.utteranceIds);
      expect(undoResponse.fulfillment).toBe("fulfilled");
      expect(undoParsed.lineage?.records ?? []).toEqual([]);
      await undoDialog
        .getByRole("button", { name: "ダイアログを閉じる" })
        .click();
      await page
        .getByRole("button", { name: "発言と原文", exact: true })
        .click();
      await expect(
        page.getByRole("button").filter({ hasText: "left right" }).first(),
      ).toBeVisible();
    });
});
