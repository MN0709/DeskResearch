import assert from "node:assert/strict";
import http from "node:http";
import { synthesizeResearch, validateSynthesis } from "./lib/llm-synthesis.mjs";

const research = {
  prompt: "比较产品能力",
  claims: [
    { id: "C1", text: "产品支持生成带来源的研究报告", sourceIds: ["S1"] },
    { id: "C2", text: "产品支持导出可编辑表格", sourceIds: ["S2"] }
  ]
};

const validated = validateSynthesis({
  summary: "两项能力均有证据支持。",
  findings: [
    { text: "可生成研究报告。", evidenceIds: ["C1", "C999"], confidence: "high" },
    { text: "这条没有真实证据。", evidenceIds: ["C999"], confidence: "high" }
  ],
  conflicts: []
}, research, "mock-model");
assert.equal(validated.findings.length, 1);
assert.deepEqual(validated.findings[0].sourceIds, ["S1"]);
assert.equal(validated.findings[0].citation, "[S1]");

assert.throws(() => validateSynthesis({ findings: [{ text: "伪造结论", evidenceIds: ["C999"] }] }, research, "mock-model"), /没有可校验/);

const server = http.createServer((request, response) => {
  assert.equal(request.url, "/v1/chat/completions");
  assert.equal(request.headers.authorization, "Bearer test-key");
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({
    choices: [{ message: { content: "```json\n{\"summary\":\"完成\",\"findings\":[{\"text\":\"支持可编辑表格\",\"evidenceIds\":[\"C2\"],\"confidence\":\"medium\"}],\"conflicts\":[]}\n```" } }]
  }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  const result = await synthesizeResearch(research, {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "mock-model",
    apiKey: "test-key"
  });
  assert.equal(result.status, "completed");
  assert.equal(result.findings[0].citation, "[S2]");
} finally {
  server.close();
}

console.log(JSON.stringify({ passed: true, checks: ["invalid citations dropped", "invalid-only rejected", "compatible endpoint parsed"] }));
