// kuromi_wave.js
// ANIMASI WAVE (melambai): satu tangan terangkat ke samping-atas lalu diayun kiri-kanan, kepala miring, senyum lebar.
// Isi file ini: parameter, pemicu, envelope waktu, kontribusi pose (kepala, pinggul, telinga, mulut) dan pose lengan.
// Dimuat SEBELUM kuromi.js (setelah kuromi_utils.js). Mengisi window.KuromiLib.WAVE dan fungsi wave*.
// State (A) milik kuromi.js. Dipicu lewat k.wave() (tombol V) atau otomatis oleh jadwal idle.
(function () {

var L = window.KuromiLib = window.KuromiLib || {};

/*---- PARAMETER WAVE (ubah di sini) ---- */
var WV = L.WAVE = {
    LEN: 3.6,     // durasi total (detik)
    SIDE: 1,      // 1 = tangan di sisi +x (kanan layar), -1 = kiri layar
    RATE: 2.6     // ayunan tangan per detik
};

/*---- MULAI wave (dipakai k.wave() dan jadwal idle). Tidak jalan kalau sedang cheer / wave. now = detik ---- */
L.waveTrigger = function (A, now) {
    if (A.cheering || A.waving) return;
    A.waving = true;
    A.waveStart = now;
};

/*---- update tiap frame: envelope naik 0.45 dtk, tahan, turun 0.5 dtk. return wv (0..1) ---- */
L.waveUpdate = function (A, now, dt) {
    var wc = A.waving ? now - A.waveStart : -1;
    if (A.waving && wc >= WV.LEN) { A.waving = false; A.cycStart = now; wc = -1; }
    var wv = wc >= 0 ? L.smooth(wc / 0.45) * (1 - L.smooth((wc - (WV.LEN - 0.5)) / 0.5)) : 0;
    A.wavePh += dt * 2 * Math.PI * WV.RATE * wv;
    return wv;
};

/*---- kontribusi pose wave (DITAMBAHKAN ke S). wv = envelope, ph = A.wavePh ---- */
L.wavePose = function (S, wv, ph) {
    S.roll  -= wv * 0.10 * WV.SIDE;
    S.yaw   += wv * 0.06 * WV.SIDE * Math.sin(ph * 0.5);
    S.pitch -= wv * 0.05;                                            // condong ke depan
    S.headY += wv * 0.025 * Math.sin(ph);
    S.waddle += wv * 0.06 * Math.sin(ph * 0.5);                      // goyang pinggul
    S.earFlare += 0.10 * wv * Math.max(0, Math.sin(ph));
    if (wv > 0.01) {
        S.mouth = Math.max(S.mouth, 1.2 * wv);                       // senyum lebar saat melambai
        S.blush = Math.max(S.blush, 0.8 * wv);
    }
};

/*---- pose lengan yang melambai. r = [rx, ry, rz] lengan biasa untuk sisi `side`; return r baru ----
   Hanya lengan WAVE.SIDE yang melambai: terangkat ke samping-atas lalu diayun kiri-kanan. */
L.waveArm = function (side, r, S) {
    var wvS = (side === WV.SIDE) ? S.wave : 0;
    var rx = r[0], ry = r[1], rz = r[2];
    if (wvS > 0.001) {
        rx = rx * (1 - wvS) + (-0.45) * wvS;                         // sedikit ke depan supaya tidak tertutup kepala
        ry = ry * (1 - wvS);
        rz = rz * (1 - wvS) + side * (1.5 + 0.32 * Math.sin(S.wavePh)) * wvS;   // ROTASI: terangkat + diayun
    }
    return [rx, ry, rz];
};

})();