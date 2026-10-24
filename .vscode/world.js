// world.js: satu canvas, satu WebGL context, satu loop untuk 3 karakter.
//   0 / 1 / 2        = fokus kamera ke Kuromi / Badtz-Maru / Hangyodon
//   Drag mouse       = putar kamera,  scroll / pinch = zoom,  panah = putar kamera
//   W A S D (Q / E)  = geser titik bidik kamera (maju/mundur/kiri/kanan, turun/naik)
//   I H J K L M T N R = animasi karakter yang sedang difokus (lihat HUD)
//   F                = FORMASI: semua karakter jalan ke slot barisnya, lalu menghadap arah yang ditentukan
//   P                = cetak posisi & arah hadap SEMUA karakter ke console (siap ditempel ke FORM_SLOTS / FORM_FACE_DEG di formation.js)
//   Badtz: J jalan rotasi, L jalan lurus, M jamur tumbuh + tersandung, T marah, N dance, I idle, R reset posisi
//   Hangyodon: I idle, H happy, J walk (toggle), K circle (toggle), L slip & dry
//   (animasi berjalan terus sampai tombol lain ditekan; posisi terakhir dipertahankan)
// environment.js (sudah dimuat lewat <script>) memasang diri ke context ini dan
// menggambar langit/tanah/pohon otomatis sebelum draw pertama tiap frame.
import { createHangyodon } from "./hangyodon/main_hangyodon.js";
import { createFormation } from "./formation.js";

var CANVAS = document.getElementById("mycanvas");
var HUD = document.getElementById("hud");

var fit = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    CANVAS.width = Math.floor(window.innerWidth * dpr);
    CANVAS.height = Math.floor(window.innerHeight * dpr);
    CANVAS.style.width = window.innerWidth + "px";
    CANVAS.style.height = window.innerHeight + "px";
};
fit();

// HARUS dibuat SETELAH environment.js dimuat (index.html sudah mengatur urutannya)
var GL = CANVAS.getContext("webgl", { antialias: true });
if (!GL) { alert("WebGL context cannot be initialized"); throw new Error("no webgl"); }

var ENV = window.ENV || { groundY: -2.1, groundHeight: function () { return -2.1; } };
if (!window.ENV) console.warn("environment.js tidak termuat: cek path di index.html");

/*======================== PROYEKSI ========================*/
function perspective(fovDeg, aspect, near, far) {
    var f = 1 / Math.tan(fovDeg * Math.PI / 360), o = new Float32Array(16);
    o[0] = f / aspect; o[5] = f;
    o[10] = (far + near) / (near - far); o[11] = -1;
    o[14] = 2 * far * near / (near - far);
    return o;
}
// cam dibaca oleh semua karakter setiap kali menggambar
var cam = { P: perspective(40, CANVAS.width / CANVAS.height, 1, 600), V: new Float32Array(16) };

/*======================== KARAKTER (statis) ========================*/
// foot = y telapak kaki di koordinat lokal karakter, scale = ukuran relatif
// Urutan array = nomor tombol: 0 Kuromi, 1 Badtz-Maru, 2 Hangyodon
var chars = [
    // x, z   = posisi di dunia (satuan world; +x = kanan layar, +z = ke arah kamera/bawah layar)
    // yawDeg = arah hadap: 0 = +z (ke kamera), 90 = +x (kanan), 180 = -z (menjauh), -90 = -x (kiri)
    { name: "Kuromi",     obj: window.createKuromi(GL, cam), x: 14, z: -20, yawDeg:  25, scale: 1.0, foot: -2.10 },
    { name: "Badtz-Maru", obj: window.createBadtz(GL, cam),  x:  3, z:   4, yawDeg:  90, scale: 1.2, foot: -2.57 },
    { name: "Hangyodon",  obj: createHangyodon(GL, cam),     x: 20, z:   6, yawDeg: 135, scale: 1.1, foot: -2.26 }
];

// Aksi per karakter: key -> fungsi. Tambah animasi baru cukup menambah satu baris di sini.
chars[0].actions = [
    { key: "j", label: "Walk",   run: function (o) { o.toggle("walk"); } },      // jalan lurus; tekan J lagi = berhenti
    { key: "c", label: "Circle", run: function (o) { o.toggle("circle"); } },    // jalan melingkar; tekan C lagi = berhenti
    { key: "h", label: "Happy",  run: function (o) { o.cheer(); } },
    { key: "l", label: "Laugh",  run: function (o) { o.laugh(); } },
    { key: "v", label: "Wave",   run: function (o) { o.wave(); } }
];
chars[1].actions = [
    { key: "i", label: "Idle",          run: function (o) { o.play("idle"); } },
    { key: "j", label: "Jalan Rotasi",  run: function (o) { o.play("walk"); } },
    { key: "l", label: "Jalan Lurus",   run: function (o) { o.play("straight"); } },
    { key: "m", label: "Tersandung Jamur", run: function (o) { o.play("trip"); } },
    { key: "t", label: "Marah",         run: function (o) { o.play("rage"); } },
    { key: "n", label: "Dance",         run: function (o) { o.play("dance"); } },
    { key: "r", label: "Reset Posisi",  run: function (o) { o.play("reset"); } }
];
chars[2].actions = [
    { key: "i", label: "Idle",        run: function (o) { o.play("idle"); } },
    { key: "h", label: "Happy",       run: function (o) { o.play("happy"); } },
    { key: "j", label: "Walk",        run: function (o) { o.toggle("walk"); } },      // jalan lurus; tekan J lagi = berhenti
    { key: "k", label: "Circle",      run: function (o) { o.toggle("circle"); } },    // jalan melingkar; tekan K lagi = berhenti
    { key: "l", label: "Slip & Dry",  run: function (o) { o.play("slip"); } }         // terpeleset -> jatuh -> bangun -> mengeringkan badan
];
chars.forEach(function (c) { c.y = 0; c.yaw = (c.yawDeg || 0) * Math.PI / 180; c.M = new Float32Array(16); });

// Model = Translate * RotateY(yaw) * Scale(s), column-major
function modelMatrix(c) {
    var cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), s = c.scale, M = c.M;
    M[0] = cs * s;  M[1] = 0;  M[2] = -sn * s; M[3] = 0;
    M[4] = 0;       M[5] = s;  M[6] = 0;       M[7] = 0;
    M[8] = sn * s;  M[9] = 0;  M[10] = cs * s; M[11] = 0;
    M[12] = c.x;    M[13] = c.y; M[14] = c.z;  M[15] = 1;
}

/*======================== FORMASI (tombol F) ========================*/
// Seluruh pengaturan formasi (posisi akhir, arah hadap, animasi akhir) ada di formation.js
var formation = createFormation(chars, modelMatrix);

/*======================== KAMERA ORBIT ========================*/
var active = 0;                       // karakter yang sedang disorot kamera
var FOCUS_DIST = 11;                  // jarak kamera per skala karakter
var camYaw = 0, camPitch = 0.22;
var camDist = FOCUS_DIST * chars[0].scale, camDistTarget = camDist;
var CAM_MIN_D = 4, CAM_MAX_D = 60;
var PITCH_MIN = -0.08, PITCH_MAX = 1.2;
var dYaw = 0, dPitch = 0, FRICTION = 0.08;
var drag = false, x_prev = 0, y_prev = 0;
var tgt = [chars[0].x, 1.5, chars[0].z];
var pan = [0, 0, 0];                  // geseran titik bidik oleh W A S D Q E

var clampPitch = function () { camPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, camPitch)); };

var updateHud = function () {
    if (!HUD) return;
    var list = chars.map(function (c, i) { return (i === active ? "▶ " : "   ") + i + " = " + c.name; });
    var acts = chars[active].actions.map(function (a) { return a.key.toUpperCase() + " = " + a.label; });
    HUD.textContent = list.join("\n") + "\n\n" + chars[active].name + ": " + acts.join("   ") +
        "\nF = semua karakter berbaris (formasi)   P = cetak posisi ke console" +
        "\nWASD/QE = geser kamera   drag = putar   scroll = zoom";
};

var focusOn = function (i) {
    active = i;
    pan[0] = pan[1] = pan[2] = 0;
    camDistTarget = FOCUS_DIST * chars[i].scale;
    updateHud();
};

var buildView = function (out, ex, ey, ez, tx, ty, tz) {
    var zx = ex - tx, zy = ey - ty, zz = ez - tz;
    var l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    var xx = zz, xy = 0, xz = -zx;
    l = Math.hypot(xx, xz) || 1; xx /= l; xz /= l;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * ex + xy * ey + xz * ez);
    out[13] = -(yx * ex + yy * ey + yz * ez);
    out[14] = -(zx * ex + zy * ey + zz * ez);
    out[15] = 1;
};

var updateCamera = function () {
    var a = chars[active];
    // Hangyodon: getPos() = posisi dunia sekarang (null sebelum frame pertama).
    // Badtz: focusOffset(M) = offset supaya kamera ikut saat ia jalan lurus.
    var cp0 = a.obj.getPos ? a.obj.getPos() : null;
    var fo = a.obj.focusOffset ? a.obj.focusOffset(a.M) : [0, 0, 0];
    var gx = (cp0 ? cp0[0] : a.x + fo[0]) + pan[0];
    var gy = (cp0 ? cp0[1] : a.y) + 1.5 * a.scale + pan[1];
    var gz = (cp0 ? cp0[2] : a.z + fo[2]) + pan[2];

    // titik bidik & jarak bergeser halus ke karakter yang dipilih
    tgt[0] += (gx - tgt[0]) * 0.12;
    tgt[1] += (gy - tgt[1]) * 0.12;
    tgt[2] += (gz - tgt[2]) * 0.12;
    camDist += (camDistTarget - camDist) * 0.12;

    var cp = Math.cos(camPitch);
    var ex = tgt[0] + camDist * Math.sin(camYaw) * cp;
    var ey = tgt[1] + camDist * Math.sin(camPitch);
    var ez = tgt[2] + camDist * Math.cos(camYaw) * cp;
    var minY = ENV.groundHeight(ex, ez) + 0.8;      // kamera tidak boleh masuk tanah
    if (ey < minY) ey = minY;
    buildView(cam.V, ex, ey, ez, tgt[0], tgt[1], tgt[2]);
};

var orbit = function (dx, dy) {
    dYaw = -dx * 2 * Math.PI / (CANVAS.clientWidth || window.innerWidth);
    dPitch = dy * Math.PI / (CANVAS.clientHeight || window.innerHeight);
    camYaw += dYaw; camPitch += dPitch; clampPitch();
};
var zoom = function (f) { camDistTarget = Math.max(CAM_MIN_D, Math.min(CAM_MAX_D, camDistTarget * f)); };

/*======================== INPUT ========================*/
var keys = {};

CANVAS.addEventListener("mousedown", function (e) { drag = true; x_prev = e.pageX; y_prev = e.pageY; e.preventDefault(); }, false);
window.addEventListener("mouseup", function () { drag = false; }, false);
window.addEventListener("mousemove", function (e) {
    if (!drag) return;
    orbit(e.pageX - x_prev, e.pageY - y_prev);
    x_prev = e.pageX; y_prev = e.pageY;
}, false);
CANVAS.addEventListener("wheel", function (e) { zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1); e.preventDefault(); }, { passive: false });

var pinchD = 0;
var touchDist = function (t) { return Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY); };
CANVAS.addEventListener("touchstart", function (e) {
    if (e.touches.length === 1) { drag = true; x_prev = e.touches[0].pageX; y_prev = e.touches[0].pageY; }
    else if (e.touches.length === 2) { drag = false; pinchD = touchDist(e.touches); }
    e.preventDefault();
}, { passive: false });
CANVAS.addEventListener("touchmove", function (e) {
    if (e.touches.length === 1 && drag) {
        orbit(e.touches[0].pageX - x_prev, e.touches[0].pageY - y_prev);
        x_prev = e.touches[0].pageX; y_prev = e.touches[0].pageY;
    } else if (e.touches.length === 2) {
        var d = touchDist(e.touches);
        if (pinchD > 0) zoom(pinchD / d);
        pinchD = d;
    }
    e.preventDefault();
}, { passive: false });
CANVAS.addEventListener("touchend", function () { drag = false; pinchD = 0; }, false);

window.addEventListener("keydown", function (e) {
    var k = e.key.toLowerCase();
    keys[k] = true;
    // 0 = Kuromi, 1 = Badtz-Maru, 2 = Hangyodon
    if (k === "0" || k === "1" || k === "2") focusOn(+k);
    if (!e.ctrlKey && !e.metaKey) {
        if (k === "f") formation.start();                         // FORMASI: berlaku untuk SEMUA karakter
        if (k === "p") formation.print();                    // cetak posisi & arah hadap ke console
        var ch = chars[active];
        ch.actions.forEach(function (a) { if (a.key === k) a.run(ch.obj); });
    }
    if (k.indexOf("arrow") === 0) e.preventDefault();
}, false);
window.addEventListener("keyup", function (e) { keys[e.key.toLowerCase()] = false; }, false);

window.addEventListener("resize", function () {
    fit();
    cam.P = perspective(40, CANVAS.width / CANVAS.height, 1, 600);
}, false);

/*======================== LOOP ========================*/
GL.enable(GL.DEPTH_TEST);
GL.depthFunc(GL.LEQUAL);
GL.clearColor(0.80, 0.93, 1.0, 1.0);
GL.clearDepth(1.0);
updateHud();

function frame(now) {
    var t = now / 1000;
    GL.viewport(0, 0, CANVAS.width, CANVAS.height);
    GL.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);

    // tombol panah memutar kamera (karakter tidak bergerak)
    if (keys["arrowleft"])  camYaw -= 0.03;
    if (keys["arrowright"]) camYaw += 0.03;
    if (keys["arrowup"])    { camPitch += 0.02; clampPitch(); }
    if (keys["arrowdown"])  { camPitch -= 0.02; clampPitch(); }

    // W A S D Q E menggeser titik bidik (relatif arah kamera, di bidang tanah)
    var sp = 0.01 * camDist;
    var fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);   // arah maju
    var rx = Math.cos(camYaw),  rz = -Math.sin(camYaw);   // arah kanan
    if (keys["w"]) { pan[0] += fx * sp; pan[2] += fz * sp; }
    if (keys["s"]) { pan[0] -= fx * sp; pan[2] -= fz * sp; }
    if (keys["d"]) { pan[0] += rx * sp; pan[2] += rz * sp; }
    if (keys["a"]) { pan[0] -= rx * sp; pan[2] -= rz * sp; }
    if (keys["e"]) pan[1] += sp;
    if (keys["q"]) pan[1] -= sp;

    // formasi (tombol F): mengatur arah hadap & memulai/menghentikan jalan semua karakter
    formation.update(t);

    // semua karakter menapak tanah, lalu susun model matrix
    chars.forEach(function (ch) {
        ch.y = ENV.groundHeight(ch.x, ch.z) - ch.foot * ch.scale;
        modelMatrix(ch);
    });

    // inersia kamera setelah drag
    if (!drag) {
        dYaw *= (1 - FRICTION); dPitch *= (1 - FRICTION);
        camYaw += dYaw; camPitch += dPitch; clampPitch();
    }
    updateCamera();

    // Kuromi digambar PERTAMA: ia mengirim Pmatrix/Vmatrix yang dibaca environment.js,
    // dan environment otomatis digambar tepat sebelum draw pertama ini.
    chars.forEach(function (ch) { ch.obj.draw(ch.M, t, ENV.groundHeight); });

    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);