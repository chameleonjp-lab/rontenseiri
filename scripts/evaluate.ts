#!/usr/bin/env node
/* Node 24 can execute this TypeScript-flavoured, type-free module with --experimental-strip-types. */
import { readFileSync, writeFileSync } from "node:fs";
import {
  evaluateSuite,
  renderEvaluationMarkdown,
} from "../src/evaluation/metrics.ts";

const args = process.argv.slice(2);
const input = args[0] || "evals/cases.json";
const output = args[1] || "evaluation-result.json";
const markdown = args[2] || "evaluation-result.md";
const predictionFile = args[3];
const dataset = JSON.parse(readFileSync(input, "utf8"));
const raw = predictionFile
  ? JSON.parse(readFileSync(predictionFile, "utf8"))
  : [];
const predictions = Array.isArray(raw) ? raw : raw?.predictions || [];
const result = evaluateSuite(dataset, predictions);
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(markdown, renderEvaluationMarkdown(result));
console.log(
  JSON.stringify({
    status: result.status,
    caseCount: result.caseCount,
    measuredCaseCount: result.measuredCaseCount,
    output,
    markdown,
  }),
);
