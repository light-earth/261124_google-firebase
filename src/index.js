// ============================================================
// 메인 페이지 로그인 관리 (index.html)
// Google 로그인을 해야만 학생 활동 / 교사 모니터링 버튼이 보입니다.
// ============================================================
import { auth, googleProvider, isAdmin } from "./firebaseConfig.js";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

const $ = (id) => document.getElementById(id);

// 로그인
$("loginBtn").addEventListener("click", async () => {
  $("loginBtn").disabled = true;
  $("loginError").hidden = true;
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
      $("loginError").textContent = `로그인에 실패했어요. (${err.code || err.message})`;
      $("loginError").hidden = false;
    }
  } finally {
    $("loginBtn").disabled = false;
  }
});

// 로그아웃
$("logoutBtn").addEventListener("click", () => signOut(auth));

// 로그인 상태에 따라 화면 전환
onAuthStateChanged(auth, (user) => {
  const loggedIn = !!user;
  $("loginSection").hidden = loggedIn;
  $("roleSection").hidden = !loggedIn;
  $("userBox").hidden = !loggedIn;
  $("statusChip").hidden = loggedIn;

  if (user) {
    $("userName").textContent = user.displayName || user.email;
    $("userPhoto").src = user.photoURL || "";
    $("userPhoto").hidden = !user.photoURL;
    $("welcomeName").textContent = user.displayName || "탐구자";
    // 관리자 UID인 경우에만 교사 모니터링 카드 표시
    $("teacherCard").hidden = !isAdmin(user);
    // UID 확인용 (관리자 등록 시 콘솔에서 복사)
    console.log("[로그인 UID]", user.uid);
  }
});
