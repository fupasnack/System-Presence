// app.js — seluruh logic digabung: Auth, Role Guard, Firestore, Cloudinary, UI, Notifikasi, PWA

// Firebase config baru
const firebaseConfig = {
  apiKey: "AIzaSyA08VBr5PfN5HB7_eub0aZ9-_FSFFHM62M",
  authDomain: "presence-system-adfd7.firebaseapp.com",
  projectId: "presence-system-adfd7",
  storageBucket: "presence-system-adfd7.firebasestorage.app",
  messagingSenderId: "84815583677",
  appId: "1:84815583677:web:12e743b9f5c2b0cb395ad4",
  measurementId: "G-HHJREDRFZB"
};

// Cloudinary
const CLOUD_NAME = "dn2o2vf04";
const UPLOAD_PRESET = "presensi_unsigned";

// UID roles baru
const ADMIN_UIDS = new Set([
  "DsBQ1TdWjgXvpVHUQJpF1H6jZzJ3", // karomi@fupa.id
  "xxySAjSMqKeq7SC6r5vyzes7USY2"  // annisa@fupa.id
]);

const KARYAWAN_UIDS = new Set([
  "y2MTtiGZcVcts2MkQncckAaUasm2", // x@fupa.id
  "4qwoQhWyZmatqkRYaENtz5Uw8fy1", // cabang1@fupa.id
  "UkIHdrTF6vefeuzp94ttlmxZzqk2", // cabang2@fupa.id
  "kTpmDbdBETQT7HIqT6TvpLwrbQf2", // cabang3@fupa.id
  "15FESE0b7cQFKqdJSqNBTZlHqWR2", // cabang4@fupa.id
  "1tQidUDFTjRTJdJJYIudw9928pa2", // cabang5@fupa.id
  "7BCcTwQ5wDaxWA6xbzJX9VWj1o52", // cabang6@fupa.id
  "mpyFesOjUIcs8O8Sh3tVLS8x7dA3", // cabang7@fupa.id
  "2jV2is3MQRhv7nnd1gXeqiaj11t2", // cabang8@fupa.id
  "or2AQDVY1hdpwT0YOmL4qJrgCju1", // cabang9@fupa.id
  "HNJ52lywYVaUhRK3BNEARfQsQo22"  // cabang10@fupa.id
]);

// Inisialisasi Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Util UI
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const toast = (msg) => {
  const t = $("#toast");
  if (!t) return alert(msg);
  t.textContent = msg;
  t.style.display = "block";
  setTimeout(() => { t.style.display = "none"; }, 2200);
};

// PWA register SW
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

// Notifikasi browser
async function ensureNotificationPermission() {
  try {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission !== "denied") {
      const res = await Notification.requestPermission();
      return res === "granted";
    }
    return false;
  } catch { return false; }
}
function notify(msg) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") new Notification("Presensi FUPA", { body: msg });
}

// Dapatkan server time via Firestore
async function getServerTime() {
  const docRef = db.collection("_meta").doc("_srv");
  await docRef.set({ t: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  const snap = await docRef.get();
  const ts = snap.get("t");
  return ts ? ts.toDate() : new Date();
}
function fmtDateTime(d) {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtHM(d) {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function sameYMD(a,b){
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

// Aturan hari & jam
const WINDOW = {
  berangkat: { start: {h:4,m:30}, end:{h:5,m:30} },
  pulang:    { start: {h:10,m:0}, end:{h:11,m:0} }
};
function inWindow(d, jenis, extraLateMin=30) {
  const w = WINDOW[jenis];
  const start = new Date(d); start.setHours(w.start.h, w.start.m, 0, 0);
  const end = new Date(d);   end.setHours(w.end.h,   w.end.m,   0, 0);
  const lateEnd = new Date(end.getTime() + extraLateMin*60000);
  if (d < start) return {allowed:false, status:"dilarang"};
  if (d >= start && d <= end) return {allowed:true, status:"tepat"};
  if (d > end && d <= lateEnd) return {allowed:true, status:"terlambat"};
  return {allowed:false, status:"dilarang"};
}

async function getScheduleOverride(dateYMD) {
  const doc = await db.collection("_settings").doc("today").get();
  if (doc.exists) {
    const d = doc.data();
    if (d.date === dateYMD) return d.mode;
  }
  return "auto";
}

function ymd(d){
  const pad = (n) => n.toString().padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

// Role guard
function redirectByRole(uid, pathIfAdmin, pathIfKaryawan) {
  if (ADMIN_UIDS.has(uid)) {
    if (!location.pathname.endsWith(pathIfAdmin)) location.href = pathIfAdmin;
  } else if (KARYAWAN_UIDS.has(uid)) {
    if (!location.pathname.endsWith(pathIfKaryawan)) location.href = pathIfKaryawan;
  } else {
    auth.signOut();
    toast("Akses ditolak: akun belum diberi peran yang benar.");
  }
}
function guardPage(uid, required) {
  const isAdmin = ADMIN_UIDS.has(uid);
  const isKaryawan = KARYAWAN_UIDS.has(uid);
  if (required === "admin" && !isAdmin) { location.href = "index.html"; return false; }
  if (required === "karyawan" && !isKaryawan) { location.href = "index.html"; return false; }
  return true;
}

// Auto bootstrap koleksi & dokumen penting
async function bootstrapCollections(user) {
  // users profile doc
  const up = db.collection("users").doc(user.uid);
  await up.set({
    email: user.email || "",
    role: ADMIN_UIDS.has(user.uid) ? "admin" : (KARYAWAN_UIDS.has(user.uid) ? "karyawan" : "unknown"),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  // meta server tick
  await db.collection("_meta").doc("_srv").set({ t: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });

  // settings today default
  const todayDoc = db.collection("_settings").doc("today");
  if (!(await todayDoc.get()).exists) {
    await todayDoc.set({ mode:"auto", date: ymd(new Date()) });
  }
}

// Auth routing untuk semua halaman
auth.onAuthStateChanged(async (user) => {
  const path = location.pathname.toLowerCase();
  if (!user) {
    // Cegah akses langsung
    if (path.endsWith("karyawan.html") || path.endsWith("admin.html")) {
      location.href = "index.html";
    }
    // halaman login tidak butuh apa-apa
    if (path.endsWith("index.html") || path.endsWith("/")) {
      bindLoginPage();
    }
    return;
  }

  await bootstrapCollections(user);

  // Update server time live
  startServerClock("#serverTime");

  // Routing per halaman
  if (path.endsWith("index.html") || path.endsWith("/")) {
    // Setelah login, arahkan sesuai role
    redirectByRole(user.uid, "admin.html", "karyawan.html");
    return;
  }

  if (path.endsWith("karyawan.html")) {
    if (!guardPage(user.uid, "karyawan")) return;
    await ensureNotificationPermission();
    bindKaryawanPage(user);
  }

  if (path.endsWith("admin.html")) {
    if (!guardPage(user.uid, "admin")) return;
    await ensureNotificationPermission();
    bindAdminPage(user);
  }
});

// Halaman login
function bindLoginPage() {
  const loginBtn = $("#loginBtn");
  if (!loginBtn) return;
  loginBtn.onclick = async () => {
    const email = $("#email").value.trim();
    const pass = $("#password").value.trim();
    if (!email || !pass) { toast("Isi email dan kata sandi."); return; }
    try {
      await auth.signInWithEmailAndPassword(email, pass);
      // onAuthStateChanged akan redirect by role
    } catch (e) {
      toast("Gagal masuk. Periksa kembali kredensial.");
    }
  };
}

// Jam server live
async function startServerClock(sel) {
  const el = $(sel);
  if (!el) return;
  const tick = async () => {
    try {
      const t = await getServerTime();
      el.textContent = `Waktu server: ${fmtDateTime(t)} WIB`;
    } catch {
      el.textContent = `Waktu server: tidak tersedia`;
    }
  };
  await tick();
  setInterval(tick, 10_000);
}

// Ambil lokasi
function getLocation(timeout=8000) {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("Geolokasi tidak didukung."));
    navigator.geolocation.getCurrentPosition(
      (pos) => res({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => rej(err),
      { enableHighAccuracy:true, timeout, maximumAge: 2_000 }
    );
  });
}

// Kamera
async function startCamera(videoEl) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    videoEl.srcObject = stream;
    await videoEl.play();
    return stream;
  } catch (e) {
    toast("Tidak bisa mengakses kamera.");
    throw e;
  }
}
function captureToCanvas(videoEl, canvasEl) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  const MAXW = 720;
  const scale = Math.min(1, MAXW / w);
  canvasEl.width = Math.round(w * scale);
  canvasEl.height = Math.round(h * scale);
  const ctx = canvasEl.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
}

// Kompres gambar ke kualitas kecil (≤30KB) dan hapus metadata
async function canvasToCompressedBlob(canvas, targetKB=30) {
  let quality = 0.6;
  let blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", quality));
  
  // Kompres hingga ≤30KB
  while (blob.size/1024 > targetKB && quality > 0.1) {
    quality = Math.max(0.1, quality - 0.1);
    blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", quality));
  }
  
  // Hapus metadata EXIF dengan menggambar ulang
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = function() {
      const cleanCanvas = document.createElement('canvas');
      cleanCanvas.width = img.width;
      cleanCanvas.height = img.height;
      const ctx = cleanCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      cleanCanvas.toBlob(resolve, 'image/jpeg', quality);
    };
    img.src = URL.createObjectURL(blob);
  });
}

// Upload ke Cloudinary unsigned
async function uploadToCloudinary(file) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`;
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", UPLOAD_PRESET);
  const r = await fetch(url, { method:"POST", body: form });
  if (!r.ok) throw new Error("Upload Cloudinary gagal");
  const data = await r.json();
  return data.secure_url;
}

// Simpan presensi
async function savePresensi({ uid, nama, jenis, status, lat, lng, selfieUrl, serverDate }) {
  const ts = serverDate || new Date();
  const doc = {
    uid, nama: nama || "", jenis, status,
    lat, lng,
    selfieUrl: selfieUrl || "",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    localTime: fmtDateTime(ts),
    ymd: ymd(ts)
  };
  await db.collection("presensi").add(doc);
}

// Ambil riwayat singkat karyawan
function subscribeRiwayat(uid, cb) {
  return db.collection("presensi")
    .where("uid", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(10)
    .onSnapshot(snap => {
      const arr = [];
      snap.forEach(d => arr.push({ id:d.id, ...d.data() }));
      cb(arr);
    });
}

// Notifikasi list untuk karyawan
function subscribeNotifForKaryawan(uid, cb) {
  return db.collection("notifs")
    .where("targets", "array-contains-any", ["all", uid])
    .orderBy("createdAt", "desc")
    .limit(20)
    .onSnapshot(snap => {
      const arr = [];
      snap.forEach(d => arr.push({ id:d.id, ...d.data() }));
      cb(arr);
    });
}

// Cuti collection
async function ajukanCuti(uid, nama, jenis, tanggal, catatan) {
  await db.collection("cuti").add({
    uid, nama, jenis, tanggal, catatan: catatan || "",
    status: "menunggu",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// Admin list cuti
function subscribeCuti(cb) {
  return db.collection("cuti")
    .orderBy("createdAt", "desc")
    .limit(50)
    .onSnapshot(snap => {
      const arr = [];
      snap.forEach(d => arr.push({ id:d.id, ...d.data() }));
      cb(arr);
    });
}

async function setCutiStatus(id, status, adminUid, adminNama) {
  await db.collection("cuti").doc(id).set({ status }, { merge:true });
  
  // Dapatkan data cuti untuk notifikasi
  const cutiDoc = await db.collection("cuti").doc(id).get();
  const cutiData = cutiDoc.data();
  
  // Buat notifikasi untuk karyawan
  await db.collection("notifs").add({
    type: "cuti",
    text: `Permintaan cuti Anda ${status === 'disetujui' ? 'telah disetujui' : 'ditolak'} oleh admin`,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    from: adminUid,
    fromNama: adminNama,
    targets: [cutiData.uid],
    cutiId: id,
    status: status
  });
  
  // Jika disetujui, buat entri presensi otomatis
  if (status === "disetujui") {
    await savePresensi({
      uid: cutiData.uid,
      nama: cutiData.nama,
      jenis: "cuti",
      status: "cuti",
      lat: null,
      lng: null,
      selfieUrl: "",
      serverDate: new Date(cutiData.tanggal)
    });
  }
}

// Pengumuman
async function kirimPengumuman(text, adminUid, adminNama) {
  await db.collection("notifs").add({
    type: "announce",
    text,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    from: adminUid,
    fromNama: adminNama,
    targets: ["all"]
  });
  notify("Pengumuman terkirim ke semua karyawan.");
}

// Jadwal wajib
async function setHariMode(mode, dateStr, adminUid, adminNama) {
  await db.collection("_settings").doc("today").set({
    mode, date: dateStr
  }, { merge: true });
  
  // Kirim notifikasi override ke semua karyawan
  let message = "";
  if (mode === "forceOn") {
    message = "Admin mengaktifkan presensi wajib hari ini";
  } else if (mode === "forceOff") {
    message = "Admin menonaktifkan presensi wajib hari ini";
  } else {
    message = "Admin mengembalikan pengaturan presensi ke mode otomatis";
  }
  
  await db.collection("notifs").add({
    type: "override",
    text: message,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    from: adminUid,
    fromNama: adminNama,
    targets: ["all"]
  });
}

// Profil simpan
async function saveProfile(uid, { nama, alamat, pfpUrl }) {
  const d = {};
  if (nama !== undefined) d.nama = nama;
  if (alamat !== undefined) d.alamat = alamat;
  if (pfpUrl !== undefined) d.pfp = pfpUrl;
  d.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
  await db.collection("users").doc(uid).set(d, { merge: true });
}

// Ambil profil
async function getProfile(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? snap.data() : {};
}

// Hapus notifikasi
async function deleteNotif(notifId) {
  await db.collection("notifs").doc(notifId).delete();
}

// Halaman Karyawan bindings
async function bindKaryawanPage(user) {
  // ... (kode untuk halaman karyawan tetap sama seperti sebelumnya)
}

// Halaman Admin bindings
function toCSV(rows, columns) {
  const esc = (v) => `"${(v ?? "").toString().replace(/"/g,'""')}"`;
  const header = columns.map(esc).join(",");
  const body = rows.map(r => columns.map(k => esc(r[k])).join(",")).join("\n");
  return header + "\n" + body;
}
function download(filename, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type:"text/csv"}));
  a.download = filename;
  a.click();
}

async function bindAdminPage(user) {
  // Profil muat
  const profile = await getProfile(user.uid);
  if (profile.pfp) $("#pfp").src = profile.pfp;
  if (profile.nama) $("#nama").value = profile.nama;
  if (profile.alamat) $("#alamat").value = profile.alamat;

  // Dialogs
  $("#profileBtn").onclick = () => $("#profileDlg").showModal();
  $("#logoutBtn").onclick = async () => { await auth.signOut(); location.href="index.html"; };

  // Simpan profil
  $("#saveProfileBtn").onclick = async () => {
    try {
      let pfpUrl;
      const file = $("#pfpFile").files?.[0];
      if (file) {
        const imgEl = document.createElement("img");
        imgEl.src = URL.createObjectURL(file);
        await new Promise(r => imgEl.onload = r);
        const c = document.createElement("canvas");
        const scale = Math.min(1, 512 / Math.max(imgEl.width, imgEl.height));
        c.width = Math.max(64, Math.round(imgEl.width * scale));
        c.height = Math.max(64, Math.round(imgEl.height * scale));
        const ctx = c.getContext("2d");
        ctx.drawImage(imgEl, 0, 0, c.width, c.height);
        const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.7));
        pfpUrl = await uploadToCloudinary(blob);
        $("#pfp").src = pfpUrl;
      }
      const nama = $("#nama").value.trim();
      const alamat = $("#alamat").value.trim();
      await saveProfile(user.uid, { nama, alamat, pfpUrl });
      toast("Profil admin tersimpan.");
      notify("Profil admin diperbarui.");
    } catch {
      toast("Gagal menyimpan profil admin.");
    }
  };

  // Notifikasi (cuti)
  $("#notifBtn").onclick = () => $("#notifDlg").showModal();
  const cutiList = $("#cutiList");
  const unsubCuti = subscribeCuti((items) => {
    cutiList.innerHTML = "";
    items.forEach(it => {
      const row = document.createElement("div");
      row.className = "card";
      row.innerHTML = `
        <div class="row" style="justify-content:space-between">
          <div class="row">
            <span class="material-symbols-rounded">person</span><b>${it.nama || it.uid}</b>
            <span>•</span>
            <span>${it.jenis}</span>
            <span>•</span>
            <span>${it.tanggal}</span>
          </div>
          <div class="row">
            <span class="status ${it.status==='menunggu'?'s-warn':(it.status==='disetujui'?'s-good':'s-bad')}">${it.status}</span>
          </div>
        </div>
        <div class="row" style="justify-content:flex-end; margin-top:8px">
          <button class="btn" data-act="approve" data-id="${it.id}"><span class="material-symbols-rounded">check</span> Setujui</button>
          <button class="btn" data-act="reject" data-id="${it.id}" style="background:#222"><span class="material-symbols-rounded">close</span> Tolak</button>
        </div>
      `;
      cutiList.appendChild(row);
    });
    // Bind actions
    $$("[data-act='approve']").forEach(b => b.onclick = async () => {
      await setCutiStatus(b.dataset.id, "disetujui", user.uid, profile.nama || "Admin");
      toast("Cuti disetujui.");
      notify("Ada cuti disetujui.");
    });
    $$("[data-act='reject']").forEach(b => b.onclick = async () => {
      await setCutiStatus(b.dataset.id, "ditolak", user.uid, profile.nama || "Admin");
      toast("Cuti ditolak.");
      notify("Ada cuti ditolak.");
    });
  });

  // Pengumuman
  $("#announceFab").onclick = async () => {
    const text = prompt("Tulis pengumuman:");
    if (!text) return;
    await kirimPengumuman(text, user.uid, profile.nama || "Admin");
    toast("Pengumuman terkirim.");
  };
  $("#sendAnnounce").onclick = async () => {
    const text = $("#announceText").value.trim();
    if (!text) { toast("Tulis isi pengumuman."); return; }
    await kirimPengumuman(text, user.uid, profile.nama || "Admin");
    $("#announceText").value = "";
    toast("Pengumuman terkirim.");
  };

  // Jadwal wajib / tidak
  $("#saveSchedule").onclick = async () => {
    const mode = $("#wajibHari").value;
    const now = await getServerTime();
    await setHariMode(mode, ymd(now), user.uid, profile.nama || "Admin");
    toast("Pengaturan hari tersimpan.");
  };

  // Tabel presensi + filter + export CSV
  let lastData = [];
  async function loadPresensi() {
    let q = db.collection("presensi").orderBy("createdAt", "desc").limit(500);
    const nama = $("#fNama").value.trim().toLowerCase();
    const tanggal = $("#fTanggal").value;
    const snap = await q.get();
    const arr = [];
    snap.forEach(d => arr.push({ id:d.id, ...d.data() }));
    let filtered = arr;
    if (tanggal) filtered = filtered.filter(x => x.ymd === tanggal);
    if (nama) filtered = filtered.filter(x => (x.nama||"").toLowerCase().includes(nama));
    lastData = filtered;
    renderTable(filtered);
  }
  function renderTable(rows) {
    const tb = $("#tableBody");
    tb.innerHTML = "";
    rows.forEach(r => {
      const badge = r.status === "tepat" ? "s-good" : (r.status==="terlambat"?"s-warn":"s-bad");
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.localTime || ""}</td>
        <td>${r.nama || r.uid}</td>
        <td>${r.jenis}</td>
        <td><span class="status ${badge}">${r.status}</span></td>
        <td>${(r.lat?.toFixed?.(5) || r.lat || "")}, ${(r.lng?.toFixed?.(5) || r.lng || "")}</td>
        <td>${r.selfieUrl ? `<a href="${r.selfieUrl}" target="_blank">Lihat</a>` : "-"}</td>
      `;
      tb.appendChild(tr);
    });
  }
  $("#applyFilter").onclick = () => loadPresensi();
  $("#exportCsv").onclick = () => {
    if (!lastData.length) { toast("Tidak ada data untuk diekspor."); return; }
    const cols = ["localTime","nama","jenis","status","lat","lng","selfieUrl","uid","ymd"];
    const csv = toCSV(lastData, cols);
    download(`presensi_${Date.now()}.csv`, csv);
  };
  // Muat awal + refresh periodik ringan
  await loadPresensi();
  setInterval(loadPresensi, 20_000);

  // Create akun karyawan
  const secondApp = firebase.apps.length > 1 ? firebase.apps[1] : firebase.initializeApp(firebaseConfig, "second");
  const secondAuth = secondApp.auth();

  $("#createUserBtn").onclick = async () => {
    const email = $("#newEmail").value.trim();
    const pass = $("#newPass").value.trim();
    if (!email || !pass) { toast("Isi email dan kata sandi."); return; }
    try {
      const cred = await secondAuth.createUserWithEmailAndPassword(email, pass);
      const uid = cred.user.uid;
      await db.collection("users").doc(uid).set({
        email, role:"karyawan", createdBy: user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge:true });
      await secondAuth.signOut();
      toast("Akun karyawan dibuat.");
      notify("Akun karyawan baru telah dibuat.");
    } catch (e) {
      toast("Gagal membuat akun karyawan.");
    }
  };

  // Bersih
  window.addEventListener("beforeunload", () => {
    unsubCuti && unsubCuti();
  });
}