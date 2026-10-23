import { track } from "./transform.js";

// =====================================================================
// IDLE ANIMATION Hangyodon (loop 6 detik), dibuat dari video referensi:
//   - kepala menoleh ke satu sisi (~30°), tahan, lalu kembali + miring sedikit
//   - pupil melirik mengikuti arah kepala, kedip (1x lalu kedip ganda)
//   - badan "bernapas" (squash & stretch halus) + goyang pelan
//   - lengan berayun pelan, jambul/sirip/telinga/ekor/gurita bergoyang terlambat
//     dari kepala (secondary motion)
//
// evaluateIdle(t, w) -> { namaPart: { pos, euler, axis, scale, hidden } }
//   t = waktu (detik), w = bobot 0..1 (untuk fade-in/out saat play/stop, supaya
//   transisi mulus dan tidak "loncat" ke pose idle).
// Nama part harus sama dengan nama di main_hangyodon.js.
// Pivot tiap part ditentukan di main_hangyodon.js (argumen ke-6 part()).
// =====================================================================

export var IDLE_PERIOD = 6.0;
var TAU = Math.PI * 2;
var P = IDLE_PERIOD;

var HEAD_AXIS = [0.1, 1.0, 0.16];      // sumbu putar kepala MIRING (bukan sumbu Y murni) -> menoleh sambil agak miring
var ARM_AXIS = [1.0, 0.0, 0.25];       // sumbu ayun lengan

export function evaluateIdle(t, w) {
    var out = {};
    var wave = function (period, phase) { return Math.sin(TAU * t / period + (phase || 0)); };

    // ---------------- BADAN (root): bernapas + goyang, pivot di tanah ----------------
    var br = wave(3.0);
    out.body = {
        scale: [1 + 0.006 * br * w, 1 + 0.014 * br * w, 1 + 0.006 * br * w],     // Scaling
        euler: [0, 0, 0.02 * wave(P, 0) * w],                                     // goyang kiri-kanan
        pos: [0.03 * wave(P, 0.6) * w, 0, 0]                                      // Translate
    };

    // ---------------- KEPALA: menoleh di SUMBU MIRING ----------------
    var yaw = track([[0, 0], [0.9, 0], [1.7, -0.5], [3.1, -0.5], [3.9, -0.12], [4.6, 0.14], [5.3, 0.03], [6, 0]], t, P);
    out.head = {
        axis: { axis: HEAD_AXIS, angle: yaw * w },                                // Rotate Arbitrary Axis
        euler: [0.03 * wave(3.0, 0.8) * w, 0, 0]                                  // angguk halus
    };

    // ---------------- MATA: pupil melirik + kelopak (kedip) ----------------
    var gazeX = track([[0, 0], [0.9, 0], [1.4, -0.07], [3.2, -0.07], [3.9, 0.01], [4.5, 0.07], [5.3, 0], [6, 0]], t, P);
    var gazeY = track([[0, 0], [1.4, 0], [2.0, 0.025], [3.2, 0.025], [4.0, 0], [6, 0]], t, P);
    out.pupilL = { pos: [gazeX * w, gazeY * w, 0] };                              // Translate
    out.pupilR = { pos: [gazeX * w, gazeY * w, 0] };

    var lid = track([[0, 0], [2.3, 0], [2.38, 1], [2.5, 0], [4.9, 0], [4.97, 1], [5.05, 0], [5.12, 1], [5.22, 0], [6, 0]], t, P);
    var lidY = Math.max(0.001, lid * w);
    var lidDelta = { scale: [1, lidY, 1], hidden: lidY < 0.2 };                  // Scaling (kelopak turun dari atas mata)
    out.lidL = lidDelta;
    out.lidR = lidDelta;

    // ---------------- LENGAN: ayun di sumbu miring + pergelangan menyusul ----------------
    [["armL", "handL", 0.0], ["armR", "handR", 2.5]].forEach(function (a) {
        out[a[0]] = { axis: { axis: ARM_AXIS, angle: 0.07 * wave(3.0, a[2]) * w }, euler: [0, 0, 0.025 * wave(3.0, a[2] + 1.0) * w] };
        out[a[1]] = { euler: [0.12 * wave(3.0, a[2] - 0.9) * w, 0, 0] };
    });

    // ---------------- SECONDARY MOTION (menyusul gerak kepala) ----------------
    out.crestBig = { euler: [0, 0, 0.05 * wave(3.0, -1.0) * w] };
    out.crestSmall = { euler: [0, 0, 0.07 * wave(3.0, -1.4) * w] };
    out.dorsalFin = { euler: [0.05 * wave(3.0, -0.8) * w, 0, 0] };
    out.earL = { euler: [0, 0.05 * wave(3.0, -0.6) * w, 0] };
    out.earR = { euler: [0, -0.05 * wave(3.0, -0.6) * w, 0] };
    out.tailFin = { euler: [0, 0.12 * wave(3.0, -0.3) * w, 0] };
    out.mouthLower = { euler: [0.02 * wave(3.0, 0.4) * w, 0, 0] };
    out.octopus = { euler: [0, 0, 0.06 * wave(2.0, 0) * w] };
    for (var k = 0; k < 8; k++) {
        var ph = k * 0.78;
        out["tent" + k] = { euler: [0.12 * wave(2.0, ph) * w, 0, 0.12 * Math.cos(TAU * t / 2.0 + ph) * w] };
    }
    return out;
}
