const stopWords = new Set(["我们", "你们", "他们", "这个", "那个", "以及", "进行", "相关", "一个", "一种", "可以", "已经", "需要", "通过", "提供", "支持", "官方", "页面", "产品", "功能", "使用", "工作", "任务", "信息"]);
const negativePatterns = /不支持|不提供|不能|不可|禁止|收费|付费|下线|停止|取消|unavailable|does not|cannot|isn't|is not/iu;
const positivePatterns = /支持|提供|能够|允许|免费|上线|发布|available|supports|can|launched/iu;

function tokens(text) {
  const latin = text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  const chinese = [];
  for (const run of text.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    if (run.length <= 8) chinese.push(run);
    for (let index = 0; index < run.length - 1; index += 1) chinese.push(run.slice(index, index + 2));
  }
  return [...new Set([...latin, ...chinese].filter((word) => !stopWords.has(word)))];
}

function sentences(text) {
  return text
    .split(/[。！？!?；;\n.]+/u)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 28 && item.length <= 240)
    .filter((item) => !/^(首页|导航|菜单|登录|注册|隐私|版权|cookie)/iu.test(item))
    .filter((item) => (item.match(/立即|下载|小程序|公众号|服务条款|用户协议|隐私协议|登录|注册/gu) ?? []).length < 2);
}

function similarity(left, right) {
  const leftSet = new Set(tokens(left));
  const rightSet = new Set(tokens(right));
  const shared = [...leftSet].filter((item) => rightSet.has(item)).length;
  return shared / Math.max(1, Math.min(leftSet.size, rightSet.size));
}

function polarity(text) {
  if (negativePatterns.test(text)) return -1;
  if (positivePatterns.test(text)) return 1;
  return 0;
}

export function analyzeResearchEvidence(prompt, pages) {
  const promptTokens = tokens(prompt);
  const sources = pages.map((page, index) => ({
    id: `S${index + 1}`,
    title: page.title || page.label,
    label: page.label,
    url: page.finalUrl || page.url,
    requestedUrl: page.requestedUrl || page.url,
    status: page.status,
    fetchedAt: page.fetchedAt,
    textLength: page.textLength ?? 0
  }));
  const claims = [];
  for (let sourceIndex = 0; sourceIndex < pages.length; sourceIndex += 1) {
    const page = pages[sourceIndex];
    const ranked = sentences(page.text ?? "").map((text) => ({
      text,
      score: promptTokens.reduce((total, word) => total + (text.toLowerCase().includes(word.toLowerCase()) ? 3 : 0), 0)
        + (text.length >= 45 && text.length <= 170 ? 2 : 0)
    })).filter((candidate) => candidate.score >= 3).sort((left, right) => right.score - left.score);
    let sourceClaimCount = 0;
    for (const candidate of ranked) {
      if (claims.some((claim) => similarity(claim.text, candidate.text) > 0.82)) continue;
      claims.push({
        id: `C${claims.length + 1}`,
        text: candidate.text,
        sourceIds: [`S${sourceIndex + 1}`],
        citation: `[S${sourceIndex + 1}]`,
        extraction: "网页原文摘录"
      });
      sourceClaimCount += 1;
      if (sourceClaimCount >= 2 || claims.length >= 16) break;
    }
  }

  const conflicts = [];
  for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
      const left = claims[leftIndex];
      const right = claims[rightIndex];
      if (left.sourceIds[0] === right.sourceIds[0]) continue;
      const leftPolarity = polarity(left.text);
      const rightPolarity = polarity(right.text);
      if (leftPolarity * rightPolarity !== -1 || similarity(left.text, right.text) < 0.25) continue;
      conflicts.push({
        id: `X${conflicts.length + 1}`,
        claimA: left.id,
        claimB: right.id,
        reason: "相近主题出现相反表述，建议人工核对适用范围和发布日期"
      });
      if (conflicts.length >= 8) break;
    }
    if (conflicts.length >= 8) break;
  }

  return {
    prompt,
    claims,
    sources,
    conflicts,
    methodology: "按任务关键词从已确认网页中抽取相关原文句子，并对跨来源的相反措辞进行提示",
    limitation: "冲突检测是词面提示，不代表事实裁决；原文摘录仍需结合页面上下文复核"
  };
}
