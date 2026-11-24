// ============================================================
// 챗봇 프롬프트 설정 파일 — 세부 프롬프트는 여기서 조절하세요.
// ============================================================

// GPT-5 계열 경량 모델 (더 가볍게: "gpt-5-nano")
export const MODEL = "gpt-5-mini";

// 추론 강도: "minimal" | "low" | "medium" | "high" (낮을수록 빠름)
export const REASONING_EFFORT = "low";

// 실험 기록 항목 이름 (프롬프트에 들어갈 라벨)
const LABELS = {
  topic: "탐구 주제",
  hypothesis: "가설",
  method: "탐구 방법",
  data: "데이터",
  analysis: "데이터 분석",
  conclusion: "탐구 결론",
  reflection: "느낀 점 · 궁금한 점",
};

/** 학생 실험 기록을 텍스트로 정리 */
export function formatRecord(record) {
  return Object.entries(LABELS)
    .filter(([key]) => record[key])
    .map(([key, label]) => `- ${label}: ${record[key]}`)
    .join("\n");
}

/** 시스템 프롬프트 (챗봇의 역할) */
export function buildSystemPrompt(grade) {
  return `당신은 초등학교 ${grade}학년 학생의 과학 탐구를 돕는 친절한 "AI 연구 도우미"입니다.

[역할]
- 학생이 스스로 데이터를 분석하고 결론을 내릴 수 있도록 질문으로 안내합니다.
- 정답이나 완성된 결론을 대신 써 주지 않습니다.
- 데이터에서 규칙, 변화, 비교할 점을 찾도록 힌트를 줍니다.
- 가설과 데이터가 맞는지 스스로 비교해 보도록 이끕니다.

[말투]
- ${grade}학년 학생이 이해할 수 있는 쉬운 말과 존댓말을 사용합니다.
- 한 번에 3~5문장 정도로 짧게 답하고, 질문은 한 번에 1개만 합니다.
- 잘한 점을 먼저 칭찬합니다.`;
}

/** 대화 시작 시 학생 기록을 전달하는 첫 메시지 */
export function buildIntroMessage(record) {
  return `제가 한 실험 기록이에요.

${formatRecord(record)}

이 실험의 데이터를 분석하는 걸 도와주세요.`;
}

/** 그래프 해석 요청 프롬프트 */
export const GRAPH_PROMPT = `이 그래프(또는 데이터 사진)를 해석하는 걸 도와주세요.
1) 그래프에서 무엇을 나타내는지(가로축, 세로축 등) 쉽게 설명해 주세요.
2) 눈에 띄는 변화나 규칙이 무엇인지 힌트를 주세요.
3) 제 가설과 비교해 볼 수 있도록 질문을 하나 해 주세요.`;
