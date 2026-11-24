// ============================================================
// 학생 활동 관리 (student.html)
// 흐름: 로그인 확인 → 학년 선택 → 실험 기록(3~7턴) → API Key 확인
//       → 챗봇 대화/그래프 해석 → 최종 수정 → 제출(Firestore + Storage)
// ============================================================
import { auth, db, storage } from "./firebaseConfig.js";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { verifyApiKey, sendChat, buildContent, processImage } from "./chatbot.js";
import { MODEL, buildSystemPrompt, buildIntroMessage, GRAPH_PROMPT } from "./prompts.js";

// ---------- 실험 기록 턴 정의 ----------
const TURNS = [
  { key: "topic", label: "탐구 주제", required: true,
    q: "어떤 실험을 했나요? 탐구 주제를 적어 주세요.",
    ph: "예) 물의 온도에 따라 설탕이 녹는 빠르기는 어떻게 달라질까?" },
  { key: "hypothesis", label: "가설", required: true,
    q: "실험 전에 어떤 결과가 나올 거라고 예상했나요?",
    ph: "예) 물의 온도가 높을수록 설탕이 더 빨리 녹을 것이다." },
  { key: "method", label: "탐구 방법", required: true,
    q: "실험을 어떻게 했나요? 준비물과 순서를 적어 주세요.",
    ph: "예) 10℃, 30℃, 50℃ 물 100mL에 각각 설탕 1숟가락을 넣고 다 녹는 시간을 쟀다." },
  { key: "data", label: "데이터", image: true,
    q: "실험에서 얻은 데이터(측정값, 관찰 내용)를 적어 주세요. 표나 그래프 사진을 올려도 좋아요.",
    ph: "예) 10℃: 95초, 30℃: 52초, 50℃: 21초" },
  { key: "analysis", label: "데이터 분석",
    q: "데이터를 보고 알게 된 점은 무엇인가요?",
    ph: "예) 온도가 높아질수록 녹는 시간이 줄어들었다." },
  { key: "conclusion", label: "탐구 결론",
    q: "실험의 결론은 무엇인가요? 가설이 맞았나요?",
    ph: "예) 물의 온도가 높을수록 설탕이 빨리 녹는다. 가설이 맞았다." },
  { key: "reflection", label: "느낀 점 · 궁금한 점",
    q: "실험을 하며 느낀 점이나 더 궁금해진 점이 있나요?",
    ph: "예) 소금도 같은 결과가 나올지 궁금하다." },
];
const MIN_TURNS = 3;

// ---------- 상태 ----------
const state = {
  user: null,
  grade: null,
  apiKey: null,
  turn: 0,
  record: {},
  dataImage: null,   // 데이터 턴 이미지 { dataUrl, pngBlob }
  graphImage: null,  // 챗봇 패널에 첨부한 그래프 이미지 { dataUrl, pngBlob }
  chatStarted: false,
  messages: [],      // OpenAI로 보내는 대화 기록
  chatLog: [],       // Firestore 저장용 대화 기록 { role, text, imageId, at }
  images: [],        // Storage 업로드 대상 { id, kind, pngBlob }
  firstSentAt: null, // 첫 대화 전송 시각 (ms)
  busy: false,
  submitted: false,
  mode: "new",       // "new": 첫 제출 / "edit": 제출 완료 → 분석·결론만 수정
  submittedAt: null,
  updatedAt: null,
};

const $ = (id) => document.getElementById(id);

// ============================================================
// 0. 로그인 확인 + 상단 사용자 정보
// ============================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("index.html");
    return;
  }
  state.user = user;
  $("userName").textContent = user.displayName || "이름 없음";
  $("userEmail").textContent = user.email || "";
  if (user.photoURL) {
    $("userPhoto").src = user.photoURL;
    $("userPhoto").hidden = false;
  }

  // 1인 1회 제출: 이미 제출했다면 수정 모드로 전환
  try {
    const snap = await getDoc(doc(db, "submissions", user.uid));
    if (snap.exists()) enterEditMode(snap.data());
  } catch (err) {
    console.error(err);
    showToast(`제출 기록을 확인하지 못했어요: ${err.code || err.message}`);
  }
  document.body.classList.remove("auth-pending");
});

/** 제출 완료 상태 → 데이터 분석·탐구 결론만 수정 가능 */
function enterEditMode(data, fromSubmit = false) {
  state.mode = "edit";
  state.submitted = true;
  state.submittedAt = toDate(data.submittedAt);
  state.updatedAt = toDate(data.updatedAt);

  if (!fromSubmit) {
    // 페이지를 다시 연 경우: 기록·챗봇 영역은 숨기고 수정란만 표시
    ["keySection", "gradeSection", "recordSection", "chatSection"].forEach((id) => ($(id).hidden = true));
    $("finalAnalysis").value = data.finalAnalysis || "";
    $("finalConclusion").value = data.finalConclusion || "";
  }
  $("finalSection").hidden = false;
  $("finalTitle").textContent = "제출 완료 · 데이터 분석과 결론 수정";
  $("submitBtn").textContent = "수정 저장";
  $("submitBtn").disabled = false;
  renderEditNotice();
  setBusy(false);
}

function renderEditNotice() {
  const sub = state.submittedAt ? fmtDateTime(state.submittedAt) : "";
  const upd = state.updatedAt ? ` · 마지막 수정 ${fmtDateTime(state.updatedAt)}` : "";
  $("editNotice").textContent =
    `✅ ${sub} 제출 완료${upd}\n제출은 한 번만 할 수 있어요. 데이터 분석과 탐구 결론은 계속 수정할 수 있어요.`;
  $("editNotice").hidden = false;
}

function toDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  return v instanceof Date ? v : new Date(v);
}

function fmtDateTime(d) {
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

$("logoutBtn").addEventListener("click", () => signOut(auth));

// ============================================================
// 1. 학년 선택
// ============================================================
document.querySelectorAll(".grade-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (state.chatStarted) return;
    document.querySelectorAll(".grade-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.grade = Number(btn.dataset.grade);
    $("gradeLabel").textContent = `${state.grade}학년`;
    $("recordSection").hidden = false;
    renderTurn();
  });
});

// ============================================================
// 2. 실험 기록 (턴 방식)
// ============================================================
function renderTurn() {
  const done = state.turn >= TURNS.length;
  const t = TURNS[state.turn];

  $("turnCounter").textContent = `TURN ${Math.min(state.turn + 1, TURNS.length)} / ${TURNS.length}`;
  $("turnProgress").style.width = `${(state.turn / TURNS.length) * 100}%`;

  $("turnBox").hidden = done || state.chatStarted;
  $("turnDone").hidden = !done || state.chatStarted;

  if (!done) {
    $("turnLabel").textContent = t.label + (t.required ? " (필수)" : " (선택)");
    $("turnQuestion").textContent = t.q;
    $("turnInput").placeholder = t.ph;
    $("turnInput").value = state.record[t.key] || "";
    $("turnImageWrap").hidden = !t.image;
    $("skipBtn").hidden = t.required;
    $("turnInput").focus();
  }
  updateStartButton();
}

function handleNext(skip = false) {
  const t = TURNS[state.turn];
  const value = $("turnInput").value.trim();

  if (!skip) {
    const hasImage = t.image && state.dataImage;
    if (!value && !hasImage) {
      showToast(`'${t.label}'을(를) 입력해 주세요.`);
      return;
    }
    state.record[t.key] = value || "(이미지 첨부)";
  } else if (t.image) {
    state.dataImage = null; // 건너뛰면 이미지도 버림
  }
  addRecordLog(t, skip ? null : state.record[t.key]);
  state.turn++;
  renderTurn();
}

function addRecordLog(t, value) {
  const item = document.createElement("div");
  item.className = "log-item" + (value ? "" : " skipped");
  item.innerHTML = `<span class="log-label">${t.label}</span><p></p>`;
  item.querySelector("p").textContent = value || "건너뜀";
  if (t.image && state.dataImage && value) {
    const img = document.createElement("img");
    img.src = state.dataImage.dataUrl;
    img.className = "log-img";
    item.appendChild(img);
  }
  $("recordLog").appendChild(item);
}

$("nextBtn").addEventListener("click", () => handleNext(false));
$("skipBtn").addEventListener("click", () => handleNext(true));
$("turnInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleNext(false);
});

$("turnImage").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    state.dataImage = await processImage(file);
    $("turnImagePreview").src = state.dataImage.dataUrl;
    $("turnImagePreview").hidden = false;
  } catch (err) {
    showToast(err.message);
  }
});

// ============================================================
// 3. OpenAI API Key 확인
// ============================================================
async function checkKey(key, silent = false) {
  $("keyStatus").textContent = "확인 중...";
  $("keyStatus").className = "status-chip pending";
  try {
    const result = await verifyApiKey(key);
    if (!result.ok) throw new Error(result.message);
    state.apiKey = key;
    sessionStorage.setItem("openai_key", key);
    $("keyStatus").textContent = `● 연결됨 · ${MODEL}`;
    $("keyStatus").className = "status-chip";
    $("keyInput").value = "";
    $("keyInput").placeholder = "sk-••••••••  (확인 완료)";
    if (!silent) showToast("API Key가 확인되었어요!");
  } catch (err) {
    state.apiKey = null;
    sessionStorage.removeItem("openai_key");
    $("keyStatus").textContent = "● 연결 안 됨";
    $("keyStatus").className = "status-chip error";
    if (!silent) showToast(`API Key 확인 실패: ${err.message}`);
  }
  updateStartButton();
}

$("keyBtn").addEventListener("click", () => {
  const key = $("keyInput").value.trim();
  if (!key) return showToast("API Key를 입력해 주세요.");
  checkKey(key);
});

// ============================================================
// 4. 챗봇 대화 시작
// ============================================================
function updateStartButton() {
  const enoughTurns = state.turn >= MIN_TURNS;
  const keyOk = !!state.apiKey;

  // API Key가 확인되어야 챗봇 기능(시작 버튼)이 나타남
  $("startArea").hidden = !keyOk || state.chatStarted;
  $("startBtn").disabled = !enoughTurns;
  $("startHint").textContent = enoughTurns
    ? "기록을 마쳤다면 챗봇과 대화를 시작해 보세요."
    : `최소 ${MIN_TURNS}턴(주제·가설·방법)을 기록하면 시작할 수 있어요. (현재 ${state.turn}턴)`;
  $("keyNeeded").hidden = keyOk || state.chatStarted;
}

$("startBtn").addEventListener("click", async () => {
  if (!state.apiKey || state.turn < MIN_TURNS || state.chatStarted) return;

  state.chatStarted = true;
  state.firstSentAt = Date.now(); // ⏱ 첫 대화 전송 시각
  renderTurn();
  $("chatSection").hidden = false;
  $("finalSection").hidden = false;

  // 최종 수정란에 기존 기록 채워 넣기
  $("finalAnalysis").value = state.record.analysis || "";
  $("finalConclusion").value = state.record.conclusion || "";

  // 대화 초기화: 시스템 프롬프트 + 학생 기록(+데이터 이미지)
  const intro = buildIntroMessage(state.record);
  const imageId = state.dataImage ? registerImage("data", state.dataImage.pngBlob) : null;
  state.messages = [
    { role: "system", content: buildSystemPrompt(state.grade) },
    { role: "user", content: buildContent(intro, state.dataImage?.dataUrl) },
  ];
  logChat("user", intro, imageId);
  addBubble("user", "📋 실험 기록을 챗봇에게 전달했어요.", state.dataImage?.dataUrl);
  $("chatSection").scrollIntoView({ behavior: "smooth" });
  await requestReply();
});

// ============================================================
// 5. 챗봇 대화 & 그래프 해석
// ============================================================
async function requestReply() {
  setBusy(true);
  const typing = addBubble("bot", "생각하는 중...");
  typing.classList.add("typing");
  try {
    const reply = await sendChat(state.apiKey, state.messages);
    state.messages.push({ role: "assistant", content: reply });
    logChat("assistant", reply);
    typing.remove();
    addBubble("bot", reply);
  } catch (err) {
    typing.remove();
    addBubble("error", `오류가 발생했어요: ${err.message}`);
    // 첫 소개 메시지는 남겨 두고, 이후 실패한 질문만 기록에서 제거
    if (state.messages.length > 2) {
      state.messages.pop();
      state.chatLog.pop();
    }
  } finally {
    setBusy(false);
  }
}

async function sendUserMessage(text, image = null, kind = "graph") {
  if (state.busy || state.submitted) return;
  const imageId = image ? registerImage(kind, image.pngBlob) : null;
  state.messages.push({ role: "user", content: buildContent(text, image?.dataUrl) });
  logChat("user", text, imageId);
  addBubble("user", text, image?.dataUrl);
  await requestReply();
}

$("chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("chatInput").value.trim();
  if (!text) return;
  $("chatInput").value = "";
  sendUserMessage(text);
});
$("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("chatForm").requestSubmit();
  }
});

// 그래프 이미지 첨부
$("graphImage").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    state.graphImage = await processImage(file);
    $("graphPreview").src = state.graphImage.dataUrl;
    $("graphPreviewWrap").hidden = false;
    $("graphBtn").disabled = false;
  } catch (err) {
    showToast(err.message);
  }
});

// 그래프 해석 요청 (첨부 없으면 데이터 턴의 이미지 사용)
$("graphBtn").addEventListener("click", () => {
  const usingAttached = !!state.graphImage;
  const image = state.graphImage || state.dataImage;
  if (!image) return showToast("해석할 그래프 이미지를 먼저 올려 주세요.");
  const extra = $("chatInput").value.trim();
  $("chatInput").value = "";
  const text = extra ? `${GRAPH_PROMPT}\n\n추가 질문: ${extra}` : GRAPH_PROMPT;
  // 데이터 이미지를 다시 쓰는 경우엔 Storage에 중복 저장하지 않음
  if (usingAttached) sendUserMessage(text, image, "graph");
  else sendDataImageAgain(text);
  clearGraph();
});

async function sendDataImageAgain(text) {
  if (state.busy || state.submitted) return;
  const dataId = state.images.find((i) => i.kind === "data")?.id || null;
  state.messages.push({ role: "user", content: buildContent(text, state.dataImage.dataUrl) });
  logChat("user", text, dataId);
  addBubble("user", text, state.dataImage.dataUrl);
  await requestReply();
}

function clearGraph() {
  state.graphImage = null;
  $("graphImage").value = "";
  $("graphPreviewWrap").hidden = true;
  $("graphBtn").disabled = !state.dataImage;
}
$("graphClear").addEventListener("click", clearGraph);

// ---------- 기록 도우미 ----------
function registerImage(kind, pngBlob) {
  const id = `${kind}-${state.images.length + 1}`;
  state.images.push({ id, kind, pngBlob });
  return id;
}

function logChat(role, text, imageId = null) {
  state.chatLog.push({ role, text, imageId, at: new Date().toISOString() });
}

// ---------- 말풍선 ----------
function addBubble(type, text, imageSrc = null) {
  const wrap = document.createElement("div");
  wrap.className = `bubble ${type}`;
  if (type === "bot") {
    wrap.innerHTML = `<span class="bubble-name">🤖 AI 연구 도우미</span>`;
  }
  const body = document.createElement("div");
  body.className = "bubble-body";
  body.innerHTML = renderText(text);
  wrap.appendChild(body);
  if (imageSrc) {
    const img = document.createElement("img");
    img.src = imageSrc;
    img.className = "bubble-img";
    wrap.appendChild(img);
  }
  $("chatLog").appendChild(wrap);
  $("chatLog").scrollTop = $("chatLog").scrollHeight;
  return wrap;
}

/** 간단한 마크다운(**굵게**, 줄바꿈) 렌더링 — HTML은 이스케이프 */
function renderText(text) {
  const escaped = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function setBusy(busy) {
  state.busy = busy;
  $("chatSend").disabled = busy || state.submitted;
  $("graphBtn").disabled = busy || state.submitted || !(state.graphImage || state.dataImage);
}

// ============================================================
// 6. 최종 수정 & 제출 (Storage 이미지 업로드 → Firestore 저장)
// ============================================================
$("submitBtn").addEventListener("click", async () => {
  if (state.busy) return;
  const analysis = $("finalAnalysis").value.trim();
  const conclusion = $("finalConclusion").value.trim();
  if (!analysis || !conclusion) return showToast("데이터 분석과 탐구 결론을 모두 입력해 주세요.");

  const btn = $("submitBtn");
  const editing = state.mode === "edit";
  if (!editing && !confirm("제출은 한 번만 할 수 있어요.\n제출 후에는 데이터 분석과 탐구 결론만 수정할 수 있어요. 제출할까요?")) return;

  btn.disabled = true;
  btn.textContent = editing ? "저장 중..." : "제출 중...";

  try {
    if (editing) {
      // 수정: 분석·결론 + 수정 시각만 변경 (보안 규칙과 일치)
      await updateDoc(doc(db, "submissions", state.user.uid), {
        finalAnalysis: analysis,
        finalConclusion: conclusion,
        updatedAt: serverTimestamp(),
      });
      state.updatedAt = new Date();
      renderEditNotice();
      showToast("수정 내용을 저장했어요!");
    } else {
      await submitReport(analysis, conclusion);
      enterEditMode({ submittedAt: new Date() }, true);
      showToast("제출이 완료되었어요!");
    }
  } catch (err) {
    console.error(err);
    showToast(`${editing ? "저장" : "제출"}에 실패했어요: ${err.code || err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = state.mode === "edit" ? "수정 저장" : "제출하기";
  }
});

async function submitReport(finalAnalysis, finalConclusion) {
  const user = state.user;
  const submittedAt = Date.now();
  const durationSec = Math.round((submittedAt - state.firstSentAt) / 1000);

  // 문서 ID = 학생 UID (1인 1회 제출, 보안 규칙에서 강제)
  const docRef = doc(db, "submissions", user.uid);

  // 1) 이미지 PNG 업로드 → submissions/{uid}/{문서ID}/{imageId}.png
  const images = [];
  for (const img of state.images) {
    const path = `submissions/${user.uid}/${docRef.id}/${img.id}.png`;
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, img.pngBlob, { contentType: "image/png" });
    images.push({ id: img.id, kind: img.kind, path, url: await getDownloadURL(fileRef) });
  }

  // 2) Firestore 저장
  await setDoc(docRef, {
    uid: user.uid,
    name: user.displayName || "",
    email: user.email || "",
    grade: state.grade,
    record: state.record,
    finalAnalysis,
    finalConclusion,
    chatLog: state.chatLog,          // 전체 대화 내용 (이미지는 imageId로 연결)
    images,
    model: MODEL,
    firstSentAt: new Date(state.firstSentAt).toISOString(),
    submittedAtClient: new Date(submittedAt).toISOString(),
    submittedAt: serverTimestamp(),
    durationSec,                     // 첫 대화 전송 ~ 제출까지 걸린 시간(초)
    durationText: formatDuration(durationSec),
  });
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h && `${h}시간`, (h || m) && `${m}분`, `${s}초`].filter(Boolean).join(" ");
}

// ============================================================
// 공통: 토스트 알림
// ============================================================
let toastTimer;
function showToast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

// ---------- 초기화: 이번 세션에 저장된 키가 있으면 자동 확인 ----------
const savedKey = sessionStorage.getItem("openai_key");
if (savedKey) checkKey(savedKey, true);
updateStartButton();
