// kuromi_walk.js
// Semua yang mengatur JALAN Kuromi: parameter, update per frame (lurus / muter / berhenti), dan mulai/hentikan jalan.
// Dimuat SEBELUM kuromi.js. Mengisi window.KuromiLib.WALK, .walkUpdate, .walkToggle.
// State (A) milik kuromi.js; file ini hanya membaca & mengubahnya.
(function () {

var L = window.KuromiLib = window.KuromiLib || {};

/*---- PARAMETER JALAN (ubah di sini) ----*/
var W = L.WALK = {
    SPEED: 2.3,                 // kecepatan (unit/detik)
    STRAIGHT_DIST: Infinity,    // jarak maksimum jalan lurus. Infinity = jalan terus sampai tombol J ditekan lagi
    LINE_ANGLE: 0,              // arah jalan lurus bawaan: 0 = ke bawah layar (arah kamera), Math.PI = ke atas, Math.PI/2 = kanan, -Math.PI/2 = kiri
    TURN_SPEED: 4.0,            // kecepatan berputar badan (rad/detik)
    FROM_FACING: true,          // true = jalan lurus mulai dari ARAH HADAP TERAKHIR Kuromi, dan setelah berhenti dia tetap menghadap arah itu (tidak berputar balik ke kamera)
    SNAP_TO_GIVEN_ANGLE: true,  // true = kalau arah jalan diberikan dari luar (mis. formation.js: walk('line', 0)), badan langsung menghadap arah itu tanpa putar dulu -> tidak ada jeda/bounce sebelum jalan
    RELATIVE_TO_CAMERA: false,  // true = arah jalan lurus mengikuti LAYAR saat J ditekan (dikunci selama jalan); false = pakai LINE_ANGLE (arah dunia)
    SCREEN_OFFSET: -0.25,       // relatif layar: 0 = ke bawah layar, negatif = ke kiri, positif = ke kanan (Math.PI = ke atas)
    CIRCLE_R: 2.2,              // jari-jari lingkaran
    CIRCLE_DIR: 1               // 1 = satu arah putar, -1 = kebalikannya
};

/*---- UPDATE JALAN tiap frame ----
   A    : state animasi Kuromi (dari kuromi.js)
   dt   : detik sejak frame sebelumnya
   damp : fungsi redaman (cur, target, lambda) -> nilai baru
   return: w = seberapa penuh animasi jalan (0..1), dipakai kuromi.js untuk pose kaki/badan/ekor */
L.walkUpdate = function (A, dt, damp) {
    // jalan lurus: badan diputar dulu ke arah jalan (tanpa animasi langkah), baru melangkah -> tidak "bounce" di tempat
    var wantsLine = A.walking && A.mode === 'line' && A.followPath && !A.cheering && !A.laughing && !A.waving;
    var errL = wantsLine ? Math.atan2(Math.sin(A.lineAngle - A.heading), Math.cos(A.lineAngle - A.heading)) : 0;
    var aligned = Math.abs(errL) < 0.2;
    var wOn = A.walking && !A.cheering && !A.laughing && !A.waving && (A.mode === 'circle' || aligned);
    A.walkAmt = damp(A.walkAmt, wOn ? 1 : 0, 6);
    var w = A.walkAmt;
    A.walkPh += dt * 2 * Math.PI * 1.1 * w;          // 1.1 siklus langkah / detik

    /* ---- jalan: LURUS (satu arah) atau MUTER (lingkaran) ----
       Posisi (A.x, A.z) disimpan terus, jadi setelah cheer/ketawa/melambai dia lanjut dari titik terakhir.
       Berhenti jalan -> badan tetap menghadap arah terakhir (W.FROM_FACING), posisi tetap.
       Arah maju badan pada heading psi = (sin psi, cos psi) di bidang (x, z). */
    var moving = wOn && A.followPath;

    if (moving && A.mode === 'circle') {
        // MUTER: arah hadap terus berputar, posisi dihitung eksak sepanjang busur
        if (!A.wasCircling) A.cpsi = A.heading;               // mulai dari arah hadap saat ini
        var dpsi = W.CIRCLE_DIR * (W.SPEED * w / W.CIRCLE_R) * dt;
        var p2 = A.cpsi + dpsi;
        A.x += W.CIRCLE_DIR * W.CIRCLE_R * (Math.cos(A.cpsi) - Math.cos(p2));   // TRANSLASI
        A.z += W.CIRCLE_DIR * W.CIRCLE_R * (Math.sin(p2) - Math.sin(A.cpsi));
        A.cpsi = p2;
        A.heading = p2;                                        // ROTASI: badan ikut menyinggung lingkaran
        A.wasCircling = true;
    } else {
        // LURUS (atau berhenti): putar badan ke arah jalan / pertahankan arah hadap
        A.wasCircling = false;
        var wantHeading = wantsLine ? A.lineAngle : (W.FROM_FACING ? A.heading : 0);
        var err = Math.atan2(Math.sin(wantHeading - A.heading), Math.cos(wantHeading - A.heading));
        var maxTurn = (wantsLine ? W.TURN_SPEED * 2.5 : W.TURN_SPEED) * dt;   // putar lebih cepat saat mau mulai jalan
        A.heading += Math.max(-maxTurn, Math.min(maxTurn, err));   // ROTASI: berputar di tempat
        if (moving && Math.abs(err) < 0.2) {
            var step = w * W.SPEED * dt;
            A.x += step * Math.sin(A.lineAngle);                    // TRANSLASI: bergeser lurus, satu arah
            A.z += step * Math.cos(A.lineAngle);
            A.walked += step;
            if (A.walked >= W.STRAIGHT_DIST) A.walking = false;    // sampai tujuan -> berhenti (tidak putar balik)
        }
    }
    return w;
};

/*---- MULAI / HENTIKAN JALAN ----
   Menekan mode yang sama = berhenti, mode lain = ganti mode sambil lanjut dari posisi terakhir.
   angle (opsional, rad): arah jalan lurus yang dikunci saat mulai. Tanpa angle dipakai arah hadap terakhir. */
L.walkToggle = function (A, mode, angle, cam) {
    if (A.walking && A.mode === mode) { A.walking = false; return; }
    if (typeof angle !== "number" && mode === 'line' && W.RELATIVE_TO_CAMERA) {
        // yaw kamera dibaca dari matriks view: V[0] = cos(yaw), V[8] = -sin(yaw)
        // dikurangi yaw dari M (arah hadap awal Kuromi di world.js), karena gerakan dihitung di ruang model
        angle = Math.atan2(-cam.V[8], cam.V[0]) + W.SCREEN_OFFSET - A.myaw;
    }
    if (typeof angle === "number") {
        A.lineAngle = angle;
        if (mode === 'line' && W.SNAP_TO_GIVEN_ANGLE) A.heading = angle;   // langsung searah, tanpa putar di tempat
    }
    else if (mode === 'line' && W.FROM_FACING) A.lineAngle = A.heading;   // jalan ke arah yang sedang dihadap
    A.mode = mode;
    A.walked = 0;
    A.walking = true;
};

})();