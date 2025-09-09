// app.js — Presensi FUPA (updated)
// - Requires firebase compat libs already loaded on page (app-compat, auth-compat, firestore-compat)

////////////////////////////////////////////////////////////////////////////////
// CONFIG (use your firebaseConfig)
////////////////////////////////////////////////////////////////////////////////
const firebaseConfig = {
  apiKey: "AIzaSyA08VBr5PfN5HB7_eub0aZ9-_FSFFHM62M",
  authDomain: "presence-system-adfd7.firebaseapp.com",
  projectId: "presence-system-adfd7",
  storageBucket: "presence-system-adfd7.firebasestorage.app",
  messagingSenderId: "84815583677",
  appId: "1:84815583677:web:12e743b9f5c2b0cb395ad4",
  measurementId: "G-HHJREDRFZB"
};

const CLOUD_NAME = "dn2o2vf04";
const UPLOAD_PRESET = "presensi_unsigned";

// Admin and Karyawan UIDs (seeded)
const ADMIN_UIDS = new Set([
  "DsBQ1TdWjgXvpVHUQJpF1H6jZzJ3",
  "xxySAjSMqKeq7SC6r5vyzes7USY2"
]);

const KARYAWAN_UIDS = new Set([
  "y2MTtiGZcVcts2MkQncckAaUasm2",
  "4qwoQhWyZmatqkRYaENtz5Uw8fy1",
  "UkIHdrTF6vefeuzp94ttlmxZzqk2",
  "kTpmDbdBETQT7HIqT6TvpLwrbQf2",
  "15FESE0b7cQFKqdJSqNBTZlHqWR2",
  "1tQidUDFTjRTJdJJYIudw9928pa2",
  "7BCcTwQ5wDaxWA6xbzJX9VWj1o52",
  "mpyFesOjUIcs8O8Sh3tVLS8x7dA3",
  "2jV2is3MQRhv7nnd1gXeqiaj11t2",
  "or2AQDVY1hdpwT0YOmL4qJrgCju1",
  "HNJ52lywYVaUhRK3BNEARfQsQo22"
]);

////////////////////////////////////////////////////////////////////////////////
// Init Firebase (compat)
////////////////////////////////////////////////////////////////////////////////
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

////////////////////////////////////////////////////////////////////////////////
// Utilities: date formatting
////////////////////////////////////////////////////////////////////////////////
function fmtDateTime(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function ymd(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

////////////////////////////////////////////////////////////////////////////////
// Session management (sessions collection + session_id in localStorage)
////////////////////////////////////////////////////////////////////////////////
async function createSessionRecord(user) {
  try {
    const expires = firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 12 * 60 * 60 * 1000)); // 12h
    const session = {
      uid: user.uid,
      email: user.email || "",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      expiresAt: expires,
      userAgent: navigator.userAgent,
      ip: await _getClientIP().catch(()=>"unknown"),
      valid: true
    };
    const ref = await db.collection("sessions").add(session);
    localStorage.setItem("session_id", ref.id);
    return ref.id;
  } catch (e) {
    console.warn("createSessionRecord failed", e);
    return null;
  }
}
async function checkSessionValidity() {
  const sid = localStorage.getItem("session_id");
  if (!sid) return false;
  try {
    const doc = await db.collection("sessions").doc(sid).get();
    if (!doc.exists) { localStorage.removeItem("session_id"); return false; }
    const data = doc.data();
    if (!data.valid) return false;
    const exp = data.expiresAt && data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
    if (exp < new Date()) { try{ await db.collection("sessions").doc(sid).delete(); }catch{} localStorage.removeItem("session_id"); return false; }
    if (!auth.currentUser || auth.currentUser.uid !== data.uid) return false;
    return true;
  } catch (e) {
    console.warn("checkSessionValidity", e);
    return false;
  }
}
async function refreshSession() {
  const sid = localStorage.getItem("session_id");
  if (!sid) return;
  try {
    await db.collection("sessions").doc(sid).update({
      expiresAt: firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 12 * 60 * 60 * 1000))
    });
  } catch (e) {
    console.warn("refreshSession failed", e);
  }
}

////////////////////////////////////////////////////////////////////////////////
// Security logs (best-effort)
// Note: rules should restrict visibility and writes appropriately
////////////////////////////////////////////////////////////////////////////////
async function logEvent(type, meta = {}) {
  try {
    const payload = {
      type,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      userAgent: navigator.userAgent,
      ip: await _getClientIP().catch(()=>"unknown"),
      ...meta
    };
    if (auth.currentUser) {
      payload.uid = auth.currentUser.uid;
      payload.email = auth.currentUser.email;
    }
    // append-only log
    await db.collection("security_logs").add(payload);
  } catch (e) {
    console.warn("logEvent failed", e);
  }
}

////////////////////////////////////////////////////////////////////////////////
// Get client IP (best-effort)
////////////////////////////////////////////////////////////////////////////////
async function _getClientIP() {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const j = await res.json();
    return j.ip || "unknown";
  } catch {
    return "unknown";
  }
}

////////////////////////////////////////////////////////////////////////////////
// Bootstrap: create users doc and one-time _meta/_srv (no repeated writes)
////////////////////////////////////////////////////////////////////////////////
async function bootstrapForUser(user) {
  try {
    // users/{uid}
    const upRef = db.collection("users").doc(user.uid);
    const upDoc = await upRef.get();
    if (!upDoc.exists) {
      await upRef.set({
        email: user.email || "",
        role: ADMIN_UIDS.has(user.uid) ? "admin" : (KARYAWAN_UIDS.has(user.uid) ? "karyawan" : "karyawan"),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastLogin: firebase.firestore.FieldValue.serverTimestamp()
      });
      await logEvent("user_profile_created", { uid: user.uid });
    } else {
      await upRef.set({ lastLogin: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }

    // ensure _meta/_srv exists (write once if missing)
    const srvRef = db.collection("_meta").doc("_srv");
    const srvSnap = await srvRef.get();
    if (!srvSnap.exists) {
      await srvRef.set({ t: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }

    // ensure _settings/today exists
    const settingsTodayRef = db.collection("_settings").doc("today");
    const settingsSnap = await settingsTodayRef.get();
    if (!settingsSnap.exists) {
      await settingsTodayRef.set({ mode: "auto", date: ymd(new Date()) }, { merge: true });
    }
  } catch (e) {
    console.warn("bootstrapForUser failed", e);
  }
}

////////////////////////////////////////////////////////////////////////////////
// Get server time (read-only). Avoids writing every tick.
// Relies on _meta/_srv being seeded by bootstrap or server-side job.
////////////////////////////////////////////////////////////////////////////////
async function getServerTime() {
  try {
    const snap = await db.collection("_meta").doc("_srv").get();
    const t = snap.exists ? snap.get("t") : null;
    if (t && t.toDate) return t.toDate();
  } catch (e) {
    console.warn("getServerTime read failed", e);
  }
  return new Date();
}

////////////////////////////////////////////////////////////////////////////////
// Camera + Image compression (target ≤30 KB) + strip metadata via redraw
////////////////////////////////////////////////////////////////////////////////
async function canvasToCompressedBlob(canvas, targetKB = 30) {
  // initial try with quality ramp
  let quality = 0.7;
  let blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
  // iterative decrease
  for (let i = 0; i < 6 && blob && blob.size / 1024 > targetKB; i++) {
    quality = Math.max(0.2, quality - 0.12);
    blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
  }
  // If still large, downscale progressively
  if (blob && blob.size / 1024 > targetKB) {
    let scale = Math.sqrt((targetKB * 1024) / blob.size);
    scale = Math.min(0.95, Math.max(0.25, scale));
    const newW = Math.max(320, Math.round(canvas.width * scale));
    const newH = Math.max(240, Math.round(canvas.height * scale));
    const tmp = document.createElement("canvas");
    tmp.width = newW; tmp.height = newH;
    const ctx = tmp.getContext("2d");
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    await new Promise(r => img.onload = r);
    ctx.drawImage(img, 0, 0, newW, newH);
    blob = await new Promise(res => tmp.toBlob(res, "image/jpeg", 0.75));
  }
  // Final metadata strip pass: draw into new canvas and export
  try {
    const img2 = new Image();
    img2.src = URL.createObjectURL(blob);
    await new Promise(r => img2.onload = r);
    const clean = document.createElement("canvas");
    clean.width = img2.width; clean.height = img2.height;
    clean.getContext("2d").drawImage(img2, 0, 0);
    const finalBlob = await new Promise(res => clean.toBlob(res, "image/jpeg", 0.85));
    return finalBlob;
  } catch (e) {
    // fallback to whatever we had
    return blob;
  }
}

////////////////////////////////////////////////////////////////////////////////
// Cloudinary unsigned upload (simple)
////////////////////////////////////////////////////////////////////////////////
async function uploadToCloudinary(fileBlob) {
  if (!fileBlob) throw new Error("No file provided");
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`;
  const form = new FormData();
  form.append("file", fileBlob);
  form.append("upload_preset", UPLOAD_PRESET);
  const resp = await fetch(url, { method: "POST", body: form });
  if (!resp.ok) {
    const text = await resp.text().catch(()=>"");
    throw new Error("Cloudinary upload failed: " + (text || resp.status));
  }
  const j = await resp.json();
  return j.secure_url || j.url;
}

////////////////////////////////////////////////////////////////////////////////
// PRESENSI (attendance)
////////////////////////////////////////////////////////////////////////////////
async function savePresensi({ uid, nama, jenis, status, lat = null, lng = null, selfieUrl = "", serverDate = null }) {
  try {
    const ts = serverDate || new Date();
    const doc = {
      uid,
      nama: nama || "",
      jenis,
      status,
      lat: lat === undefined ? null : lat,
      lng: lng === undefined ? null : lng,
      selfieUrl: selfieUrl || "",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      localTime: (typeof fmtDateTime === 'function') ? fmtDateTime(ts) : ts.toISOString(),
      ymd: (typeof ymd === 'function') ? ymd(ts) : `${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,'0')}-${String(ts.getDate()).padStart(2,'0')}`
    };
    const ref = await db.collection("presensi").add(doc);
    await logEvent("presensi_created", { presensiId: ref.id, uid, jenis, status });
    return ref.id;
  } catch (e) {
    console.error("savePresensi failed", e);
    throw e;
  }
}
function subscribeRiwayat(uid, cb, limit = 20) {
  return db.collection("presensi")
    .where("uid", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .onSnapshot(snap => {
      const arr = [];
      snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      cb(arr);
    }, err => { console.warn("subscribeRiwayat error", err); cb([]); });
}

////////////////////////////////////////////////////////////////////////////////
// NOTIFICATIONS: per-user subcollection design
////////////////////////////////////////////////////////////////////////////////
function subscribeNotifications(uid, cb) {
  if (!uid) throw new Error("subscribeNotifications needs uid");
  return db.collection("users").doc(uid).collection("notifications")
    .orderBy("createdAt", "desc")
    .limit(100)
    .onSnapshot(snap => {
      const arr = [];
      snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      cb(arr);
    }, err => { console.warn("subscribeNotifications error", err); cb([]); });
}

/**
 * createNotification:
 * - if userId is a UID -> writes to users/{userId}/notifications
 * - if userId === 'all' -> writes a master announcement doc to 'announcements' (server should fan-out)
 * - if userId === 'admin' -> writes to admin_notifications (or creates per-admin notifications if ADMIN_UIDS small)
 */
async function createNotification({ userId = "all", type = "info", title, message, data = {} } = {}) {
  if (!title) title = type;
  try {
    if (userId === "all") {
      const doc = {
        type, title, message, data,
        broadcast: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        from: (auth.currentUser ? auth.currentUser.uid : null)
      };
      await db.collection("announcements").add(doc);
      await logEvent("announcement_created", { title });
      return;
    }
    if (userId === "admin") {
      const batch = db.batch();
      ADMIN_UIDS.forEach(aid => {
        const ref = db.collection("users").doc(aid).collection("notifications").doc();
        batch.set(ref, {
          type, title, message, data,
          read: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          from: auth.currentUser ? auth.currentUser.uid : null
        });
      });
      await batch.commit();
      await logEvent("admin_notifications_created", { title });
      return;
    }
    const ref = db.collection("users").doc(userId).collection("notifications").doc();
    await ref.set({
      type, title, message, data,
      read: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      from: auth.currentUser ? auth.currentUser.uid : null
    });
    await logEvent("notification_created", { userId, title });
  } catch (e) {
    console.warn("createNotification failed", e);
    throw e;
  }
}

async function markNotificationAsRead(uid, nid) {
  try {
    await db.collection("users").doc(uid).collection("notifications").doc(nid).update({ read: true });
  } catch (e) {
    console.warn("markNotificationAsRead failed", e);
    throw e;
  }
}
async function deleteNotification(uid, nid) {
  try {
    await db.collection("users").doc(uid).collection("notifications").doc(nid).delete();
    await logEvent("notification_deleted", { uid, nid });
  } catch (e) {
    console.warn("deleteNotification failed", e);
    throw e;
  }
}

/**
 * createBroadcastNotification (client-side fan-out)
 */
async function createBroadcastNotification({ targetUids = [], type = "info", title = "", message = "", data = {} }) {
  if (!Array.isArray(targetUids)) throw new Error("targetUids must be array");
  if (!targetUids.length) throw new Error("targetUids empty");
  const batchSize = 450;
  const chunks = [];
  for (let i = 0; i < targetUids.length; i += batchSize) chunks.push(targetUids.slice(i, i + batchSize));
  for (const chunk of chunks) {
    const batch = db.batch();
    chunk.forEach(uid => {
      const ref = db.collection("users").doc(uid).collection("notifications").doc();
      batch.set(ref, {
        type, title, message, data,
        read: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        from: auth.currentUser ? auth.currentUser.uid : null
      });
    });
    await batch.commit();
  }
  await logEvent("broadcast_notifications_sent", { count: targetUids.length, title });
}

////////////////////////////////////////////////////////////////////////////////
// CUTI (leave)
////////////////////////////////////////////////////////////////////////////////
async function ajukanCuti(uid, nama, jenis, tanggal, catatan = "") {
  try {
    const ref = await db.collection("cuti").add({
      uid, nama, jenis, tanggal, catatan,
      status: "menunggu",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    const batch = db.batch();
    ADMIN_UIDS.forEach(aid => {
      const nref = db.collection("users").doc(aid).collection("notifications").doc();
      batch.set(nref, {
        type: "cuti",
        title: "Permintaan Cuti Baru",
        message: `${nama} mengajukan ${jenis} pada ${tanggal}`,
        data: { cutiId: ref.id, uid, nama, jenis, tanggal, catatan },
        read: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        from: uid
      });
    });
    await batch.commit();

    await logEvent("cuti_submitted", { cutiId: ref.id, uid });
    return ref.id;
  } catch (e) {
    console.error("ajukanCuti failed", e);
    throw e;
  }
}

/**
 * setCutiStatus
 */
async function setCutiStatus(cutiId, status, adminUid) {
  try {
    const cutiRef = db.collection("cuti").doc(cutiId);
    const snap = await cutiRef.get();
    if (!snap.exists) throw new Error("cuti not found");
    const cuti = snap.data();

    await cutiRef.set({
      status,
      decidedBy: adminUid,
      decidedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await createNotification({
      userId: cuti.uid,
      type: "cuti",
      title: "Status Cuti",
      message: `Cuti Anda pada ${cuti.tanggal} telah ${status}`,
      data: { cutiId, status }
    });

    if (status === "disetujui") {
      try {
        const serverDate = new Date(cuti.tanggal + "T09:00:00");
        await db.collection("presensi").add({
          uid: cuti.uid,
          nama: cuti.nama,
          jenis: cuti.jenis,
          status: cuti.jenis,
          lat: null,
          lng: null,
          selfieUrl: "",
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          localTime: (typeof fmtDateTime === 'function') ? fmtDateTime(serverDate) : serverDate.toISOString(),
          ymd: cuti.tanggal,
          isCuti: true,
          createdByAdmin: adminUid
        });
      } catch (e) {
        console.warn("auto-create presensi for cuti failed", e);
      }
    }

    await logEvent("cuti_status_changed", { cutiId, status, adminUid });
  } catch (e) {
    console.error("setCutiStatus failed", e);
    throw e;
  }
}

function subscribeCutiAdmin(cb) {
  return db.collection("cuti")
    .where("status", "==", "menunggu")
    .orderBy("createdAt", "desc")
    .limit(200)
    .onSnapshot(snap => {
      const arr = [];
      snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      cb(arr);
    }, err => { console.warn("subscribeCutiAdmin error", err); cb([]); });
}

////////////////////////////////////////////////////////////////////////////////
// OVERRIDES
////////////////////////////////////////////////////////////////////////////////
async function setOverrideStatus(dateYMD, status, adminUid) {
  try {
    await db.collection("overrides").doc(dateYMD).set({
      status,
      createdBy: adminUid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    const targetUids = Array.from(KARYAWAN_UIDS);
    if (targetUids.length > 0) {
      await createBroadcastNotification({
        targetUids,
        type: "override",
        title: "Override Status Presensi",
        message: `Admin menetapkan override pada ${dateYMD}: ${status}`,
        data: { date: dateYMD, status, adminUid }
      });
    } else {
      await createNotification({
        userId: "all",
        type: "override",
        title: "Override Status Presensi",
        message: `Admin menetapkan override pada ${dateYMD}: ${status}`,
        data: { date: dateYMD, status, adminUid }
      });
    }

    await logEvent("override_set", { dateYMD, status, adminUid });
  } catch (e) {
    console.error("setOverrideStatus failed", e);
    throw e;
  }
}

async function getScheduleOverride(dateYMD) {
  try {
    const doc = await db.collection("_settings").doc("today").get();
    if (doc.exists) {
      const d = doc.data();
      if (d.date === dateYMD) return d.mode;
    }
    const overrideDoc = await db.collection("overrides").doc(dateYMD).get();
    if (overrideDoc.exists) return overrideDoc.data().status;
    return "auto";
  } catch (e) {
    console.warn("getScheduleOverride failed", e);
    return "auto";
  }
}

////////////////////////////////////////////////////////////////////////////////
// Announcements by admin
////////////////////////////////////////////////////////////////////////////////
async function kirimPengumuman(text, adminUid) {
  try {
    await db.collection("announcements").add({
      text,
      from: adminUid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (Array.from(KARYAWAN_UIDS).length <= 500) {
      await createBroadcastNotification({
        targetUids: Array.from(KARYAWAN_UIDS),
        type: "pengumuman",
        title: "Pengumuman",
        message: text,
        data: { from: adminUid }
      });
    }
    await logEvent("announcement_sent", { adminUid, snippet: text.substring(0,120) });
  } catch (e) {
    console.error("kirimPengumuman failed", e);
    throw e;
  }
}

////////////////////////////////////////////////////////////////////////////////
// Profile management
////////////////////////////////////////////////////////////////////////////////
async function saveProfile(uid, { nama, alamat, pfpUrl }) {
  try {
    const d = {};
    if (nama !== undefined) d.nama = nama;
    if (alamat !== undefined) d.alamat = alamat;
    if (pfpUrl !== undefined) d.pfp = pfpUrl;
    d.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection("users").doc(uid).set(d, { merge: true });
    await logEvent("profile_saved", { uid, fields: Object.keys(d).filter(k => k !== "updatedAt") });
  } catch (e) {
    console.warn("saveProfile failed", e);
    throw e;
  }
}
async function getProfile(uid) {
  try {
    const snap = await db.collection("users").doc(uid).get();
    return snap.exists ? snap.data() : {};
  } catch (e) {
    console.warn("getProfile failed", e);
    return {};
  }
}

////////////////////////////////////////////////////////////////////////////////
// Admin: create user without logging out (second firebase app)
////////////////////////////////////////////////////////////////////////////////
function getSecondAuth() {
  if (!firebase.apps.some(a => a.name === "second")) {
    firebase.initializeApp(firebaseConfig, "second");
  }
  return firebase.app("second").auth();
}
async function createKaryawanAccountByAdmin(email, password, adminUid) {
  const secondAuth = getSecondAuth();
  try {
    const cred = await secondAuth.createUserWithEmailAndPassword(email, password);
    const newUid = cred.user.uid;
    await db.collection("users").doc(newUid).set({
      email,
      role: "karyawan",
      createdBy: adminUid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await logEvent("karyawan_created", { adminUid, newUid, email });
    await secondAuth.signOut();
    return newUid;
  } catch (e) {
    try { await secondAuth.signOut(); } catch {}
    console.error("createKaryawanAccountByAdmin failed", e);
    throw e;
  }
}

////////////////////////////////////////////////////////////////////////////////
// Admin: fetch presensi with filters
////////////////////////////////////////////////////////////////////////////////
async function fetchPresensi({ namaFilter = "", tanggal = "", periode = "semua", limit = 500 } = {}) {
  try {
    let q = db.collection("presensi").orderBy("createdAt", "desc");
    if (periode && periode !== "semua") {
      const now = new Date();
      const start = new Date();
      switch (periode) {
        case "hari": start.setHours(0,0,0,0); break;
        case "minggu": start.setDate(now.getDate() - 7); break;
        case "bulan": start.setMonth(now.getMonth() - 1); break;
        case "tahun": start.setFullYear(now.getFullYear() - 1); break;
      }
      q = q.where("createdAt", ">=", start);
    }
    const snap = await q.limit(limit).get();
    let arr = [];
    snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
    if (tanggal) arr = arr.filter(x => x.ymd === tanggal);
    if (namaFilter) arr = arr.filter(x => (x.nama || "").toLowerCase().includes(namaFilter.toLowerCase()));
    return arr;
  } catch (e) {
    console.error("fetchPresensi failed", e);
    return [];
  }
}

////////////////////////////////////////////////////////////////////////////////
// Delete presensi (admin)
////////////////////////////////////////////////////////////////////////////////
async function deletePresensi(id) {
  try {
    const doc = await db.collection("presensi").doc(id).get();
    if (!doc.exists) throw new Error("presensi not found");
    const data = doc.data();
    await db.collection("presensi").doc(id).delete();
    await logEvent("presensi_deleted", { presensiId: id, uid: data.uid || null });
  } catch (e) {
    console.error("deletePresensi failed", e);
    throw e;
  }
}

////////////////////////////////////////////////////////////////////////////////
// CSV helpers
////////////////////////////////////////////////////////////////////////////////
function toCSV(rows, columns) {
  const esc = v => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
  const header = columns.map(esc).join(",");
  const body = rows.map(r => columns.map(k => esc(r[k])).join(",")).join("\n");
  return header + "\n" + body;
}
function downloadText(filename, text, mime="text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  a.click();
}

////////////////////////////////////////////////////////////////////////////////
// Server clock UI updater (reads _meta/_srv; no repeated writes)
////////////////////////////////////////////////////////////////////////////////
async function startServerClock(sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  async function tick() {
    try {
      const t = await getServerTime();
      el.textContent = `Waktu server: ${fmtDateTime(t)} WIB`;
    } catch {
      el.textContent = `Waktu server: tidak tersedia`;
    }
  }
  await tick();
  setInterval(tick, 60_000); // update every minute
}

////////////////////////////////////////////////////////////////////////////////
// Export public API
////////////////////////////////////////////////////////////////////////////////
window.PresensiFUPA = {
  auth, db,
  createSessionRecord, checkSessionValidity, refreshSession,
  saveProfile, getProfile,
  canvasToCompressedBlob, uploadToCloudinary,
  savePresensi, subscribeRiwayat, fetchPresensi, deletePresensi,
  ajukanCuti, subscribeCutiAdmin, setCutiStatus,
  subscribeNotifications, createNotification, markNotificationAsRead, deleteNotification, createBroadcastNotification,
  setOverrideStatus, getScheduleOverride,
  kirimPengumuman,
  createKaryawanAccountByAdmin,
  toCSV, downloadText, startServerClock, fmtDateTime, ymd
};

////////////////////////////////////////////////////////////////////////////////
// Optional auto-bind for simple login UI if present (non-invasive)
////////////////////////////////////////////////////////////////////////////////
(function autoWireLogin() {
  try {
    const loginBtn = document.getElementById('loginBtn');
    const emailEl = document.getElementById('email');
    const passEl = document.getElementById('password');
    if (!loginBtn || !emailEl || !passEl) return;
    if (loginBtn.dataset.bound) return;
    loginBtn.dataset.bound = '1';
    loginBtn.addEventListener('click', async () => {
      const email = emailEl.value.trim();
      const pass = passEl.value;
      if (!email || !pass) { alert('Masukkan email dan kata sandi'); return; }
      try {
        await logEvent('login_attempt', { email });
        const cred = await auth.signInWithEmailAndPassword(email, pass);
        try { await createSessionRecord(cred.user); } catch(e){ console.warn('session record failed', e); }
        await logEvent('login_success', { uid: cred.user.uid });
      } catch (e) {
        await logEvent('login_failed', { email, error: e.code });
        alert('Login gagal: ' + (e.message || e.code));
      }
    });
  } catch (e) { console.warn('autoWireLogin failed', e); }
})();
