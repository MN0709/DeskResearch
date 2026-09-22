export const capabilities = [
  { key: "task_planning", label: "自主拆解与规划", pattern: /自主.{0,8}(拆解|规划|規劃)|拆解.{0,8}(任务|任務)|规划.{0,8}步骤|規劃.{0,8}步驟/u },
  { key: "web_operation", label: "网页检索或操作", pattern: /浏览器|瀏覽器|网页|網頁|网络搜集|網路蒐集|信息检索|資訊檢索|深度调研|深度研究|网络调研/u },
  { key: "local_files", label: "本地文件处理", pattern: /本地.{0,8}(文件|文件夹).{0,20}(处理|操作|读写|整理)|读写本地文件|本機.{0,8}(檔案|資料夾)|电脑.{0,8}文件|電腦.{0,8}檔案|文件夹.{0,8}(读取|整理|处理)|資料夾.{0,8}(建立|整理)|批量文件处理/u },
  { key: "structured_data", label: "表格与数据处理", pattern: /表格|试算表|試算表|Excel|数据处理|資料處理|数据分析|資料分析/u },
  { key: "deliverables", label: "报告与办公成果", pattern: /报告|報告|PPT|演示文稿|簡報|工作成果|交付物|完整成果/u },
  { key: "skills", label: "Skill 或技能扩展", pattern: /Skills?|技能/u },
  { key: "scheduling", label: "定时或周期任务", pattern: /定时任务|排程任務|排程任务|周期性.{0,8}(任务|工作)|自动化.{0,8}(任务|执行)/u },
  { key: "multi_agent", label: "多 Agent 协作", pattern: /多.{0,3}Agent|Agent.{0,3}(集群|團隊|团队)|专家团|專家團|并行.{0,6}(执行|处理|协作)|平行.{0,6}執行/u },
  { key: "permission_control", label: "授权与接管控制", pattern: /权限|權限|授权|授權|敏感操作|接管|終止任務|终止任务/u }
];

function evidenceSnippet(text, match) {
  const start = Math.max(0, match.index - 70);
  const end = Math.min(text.length, match.index + match[0].length + 130);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

export function analyzeProduct(product, fetchedSources, { includeText = false } = {}) {
  const findings = {};
  for (const capability of capabilities) {
    let finding = { found: false, evidence: "", sourceLabel: "", sourceUrl: "" };
    for (const source of fetchedSources) {
      const match = source.text?.match(capability.pattern);
      if (match) {
        finding = {
          found: true,
          evidence: evidenceSnippet(source.text, match),
          sourceLabel: source.label,
          sourceUrl: source.finalUrl ?? source.url
        };
        break;
      }
    }
    findings[capability.key] = finding;
  }
  return {
    product: product.product,
    company: product.company,
    findings,
    sources: includeText ? fetchedSources : fetchedSources.map(({ text, ...source }) => source)
  };
}

export function evidenceSignature(evidence) {
  return evidence.products.map((product) => ({
    product: product.product,
    capabilities: capabilities.map((capability) => Boolean(product.findings[capability.key]?.found))
  }));
}
