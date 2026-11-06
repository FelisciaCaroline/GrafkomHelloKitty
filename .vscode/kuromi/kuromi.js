// kuromi.js  =  ENTRY / LOADER Kuromi
// Di index.html cukup satu baris ini (sama seperti badtz_entry.js):
//     <script src="kuromi/kuromi.js"></script>     -> menyediakan window.createKuromi(GL, cam)
// File ini berisi kode utama Kuromi + otomatis memuat modul lainnya (urutan penting) dari folder yang sama dengan dirinya,
// jadi index.html TIDAK perlu mendaftar file-file lain.
//
// Bagian-bagian Kuromi (semua ada di folder yang sama):
//   kuromi_geometry.js  bentuk 3D            kuromi_shaders.js  shader & uniform
//   kuromi_utils.js     matriks, easing      kuromi_walk.js     jalan (lurus / muter / berhenti)
//   kuromi_happy.js     animasi happy/cheer  kuromi_wave.js     animasi wave
//   (kode utama createKuromi: state, pose, render, API = bagian bawah file ini)
// Menambah modul baru: taruh filenya di folder ini lalu tambahkan namanya di daftar PARTS di bawah.
(function () {

var PARTS = [
    "kuromi_geometry.js",
    "kuromi_utils.js",
    "kuromi_shaders.js",
    "kuromi_walk.js",
    "kuromi_happy.js",
    "kuromi_wave.js"
];

// folder tempat file ini berada (jadi folder Kuromi boleh dipindah / diganti namanya)
var me = document.currentScript;
if (!me) { var all = document.getElementsByTagName("script"); me = all[all.length - 1]; }
var BASE = me.src.replace(/[^\/]*$/, "");
window.KuromiLib = window.KuromiLib || {};
window.KuromiLib.BASE = BASE;                         // dipakai kode utama di bawah untuk mencari skull.png

if (document.readyState !== "loading") {
    console.error("Kuromi: kuromi.js harus dimuat lewat <script src> biasa di index.html (bukan dipasang setelah halaman selesai dimuat).");
    return;
}
// document.write saat halaman masih di-parse: script yang ditulis dieksekusi BERURUTAN dan SELESAI
// sebelum <script> berikutnya di index.html (termasuk world.js). Kode utama di bawah baru membaca modul saat createKuromi() dipanggil.
PARTS.forEach(function (f) {
    document.write('<script src="' + BASE + f + '"><\/script>');
});

})();

/*=================================================================================================
   KODE UTAMA KUROMI (factory createKuromi)
=================================================================================================*/
// ===== KODE UTAMA: Kuromi sebagai "factory": window.createKuromi(GL, cam) =====
// Canvas, kamera, input, dan loop ada di world.js. Environment digambar otomatis oleh environment.js.
// Animasi (idle + cheer + walk + laugh + wave) dihitung di sini memakai performance.now(), jadi world.js hanya perlu memanggil API-nya.
// API:
//   var k = window.createKuromi(GL, cam);
//   k.cheer();          // memicu animasi senang manual
//   k.wave();           // memicu animasi idle "melambai" manual
//   k.laugh(true);      // ketawa (k.laugh() = toggle)
//   k.walk('line', sudut); // jalan LURUS; sudut (rad, opsional) = arah dunia: maju = (sin sudut, cos sudut)
//   k.walk('line');     // jalan LURUS (k.walk('circle') = jalan MUTER, k.walk(false) = berhenti, k.walk() = toggle)
//   k.walkPath(false);  // false = jalan di tempat (tanpa berpindah posisi)
//   k.setGround(function (x, z) { return tinggiTanah; });  // deteksi tinggi tanah/map (koordinat dunia)
//   k.toggle('walk');   // jalan lurus (k.toggle('circle') = jalan muter); panggil lagi = berhenti
//   k.stop();           // berhenti jalan
//   k.getPos();         // [x, y, z] posisi dunia sekarang (null sebelum frame pertama), dipakai world.js supaya kamera mengikuti
// Tombol diatur di world.js (hanya aktif saat Kuromi difokus): J = walk, C = circle, H = cheer, K = laugh, V = wave
(function () {

var L = window.KuromiLib;   // diisi modul-modul lain (lihat daftar PARTS di atas)


window.createKuromi = function (GL, cam) {

    // ---- ambil fungsi dari modul pendukung (baru dijalankan saat createKuromi dipanggil, jadi semua modul sudah termuat) ----
    if (!L || !L.createShaders || !L.walkUpdate || !L.cheerTime || !L.waveUpdate || !L.makeSphere || !L.mul4) {
        throw new Error("Kuromi: muat dulu kuromi_geometry.js, kuromi_utils.js, kuromi_shaders.js, kuromi_walk.js, kuromi_happy.js, kuromi_wave.js SEBELUM kuromi.js");
    }
    var gridIndices = L.gridIndices;
    var makeSphere = L.makeSphere;
    var makeEyePatch = L.makeEyePatch;
    var makePeakPatch = L.makePeakPatch;
    var makeCone = L.makeCone;
    var makeDiamond = L.makeDiamond;
    var makeLeg = L.makeLeg;
    var makeSkullPatch = L.makeSkullPatch;
    var sweepVertices = L.sweepVertices;
    var mul4 = L.mul4;
    var translateM = L.translateM;
    var scaleM = L.scaleM;
    var rotationMatrix = L.rotationMatrix;
    var pivotRot = L.pivotRot;
    var pivotScale = L.pivotScale;
    var axisAngleM = L.axisAngleM;
    var pivotAxis = L.pivotAxis;
    var clamp01 = L.clamp01;
    var smooth = L.smooth;
    var keys = L.keys;
    var easeOutBack = L.easeOutBack;
    var removeWhiteBackground = L.removeWhiteBackground;
    var nextPOT = L.nextPOT;
    var W = L.WALK;   // parameter jalan (kuromi_walk.js)

    /*========================= SHADERS (kuromi_shaders.js) ========================= */
    var SH = L.createShaders(GL);
    var SHADER_PROGRAM = SH.program;
    var _position = SH.position, _normal = SH.normal, _uv = SH.uv;
    var _Pmatrix = SH.Pmatrix, _Vmatrix = SH.Vmatrix, _Mmatrix = SH.Mmatrix;
    var _uOffset = SH.uOffset, _uScale = SH.uScale, _uColor = SH.uColor;
    var _uRot = SH.uRot, _uTex = SH.uTex, _uUseTex = SH.uUseTex;

    /*======================== GEOMETRY & BUFFERS ======================== */
    var makeMesh = function (data) {
        var vb = GL.createBuffer();
        var ib = GL.createBuffer();
        GL.bindBuffer(GL.ARRAY_BUFFER, vb);
        GL.bufferData(GL.ARRAY_BUFFER, new Float32Array(data.vertices), GL.STATIC_DRAW);
        GL.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, ib);
        GL.bufferData(GL.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.indices), GL.STATIC_DRAW);
        return { vb: vb, ib: ib, count: data.indices.length, stride: data.stride || 24, textured: !!data.textured };
    };

    var sphere = makeMesh(makeSphere(1, 30, 30));
    var cone = makeMesh(makeCone(1, 2, 30));
    var diamond = makeMesh(makeDiamond(1, 0.22, 0.78, 8));
    var star = makeMesh(makeDiamond(1, 1, 1, 4));   // dipakai untuk kilau bintang
    var leg = makeMesh(makeLeg(32, 28));

    var SKULL_CY = 2.15, SKULL_HH = 0.8;
    var skullMesh = makeMesh(makeSkullPatch(SKULL_CY, SKULL_HH * 1.0, SKULL_HH, 12, 0.06));
    var SKULL_TINT = [1.0, 1.0, 1.0];
    var peakMesh = makeMesh(makePeakPatch(2, 1.3, 0.65, 12));
    var eyeL = makeMesh(makeEyePatch(-0.74, 1.17, 0.18, 0.22, -1, 16, 0.02));
    var eyeR = makeMesh(makeEyePatch(0.74, 1.17, 0.21, 0.25, 1, 16, 0.02));

    var TAIL_STEPS = 36, TAIL_SEG = 12;
    var tailProfile = function (t) { return [0.19 * (1 - 0.35 * t), 0.15 * (1 - 0.35 * t)]; };
    var tailPathStatic = [
        [0.30, -0.7, -0.6],
        [0.80, -1.20, -0.733],
        [1.30, -0.733, -0.867],
        [1.80, 0.20, -1.000]
    ];
    var tail = makeMesh({
        vertices: sweepVertices(tailPathStatic, tailProfile, TAIL_STEPS, TAIL_SEG),
        indices: gridIndices(TAIL_STEPS + 1, TAIL_SEG)
    });

    var smileProfile = function () { return [0.03, 0.03]; };
    var smile = makeMesh({
        vertices: sweepVertices([
            [-0.50, 0.88, 1.60],
            [-0.40, 0.80, 1.58],
            [0.40, 0.80, 1.58],
            [0.46, 0.88, 1.60]
        ], smileProfile, 20, 8),
        indices: gridIndices(21, 8)
    });

    // Busur mata tertutup "^" (dipakai saat berkedip & senang). Bentuk unit, diskalakan saat draw.
    var arcMesh = makeMesh({
        vertices: sweepVertices([
            [-1, -0.35, 0],
            [-0.55, 0.75, 0],
            [0.55, 0.75, 0],
            [1, -0.35, 0]
        ], function (t) {
            var r = 0.14 * (0.35 + 0.65 * Math.sin(Math.PI * t));
            return [r, r];
        }, 24, 8),
        indices: gridIndices(25, 8)
    });

    /*========================= SKULL TEXTURE ========================= */
    var skullTex = GL.createTexture();
    GL.bindTexture(GL.TEXTURE_2D, skullTex);
    GL.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, true);
    GL.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
    GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
    GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
    GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);

    // path relatif terhadap index.html di root project
    var SKULL_FILE = (L.BASE || "kuromi/") + "skull.png";   // folder yang sama dengan kuromi.js (BASE diisi loader)

    var skullImg = new Image();
    skullImg.onload = function () {
        var w = skullImg.width, h = skullImg.height;

        var c1 = document.createElement("canvas");
        c1.width = w; c1.height = h;
        var x1 = c1.getContext("2d");
        x1.drawImage(skullImg, 0, 0);
        var id = x1.getImageData(0, 0, w, h);
        removeWhiteBackground(id.data, w, h);
        x1.putImageData(id, 0, 0);

        var tw = Math.min(1024, Math.max(256, nextPOT(w)));
        var th = Math.min(1024, Math.max(256, nextPOT(h)));
        var c2 = document.createElement("canvas");
        c2.width = tw; c2.height = th;
        var x2 = c2.getContext("2d");
        x2.imageSmoothingEnabled = (w > tw || h > th);
        x2.drawImage(c1, 0, 0, tw, th);

        GL.bindTexture(GL.TEXTURE_2D, skullTex);
        GL.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, true);
        GL.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, c2);
        GL.generateMipmap(GL.TEXTURE_2D);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR_MIPMAP_LINEAR);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
        var aniso = GL.getExtension("EXT_texture_filter_anisotropic");
        if (aniso) {
            GL.texParameterf(GL.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT,
                Math.min(8, GL.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        }

        var aspect = w / h;
        GL.deleteBuffer(skullMesh.vb);
        GL.deleteBuffer(skullMesh.ib);
        skullMesh = makeMesh(makeSkullPatch(SKULL_CY, SKULL_HH * aspect, SKULL_HH, 12, 0.06));
    };
    skullImg.onerror = function () {
        console.warn("kuromi/skull.png tidak bisa dimuat. Buka lewat Live Server (bukan file://) dan cek path-nya.");
    };
    skullImg.src = SKULL_FILE;

    var draw = function (mesh, pos, scale, color, rot) {
        if (!rot) rot = [0, 0, 0];
        GL.bindBuffer(GL.ARRAY_BUFFER, mesh.vb);
        GL.vertexAttribPointer(_position, 3, GL.FLOAT, false, mesh.stride, 0);
        GL.vertexAttribPointer(_normal, 3, GL.FLOAT, false, mesh.stride, 12);
        GL.vertexAttribPointer(_uv, 2, GL.FLOAT, false, mesh.stride, mesh.textured ? 24 : 0);
        GL.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, mesh.ib);
        GL.uniformMatrix4fv(_uRot, false, rotationMatrix(rot[0], rot[1], rot[2]));
        GL.uniform3fv(_uOffset, pos);
        GL.uniform3fv(_uScale, scale);
        GL.uniform3fv(_uColor, color);
        GL.uniform1f(_uUseTex, mesh.textured ? 1.0 : 0.0);
        GL.drawElements(GL.TRIANGLES, mesh.count, GL.UNSIGNED_SHORT, 0);
    };

    var setM = function (m) { GL.uniformMatrix4fv(_Mmatrix, false, m); };

    /*======================== CHARACTER DRAWING HELPERS ======================== */
    var BLACK = [0.12, 0.12, 0.16];
    var WHITE = [0.97, 0.97, 0.97];
    var PINK = [0.98, 0.62, 0.78];
    var BLUSH = [1.0, 0.66, 0.78];
    var MOUTH = [0.46, 0.10, 0.22];
    var STAR_Y = [1.0, 0.95, 0.55];
    var TEAR = [0.55, 0.82, 1.0];

    var FEET_Y = -2.1;          // titik tumpu squash & stretch
    var NECK = [0, 0.35, 0];    // pivot kepala

    var faceZ = function (x, y) {
        var q = 1 - (x / 1.5) * (x / 1.5) - (y - 1.3) * (y - 1.3);
        return 0.8 + 0.9 * Math.sqrt(Math.max(q, 0));
    };

    // delta = lean telinga (rad). Positif = kedua telinga condong ke +x (kanan).
    var drawEar = function (side, delta, flare) {
        var a = 0.6 - side * delta + flare;
        var H = 2;
        var base = [side * 1, 2.7, -0.1];
        var sinA = Math.sin(a);
        var cosA = Math.cos(a);

        draw(diamond, base, [0.95, H, 1], BLACK, [0, 0, -side * a]);
        draw(sphere, [base[0] + side * sinA * (H - 0.05), base[1] + cosA * (H - 0.05), base[2]], [0.26, 0.26, 0.24], BLACK);
    };

    // o: 1 = terbuka, 0 = tertutup. k: kelengkungan busur (0.4 kedip, 1 senang)
    var drawEye = function (mesh, cx, cy, rx, ry, side, o, k) {
        if (o > 0.08) {
            draw(mesh, [0, cy * (1 - o), 0], [1, o, 1], BLACK);
            var lash = clamp01((o - 0.45) / 0.55);
            if (lash > 0.03) {
                var lx = cx + side * rx * 1.0, ly = cy + ry * 0.62 * o;
                draw(sphere, [lx, ly, faceZ(lx, ly) + 0.02], [0.12 * lash, 0.024 * lash, 0.03], BLACK, [0, 0, side * 0.45]);
                var lx2 = cx + side * rx * 1.3, ly2 = cy + ry * 0.10 * o;
                draw(sphere, [lx2, ly2, faceZ(lx2, ly2) + 0.02], [0.11 * lash, 0.024 * lash, 0.03], BLACK, [0, 0, side * 0.15]);
            }
        }
        var a = smooth((0.4 - o) / 0.4);
        if (a > 0.02) {
            draw(arcMesh,
                [cx, cy - 0.02, faceZ(cx, cy) + 0.05],
                [rx * 1.35 * a, ry * 1.2 * k * a, rx * 1.35],
                BLACK, [0, side * 0.33, 0]);
        }
    };

    var drawCollar = function () {
        var N = 7, ALPHA = 2.30;
        for (var i = 0; i < N; i++) {
            var th = Math.PI / N + i * 2 * Math.PI / N;
            var base = [1.02 * Math.cos(th), 0.4, 0.86 * Math.sin(th)];
            var beta = Math.PI / 2 - th;
            draw(cone, base, [0.5, 0.45, 0.2], BLACK, [ALPHA, beta, 0]);

            var dist = 0.8;
            var tip = [
                base[0] + Math.sin(ALPHA) * Math.sin(beta) * dist,
                base[1] + Math.cos(ALPHA) * dist,
                base[2] + Math.sin(ALPHA) * Math.cos(beta) * dist
            ];
            draw(sphere, tip, [0.14, 0.14, 0.14], PINK);
        }
    };

    var drawTail = function () {
        draw(tail, [0, 0, 0], [1, 1, 1], BLACK);
        draw(cone, [1.8, 0.2, -1.0], [0.32, 0.45, 0.14], BLACK, [0, 0, -0.69]);
    };

    // kilau 4 sudut: dua belah ketupat tipis bersilang. fat > 1 = lebih gemuk (kilau oranye)
    var drawStar = function (x, y, z, sz, col, spin, fat) {
        fat = fat || 1;
        var a = 0.55 * sz, w = 0.11 * sz * fat;
        for (var i = 0; i < 2; i++) {
            var th = spin + i * Math.PI / 2;
            draw(star, [x + a * Math.sin(th), y - a * Math.cos(th), z], [w, a, w], col, [0, 0, th]);
        }
    };

    var drawHeart = function (x, y, z, s, col) {
        draw(sphere, [x - 0.42 * s, y + 0.28 * s, z], [0.52 * s, 0.52 * s, 0.30 * s], col);
        draw(sphere, [x + 0.42 * s, y + 0.28 * s, z], [0.52 * s, 0.52 * s, 0.30 * s], col);
        draw(cone, [x, y + 0.25 * s, z], [0.98 * s, 0.62 * s, 0.30 * s], col, [0, 0, Math.PI]);
    };

    /*========================= ANIMATION STATE ========================= */
    // Timeline disalin dari video referensi (30 fps, 8.16 dtk), c = detik sejak cheer mulai (= 6.1 dtk di video):
    //  0.0 - 6.1 dtk : idle. Kepala goyang kiri-kanan (siklus ~4.1 dtk), satu kedip datar di 0.17 dtk
    //  c 0.0 - 0.7   : membungkuk pelan, kepala turun & menunduk, telinga mengembang, tangan melebar
    //  c 0.7 - 0.9   : pop naik cepat (sedikit overshoot), mulut terbuka, tangan merapat ke dada
    //  c 0.95        : mata ^ ^
    //  c 1.1 / 1.4 / 1.55 / 1.75 : kilau kecil, kilau putih besar, kilau oranye, hati
    var IDLE_LEN = 6.1;

    // goyang kepala (-1..1) per fase siklus 4.1 dtk: lembah (tahan) -> naik cepat ~1.1 dtk -> puncak (tahan) -> turun pelan
    var SWAY_KEYS = [[0, -1], [0.03, -1], [0.27, 1], [0.34, 1], [1, -1]];
    var SWAY_PERIOD = 4.1, SWAY_OFFSET = 0.5;

    // (kurva & parameter cheer/happy ada di kuromi_happy.js -> L.HAPPY)

    /* ---- parameter jalan ----
       Mode 'line'   : jalan LURUS satu arah (tanpa putar balik), terus sampai J ditekan lagi (atau sampai STRAIGHT_DIST).
         LINE_ANGLE : arah jalan. 0 = ke bawah layar / arah kamera, Math.PI/2 = ke kanan layar
       Mode 'circle' : jalan memutar membentuk lingkaran berjari-jari CIRCLE_R.
       Posisi terakhir (A.x, A.z) selalu disimpan, jadi setelah animasi lain dia lanjut dari titik itu. */
    // (nilai parameter jalan ada di kuromi_walk.js -> L.WALK)

    /* ---- parameter tanah (supaya tidak melayang) ----
       Tiap frame, posisi telapak kaki di dunia dihitung dari matriks M, lalu badan diturunkan/dinaikkan
       sampai telapak menyentuh tanah.
       GROUND_Y     : (tidak dipakai lagi kalau ENV.groundHeight ada) cadangan tinggi tanah
       GROUND_LIFT  : naikkan Kuromi dari tanah (unit dunia). Kalau kaki masih tenggelam, besarkan; kalau melayang, kecilkan; boleh negatif
       k.setGround(fn) : fn(x, z) -> tinggi tanah di titik itu, untuk map yang bergelombang (bukit, jalan, kolam) */
    var GROUND_Y = 0;
    var GROUND_LIFT = -0.2;
    var groundFn = null;                  // diisi k.setGround(fn). Kalau kosong, otomatis memakai ENV.groundHeight dari environment.js
    var getGround = function () {
        if (groundFn) return groundFn;
        if (window.ENV && typeof window.ENV.groundHeight === "function") {
            return function (x, z) { return window.ENV.groundHeight(x, z); };
        }
        return null;
    };

    // (parameter wave ada di kuromi_wave.js -> L.WAVE)

    var worldPos = null;                  // posisi dunia Kuromi sekarang (null sebelum frame pertama), dipakai kamera
    var t0 = performance.now() / 1000;
    var A = {
        last: null, cycStart: t0, nextAct: 0,           // nextAct: 0 = berikutnya cheer, 1 = berikutnya melambai (bergantian)
        cheering: false, cheerStart: 0,
        waving: false, waveStart: 0, wavePh: 0,
        breath: 0, armPh: 0, tailPh: 0, bobPh: 0,
        happy: 0, eyeHappy: 0, earRoll: 0,
        walking: false, followPath: true, walkAmt: 0, walkPh: 0,
        x: 0, z: 0, walked: 0, myaw: 0, lineAngle: W.LINE_ANGLE, heading: 0,              // posisi dunia terakhir, jarak tempuh jalan lurus, arah hadap badan (rad)
        mode: 'line', cpsi: 0, wasCircling: false,      // mode jalan: 'line' | 'circle'
        laughing: false, laugh: 0, laughPh: 0,
        gdy: null                                       // koreksi tinggi ke tanah (unit model), dihaluskan
    };

    // logika cheer ada di kuromi_happy.js, wave di kuromi_wave.js
    var triggerCheer = function () { L.cheerTrigger(A, performance.now() / 1000); };
    var triggerWave = function () { L.waveTrigger(A, performance.now() / 1000); };

    var update = function (now) {
        var dt = A.last === null ? 0.016 : Math.min(0.05, Math.max(0.0005, now - A.last));
        A.last = now;
        var damp = function (cur, target, lambda) { return cur + (target - cur) * (1 - Math.exp(-lambda * dt)); };

        /* ---- saat jalan / ketawa, jadwal idle otomatis ditahan ---- */
        if ((A.walking || A.laughing) && !A.cheering && !A.waving) A.cycStart = now;

        /* ---- jadwal: idle -> (cheer | melambai, bergantian) -> idle ---- */
        if (!A.cheering && !A.waving && now - A.cycStart >= IDLE_LEN) {
            if (A.nextAct === 0) L.cheerTrigger(A, now);
            else L.waveTrigger(A, now);
            A.nextAct = 1 - A.nextAct;
        }
        var c = L.cheerTime(A, now);                    // kuromi_happy.js
        var ti = now - A.cycStart;

        /* ---- idle "melambai" (kuromi_wave.js) ---- */
        var wv = L.waveUpdate(A, now, dt);

        /* ---- envelope senang (kuromi_happy.js) ---- */
        L.happyEnvelope(A, c, damp);
        /* ---- ketawa ---- */
        A.laugh = damp(A.laugh, (A.laughing && !A.cheering && !A.waving) ? 1 : 0, 7);
        var lf = A.laugh;                               // 0 = tenang, 1 = ketawa penuh
        A.laughPh += dt * 2 * Math.PI * 4.5;            // 4.5 "ha" per detik (ubah 4.5 untuk kecepatan ketawa)
        var eyeOn = L.happyEyes(c) || lf > 0.3 || wv > 0.5;
        A.eyeHappy = damp(A.eyeHappy, eyeOn ? 1 : 0, eyeOn ? 22 : 8);
        var h = A.happy;

        /* ---- jalan (logika di kuromi_walk.js) ---- */
        var w = L.walkUpdate(A, dt, damp);
        var wStep = Math.sin(A.walkPh), wCos = Math.cos(A.walkPh);

        /* ---- fase kontinu ---- */
        A.breath += dt * 2 * Math.PI / 3.4;
        A.armPh += dt * 2 * Math.PI * (0.55 + 0.9 * h);
        A.tailPh += dt * 2 * Math.PI * (0.70 + 1.2 * h + 0.8 * w + 1.5 * A.laugh + 0.9 * wv);
        A.bobPh += dt * 1.0;

        var br = Math.sin(A.breath);

        /* ---- goyang idle ---- */
        var ia = A.cheering ? 1 - smooth(c / 0.9) : smooth(ti / 1.2);
        ia *= 1 - 0.6 * wv;                              // saat melambai, goyang kepala dikurangi
        var ph = (((ti - SWAY_OFFSET) / SWAY_PERIOD) % 1 + 1) % 1;
        var sway = keys(ph, SWAY_KEYS) * ia;

        /* ---- kurva cheer ---- */
        var cv = L.cheerCurves(c);
        var sq = cv.sq, pk = cv.pk, ao = cv.ao, jp = cv.jp;

        var bob = Math.sin(2 * Math.PI * A.bobPh);
        var S = {
            c: c, happy: h, sq: sq, ao: ao,
            walk: w, step: wStep, stepCos: wCos,
            px: A.x, pz: A.z, heading: A.heading,
            wave: wv, wavePh: A.wavePh,
            waddle: w * 0.10 * wStep,                                          // ARBITRARY ROTATE: goyang pinggul (+ wave: kuromi_wave.js)
            hop: L.happyHop(h, bob) + w * 0.07 * (0.5 + 0.5 * Math.cos(2 * A.walkPh)),
            jump: jp,                                                          // TRANSLASI: lompatan cheer
            sy: 1 + 0.012 * br - 0.17 * sq + w * 0.02 * Math.cos(2 * A.walkPh),
            sxz: 1 - 0.006 * br + 0.10 * sq
        };

        /* ---- kepala ---- */
        S.roll = -0.06 * sway - w * 0.05 * wStep;
        S.yaw = 0.10 * sway;
        S.pitch = 0.025 * br + w * 0.08;                                   // condong ke depan
        S.headY = 0.03 * Math.sin(A.breath - 0.6) + 0.065 * sway - 0.05 * sq - w * 0.03 * Math.cos(2 * A.walkPh);
        S.earFlare = 0;                                                    // diisi happy/wave di bawah
        S.mouth = 0; S.blush = 0;

        /* ---- pose happy (kuromi_happy.js) & wave (kuromi_wave.js): ditambahkan ke kepala/telinga/mulut/pipi ---- */
        L.happyPose(S, A, h, pk, bob, now);
        L.wavePose(S, wv, A.wavePh);

        /* ---- ketawa: tiap "ha" badan memantul, kepala mendongak & bergoyang, badan condong ke belakang ---- */
        var lph = A.laughPh, ha = Math.sin(lph), hh = 0.5 + 0.5 * ha;
        S.laugh = lf; S.ha = ha; S.hh = hh;
        S.hop   += lf * 0.07 * hh;                           // translasi: memantul tiap "ha"
        S.sy    += lf * 0.045 * Math.sin(lph + 1.6);         // scaling: squash & stretch
        S.sxz   -= lf * 0.025 * Math.sin(lph + 1.6);
        S.pitch += lf * (-0.28 + 0.10 * ha);                 // rotasi: kepala mendongak ke belakang
        S.roll  += lf * 0.10 * Math.sin(lph * 0.5);          // rotasi: kepala goyang kiri-kanan
        S.yaw   += lf * 0.05 * Math.sin(lph * 0.5 + 1.0);
        S.headY += lf * 0.05 * hh;
        S.lean   = lf * (-0.10 + 0.07 * Math.sin(lph - 0.8)); // arbitrary rotate: badan condong ke belakang (sumbu miring)

        // telinga: tertinggal dari gerak kepala + mengembang saat menunduk
        A.earRoll = damp(A.earRoll, S.roll, 7);
        S.earDelta = (A.earRoll - S.roll) * 2.4 + 0.05 * Math.sin(A.breath * 1.7) + L.happyEarShake(h, now);

        /* ---- kedip: sekali per siklus idle, garis datar ---- */
        var bp = (ti - 0.16) / 0.15;
        var blinkO = (!A.cheering && !A.waving && bp > 0 && bp < 1) ? 1 - clamp01(1.7 * Math.sin(Math.PI * bp)) : 1;
        S.eyeO = Math.min(blinkO, 1 - A.eyeHappy);
        S.eyeK = 0.15 + 0.85 * A.eyeHappy;

        /* ---- mulut & pipi ---- */
        if (lf > 0.01) {
            S.mouth = Math.max(S.mouth, lf * (0.85 + 0.55 * hh));   // mulut terbuka lebar, membesar tiap "ha"
            S.blush = Math.max(S.blush, lf);
        }
        return S;
    };

    /*========================= RENDER (dipanggil world.js tiap frame) ========================= */
    // M = model matrix (posisi + arah hadap + skala), disusun oleh world.js
    var render = function (M) {
        var now = performance.now() / 1000;
        A.myaw = Math.atan2(M[8], M[10]);              // yaw M dari world.js (yawDeg karakter)
        var S = update(now);
        var h = S.happy;

        // ---- DETEKSI TANAH: hitung posisi telapak kaki di dunia, lalu tempelkan ke tinggi tanah ----
        var fx = S.px, fy = FEET_Y, fz = S.pz;
        var fwx = M[0] * fx + M[4] * fy + M[8] * fz + M[12];
        var fwy = M[1] * fx + M[5] * fy + M[9] * fz + M[13];
        var fwz = M[2] * fx + M[6] * fy + M[10] * fz + M[14];
        var gfn = getGround();
        var gy = gfn ? gfn(fwx, fwz) : fwy;   // tanpa data tanah: tidak ada koreksi (pakai penempatan dari world.js)
        if (typeof gy !== "number" || !isFinite(gy)) gy = fwy;
        var sY = Math.hypot(M[4], M[5], M[6]) || 1;                 // skala vertikal model
        var dy = (gy + GROUND_LIFT - fwy) / sY;                     // koreksi dalam unit model
        // langsung tepat tiap frame (tanpa jeda): titik asal model bisa bergeser saat formasi memutar yaw, dan koreksi yang
        // dihaluskan akan tertinggal -> badan naik-turun ("bounce"). groundHeight sudah mulus, jadi tidak perlu dihaluskan.
        A.gdy = dy;
        M = mul4(M, translateM(0, A.gdy, 0));                       // TRANSLASI: turun sampai menapak

        // HIERARCHY level atas: M (world) -> translasi ke posisi terakhir (px, pz) -> rotasi hadap -> root badan
        // TRANSLASI murni (px, pz) + ROTASI di sumbu Y (heading)
        M = mul4(M, mul4(translateM(S.px, 0, S.pz), rotationMatrix(0, S.heading, 0)));
        worldPos = [M[12], M[13], M[14]];                       // posisi dunia (sudah termasuk hasil jalan + tinggi tanah)

        GL.useProgram(SHADER_PROGRAM);
        for (var a = 0; a < 8; a++) GL.disableVertexAttribArray(a);
        GL.enableVertexAttribArray(_position);
        GL.enableVertexAttribArray(_normal);
        GL.enableVertexAttribArray(_uv);

        // Pmatrix & Vmatrix harus diset SEBELUM draw pertama: environment.js membacanya dari sini
        GL.uniformMatrix4fv(_Pmatrix, false, cam.P);
        GL.uniformMatrix4fv(_Vmatrix, false, cam.V);

        GL.activeTexture(GL.TEXTURE0);
        GL.bindTexture(GL.TEXTURE_2D, skullTex);
        GL.uniform1i(_uTex, 0);

        // ---- matriks root: translasi hop/jump, goyang pinggul (sumbu sembarang), squash/stretch dari telapak kaki ----
        var root0 = mul4(M, translateM(0, S.hop + S.jump, 0));                 // TRANSLASI
        root0 = pivotAxis(root0, 0, FEET_Y, 0, 0.15, 1, 0.35, S.waddle);       // ARBITRARY ROTATE: goyang pinggul
        root0 = pivotAxis(root0, 0, -1.2, 0, 1, 0.15, 0.3, S.lean);            // ARBITRARY ROTATE: condong saat ketawa
        var root = pivotScale(root0, S.sxz, S.sy, FEET_Y);                     // SCALING

        /* ===== BADAN ===== */
        setM(root);
        draw(sphere, [0, -0.30, 0], [0.90, 1.0, 1.0], WHITE);
        drawCollar();

        /* ===== KAKI (pivot di pinggul, berayun saat jalan) ===== */
        for (var li = 0; li < 2; li++) {
            var ls = li === 0 ? -1 : 1;
            var legRx = ls * 0.55 * S.step * S.walk;                 // ayun maju-mundur
            var fwd = ls < 0 ? S.stepCos : -S.stepCos;               // >0 = sedang melangkah maju
            var lift = Math.max(0, fwd) * 0.14 * S.walk;             // kaki terangkat
            setM(pivotRot(mul4(root, translateM(0, lift, 0)), ls * 0.5, -0.35, 0.05, legRx, 0, 0));
            draw(leg, [ls * 0.50, -1.20, 0.05], [0.50, 0.90, 0.50], WHITE);
        }
        setM(root);

        /* ===== LENGAN (pivot di bahu) =====
           idle: tangan terlipat dekat dada | membungkuk: melebar ke samping | senang: merapat ke dada
           jalan: berayun berlawanan dengan kaki satu sisi
           melambai: lengan L.WAVE.SIDE terangkat ke samping-atas, lalu diayun kiri-kanan */
        for (var si = 0; si < 2; si++) {
            var side = si === 0 ? -1 : 1;
            var swing = Math.sin(A.armPh + (side > 0 ? 0 : 1.1));
            var rx = (-0.20 - 0.25 * S.ao) * (1 - h) - 1.0 * h + 0.07 * swing * h + 0.03 * swing * (1 - h)
                     - side * 0.40 * S.step * S.walk
                     - S.laugh * (0.75 - 0.15 * S.ha);                 // tangan memegang perut & bergetar
            var ry = -side * (0.10 * (1 - h) + 0.42 * h + 0.30 * S.laugh);
            var rz = side * ((0.08 + 0.05 * swing + 0.60 * S.ao) * (1 - h));

            var wa = L.waveArm(side, [rx, ry, rz], S);                 // kuromi_wave.js: hanya satu tangan yang melambai
            rx = wa[0]; ry = wa[1]; rz = wa[2];

            setM(pivotRot(root, side * 0.95, -0.05, 0.2, rx, ry, rz));
            draw(sphere, [side * 1.0, -0.45, 0.15], [0.30, 0.62, 0.32], WHITE, [0, 0, -side * 0.2]);
            draw(sphere, [side * 1.17, -0.90, 0.30], [0.35, 0.45, 0.32], WHITE);
        }

        /* ===== EKOR ===== */
        var wag = Math.sin(A.tailPh);
        setM(pivotRot(root, 0.30, -1.10, -0.60, 0, 0.25 * wag * (1 + h), 0.08 * Math.sin(A.tailPh * 0.5 + 1) + 0.15 * Math.max(S.sq, 0)));
        drawTail();

        /* ===== KEPALA (pivot di leher) - HIERARCHY: telinga, mata, mulut, pipi ikut matriks kepala ===== */
        var head = pivotRot(mul4(root, translateM(0, S.headY, 0)), NECK[0], NECK[1], NECK[2], S.pitch, S.yaw, S.roll);
        setM(head);

        draw(sphere, [0, 1.6, 0], [1.9, 1.55, 1.6], BLACK);
        draw(sphere, [0, 1.3, 0.8], [1.5, 1.0, 0.9], WHITE);

        draw(peakMesh, [0, 0, 0], [1, 1, 1], BLACK);
        draw(skullMesh, [0, 0, 0], [1, 1, 1], SKULL_TINT);

        drawEar(-1, S.earDelta, S.earFlare);
        drawEar(1, S.earDelta, S.earFlare);

        drawEye(eyeL, -0.74, 1.17, 0.18, 0.22, -1, S.eyeO, S.eyeK);
        drawEye(eyeR, 0.74, 1.17, 0.21, 0.25, 1, S.eyeO, S.eyeK);

        draw(sphere, [0, 1.03, 1.67], [0.17, 0.10, 0.07], PINK);

        // pipi merona
        if (S.blush > 0.03) {
            for (var bi = 0; bi < 2; bi++) {
                var bs = bi === 0 ? -1 : 1;
                draw(sphere, [bs * 1.0, 0.92, faceZ(bs * 1.0, 0.92) - 0.02],
                    [0.20 * S.blush, 0.12 * S.blush, 0.06], BLUSH, [0, bs * 0.55, 0]);
            }
        }

        // senyum -> mulut terbuka
        if (S.mouth < 0.97) draw(smile, [0, -0.10, 0], [0.3 * (1 - 0.9 * S.mouth), 1, 1], BLACK);
        if (S.mouth > 0.03) {
            var m = S.mouth;
            draw(sphere, [0, 0.69, 1.53], [0.15 * Math.sqrt(m), 0.11 * m, 0.10], MOUTH);
        }

        /* ===== EFEK KETAWA: air mata bahagia memercik + kilau berputar (ikut kepala) ===== */
        if (S.laugh > 0.05) {
            var lg = S.laugh;
            for (var te = 0; te < 6; te++) {
                var ts = te % 2 === 0 ? -1 : 1;
                var tu = (now * 1.6 + te / 6) % 1;
                var tx = ts * (0.95 + 1.0 * tu);
                var ty = 1.12 + 1.1 * tu - 2.0 * tu * tu;                // translasi: memercik naik lalu jatuh
                var tz = faceZ(ts * Math.min(Math.abs(tx), 1.45), ty) + 0.05;
                var tsz = lg * 0.09 * (1 - 0.6 * tu);                    // scaling: mengecil saat jatuh
                draw(sphere, [tx, ty, tz], [tsz, tsz * 1.3, tsz], TEAR);
            }
            for (var sp = 0; sp < 3; sp++) {
                var su = (now * 0.9 + sp / 3) % 1;
                var ssz = lg * 0.32 * Math.sin(Math.PI * su);            // scaling: muncul lalu hilang
                drawStar(sp % 2 ? 2.3 + 0.3 * sp : -2.3 - 0.3 * sp, 2.4 + 0.5 * su, 1.2, ssz, STAR_Y, now * 2 + sp, 1);   // rotasi: berputar
            }
        }

        /* ===== DEKORASI: kilau & hati muncul berurutan (ikut M saja, tidak ikut squash) ===== */
        setM(M);
        L.drawHappyDecor({ drawStar: drawStar, drawHeart: drawHeart }, S, now);   // kuromi_happy.js

        setM(M); // kembalikan supaya environment tidak terpengaruh
    };

    // mulai / hentikan jalan. Menekan tombol mode yang sama = berhenti, mode lain = ganti mode sambil lanjut dari posisi terakhir
    // angle (opsional, rad): arah jalan lurus yang dikunci saat mulai jalan. Tanpa angle dipakai LINE_ANGLE / arah terakhir.
    // Toggle yang terpanggil 2x dalam hitungan milidetik (mis. tombol yang sama juga dipasang di world.js) dianggap satu kali,
    // supaya tidak saling membatalkan (hidup lalu langsung mati).
    var lastToggle = {};
    var onceFast = function (name) {
        var n = performance.now();
        if (lastToggle[name] !== undefined && n - lastToggle[name] < 120) return false;
        lastToggle[name] = n;
        return true;
    };
    var toggleLaugh = function () { if (onceFast("laugh")) A.laughing = !A.laughing; };

    var toggleWalk = function (mode, angle) {
        if (!onceFast("walk:" + mode)) return;
        L.walkToggle(A, mode, angle, cam);
    };

    // Tombol TIDAK dipasang di file ini: world.js yang memanggil API di bawah, hanya saat Kuromi sedang difokus.

    return {
        draw: render,
        cheer: triggerCheer,
        wave: triggerWave,
        laugh: function (on) { if (on === undefined) toggleLaugh(); else A.laughing = !!on; },
        walk: function (m, angle) {
            if (m === 'line' || m === 'circle') toggleWalk(m, angle);
            else if (m === undefined) toggleWalk(A.mode);
            else if (m) { if (!A.walking) { A.walked = 0; A.walking = true; } } else A.walking = false;
        },
        pos: function () { return [A.x, A.z]; },
        getPos: function () { return worldPos; },   // posisi dunia karakter sekarang (kamera mengikuti), sama seperti Hangyodon
        // dipanggil world.js: o.toggle("walk") = jalan lurus, o.toggle("circle") = jalan muter; panggil lagi = berhenti
        toggle: function (name) {
            if (name === "walk" || name === "line") toggleWalk('line');
            else if (name === "circle") toggleWalk('circle');
        },
        stop: function () { A.walking = false; },
        face: function (rad) { A.heading = rad || 0; A.lineAngle = A.heading; A.cpsi = A.heading; },   // set arah hadap (model space); face() = hadap kamera
        setGround: function (fn) { groundFn = (typeof fn === "function") ? fn : null; A.gdy = null; },
        walkPath: function (on) { A.followPath = !!on; }   // false = jalan di tempat
    };

};

})();