// formation.js: FORMASI (tombol F). Dipisah dari world.js supaya mudah diatur.
// Satu tombol: tiap karakter berbalik ke slot barisnya, jalan lurus ke sana, berhenti, langsung berbalik ke arah akhirnya,
// lalu setelah SEMUA sampai & selesai berbalik, tiap karakter menjalankan animasi akhir (FORM_FINALE).
// Kode di dalam tiap karakter TIDAK diubah: file ini hanya memakai aksi yang sudah ada (jalan lurus / idle / animasi).
//
// Cara pakai (sudah dipasang di world.js):
//   import { createFormation } from "./formation.js";
//   var formation = createFormation(chars, modelMatrix);
//   formation.start();       // tombol F
//   formation.update(t);     // tiap frame, SEBELUM model matrix karakter disusun
//   formation.print();       // tombol P: cetak posisi & arah hadap sekarang ke console
//
// =================== PENGATURAN (bagian yang Anda ubah) ===================
// >>> BAGIAN YANG ANDA UBAH UNTUK MENENTUKAN POSISI AKHIR <<<
// POSISI AKHIR TETAP per karakter: [x, z] di dunia (+x = kanan layar, +z = ke arah kamera / bawah layar).
// Urutan = nomor karakter: [Kuromi, Badtz-Maru, Hangyodon].
// Isi tiap entri dengan null kalau ingin posisi karakter itu dihitung otomatis dari FORM_ORDER / FORM_CENTER / FORM_SPACING.
// Tekan P di browser untuk mencetak posisi sekarang ke console, lalu tempel di sini.
var FORM_SLOTS = [
    [ 5.7, -8.1],   // Kuromi      (kiri layar)
    [10.0, -2.0],   // Badtz-Maru  (tengah)
    [14.3,  4.1]    // Hangyodon   (kanan layar)
];

// Layout otomatis (dipakai bila FORM_SLOTS = null atau entrinya null)
var FORM_ORDER = [0, 1, 2];     // urutan KIRI -> KANAN (nomor karakter): 0 Kuromi, 1 Badtz-Maru, 2 Hangyodon
var FORM_CENTER = null;         // titik tengah barisan [x, z]. null = otomatis tepat "di depan" Badtz (x Badtz, z Badtz - 6.5)
var FORM_SPACING = 7.5;         // jarak antar karakter (satuan world)

// Arah hadap akhir. Boleh SATU angka untuk semua, atau ARRAY per karakter [Kuromi, Badtz, Hangyodon].
// 0 = ke kamera (+z), 90 = kanan, 180 = menjauh, -90 = kiri, null = tidak berbalik di akhir (untuk tes)
// Contoh per karakter: [0, 0, 0]  atau  [20, 0, -20]  atau  [0, null, 0]
var FORM_FACE_DEG = [-55, -55, -55];

var FORM_TURN_RATE = 4;         // kecepatan berbalik badan
var FORM_KEEP_POS = true;       // menjaga posisi tetap saat karakter berbalik (kalau karakter malah melompat saat berbalik, coba ganti false)

// start / stop = aksi yang dipanggil untuk memulai & menghentikan jalan lurus tiap karakter (urutan = chars).
// speed = kecepatan jalan lurus (unit/detik). HANYA dipakai untuk karakter yang posisinya tidak bisa dibaca
// (tidak punya getPos() / focusOffset()), yaitu berhenti berdasarkan waktu. Kalau karakter berhenti kurang jauh
// KECILKAN angkanya, kalau kelewatan BESARKAN.
var FORM = [
    // Kuromi: walk('line', 0) = jalan lurus ke arah hadap model (yang sudah diputar ke slot di fase turn1).
    // JANGAN pakai toggle("walk") di sini: itu mengunci arah ke LAYAR kamera, bukan ke slot.
    { start: function (o) { o.stop(); o.walk('line', 0); }, stop: function (o) { o.stop(); }, speed: 2.0 },   // Kuromi
    { start: function (o) { o.play("straight"); }, stop: function (o) { o.play("idle"); },   speed: 2.0 },   // Badtz-Maru
    { start: function (o) { o.toggle("walk"); },   stop: function (o) { o.play("idle"); },   speed: 2.0 }    // Hangyodon
];
// ANIMASI SETELAH SEMUA KARAKTER SAMPAI & SELESAI BERBALIK (urutan = chars: Kuromi, Badtz-Maru, Hangyodon).
// Tiap karakter punya daftar langkah { t: detik sejak SEMUA siap, run: fungsi }. Langkah dijalankan berurutan sesuai t.
// Kuromi tidak bisa wave dan happy bersamaan (keduanya saling mengunci), jadi dibuat berurutan:
// wave selama 3.6 dtk, lalu happy mulai di t = 3.7. Ubah angkanya sesuka Anda. Kosongkan ( [] ) kalau tidak mau animasi.
var FORM_FINALE = [
    [ { t: 0,   run: function (o) { o.wave(); } },            // Kuromi: wave
      { t: 3.7, run: function (o) { o.cheer(); } } ],         //         lalu happy
    [ { t: 0,   run: function (o) { o.play("dance"); } } ],   // Badtz-Maru: dance
    [ { t: 0,   run: function (o) { o.play("happy"); } } ]    // Hangyodon: happy
];

// =================== LOGIKA (biasanya tidak perlu diubah) ===================
export function createFormation(chars, modelMatrix) {

var formCenter = FORM_CENTER || [chars[1].x, chars[1].z - 6.5];

var form = { phase: "idle", last: null };   // phase: idle | turn1 | march (jalan + berbalik per karakter begitu sampai) | finale (animasi akhir) | formed

var wrapAngle = function (a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
};
// slot baris karakter ke-i (dunia): [x, z]
var formSlot = function (i) {
    if (FORM_SLOTS && FORM_SLOTS[i]) return FORM_SLOTS[i];      // posisi tetap yang Anda tulis sendiri
    var k = FORM_ORDER.indexOf(i);
    return [formCenter[0] + (k - (FORM_ORDER.length - 1) / 2) * FORM_SPACING, formCenter[1]];
};
// arah hadap akhir karakter ke-i dalam derajat (null = tidak berbalik)
var formFaceDeg = function (i) {
    var d = Array.isArray(FORM_FACE_DEG) ? FORM_FACE_DEG[i] : FORM_FACE_DEG;
    return (d === undefined) ? null : d;
};
// posisi dunia karakter saat ini [x, z] bila bisa dibaca, null kalau tidak
var charPos = function (i) {
    var c = chars[i], o = c.obj;
    if (o.worldXZ) return o.worldXZ(c.M);                       // Kuromi: dihitung langsung dari M, selalu terbaru
    if (o.getPos) { var p = o.getPos(); if (p) return [p[0], p[2]]; }
    if (o.focusOffset) { var fo = o.focusOffset(c.M); return [c.x + fo[0], c.z + fo[2]]; }
    return null;
};
// ubah arah hadap TANPA membuat karakter melompat.
// Kenapa bisa melompat: karakter berjalan di ruang LOKAL modelnya (offset dari c.x, c.z). Memutar c.yaw memutar seluruh offset itu
// mengelilingi c.x, c.z, jadi karakter yang sudah berjalan jauh akan "terayun" ke tempat lain.
// Solusi: hitung offset terlihat d = posisi sekarang - (c.x, c.z), putar d sebesar selisih yaw, lalu geser c.x, c.z
// sebesar selisihnya supaya posisi yang terlihat tetap sama. Tidak perlu membaca posisi SESUDAH berputar (yang bisa basi).
var setYaw = function (c, i, yaw) {
    if (FORM_KEEP_POS) modelMatrix(c);                          // pastikan c.M cocok dengan c.x / c.z / c.yaw sekarang
    var p0 = FORM_KEEP_POS ? charPos(i) : null;                 // posisi terlihat sekarang (dunia)
    var dyaw = yaw - c.yaw;
    c.yaw = yaw;
    if (p0) {
        var dx = p0[0] - c.x, dz = p0[1] - c.z;                 // offset terlihat dari titik asal model
        var cd = Math.cos(dyaw), sd = Math.sin(dyaw);
        var nx = cd * dx + sd * dz, nz = -sd * dx + cd * dz;    // offset itu setelah ikut berputar (sama dengan modelMatrix)
        c.x += dx - nx;
        c.z += dz - nz;
    }
};
// berbalik halus menuju targetYaw; true bila sudah menghadap
var formTurn = function (c, i, targetYaw, dt) {
    var diff = wrapAngle(targetYaw - c.yaw);
    if (Math.abs(diff) <= 0.03) {
        if (c.yaw !== targetYaw) setYaw(c, i, targetYaw);
        return true;
    }
    setYaw(c, i, c.yaw + diff * (1 - Math.exp(-FORM_TURN_RATE * dt)));
    return false;
};

var formStart = function () {
    if (form.phase === "turn1" || form.phase === "march" || form.phase === "finale") return;   // sedang berjalan: abaikan
    chars.forEach(function (c, i) {
        var p = charPos(i) || [c.x, c.z];
        var s = formSlot(i);
        var vx = s[0] - p[0], vz = s[1] - p[1];
        c.fSlot = s;
        c.fDone = Math.hypot(vx, vz) <= 0.05;                         // sudah di slot: tidak perlu jalan
        c.fHead = c.fDone ? c.yaw : Math.atan2(vx, vz);               // yaw 0 = +z, sama seperti modelMatrix()
    });
    form.phase = "turn1";
};

var formUpdate = function (t) {
    var dt = form.last === null ? 0.016 : Math.min(0.05, Math.max(0.0005, t - form.last));
    form.last = t;
    var ready = true;

    if (form.phase === "turn1") {
        // 1. tiap karakter berbalik menghadap slot barisnya
        chars.forEach(function (c, i) { if (!formTurn(c, i, c.fHead, dt)) ready = false; });
        if (ready) {
            // 2. mulai jalan lurus bersamaan
            form.phase = "march";
            chars.forEach(function (c, i) {
                if (c.fDone) return;
                var p = charPos(i);
                var s = p || [c.x, c.z];
                var dist = Math.hypot(c.fSlot[0] - s[0], c.fSlot[1] - s[1]);
                c.fTimed = !p;                                        // posisi tak terbaca -> berhenti berdasarkan waktu
                c.fEnd = t + dist / FORM[i].speed;
                FORM[i].start(c.obj);
            });
        }
    } else if (form.phase === "march") {
        // 3. tiap karakter berhenti begitu sampai di slotnya, lalu LANGSUNG berbalik ke arah akhirnya
        //    (tidak menunggu karakter lain). FORM_FACE_DEG null -> karakter itu tidak berbalik.
        var allFormed = true;
        chars.forEach(function (c, i) {
            if (!c.fDone) {
                var arrived;
                if (c.fTimed) {
                    arrived = t >= c.fEnd;
                } else {
                    var p = charPos(i);
                    // sisa jarak searah jalan; <= 0 berarti sudah sampai / terlewat
                    arrived = p ? ((c.fSlot[0] - p[0]) * Math.sin(c.fHead) + (c.fSlot[1] - p[1]) * Math.cos(c.fHead) <= 0.05) : true;
                }
                if (arrived) { FORM[i].stop(c.obj); c.fDone = true; }
            }
            if (!c.fDone) { allFormed = false; return; }        // masih jalan
            var deg = formFaceDeg(i);
            if (deg === null) return;                           // tidak perlu berbalik
            if (!formTurn(c, i, deg * Math.PI / 180, dt)) allFormed = false;
        });
        if (allFormed) {                                        // SEMUA sudah sampai & selesai berbalik
            form.phase = "finale";
            form.finT0 = t;
            chars.forEach(function (c) { c.fStep = 0; });
        }
    } else if (form.phase === "finale") {
        // 4. jalankan animasi akhir tiap karakter sesuai jadwal FORM_FINALE
        var finDone = true;
        chars.forEach(function (c, i) {
            var steps = FORM_FINALE[i] || [];
            while (c.fStep < steps.length && t - form.finT0 >= steps[c.fStep].t) {
                steps[c.fStep].run(c.obj);
                c.fStep++;
            }
            if (c.fStep < steps.length) finDone = false;
        });
        if (finDone) form.phase = "formed";
    }
};

// Cetak posisi & arah hadap semua karakter saat ini (tombol P), siap ditempel ke kode
var printFormation = function () {
    var slots = chars.map(function (c, i) {
        var p = charPos(i) || [c.x, c.z];
        return "    [" + p[0].toFixed(1) + ", " + p[1].toFixed(1) + "]" + (i < chars.length - 1 ? "," : " ") + "   // " + c.name;
    }).join("\n");
    var faces = chars.map(function (c) {
        return Math.round(wrapAngle(c.yaw) * 180 / Math.PI);
    }).join(", ");
    console.log("var FORM_SLOTS = [\n" + slots + "\n];\nvar FORM_FACE_DEG = [" + faces + "];");
};

return { start: formStart, update: formUpdate, print: printFormation, state: form };

}