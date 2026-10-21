import { track } from "./transform.js";

// =====================================================================
// EMOTE ANIMATIONS Hangyodon (formatnya sama dengan idle_animation.js):
//   evaluateX(t, w) -> { namaPart: { pos, euler, axis, scale, hidden } }
//   t = waktu (detik), w = bobot 0..1 (fade-in/out).
//
//   1) evaluateHappy      : emote senang dari video (4 detik, loop) + hati & kilau bintang
//   2) evaluateWalk       : jalan di tempat, kepala "bop" kiri-kanan + mata ^ ^ (dari GIF)
//   3) evaluateWalkCircle : gerak kepala yang sama, tapi berjalan MELINGKAR (orbit seperti planet)
//                           memakai rotasi di SUMBU SEMBARANG (axis-angle) yang pusatnya digeser
// Nama part harus sama dengan nama di main_hangyodon.js.
// =====================================================================

var TAU = Math.PI * 2;
var HEAD_AXIS = [0.1, 1.0, 0.16];            // sama dengan idle: sumbu putar kepala miring

// gelombang "bop": sinus yang dibuat lebih "tahan" di kiri/kanan (kepala berhenti sebentar di ujung)
function bop(x) { return Math.tanh(1.8 * Math.sin(x)) / Math.tanh(1.8); }

// gerak sekunder (jambul, sirip, telinga, ekor, gurita + tentakel) yang menyusul gerak kepala
function secondary(out, t, w, f, amp) {
    var ph = function (p) { return TAU * f * t + p; };
    out.crestBig = { euler: [0, 0, 0.07 * amp * Math.sin(ph(-1.0)) * w] };
    out.crestSmall = { euler: [0, 0, 0.10 * amp * Math.sin(ph(-1.4)) * w] };
    out.dorsalFin = { euler: [0.07 * amp * Math.sin(ph(-0.8)) * w, 0, 0] };
    out.earL = { euler: [0, 0.10 * amp * Math.sin(ph(-0.6)) * w, 0] };
    out.earR = { euler: [0, -0.10 * amp * Math.sin(ph(-0.6)) * w, 0] };
    out.tailFin = { euler: [0, 0.20 * amp * Math.sin(ph(-0.3)) * w, 0] };
    out.octopus = { euler: [0, 0, 0.08 * amp * Math.sin(ph(0.5)) * w] };
    for (var k = 0; k < 8; k++) {
        var p = k * 0.78;
        out["tent" + k] = { euler: [0.14 * amp * Math.sin(ph(p)) * w, 0, 0.14 * amp * Math.cos(ph(p)) * w] };
    }
}

// =====================================================================
// 1) HAPPY EMOTE  (loop 4 detik, mengikuti video)
//    0.0-0.7  melirik kiri-kanan, tangan terbuka
//    0.7-1.2  mata jadi ^ ^, squash -> loncat kecil, tangan naik ke dekat pipi, hati muncul (pop)
//    1.2-3.4  tahan: kepala goyang, badan memantul pelan, hati berdenyut, kilau berkelap-kelip
//    3.4-4.0  hati hilang, mata terbuka lagi, tangan turun
// =====================================================================
export var HAPPY_PERIOD = 4.0;
var HP = HAPPY_PERIOD;
var HAPPY_ON = 0.75, HAPPY_OFF = 3.55;       // rentang waktu mata ^ ^

// posisi dasar efek ada di main_hangyodon.js (part), di sini hanya delta (pos/scale/euler)
var SPARKS = [                                 // [periode, fase] tiap kilau
    [0.9, 0.00], [1.1, 0.35], [0.8, 0.62], [1.0, 0.15], [1.2, 0.80], [0.95, 0.50]
];

export function evaluateHappy(t, w) {
    var out = {};
    var tt = ((t % HP) + HP) % HP;
    var wave = function (period, phase) { return Math.sin(TAU * t / period + (phase || 0)); };
    var happy = tt > HAPPY_ON && tt < HAPPY_OFF;
    var hold = track([[0, 0], [0.7, 0], [1.2, 1], [3.3, 1], [3.7, 0], [4, 0]], t, HP);   // 0..1: fase "senang"

    // ---------------- BADAN: menoleh, squash & stretch, loncat, memantul ----------------
    var sy = track([[0, 1], [0.5, 1], [0.72, 0.92], [0.95, 1.07], [1.2, 1], [3.45, 1], [3.6, 0.94], [3.8, 1.02], [4, 1]], t, HP);
    var jump = track([[0, 0], [0.72, 0], [0.95, 0.14], [1.2, 0], [4, 0]], t, HP);
    var bodyYaw = track([[0, 0.3], [0.6, 0.12], [0.9, 0], [3.5, 0], [3.8, 0.2], [4, 0.3]], t, HP);
    var bounce = 0.5 - 0.5 * Math.cos(TAU * t / 0.6);                                     // 0..1, 1.6 Hz
    var sY = 1 + (sy - 1) * w;
    out.body = {
        scale: [1 + (1 - sY) * 0.5, sY, 1 + (1 - sY) * 0.5],                              // Scaling (volume kira-kira tetap)
        euler: [0, bodyYaw * w, 0.035 * hold * wave(1.2) * w],                            // menoleh + goyang
        pos: [0, (jump + 0.05 * hold * bounce) * w, 0]                                    // Translate (loncat + pantul)
    };

    // ---------------- KEPALA: menoleh di sumbu miring + miring kiri-kanan ----------------
    var yaw = track([[0, 0.3], [0.3, 0.5], [0.6, -0.3], [0.85, 0], [3.5, 0], [3.75, 0.25], [4, 0.3]], t, HP);
    out.head = {
        axis: { axis: HEAD_AXIS, angle: yaw * w },                                        // Rotate Arbitrary Axis
        euler: [0.04 * hold * wave(0.6, 0.5) * w, 0, (0.03 + 0.11 * wave(1.2, 0.4)) * hold * w]
    };

    // ---------------- MATA: pupil melirik -> mata senang ^ ^ ----------------
    var gaze = track([[0, 0.08], [0.3, 0.08], [0.6, -0.08], [0.85, 0], [3.5, 0], [3.75, 0.06], [4, 0.08]], t, HP);
    out.pupilL = { pos: [gaze * w, 0, 0], hidden: happy };
    out.pupilR = { pos: [gaze * w, 0, 0], hidden: happy };
    out.happyEyeL = { hidden: !happy };
    out.happyEyeR = { hidden: !happy };

    // ---------------- LENGAN: terbuka -> naik memeluk dekat pipi + bergetar kecil ----------------
    var spread = track([[0, 0.8], [0.5, 0.9], [0.8, 0], [3.5, 0], [3.75, 0.8], [4, 0.8]], t, HP);
    var raise = track([[0, 0], [0.6, 0], [1.0, 1], [3.3, 1], [3.7, 0], [4, 0]], t, HP);
    [["armL", "handL", -1], ["armR", "handR", 1]].forEach(function (a) {
        var s = a[2];
        var shake = 0.07 * hold * Math.sin(TAU * t / 0.35 + (s < 0 ? 0 : 1.6));
        out[a[0]] = { euler: [(-1.0 * raise + shake) * w, -s * 0.5 * raise * w, s * 0.55 * spread * w] };
        out[a[1]] = { euler: [-0.35 * raise * w, 0, -s * 0.25 * raise * w] };
    });

    // ---------------- MULUT: terkekeh kecil ----------------
    out.mouthLower = { euler: [0.07 * hold * (0.5 + 0.5 * wave(0.5)) * w, 0, 0] };

    // ---------------- SECONDARY MOTION ----------------
    secondary(out, t, w, 1 / 0.6, 0.3 + 0.9 * hold);

    // ---------------- EFEK: HATI BESAR (pop + berdenyut) ----------------
    var hs = track([[0, 0], [0.82, 0], [0.98, 1.2], [1.12, 0.95], [1.25, 1], [3.4, 1], [3.52, 1.15], [3.68, 0], [4, 0]], t, HP);
    hs *= (1 + 0.07 * hold * wave(0.8)) * w;
    out.heartBig = {
        pos: [0, 0.1 * hold * wave(1.6) * w, 0],
        euler: [0, 0.35 * wave(2.4), 0.12 * hold * wave(1.3)],                            // goyang + berputar pelan di sumbu Y
        scale: [hs, hs, hs],
        hidden: hs < 0.03
    };

    // ---------------- EFEK: HATI KECIL melayang naik lalu hilang ----------------
    for (var i = 0; i < 3; i++) {
        var u = ((t / 1.9 + i / 3) % 1 + 1) % 1;                                          // 0..1 siklus hidup tiap hati
        var s2 = Math.sin(Math.PI * Math.min(u * 1.15, 1)) * hold * w * 0.95;            // membesar lalu mengecil
        out["heartS" + i] = {
            pos: [0.25 * Math.sin(TAU * u * 1.5 + i), 1.0 * u, 0],
            euler: [0, TAU * u * 0.6, 0.25 * Math.sin(TAU * u + i)],
            scale: [s2, s2, s2],
            hidden: s2 < 0.03
        };
    }

    // ---------------- EFEK: KILAU BINTANG berkelap-kelip ----------------
    SPARKS.forEach(function (sp, k) {
        var u2 = ((t / sp[0] + sp[1]) % 1 + 1) % 1;
        var env = Math.pow(Math.sin(Math.PI * u2), 2);                                    // 0 -> 1 -> 0
        var s3 = (0.15 + 1.05 * env) * hold * w;
        out["spark" + k] = { euler: [0, 0, u2 * 1.6], scale: [s3, s3, s3], hidden: s3 < 0.05 };
    });
    return out;
}

// =====================================================================
// 2) WALK IN PLACE + 3) WALK IN CIRCLE
//    Siklus langkah WALK_PERIOD detik (= 1 bop kiri-kanan). Dari GIF: kepala miring/geser
//    ke kiri lalu ke kanan, mata ^ ^, badan ikut goyang. Pada versi ini badan berdiri
//    (bukan duduk): kaki bergantian terangkat, lengan berayun berlawanan dengan kaki.
// =====================================================================
export var WALK_PERIOD = 0.8;
export var CIRCLE_RADIUS = 1.6;              // jari-jari lingkaran orbit
export var CIRCLE_PERIOD = 10.0;             // detik untuk 1 putaran penuh

function walkPose(t, w) {
    var out = {};
    var ph = TAU * t / WALK_PERIOD;           // fase langkah
    var b = bop(ph);                          // -1..1, kepala kiri <-> kanan

    // ---------------- BADAN: memantul tiap langkah + goyang pinggul ----------------
    out.body = {
        scale: [1, 1 - 0.02 * Math.cos(2 * ph) * w, 1],                              // squash tiap langkah
        euler: [0, 0, -0.05 * Math.sin(ph) * w],                                      // goyang kiri-kanan
        pos: [0, 0.07 * Math.abs(Math.sin(ph)) * w, 0]                                // pantulan vertikal
    };

    // ---------------- KEPALA: bop kanan-kiri (miring + geser), menoleh sedikit di sumbu miring ----------------
    out.head = {
        axis: { axis: HEAD_AXIS, angle: 0.10 * b * w },                               // Rotate Arbitrary Axis
        euler: [0.04 * Math.cos(2 * ph) * w, 0, 0.22 * b * w],                        // miring (roll) kiri-kanan
        pos: [0.10 * b * w, 0, 0]                                                     // geser kiri-kanan
    };

    // ---------------- MATA: mata ^ ^ (pupil disembunyikan) ----------------
    out.pupilL = { hidden: true };
    out.pupilR = { hidden: true };
    out.happyEyeL = {};
    out.happyEyeR = {};

    // ---------------- MULUT: ikut memantul ----------------
    out.mouthLower = { euler: [0.05 * Math.sin(2 * ph - 0.5) * w, 0, 0] };

    // ---------------- KAKI: bergantian terangkat & melangkah (jalan di tempat) ----------------
    [["legR", "footR", 0], ["legL", "footL", Math.PI]].forEach(function (L) {
        var p = ph + L[2];
        var lift = Math.max(0, Math.sin(p));                                          // 0..1 saat kaki di udara
        out[L[0]] = { pos: [0, 0.34 * lift * w, -0.24 * Math.cos(p) * w], euler: [-0.25 * lift * w, 0, 0] };
        out[L[1]] = { euler: [-0.3 * lift * w, 0, 0] };                               // ujung kaki terangkat
    });

    // ---------------- LENGAN: berayun berlawanan dengan kaki di sisi yang sama ----------------
    [["armL", "handL", 0], ["armR", "handR", Math.PI]].forEach(function (A) {
        var p = ph + A[2];
        out[A[0]] = { euler: [0.6 * Math.cos(p) * w, 0, 0] };
        out[A[1]] = { euler: [0.3 * Math.cos(p - 0.8) * w, 0, 0] };
    });

    secondary(out, t, w, 2 / WALK_PERIOD, 1.2);                                       // jambul/telinga/ekor menyusul
    return out;
}

export function evaluateWalk(t, w) {
    return walkPose(t, w);
}

// Berjalan MELINGKAR: tubuh berputar di SUMBU SEMBARANG = sumbu vertikal yang melewati titik pusat C
// (bukan sumbu badan sendiri), seperti planet mengelilingi matahari.
//   R_axis(theta) di sekitar C  ==  rotasi di sekitar pivot badan + translasi (C - R*C)
// Lingkaran dipusatkan di titik (0,0,0) dunia supaya karakter tetap di tengah layar.
export function evaluateWalkCircle(t, w) {
    var out = walkPose(t, w);
    var theta = TAU * t / CIRCLE_PERIOD;
    theta = Math.atan2(Math.sin(theta), Math.cos(theta)) * w;     // dibungkus (-PI,PI] lalu x bobot: kembali ke depan saat stop
    var r = CIRCLE_RADIUS * w;
    var body = out.body;
    body.axis = { axis: [0, 1, 0], angle: theta };                // Rotate Arbitrary Axis: arah hadap mengikuti garis singgung
    body.euler[2] += -0.06 * w;                                   // sedikit condong ke pusat lingkaran
    body.pos = [-r * Math.cos(theta), body.pos[1], r * Math.sin(theta)];   // posisi di lingkaran = -Ry(theta) * C, C = (R,0,0)
    return out;
}
