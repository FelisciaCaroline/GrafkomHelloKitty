// kuromi_happy.js
// ANIMASI HAPPY (cheer): membungkuk -> pop melompat -> mata ^ ^ -> kilau & hati muncul.
// Isi file ini: parameter & kurva keyframe, waktu cheer, envelope "senang", kurva squash/lompat/tangan,
// kontribusi pose (kepala, telinga, mulut, pipi), dan gambar dekorasi (bintang & hati).
// Dimuat SEBELUM kuromi.js (setelah kuromi_utils.js). Mengisi window.KuromiLib.HAPPY dan fungsi cheer*/happy*.
// State (A) milik kuromi.js. Dipicu lewat k.cheer() (tombol H) atau otomatis oleh jadwal idle.
(function () {

var L = window.KuromiLib = window.KuromiLib || {};

/*---- PARAMETER HAPPY (ubah di sini) ----
   Timeline disalin dari video referensi (30 fps), c = detik sejak cheer mulai:
   c 0.0 - 0.7   : membungkuk pelan, kepala turun & menunduk, telinga mengembang, tangan melebar
   c 0.7 - 0.9   : pop naik cepat (sedikit overshoot), mulut terbuka, tangan merapat ke dada
   c 0.95        : mata ^ ^
   c 1.1 / 1.4 / 1.55 / 1.75 : kilau kecil, kilau putih besar, kilau oranye, hati */
var HP = L.HAPPY = {
    CHEER_LEN: 4.4,      // durasi total cheer (detik)
    HAPPY_END: 3.4,      // envelope "senang" (mulut/pipi/mata ^) berakhir di c ini

    // kurva cheer (ukur dari video): squash badan, menunduk kepala (rad), lebar tangan ke samping
    SQ_KEYS:     [[0, 0], [0.1, 0.05], [0.3, 0.35], [0.5, 0.6], [0.6, 0.65], [0.7, 0.55], [0.8, 0.0], [0.9, -0.35], [1.1, -0.2], [1.5, -0.1], [3.2, -0.06], [4.2, 0]],
    PITCH_KEYS:  [[0, 0], [0.1, 0.05], [0.3, 0.2], [0.5, 0.36], [0.6, 0.4], [0.7, 0.35], [0.8, 0.05], [0.9, -0.1], [1.1, -0.06], [1.5, -0.05], [3.2, -0.03], [4.2, 0]],
    ARMOUT_KEYS: [[0, 0], [0.15, 0.15], [0.35, 0.6], [0.55, 1.0], [0.68, 1.0], [0.8, 0.2], [0.9, 0]],
    // TRANSLASI: lompatan saat "pop" (unit model). Naik cepat di c 0.75-0.95, turun pelan, mendarat di c 1.35
    JUMP_KEYS:   [[0, 0], [0.75, 0], [0.95, 0.45], [1.15, 0.22], [1.35, 0], [4.4, 0]],

    // dekorasi muncul berurutan seperti di video (posisi dalam ruang model, di depan telinga)
    DECOR: [
        { on: 1.10, x: 2.45, y: 1.35, z: 1.8, size: 0.30, type: 'star',  col: [1.0, 0.95, 0.55], k: 0.0 },
        { on: 1.35, x: 2.75, y: 0.55, z: 1.8, size: 0.22, type: 'star',  col: [1.0, 0.95, 0.55], k: 2.1 },
        { on: 1.40, x: -0.45, y: 4.95, z: 2.0, size: 0.95, type: 'star', col: [1.0, 1.0, 0.92],  k: 4.0 },
        { on: 1.55, x: 0.55, y: 4.60, z: 2.0, size: 0.55, type: 'star',  col: [1.0, 0.62, 0.42], fat: 1.9, k: 1.2 },
        { on: 1.75, x: 1.50, y: 4.60, z: 2.0, size: 0.46, type: 'heart', col: [0.95, 0.25, 0.42], k: 3.1 }
    ]
};

/*---- MULAI cheer (dipakai k.cheer() dan jadwal idle). now = detik ---- */
L.cheerTrigger = function (A, now) {
    if (A.cheering) return;
    A.waving = false;
    A.cheering = true;
    A.cheerStart = now;
};

/*---- waktu cheer: return c (detik sejak mulai) atau -1 bila tidak sedang cheer; mengakhiri cheer bila sudah selesai ---- */
L.cheerTime = function (A, now) {
    var c = A.cheering ? now - A.cheerStart : -1;
    if (A.cheering && c >= HP.CHEER_LEN) { A.cheering = false; A.cycStart = now; c = -1; }
    return c;
};

/*---- envelope "senang" (A.happy 0..1) ---- */
L.happyEnvelope = function (A, c, damp) {
    var happyOn = (c > 0.78 && c < HP.HAPPY_END);
    A.happy = damp(A.happy, happyOn ? 1 : 0, happyOn ? 9 : 3.2);
};

/*---- mata ^ ^ aktif? ---- */
L.happyEyes = function (c) { return c > 0.95 && c < HP.HAPPY_END; };

/*---- kurva cheer pada waktu c -> { sq: squash, pk: menunduk, ao: tangan melebar, jp: lompat } ---- */
L.cheerCurves = function (c) {
    var o = { sq: 0, pk: 0, ao: 0, jp: 0 };
    if (c >= 0) {
        o.sq = L.keys(c, HP.SQ_KEYS);
        o.pk = L.keys(c, HP.PITCH_KEYS);
        o.ao = L.keys(c, HP.ARMOUT_KEYS);
        o.jp = L.keys(c, HP.JUMP_KEYS);
    }
    return o;
};

/*---- kontribusi pose senang (DITAMBAHKAN ke S) ----
   h = A.happy, pk = menunduk dari kurva, bob = sin(2*pi*bobPh), now = detik */
L.happyHop = function (h, bob) { return h * 0.025 * (1 + bob); };
L.happyEarShake = function (h, now) { return 0.06 * h * Math.sin(now * 14); };
L.happyPose = function (S, A, h, pk, bob, now) {
    S.roll  += h * 0.07 * Math.sin(A.bobPh * Math.PI + 0.7);
    S.yaw   += h * 0.05 * Math.sin(A.bobPh * Math.PI * 0.7);
    S.pitch += pk - 0.04 * h;
    S.headY += h * 0.04 * bob;
    S.earFlare += 0.06 * S.sq + 0.75 * Math.max(pk, 0);          // telinga mengembang saat menunduk
    S.mouth = Math.max(S.mouth, h * (0.95 + 0.05 * Math.sin(now * 8)));
    S.blush = Math.max(S.blush, L.clamp01(h * 1.2));
};

/*---- gambar dekorasi: kilau & hati muncul berurutan (ikut M saja, tidak ikut squash) ----
   env = { drawStar, drawHeart } dari kuromi.js. Pemanggil sudah setM(M). */
L.drawHappyDecor = function (env, S, now) {
    if (S.c < 0) return;
    var hv = L.clamp01(S.happy * 2);
    for (var i = 0; i < HP.DECOR.length; i++) {
        var d = HP.DECOR[i];
        var u = (S.c - d.on) / 0.3;
        if (u <= 0 || hv <= 0.01) continue;
        var sc = d.size * L.easeOutBack(L.clamp01(u)) * hv * (1 + 0.12 * Math.sin(now * 7 + d.k));
        var yy = d.y + 0.06 * Math.sin(now * 2.2 + d.k);
        if (d.type === 'heart') env.drawHeart(d.x, yy, d.z, sc, d.col);
        else env.drawStar(d.x, yy, d.z, sc, d.col, now * 1.5 + d.k, d.fat);   // bintang berputar
    }
};

})();