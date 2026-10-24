import { track } from "./transform.js";
import { secondary } from "./emote_animation.js";

// =====================================================================
// SLIP -> FALL -> GET UP -> SHAKE DRY  (1 sekuens, dipicu 1 tombol, dari video referensi)
//
//   0.00-0.45  TERPELESET : kaki kanan meluncur ke depan, badan condong ke belakang, tangan terlempar
//   0.45-1.25  JATUH      : badan berputar ke belakang (rotasi sumbu X di pivot telapak), kaki terangkat,
//                           mendarat -> squash & bounce
//   1.25-2.05  TERGELETAK : pusing, kepala miring, kaki menendang pelan
//   2.05-3.35  BANGUN     : duduk dulu (sit-up) lalu berdiri + loncat kecil
//   3.35-4.00  MENGGIGIL  : badan basah, gemetar kecil
//   4.00-7.50  MENGERING  : badan menggeliat/berputar cepat kiri-kanan di SUMBU SEMBARANG (miring) +
//                           lengan mengepak + percikan air (bola kecil dari kecil -> besar -> kecil)
//   7.50-8.60  SELESAI    : tenang lagi, lalu otomatis kembali ke idle
//
// Transformasi yang dipakai: Translasi (meluncur, loncat, percikan), Rotasi (jatuh/bangun, euler),
// Rotasi sumbu sembarang / Rodrigues (goyang kering + kepala menyusul), Scaling (squash, percikan),
// Hierarchy (kepala/lengan/kaki/gurita ikut badan).
//
//   evaluateSlip(t, w) -> { namaPart: { pos, euler, axis, scale, hidden } }   (format sama dgn animasi lain)
//   slipMove(t)        -> target gerak maju badan (dipakai pose di main_hangyodon.js)
// =====================================================================

export var SLIP_DURATION = 8.6;
export var DROP_COUNT = 16;                  // jumlah percikan air (part "drop0".."drop15" dibuat di main_hangyodon.js)

var T = SLIP_DURATION;
var TAU = Math.PI * 2;
var T_SHAKE0 = 4.0, T_SHAKE1 = 7.5;
var SHAKE_F = 3.4;                           // Hz, kecepatan goyang kering
var HEAD_AXIS = [0.1, 1.0, 0.16];
var BODY_AXIS = [0.07, 1.0, 0.04];           // sumbu goyang badan: MIRING sedikit (bukan sumbu Y murni)

// Tabel kontak tanah: |pitch badan| (rad) -> berapa unit badan harus diangkat supaya punggung menempel tanah
// (badan berputar di pivot telapak kaki, jadi tanpa ini punggung masuk ke dalam tanah).
var LIFT = [[0.0, 0.0], [0.3, 0.0], [0.5, 0.05], [0.7, 0.2], [0.9, 0.55], [1.1, 0.95], [1.25, 1.2], [1.4, 1.45]];   // hasil ukur
function liftFor(pitch) {
    var a = Math.abs(pitch);
    if (a >= LIFT[LIFT.length - 1][0]) return LIFT[LIFT.length - 1][1];
    for (var i = 0; i < LIFT.length - 1; i++) {
        if (a <= LIFT[i + 1][0]) {
            var u = (a - LIFT[i][0]) / (LIFT[i + 1][0] - LIFT[i][0]);
            return LIFT[i][1] + (LIFT[i + 1][1] - LIFT[i][1]) * u;
        }
    }
    return 0;
}

// Gerak maju badan selama sekuens: kecepatan jalan yang tersisa MELUNCUR (licin) lalu berhenti pelan
// k kecil = licin. Kalau sebelumnya tidak berjalan, tidak ada luncuran.
export function slipMove(t) {
    return { v: 0, turn: 0, k: 1.8 };
}

// percikan: tiap butir punya arah, kecepatan, ketinggian awal, periode, fase (deterministik)
var DROPS = [];
(function () {
    for (var i = 0; i < DROP_COUNT; i++) {
        var a = i * 2.399963;                                    // sudut emas -> tersebar merata
        var r = ((i * 0.6180339) % 1);                           // 0..1 pseudo-acak
        DROPS.push({
            dir: [Math.cos(a), Math.sin(a)],
            h: 0.1 + 2.7 * ((i * 0.381966) % 1),                 // tinggi awal di badan/kepala
            speed: 2.0 + 2.2 * r,
            up: 0.8 + 1.6 * ((i * 0.7548777) % 1),
            period: 0.85 + 0.5 * ((i * 0.5698403) % 1),
            phase: (i * 0.3247179) % 1,
            size: 0.8 + 0.8 * ((i * 0.8191725) % 1)
        });
    }
})();

export function evaluateSlip(t, w) {
    var out = {};
    var tc = Math.min(Math.max(t, 0), T - 1e-4);
    var K = function (keys) { return track(keys, tc, T); };
    var wave = function (f, ph) { return Math.sin(TAU * f * tc + (ph || 0)); };

    // ---- masker fase (0..1) ----
    var flail = K([[0, 0], [0.12, 1], [1.15, 1], [1.5, 0], [T, 0]]);                 // tangan/kaki menggapai saat jatuh
    var lying = K([[0, 0], [1.1, 0], [1.3, 1], [2.0, 1], [2.4, 0], [T, 0]]);          // tergeletak
    var shiver = K([[0, 0], [3.3, 0], [3.5, 1], [3.9, 1], [4.0, 0], [T, 0]]);         // menggigil
    var shake = K([[0, 0], [T_SHAKE0 - 0.3, 0], [T_SHAKE0 + 0.1, 1], [T_SHAKE1 - 0.6, 1], [T_SHAKE1, 0], [T, 0]]);   // goyang kering
    var closed = (tc > 0.3 && tc < 3.05) || (tc > T_SHAKE0 - 0.15 && tc < T_SHAKE1 + 0.25);        // mata terpejam ^ ^

    // ---------------- BADAN (root, pivot di telapak kaki) ----------------
    var pitch = K([[0, 0], [0.45, -0.30], [1.0, -1.38], [1.12, -1.29], [1.25, -1.38], [2.05, -1.38],
                   [2.65, -0.55], [2.85, -0.5], [3.35, 0], [T, 0]]);                   // Rotasi sumbu X: negatif = jatuh ke belakang
    var hop = K([[0, 0], [3.2, 0], [3.4, 0.28], [3.62, 0], [T, 0]]);                   // loncat kecil saat berdiri
    var slide = K([[0, 0], [1.0, -0.5], [2.05, -0.5], [3.35, 0], [T, 0]]);             // pantat mendarat sedikit di belakang
    var squash = K([[0, 0], [0.95, 0], [1.05, 1], [1.25, 0], [T, 0]]);                 // squash saat mendarat
    var bounceShake = Math.abs(wave(SHAKE_F)) * 0.06 * shake;
    var wobble = 0.12 * lying * wave(1.4) + 0.035 * shiver * wave(11) + 0.04 * shake * wave(SHAKE_F);
    out.body = {
        scale: [1 + (0.10 * squash + 0.03 * shake * wave(SHAKE_F * 2)) * w,
                1 - (0.12 * squash + 0.03 * shake * wave(SHAKE_F * 2)) * w,
                1 + (0.10 * squash + 0.03 * shake * wave(SHAKE_F * 2)) * w],
        euler: [pitch * w, 0, wobble * w],
        axis: { axis: BODY_AXIS, angle: 0.62 * shake * wave(SHAKE_F) * w },             // Rotate Arbitrary Axis (goyang kering)
        pos: [0, (liftFor(pitch) + hop + bounceShake) * w, slide * w]                    // Translate
    };

    // ---------------- KEPALA: tertahan lalu miring ke samping, menyusul goyang badan ----------------
    var headX = K([[0, 0], [0.4, -0.3], [1.0, 0.3], [2.0, 0.3], [2.8, 0], [T, 0]]);
    var headZ = K([[0, 0], [0.5, 0], [1.1, 0.5], [2.0, 0.55], [2.7, 0.2], [3.3, 0], [T, 0]]);
    out.head = {
        axis: { axis: HEAD_AXIS, angle: -0.45 * shake * Math.sin(TAU * SHAKE_F * tc - 1.1) * w },   // lag di belakang badan
        euler: [headX * w, 0, (headZ + 0.05 * shake * wave(SHAKE_F * 2)) * w]
    };

    // ---------------- WAJAH: mata terpejam, mulut menganga ----------------
    out.pupilL = { hidden: closed };
    out.pupilR = { hidden: closed };
    out.painEyeL = { hidden: !closed };   // mata meringis > <  (bukan ^ ^ yang terlihat senang)
    out.painEyeR = { hidden: !closed };
    var open = K([[0, 0], [0.3, 1], [2.9, 1], [3.4, 0.2], [3.9, 0], [4.0, 0.5], [7.3, 0.5], [T, 0]]);
    out.mouthLower = { euler: [(0.42 * open + 0.1 * shake * wave(SHAKE_F * 2)) * w, 0, 0] };

    // ---------------- LENGAN: menggapai -> terkulai -> menumpu -> mengepak saat kering ----------------
    var armX = K([[0, 0], [0.25, -1.6], [0.45, -1.9], [1.0, -1.9], [1.3, -0.9], [2.0, -0.6],
                  [2.4, 0.5], [2.9, 0.3], [3.4, 0], [T, 0]]);
    var armZ = K([[0, 0], [0.3, 0.9], [1.2, 1.1], [2.0, 0.9], [2.6, 0.4], [3.4, 0], [T, 0]]);
    [["armL", "handL", -1], ["armR", "handR", 1]].forEach(function (a, idx) {
        var s = a[2], ph = idx * Math.PI;
        var x = armX + 0.45 * flail * wave(3.2, ph) - 0.25 * shake;
        var z = armZ + shake * (0.55 + 0.40 * wave(SHAKE_F * 2, ph));
        out[a[0]] = { euler: [x * w, 0, s * z * w] };
        out[a[1]] = { euler: [(0.35 * flail * wave(3.2, ph + 1.0) + 0.3 * shake * wave(SHAKE_F * 2, ph + 0.8)) * w, 0, 0] };
    });

    // ---------------- KAKI: kanan meluncur ke depan, lalu keduanya terangkat & menendang ----------------
    var legR = K([[0, 0], [0.3, -1.0], [0.6, -1.15], [1.2, -1.1], [2.0, -1.0], [2.5, -0.4], [3.2, 0], [T, 0]]);
    var legL = K([[0, 0], [0.3, 0.25], [0.6, -0.9], [1.2, -1.05], [2.0, -0.95], [2.5, -0.3], [3.2, 0], [T, 0]]);
    var toe = K([[0, 0], [0.3, -0.5], [1.2, -0.4], [2.5, -0.2], [3.3, 0], [T, 0]]);
    var slideFoot = K([[0, 0], [0.3, 0.45], [0.7, 0.2], [1.0, 0], [T, 0]]);          // telapak kanan meluncur maju
    out.legR = { pos: [0, 0.1 * slideFoot, 0.6 * slideFoot], euler: [(legR + 0.18 * lying * wave(2.2)) * w, 0, 0] };
    out.legL = { euler: [(legL + 0.18 * lying * wave(2.2, 2.0)) * w, 0, 0] };
    out.footR = { euler: [toe * w, 0, 0] };
    out.footL = { euler: [toe * w, 0, 0] };

    // ---------------- SECONDARY: jambul, sirip, telinga, gurita + tentakel ikut terlempar ----------------
    var fsec = 2.2 + (SHAKE_F - 2.2) * shake;
    secondary(out, tc, w, fsec, 0.5 + 1.6 * flail + 1.6 * shake + 0.5 * lying);

    // ---------------- PERCIKAN AIR (anak dari badan): kecil -> besar -> kecil sambil terlempar keluar ----------------
    DROPS.forEach(function (d, i) {
        var u = (((tc / d.period) + d.phase) % 1 + 1) % 1;                  // 0..1 siklus hidup
        var life = Math.pow(Math.sin(Math.PI * u), 0.7);                    // 0 -> 1 -> 0
        var sc = 0.15 + 1.1 * life;
        sc *= shake * d.size * w;
        var dist = 1.5 + d.speed * u;                                        // menjauh dari badan
        out["drop" + i] = {
            pos: [d.dir[0] * dist, d.h + d.up * u - 2.4 * u * u, d.dir[1] * dist * 0.8],
            scale: [sc, sc * 1.35, sc],                                      // agak lonjong seperti tetesan
            hidden: sc < 0.06
        };
    });
    return out;
}
