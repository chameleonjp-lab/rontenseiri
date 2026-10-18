import { useState } from "react";
import { createRoot } from "react-dom/client";
import Inspector from "../../src/components/Inspector";
import { reviseSource } from "../../src/domain/project";
import { incomingReturnsFixture } from "../../tests/fixtures/incoming-returns";

/** Browser component host: exercise prop updates without changing selection. */
function IncomingContextHost() {
  const [project, setProject] = useState(incomingReturnsFixture);
  const [error, setError] = useState("");
  function edit(id: string, suffix: string) {
    setProject((current) =>
      reviseSource(
        current,
        id,
        current.utterances.find((u) => u.id === id)!.quote + suffix,
        "コンテキスト更新",
      ),
    );
  }
  return (
    <>
      <button
        onClick={() =>
          setProject((current) => ({
            ...current,
            relations: current.relations.map((r) =>
              r.kind === "return" && r.to === "U10"
                ? {
                    ...r,
                    evidenceIds: r.evidenceIds.filter((id) => id !== "U10"),
                  }
                : r,
            ),
          }))
        }
      >
        対象発言を根拠IDから除く
      </button>
      <button onClick={() => edit("U10", "【対象発言の更新本文】")}>
        対象の本文を更新
      </button>
      <button onClick={() => edit("U09", "【保持線の更新根拠】")}>
        表示中の保持線の根拠を更新
      </button>
      <button onClick={() => edit("U16", "【表示外の更新本文】")}>
        表示外の本文を更新
      </button>
      <output aria-label="更新対象の本文">
        {JSON.stringify(
          project.utterances
            .filter((u) => ["U09", "U16"].includes(u.id))
            .map((u) => ({ id: u.id, quote: u.quote })),
        )}
      </output>
      <output aria-label="現在の関係配列">
        {JSON.stringify(project.relations)}
      </output>
      {error && <p role="alert">{error}</p>}
      <Inspector
        project={project}
        utteranceId="U10"
        onUpdate={setProject}
        onClose={() => {}}
        onTranscript={() => {}}
        onSummary={() => {}}
        onGraph={() => {}}
        onError={setError}
      />
    </>
  );
}

export function mountIncomingContextHost() {
  const app = document.getElementById("root");
  if (app) app.hidden = true;
  const mount = document.createElement("div");
  document.body.append(mount);
  createRoot(mount).render(<IncomingContextHost />);
}
