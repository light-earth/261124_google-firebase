// ============================================================
// OpenAI API 호출 (프런트엔드 직접 호출)
// ============================================================
import { MODEL, REASONING_EFFORT } from "./prompts.js";

const API_BASE = "https://api.openai.com/v1";

/** API Key 유효성 + 모델 사용 가능 여부 확인 */
export async function verifyApiKey(apiKey) {
  const res = await fetch(`${API_BASE}/models/${MODEL}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.ok) return { ok: true };
  const err = await res.json().catch(() => ({}));
  return { ok: false, message: err?.error?.message || `HTTP ${res.status}` };
}

/**
 * 대화 요청
 * @param {string} apiKey
 * @param {Array} messages  [{ role, content }]  content는 문자열 또는 [{type:"text"}, {type:"image_url"}]
 * @returns {Promise<string>} 챗봇 답변
 */
export async function sendChat(apiKey, messages) {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      reasoning_effort: REASONING_EFFORT,
      max_completion_tokens: 4000,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);

  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("답변이 비어 있어요. 다시 시도해 주세요.");
  return text;
}

/** 텍스트 + 이미지(선택)로 메시지 content 만들기 */
export function buildContent(text, imageDataUrl) {
  if (!imageDataUrl) return text;
  return [
    { type: "text", text },
    { type: "image_url", image_url: { url: imageDataUrl } },
  ];
}

/**
 * 이미지 파일 처리
 * - dataUrl: 챗봇 전송용 (JPEG, 최대 1024px — 용량 절약)
 * - pngBlob: Storage 저장용 (PNG, 최대 1600px)
 */
export async function processImage(file) {
  const img = await loadImage(file);
  const dataUrl = drawToCanvas(img, 1024).toDataURL("image/jpeg", 0.85);

  // Storage 규칙: PNG 5MB 이하 → 넘으면 해상도를 줄여 다시 변환
  const MAX_BYTES = 5 * 1024 * 1024;
  let size = 1600;
  let pngBlob;
  do {
    pngBlob = await new Promise((resolve) => drawToCanvas(img, size).toBlob(resolve, "image/png"));
    size = Math.round(size * 0.75);
  } while (pngBlob.size > MAX_BYTES && size >= 300);
  if (pngBlob.size > MAX_BYTES) throw new Error("이미지가 너무 커요. 다른 사진을 올려 주세요.");

  return { dataUrl, pngBlob };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 읽을 수 없어요.")); };
    img.src = url;
  });
}

function drawToCanvas(img, maxSize) {
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}
