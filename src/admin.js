// ============================================================
// 교사 모니터링 페이지 (teacherMonitor.html)
// 관리자 UID로 로그인한 경우에만 접근 가능 — 그 외에는 메인으로 이동
// ============================================================
import { auth, db, storage, isAdmin } from "./firebaseConfig.js";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, getDocs, query, orderBy, doc, deleteDoc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";

const RECORD_LABELS = {
  topic: "탐구 주제",
  hypothesis: "가설",
  method: "탐구 방법",
  data: "데이터",
  analysis: "데이터 분석 (처음)",
  conclusion: "탐구 결론 (처음)",
  reflection: "느낀 점 · 궁금한 점",
};

const state = {
  all: [],                 // 전체 제출 데이터
  checkedDates: new Set(), // 선택된 날짜 (YYYY-MM-DD)
  selectedId: null,
  search: "",
};

const $ = (id) => document.getElementById(id);

// ============================================================
// 권한 확인
// ============================================================
onAuthStateChanged(auth, (user) => {
  if (!isAdmin(user)) {
    location.replace("index.html");
    return;
  }
  $("adminName").textContent = user.displayName || "관리자";
  $("adminEmail").textContent = user.email || "";
  if (user.photoURL) {
    $("adminPhoto").src = user.photoURL;
    $("adminPhoto").hidden = false;
  }
  document.body.classList.remove("auth-pending");
  loadSubmissions();
});

$("logoutBtn").addEventListener("click", () => signOut(auth));
$("refreshBtn").addEventListener("click", () => loadSubmissions());

// ============================================================
// 데이터 불러오기
// ============================================================
async function loadSubmissions() {
  $("dateList").innerHTML = `<p class="empty">불러오는 중...</p>`;
  try {
    const snap = await getDocs(query(collection(db, "submissions"), orderBy("submittedAt", "desc")));
    state.all = snap.docs.map((d) => {
      const data = d.data();
      const date = data.submittedAt?.toDate?.() || new Date(data.submittedAtClient || Date.now());
      return { id: d.id, ...data, _date: date, _day: dayKey(date) };
    });
  } catch (err) {
    console.error(err);
    $("dateList").innerHTML = `<p class="empty error">불러오기 실패: ${esc(err.code || err.message)}</p>`;
    return;
  }

  // 처음 불러올 땐 전체 날짜 선택, 새로고침 시엔 기존 선택 유지 + 새 날짜 추가
  const days = uniqueDays();
  if (state.checkedDates.size === 0) days.forEach((d) => state.checkedDates.add(d));
  else days.filter((d) => !knownDays.has(d)).forEach((d) => state.checkedDates.add(d));
  knownDays = new Set(days);

  if (state.selectedId && !state.all.some((s) => s.id === state.selectedId)) clearDetail();
  renderDates();
  renderList();
}
let knownDays = new Set();

function uniqueDays() {
  return [...new Set(state.all.map((s) => s._day))].sort().reverse();
}

// ============================================================
// 좌측: 날짜 필터
// ============================================================
function renderDates() {
  const days = uniqueDays();
  if (!days.length) {
    $("dateList").innerHTML = `<p class="empty">제출된 데이터가 없어요.</p>`;
    return;
  }
  $("dateList").innerHTML = days
    .map((day) => {
      const count = state.all.filter((s) => s._day === day).length;
      const checked = state.checkedDates.has(day) ? "checked" : "";
      return `<label class="date-item">
        <input type="checkbox" value="${day}" ${checked} />
        <span class="date-text">${formatDay(day)}</span>
        <span class="count-chip">${count}</span>
      </label>`;
    })
    .join("");
}

$("dateList").addEventListener("change", (e) => {
  if (e.target.type !== "checkbox") return;
  if (e.target.checked) state.checkedDates.add(e.target.value);
  else state.checkedDates.delete(e.target.value);
  renderList();
});

$("checkAll").addEventListener("click", () => {
  uniqueDays().forEach((d) => state.checkedDates.add(d));
  renderDates();
  renderList();
});
$("checkNone").addEventListener("click", () => {
  state.checkedDates.clear();
  renderDates();
  renderList();
});

$("searchInput").addEventListener("input", (e) => {
  state.search = e.target.value.trim().toLowerCase();
  renderList();
});

// ============================================================
// 좌측: 제출 데이터 목록 — "이름 (날짜, 시간)"
// ============================================================
function filtered() {
  return state.all.filter((s) => {
    if (!state.checkedDates.has(s._day)) return false;
    if (!state.search) return true;
    return `${s.name} ${s.email}`.toLowerCase().includes(state.search);
  });
}

function renderList() {
  const list = filtered();
  $("subCount").textContent = list.length;

  if (!list.length) {
    $("subList").innerHTML = `<p class="empty">${state.checkedDates.size ? "해당하는 데이터가 없어요." : "날짜를 선택하세요."}</p>`;
    return;
  }

  $("subList").innerHTML = list
    .map((s) => `
      <div class="sub-item ${s.id === state.selectedId ? "active" : ""}" data-id="${s.id}">
        <div class="sub-main">
          <span class="sub-name">${esc(s.name || "이름 없음")}</span>
          <span class="sub-time">(${formatDay(s._day, true)}, ${formatTime(s._date)})</span>
          ${s.updatedAt ? `<span class="edited-chip">수정됨</span>` : ""}
          <span class="sub-email">${esc(s.email || "")}</span>
        </div>
        <button class="icon-btn del" data-del="${s.id}" title="삭제">🗑</button>
      </div>`)
    .join("");
}

$("subList").addEventListener("click", (e) => {
  const delId = e.target.closest("[data-del]")?.dataset.del;
  if (delId) return deleteSubmission(delId);
  const id = e.target.closest(".sub-item")?.dataset.id;
  if (id) selectSubmission(id);
});

// ============================================================
// 가운데 + 우측: 상세 보기
// ============================================================
function selectSubmission(id) {
  const s = state.all.find((x) => x.id === id);
  if (!s) return;
  state.selectedId = id;
  renderList();

  $("detailEmpty").hidden = true;
  $("detailView").hidden = false;
  $("chatPanel").hidden = true;
  $("chatToggle").textContent = "💬 대화 내용 보기";

  $("dName").textContent = s.name || "이름 없음";
  const updated = s.updatedAt?.toDate?.();
  $("dMeta").textContent = `${s.email || ""} · ${formatDay(s._day)} ${formatTime(s._date)} 제출`
    + (updated ? ` · ${formatDay(dayKey(updated), true)} ${formatTime(updated)} 수정` : "");
  $("dGrade").textContent = s.grade ? `${s.grade}학년` : "-";
  $("dDuration").textContent = s.durationText || "-";
  $("dTurns").textContent = `${(s.chatLog || []).filter((m) => m.role === "user").length}회`;
  $("dImages").textContent = `${(s.images || []).length}장`;

  // 실험 기록
  const record = s.record || {};
  $("dRecord").innerHTML = Object.entries(RECORD_LABELS)
    .filter(([key]) => record[key])
    .map(([key, label]) => `<dt>${label}</dt><dd>${esc(record[key])}</dd>`)
    .join("") || `<p class="empty">기록 없음</p>`;

  $("dAnalysis").textContent = s.finalAnalysis || "-";
  $("dConclusion").textContent = s.finalConclusion || "-";

  renderChat(s);
  renderGallery(s);
  $("detailView").parentElement.scrollTop = 0;
}

function renderChat(s) {
  const images = Object.fromEntries((s.images || []).map((img) => [img.id, img]));
  const log = s.chatLog || [];
  $("dChat").innerHTML = log.length
    ? log.map((m) => {
        const who = m.role === "assistant" ? "🤖 AI 연구 도우미" : `🧑‍🔬 ${esc(s.name || "학생")}`;
        const img = m.imageId && images[m.imageId]
          ? `<img src="${safeUrl(images[m.imageId].url)}" class="chat-img" alt="첨부 이미지" />` : "";
        return `<div class="msg ${m.role}">
          <div class="msg-head"><span>${who}</span><span class="mono-sm">${m.at ? formatTime(new Date(m.at), true) : ""}</span></div>
          <div class="msg-body">${esc(m.text || "").replace(/\n/g, "<br>")}</div>${img}
        </div>`;
      }).join("")
    : `<p class="empty">대화 내용이 없어요.</p>`;
}

function renderGallery(s) {
  const images = s.images || [];
  $("gallery").innerHTML = images.length
    ? images.map((img) => `
        <a class="gallery-item" href="${safeUrl(img.url)}" target="_blank" rel="noopener">
          <img src="${safeUrl(img.url)}" alt="${esc(img.kind)}" loading="lazy" />
          <span class="gallery-cap">${img.kind === "data" ? "📋 실험 데이터" : "📈 그래프"} · ${esc(img.id)}</span>
        </a>`).join("")
    : `<p class="empty">올린 사진이 없어요.</p>`;
}

function clearDetail() {
  state.selectedId = null;
  $("detailEmpty").hidden = false;
  $("detailView").hidden = true;
  $("gallery").innerHTML = `<p class="empty">선택된 데이터가 없어요.</p>`;
}

// 대화 내용 접기/펼치기
$("chatToggle").addEventListener("click", () => {
  const open = $("chatPanel").hidden;
  $("chatPanel").hidden = !open;
  $("chatToggle").textContent = open ? "💬 대화 내용 접기" : "💬 대화 내용 보기";
  if (open) $("chatPanel").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("deleteBtn").addEventListener("click", () => {
  if (state.selectedId) deleteSubmission(state.selectedId);
});

// ============================================================
// 삭제 (Storage 이미지 → Firestore 문서)
// ============================================================
async function deleteSubmission(id) {
  const s = state.all.find((x) => x.id === id);
  if (!s) return;
  const label = `${s.name || "이름 없음"} (${formatDay(s._day, true)}, ${formatTime(s._date)})`;
  if (!confirm(`${label} 데이터를 삭제할까요?\n사진과 대화 내용도 함께 삭제되며 되돌릴 수 없어요.`)) return;

  try {
    for (const img of s.images || []) {
      try {
        await deleteObject(ref(storage, img.path));
      } catch (err) {
        if (err.code !== "storage/object-not-found") throw err;
      }
    }
    await deleteDoc(doc(db, "submissions", id));

    state.all = state.all.filter((x) => x.id !== id);
    if (state.selectedId === id) clearDetail();
    renderDates();
    renderList();
    showToast("삭제했어요.");
  } catch (err) {
    console.error(err);
    showToast(`삭제 실패: ${err.code || err.message}`);
  }
}

// ============================================================
// 유틸
// ============================================================
function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDay(day, short = false) {
  const [y, m, d] = day.split("-").map(Number);
  if (short) return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`;
  const week = "일월화수목금토"[new Date(y, m - 1, d).getDay()];
  return `${y}년 ${m}월 ${d}일 (${week})`;
}

function formatTime(date, seconds = false) {
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit", minute: "2-digit", ...(seconds && { second: "2-digit" }), hour12: false,
  });
}

/** Firebase Storage 주소만 허용 (학생이 조작한 주소 차단) */
function safeUrl(url) {
  return /^https:\/\/firebasestorage\.googleapis\.com\//.test(url || "") ? esc(url) : "";
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

let toastTimer;
function showToast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}
