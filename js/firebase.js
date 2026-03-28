  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  import { getFirestore, doc, setDoc, getDoc, deleteDoc, collection, getDocs, query, orderBy, limit,
           enableIndexedDbPersistence }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
  import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

  const firebaseConfig = {
    apiKey: "AIzaSyDIrVL0Dqxs8vXMPAJDiEVoL-ELkahz3aA",
    authDomain: "lexon-c4f76.firebaseapp.com",
    projectId: "lexon-c4f76",
    storageBucket: "lexon-c4f76.firebasestorage.app",
    messagingSenderId: "559467320984",
    appId: "1:559467320984:web:dcc9570790b1d54fba22ed"
  };

  const app  = initializeApp(firebaseConfig);
  const db   = getFirestore(app);
  const auth = getAuth(app);

  // ── Firestore offline persistence — tự cache tất cả reads/writes ──
  // Khi offline: reads từ cache, writes vào queue → tự sync khi có mạng lại
  enableIndexedDbPersistence(db).catch(err => {
    if (err.code === 'failed-precondition') {
      // Nhiều tab mở cùng lúc — chỉ 1 tab được persistence
      console.warn('[Firestore] Persistence failed: multiple tabs open');
    } else if (err.code === 'unimplemented') {
      // Browser không hỗ trợ
      console.warn('[Firestore] Persistence not supported in this browser');
    }
  });

  // Gán ra window
  window._db          = db;
  window._auth        = auth;
  window._doc         = doc;
  window._setDoc      = setDoc;
  window._getDoc      = getDoc;
  window._deleteDoc   = deleteDoc;
  window._collection  = collection;
  window._getDocs     = getDocs;
  window._query       = query;
  window._orderBy     = orderBy;
  window._limit       = limit;
  window._GoogleAuthProvider = GoogleAuthProvider;
  window._signInWithPopup    = signInWithPopup;
  window._signOut            = signOut;

  // Lắng nghe trạng thái đăng nhập
  onAuthStateChanged(auth, (user) => {
    window._currentUser = user;
    if (!window._firebaseReady) {
      window._firebaseReady = true;
      window.dispatchEvent(new Event('firebase-ready'));
    } else {
      window.dispatchEvent(new Event('auth-changed'));
    }
  });
