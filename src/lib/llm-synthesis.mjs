function stripCodeFence(value) {
  return String(value || "").trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
}

function parseJsonObject(value) {
  const cleaned = stripCodeFence(value);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("模型没有返回有效 JSON");
  }
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

export function validateSynthesis(raw, research, model) {
  const evidenceById = new Map(research.claims.map((claim) => [claim.id, claim]));
  const findings = [];
  for (const item of Array.isArray(raw?.findings) ? raw.findings : []) {
    const evidenceIds = [...new Set((Array.isArray(item?.evidenceIds) ? item.evidenceIds : []).filter((id) => evidenceById.has(id)))];
    const text = cleanText(item?.text, 500);
    if (!text || evidenceIds.length === 0) continue;
    const sourceIds = [...new Set(evidenceIds.flatMap((id) => evidenceById.get(id).sourceIds))];
    findings.push({
      id: `F${findings.length + 1}`,
      text,
      evidenceIds,
      sourceIds,
      citation: sourceIds.map((id) => `[${id}]`).join(" "),
      confidence: ["high", "medium", "low"].includes(item?.confidence) ? item.confidence : "medium"
    });
    if (findings.length >= 10) break;
  }
  if (findings.length === 0) throw new Error("模型结果没有可校验的证据引用");
  const conflicts = [];
  for (const item of Array.isArray(raw?.conflicts) ? raw.conflicts : []) {
    const evidenceIds = [...new Set((Array.isArray(item?.evidenceIds) ? item.evidenceIds : []).filter((id) => evidenceById.has(id)))];
    const text = cleanText(item?.text, 400);
    if (!text || evidenceIds.length < 2) continue;
    const sourceIds = [...new Set(evidenceIds.flatMap((id) => evidenceById.get(id).sourceIds))];
    conflicts.push({
      id: `LX${conflicts.length + 1}`,
      text,
      evidenceIds,
      sourceIds,
      citation: sourceIds.map((id) => `[${id}]`).join(" ")
    });
    if (conflicts.length >= 6) break;
  }
  return {
    status: "completed",
    model,
    summary: cleanText(raw?.summary, 1200),
    findings,
    conflicts,
    guardrail: "每条模型结论必须引用已抽取证据；无有效证据编号的内容已自动丢弃"
  };
}

export async function synthesizeResearch(research, config = {}) {
  const baseUrl = String(config.baseUrl || process.env.DESKRESEARCH_LLM_BASE_URL || "").replace(/\/$/, "");
  const model = String(config.model || process.env.DESKRESEARCH_LLM_MODEL || "");
  const apiKey = String(config.apiKey || process.env.DESKRESEARCH_LLM_API_KEY || "");
  if (!baseUrl || !model || !apiKey) return { status: "not_configured", findings: [], conflicts: [] };
  const evidence = research.claims.map((claim) => ({ id: claim.id, sourceIds: claim.sourceIds, text: claim.text }));
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: "你是审慎的研究分析员。只能根据用户提供的证据作答，不得补充外部知识。输出单个 JSON 对象，不要 Markdown。每条 finding 必须包含至少一个真实 evidenceIds。无法由证据支持的结论不要输出。"
        },
        {
          role: "user",
          content: JSON.stringify({
            task: research.prompt,
            evidence,
            requiredSchema: {
              summary: "不超过300字的总体总结",
              findings: [{ text: "综合结论", evidenceIds: ["C1"], confidence: "high|medium|low" }],
              conflicts: [{ text: "需要人工复核的分歧", evidenceIds: ["C1", "C2"] }]
            }
          })
        }
      ]
    }),
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) throw new Error(`模型接口返回 HTTP ${response.status}：${(await response.text()).slice(0, 300)}`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  return validateSynthesis(parseJsonObject(content), research, model);
}
