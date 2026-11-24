// ============================================================
// Firebase 설정 — 값은 .env 파일(VITE_FIREBASE_*)에서 불러옵니다.
// 다른 JS 파일에서: import { auth, googleProvider } from "./firebaseConfig.js";
// ============================================================
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey) {
  console.error("[Firebase] .env 파일에 VITE_FIREBASE_* 값을 입력하고 개발 서버를 재시작하세요.");
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" }); // 매번 계정 선택 창 표시

// ---------- 관리자(교사) UID ----------
// .env 의 VITE_ADMIN_UIDS=uid1,uid2,uid3 (쉼표로 구분)
export const ADMIN_UIDS = (import.meta.env.VITE_ADMIN_UIDS || "")
  .split(",")
  .map((uid) => uid.trim())
  .filter(Boolean);

/** 로그인한 사용자가 관리자인지 확인 */
export function isAdmin(user) {
  return !!user && ADMIN_UIDS.includes(user.uid);
}
