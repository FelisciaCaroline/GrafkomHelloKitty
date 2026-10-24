import * as builder from "./helpers/builders.js";
import { animMatrix, normalMatrix, translationM, axisAngleM } from "./helpers/transform.js";
import { evaluateIdle } from "./helpers/idle_animation.js";
import { evaluateHappy, evaluateWalk, evaluateWalkCircle, WALK_SPEED, CIRCLE_SPEED, CIRCLE_TURN } from "./helpers/emote_animation.js";
import { evaluateSlip, slipMove, SLIP_DURATION, DROP_COUNT } from "./helpers/slip_animation.js";
import { generateHeart, generateSparkle } from "./helpers/effects.js";

// =====================================================================
// Bentuk (shape), tata letak (layout), hierarchy, displacement, + IDLE ANIMATION
// (tombol "Idle", loop sampai di-stop). Model bisa diputar mengelilingi sumbu vertikal (Y).
//
// Semua angka posisi/ukuran diukur dari foto referensi (tampak depan,
// samping, belakang). Satuan: 1 unit ~ 1/160 tinggi kepala di foto.
// Sistem koordinat: +X = sisi kiri karakter, +Y = atas, +Z = depan.
// =====================================================================

function hex(h) {
  return [parseInt(h.substr(1, 2), 16) / 255, parseInt(h.substr(3, 2), 16) / 255, parseInt(h.substr(5, 2), 16) / 255];
}
var COLOR = {
  head:  hex("#82cbd6"),   // kepala (toska muda)
  body:  hex("#66b8c4"),   // badan, tangan, kaki
  blue:  hex("#4b8ecb"),   // telinga, jambul, sirip
  pink:  hex("#eba3bd"),   // mulut
  white: hex("#f4f4f4"),   // bola mata
  black: hex("#1b1212"),   // pupil
  red:   hex("#e0706a"),   // gurita kecil
  pinkDark: hex("#e393b2"),   // bibir bawah
  patch:    hex("#d9a6c2"),   // bercak pink wajah gurita
  heart: hex("#ff3b5c"),   // hati (happy emote)
  water: hex("#8fe0ff"),   // percikan air (animasi mengeringkan badan)
  spark: [1.5, 1.4, 1.0],  // kilau bintang (happy emote); sengaja >1 supaya tampak berpendar
};

// Urutan transform lokal (SELALU sama): rotZ -> rotX -> rotY, lalu translate.
// (LIBS.translate* langsung menambah posisi akhir, jadi urutan scale tidak
// dipakai: ukuran semua bagian diatur lewat radius di generator.)
function xf(pos, rot) {
  var m = LIBS.get_I4();
  rot = rot || [0, 0, 0];
  if (rot[2]) LIBS.rotateZ(m, rot[2]);
  if (rot[0]) LIBS.rotateX(m, rot[0]);
  if (rot[1]) LIBS.rotateY(m, rot[1]);
  LIBS.translateX(m, pos[0]);
  LIBS.translateY(m, pos[1]);
  LIBS.translateZ(m, pos[2]);
  return m;
}
// world = parentWorld * local.
// CATATAN PENTING: LIBS.multiply(m1, m2) mengembalikan matriks m2 * m1
// (array WebGL itu column-major), jadi argumennya harus DITUKAR di sini.
// Inilah bug di versi sebelumnya: kepala/mata/mulut tidak ikut berputar
// bersama badan karena urutan perkaliannya terbalik.
function mul(parentWorld, local) { return LIBS.multiply(local, parentWorld); }

// Dipanggil oleh world.js:  const h = createHangyodon(GL, cam);  h.draw(M, t);
// GL  = satu-satunya WebGL context milik world.js
// cam = { P, V } milik world.js (dibaca TIAP frame, jadi kamera boleh bergerak)
export function createHangyodon(GL, cam) {

  /*========================= SHADERS (Phong) =========================*/
  var shader_vertex_source = `
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec3 color;
    uniform mat4 Pmatrix, Vmatrix, Mmatrix;
    uniform mat3 Nmatrix;      // inverse-transpose dari 3x3 Mmatrix (benar walau ada scaling non-uniform)
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vView;
    void main(void) {
        gl_Position = Pmatrix * Vmatrix * Mmatrix * vec4(position, 1.);
        vColor = color;
        vNormal = Nmatrix * normal;
        vView = vec3(Vmatrix * Mmatrix * vec4(position, 1.));
    }`;

  var shader_fragment_source = `
    precision mediump float;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vView;

    // cahaya TETAP terhadap kamera (model yang berputar, seperti turntable)
    const vec3 keyDir  = vec3(0.45, 0.70, 1.00);   // cahaya utama: atas-depan-kanan
    const vec3 fillDir = vec3(-0.60, 0.20, -0.80); // cahaya isi: belakang-kiri (supaya tampak belakang tidak hitam)

    void main(void) {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(-vView);
        vec3 L1 = normalize(keyDir);
        vec3 L2 = normalize(fillDir);

        // ambient: sedikit lebih terang di sisi atas (hemisphere)
        vec3 ambient = mix(vec3(0.38, 0.42, 0.45), vec3(0.58, 0.60, 0.62), 0.5 + 0.5 * N.y);

        float d1 = max(0., dot(N, L1));
        float d2 = max(0., dot(N, L2));

        // specular Phong (kecil, kulit agak matte)
        float spec = 0.;
        if (d1 > 0.) {
            vec3 R = reflect(-L1, N);
            spec = 0.16 * pow(max(dot(R, V), 0.), 24.);
        }

        vec3 I = ambient + 0.55 * d1 + 0.28 * d2;
        gl_FragColor = vec4(I * vColor + vec3(spec), 1.);
    }`;

  var compile = function (src, type, name) {
    var s = GL.createShader(type);
    GL.shaderSource(s, src); GL.compileShader(s);
    if (!GL.getShaderParameter(s, GL.COMPILE_STATUS)) { alert("ERROR IN " + name + " SHADER: " + GL.getShaderInfoLog(s)); return false; }
    return s;
  };
  var PROG = GL.createProgram();
  GL.attachShader(PROG, compile(shader_vertex_source, GL.VERTEX_SHADER, "VERTEX"));
  GL.attachShader(PROG, compile(shader_fragment_source, GL.FRAGMENT_SHADER, "FRAGMENT"));
  GL.linkProgram(PROG);
  GL.useProgram(PROG);

  var _position = GL.getAttribLocation(PROG, "position"); GL.enableVertexAttribArray(_position);
  var _normal = GL.getAttribLocation(PROG, "normal");     GL.enableVertexAttribArray(_normal);
  var _color = GL.getAttribLocation(PROG, "color");       GL.enableVertexAttribArray(_color);
  var _Pmatrix = GL.getUniformLocation(PROG, "Pmatrix");
  var _Vmatrix = GL.getUniformLocation(PROG, "Vmatrix");
  var _Mmatrix = GL.getUniformLocation(PROG, "Mmatrix");
  var _Nmatrix = GL.getUniformLocation(PROG, "Nmatrix");

    // Goresan sirip ekor: 3 celah searah kedalaman (sumbu lokal z), dari pangkal (dekat badan, z lokal > 0)
  // keluar ke ujung. Kedua sisi daun digores (tanpa syarat y), karena sirip ekor ada di tengah badan.
  function tailSlit(x, y, z) {
    var along = smoothstep(0.22, 0.08, z) * smoothstep(-0.34, -0.18, z);
    var across = Math.max(
      Math.exp(-Math.pow((x + 0.15) / 0.03, 2)),
      Math.exp(-Math.pow(x / 0.03, 2)),
      Math.exp(-Math.pow((x - 0.15) / 0.03, 2)));
    return 0.045 * along * across;
  }

  // Goresan sirip belakang kepala (mesh sweep). Posisi vertex di sini dalam koordinat lokal KEPALA
  // (karena path kurvanya ditulis di koordinat kepala). Garis-garis horizontal menjauh dari kepala
  // (searah -z), hanya di bagian yang sudah keluar dari kepala (z < -1.15) dan hanya di sisi lebar
  // sirip (|x| besar), jadi tepi tipis sirip tidak ikut tergores.
  function finGroove(x, y, z) {
    var side = smoothstep(0.07, 0.14, Math.abs(x));
    var along = smoothstep(-1.15, -1.35, z) * smoothstep(-1.95, -1.75, z);
    var across = Math.max(
      Math.exp(-Math.pow((y - 0.36) / 0.03, 2)),
      Math.exp(-Math.pow((y - 0.17) / 0.03, 2)),
      Math.exp(-Math.pow((y + 0.02) / 0.03, 2)));
    return 0.045 * side * along * across;
  }

  // Rusuk jambul: garis lengkung vertikal di sisi DEPAN gelambir (z lokal > 0).
  // ribs = [[x0, k], ...]; tiap rusuk berupa kurva x = x0 + k*y² ( k>0 -> "(" , k<0 -> ")" ),
  // dari y = -0.1 sampai y = 0.4 di koordinat lokal elipsoid jambul.
  function makeCrestRibs(ribs) {
    return function (x, y, z) {
      if (z < 0.05) return 0;
      var front = smoothstep(0.05, 0.2, z);
      var along = smoothstep(-0.12, 0.0, y) * smoothstep(0.42, 0.3, y);
      var d = 0;
      for (var i = 0; i < ribs.length; i++) {
        var xc = ribs[i][0] + ribs[i][1] * y * y;
        d = Math.max(d, Math.exp(-Math.pow((x - xc) / 0.035, 2)));
      }
      return 0.065 * front * along * d;
    };
  }
  var crestBigRibs = makeCrestRibs([[-0.13, 0.35], [0.1, -0.35]]);
  var crestSmallRibs = makeCrestRibs([[0.0, 0.3]]);

  /*========================= DEFINISI BAGIAN TUBUH =========================
    Tiap part = { parent, geo, local }. world = parentWorld * local.
    Semua posisi `local` di bawah adalah posisi RELATIF ke parent-nya.
    Di komentar ditulis juga posisi world-nya supaya gampang dicek ke foto. */
  var PARTS = {};
  var ORDER = [];
  // pivot (opsional) = titik putar animasi, dalam koordinat PARENT. Default = posisi part itu sendiri.
  function part(name, parent, geo, pos, rot, pivot) {
    PARTS[name] = { parent: parent, geo: geo, local: xf(pos, rot), pivot: pivot || pos, world: null };
    ORDER.push(name);   // parent selalu didefinisikan sebelum anaknya
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

  // Posisi world pusat badan & kepala (acuan untuk menghitung posisi relatif anak)
  var BODY_W = [0, -0.65, 0.03];
  var HEAD_W = [0, 1.61, 0];
  var HEAD_L = sub(HEAD_W, BODY_W);   // kepala relatif ke badan

  /*========================= DISPLACEMENT =========================
    Tiap fungsi menerima posisi vertex lokal (x, y, z) dan mengembalikan kedalaman
    cekungan (positif = masuk). Dipakai lewat builder.applyDisplacement(mesh, fn). */
  function smoothstep(e0, e1, x) {
    var t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
    return t * t * (3 - 2 * t);
  }

  // Groove perut: busur "senyum" (∪) kecil. Posisi diberi dalam koordinat WORLD
  // (titik terendah busur) lalu diubah ke koordinat lokal badan, jadi aman
  // kalau BODY_W / tinggi badan kamu ubah.
  var R_ARC = 0.24, HALF_ANGLE = 1.05;
  var BELLY_ARCS = [
    [-0.62, -0.22], [-0.02, -0.28], [0.58, -0.22],   // baris atas
    [-0.36, -0.64], [0.42, -0.62]                    // baris bawah
  ].map(function (a) { return [a[0], a[1] + R_ARC - BODY_W[1]]; });

  function bellyGroove(x, y, z) {
    if (z < 0.2) return 0;
    var front = smoothstep(0.2, 0.6, z);
    var depth = 0;
    for (var i = 0; i < BELLY_ARCS.length; i++) {
      var dx = x - BELLY_ARCS[i][0], dy = y - BELLY_ARCS[i][1];
      var r = Math.sqrt(dx * dx + dy * dy);
      var ang = Math.atan2(dy, dx) + Math.PI / 2;
      var along = smoothstep(HALF_ANGLE, HALF_ANGLE - 0.3, Math.abs(ang));
      var across = Math.exp(-Math.pow((r - R_ARC) / 0.04, 2));
      depth = Math.max(depth, along * across);
    }
    return 0.045 * depth * front;
  }

// Tangan: 2 alur memanjang (memisah 3 jari) dari ujung tangan ke pangkal jari.
  // Koordinat lokal TANGAN (elipsoid 0.34 x 0.32 x 0.28); ujung jari ke arah -y. Kedua sisi (depan/belakang, |z|) digores.
  function handGroove(x, y, z) {
    var face = smoothstep(0.04, 0.12, Math.abs(z));
    var along = smoothstep(-0.02, -0.1, y) * smoothstep(-0.34, -0.27, y);
    var across = Math.max(Math.exp(-Math.pow((x - 0.1) / 0.03, 2)), Math.exp(-Math.pow((x + 0.1) / 0.03, 2)));
    return 0.032 * face * along * across;
  }

  // Kaki: 2 alur dari ujung jari kaki ke belakang (memisah 3 jari kaki), di permukaan atas-depan.
  // Koordinat lokal TELAPAK (elipsoid 0.7 x 0.28 x 0.8); jari kaki ke arah +z.
  function toeGroove(x, y, z) {
    var top = smoothstep(-0.14, -0.02, y);
    var along = smoothstep(0.4, 0.55, z);
    var across = Math.max(Math.exp(-Math.pow((x - 0.17) / 0.03, 2)), Math.exp(-Math.pow((x + 0.17) / 0.03, 2)));
    return 0.04 * top * along * across;
  }

    // Goresan di muka telinga: 2 celah horizontal (sumbu lokal x = tinggi telinga, z = kedalaman).
  // Hanya sisi luar (y lokal > 0).
  function earSlit(x, y, z) {
    if (y <= 0) return 0;
    var along = smoothstep(0.24, 0.12, Math.abs(z + 0.02));
    var across = Math.max(Math.exp(-Math.pow((x - 0.17) / 0.032, 2)), Math.exp(-Math.pow((x + 0.17) / 0.032, 2)));
    return 0.05 * along * across;
  }

  
  // ---------------- BADAN (root) ----------------
  // Telur gemuk, agak kotak membulat. Lebar 2.5, tinggi 1.96, tebal 2.5.
  part("body", null, builder.applyDisplacement(
    builder.generateSuperEllipsoid(1.22, 1.13, 1.25, 2.3, 150, 260, COLOR.body, 0.12),
    bellyGroove),
  BODY_W, null, [0, -2.1, 0]); // pivot animasi di tanah (dasar telapak kaki)

  // ---------------- KEPALA ----------------
  // Lebar 2.72, tinggi 2.6, tebal 2.4. Kotak membulat (p=2.8), sedikit lebih sempit di atas, pusat y=1.61.
  part("head", "body", builder.generateSuperEllipsoid(1.36, 1.3, 1.2, 2.8, 30, 44, COLOR.head, 0.08), HEAD_L,
    null, sub([0, 0.3, 0], BODY_W));            // pivot animasi: leher

  // ---------------- MATA (bola putih + pupil kecil di bawah-tengah) ----------------
  [-1, 1].forEach(function (s) {
    var L = s < 0 ? "L" : "R";   // s = -1 -> sisi kiri layar (kanan karakter)
    part("eye" + L, "head",
      builder.generateEllipsoid(0.5, 0.52, 0.36, 18, 24, COLOR.white),
      [s * 0.62, -0.14, 0.98], [0, s * 0.2, 0]);                 // world: (±0.62, 1.47, 0.98)
    part("pupil" + L, "eye" + L,
      builder.generateEllipsoid(0.11, 0.12, 0.07, 12, 16, COLOR.black),
      [-s * 0.2, -0.05, 0.31]);                                    // pupil agak ke arah tengah wajah
    // Kelopak (untuk kedip): elipsoid warna kulit sedikit lebih besar dari bola mata. Disembunyikan saat mata terbuka;
    // saat kedip di-SCALE di sumbu Y dari atas mata ke bawah (pivot = puncak mata).
    part("lid" + L, "head",
      builder.generateEllipsoid(0.54, 0.56, 0.46, 18, 24, COLOR.head),
      [s * 0.62, -0.14, 0.98], [0, s * 0.2, 0], [s * 0.62, 0.38, 0.98]);
    PARTS["lid" + L].hiddenDefault = true;
  });

  // ---------------- MULUT (elliptic paraboloid, paruh bebek lebar & pipih) ----------------
  // Lebar 2.4, tinggi 0.66, menonjol ~0.45 dari wajah, ujung sedikit turun.
  // Paraboloid aslinya "mangkuk" menghadap +Y -> diputar -90° di X supaya apex-nya menghadap +Z.
  part("mouthUpper", "head",
    builder.generateEllipticParaboloid(1.18, 0.33, 0.9, 12, 40, COLOR.pink, true),
    [0, -0.9, 1.5], [-Math.PI / 2 + 0.04, 0, 0]);
  part("mouthLower", "head",
    builder.generateEllipticParaboloid(1.1, 0.3, 0.9, 12, 40, COLOR.pinkDark, true),
    [0, -1.08, 1.5], [-Math.PI / 2 + 0.14, 0, 0], [0, -1.08, 0.5]);

  // ---------------- TELINGA (hyperbolic paraboloid tebal, daun oval berdiri di sisi kepala) ----------------
  // Tinggi 1.24, lebar 0.54, tebal 0.4. Menonjol ~0.4 dari siluet kepala, agak menghadap depan.
  [-1, 1].forEach(function (s) {
    var L = s < 0 ? "L" : "R";
    part("ear" + L, "head",
      builder.applyDisplacement(builder.generateHyperbolicParaboloid(0.64, 0.3, 0.10, 0.2, 40, 90, COLOR.blue), earSlit),
      [s * 1.56, -0.08, 0.1], [0, -s * 0.8, -s * Math.PI / 2], [s * 1.3, -0.08, 0.1]); // world: (±1.55, 1.53, 0.12)
  });

  // ---------------- JAMBUL (2 gelambir di atas kepala, miring ke kanan layar) ----------------
  part("crestBig", "head",
    builder.applyDisplacement(builder.generateEllipsoid(0.42, 0.52, 0.36, 90, 140, COLOR.blue), crestBigRibs),
    [-0.05, 1.49, 0.0], [0, 0, -0.12], [-0.05, 1.1, 0.0]);    
  part("crestSmall", "head",
    builder.applyDisplacement(builder.generateEllipsoid(0.34, 0.44, 0.3, 90, 140, COLOR.blue), crestSmallRibs),
    [0.62, 1.39, 0.02], [0, 0, -0.5], [0.62, 1.05, 0.02]);

  // ---------------- SIRIP BELAKANG KEPALA (sweep mengikuti kurva Bezier) ----------------
  // Kurva dari belakang atas kepala, melengkung keluar ke belakang, lalu kembali ke kepala bawah.
  function finPath(t) {
    var p0 = [0, 0.5, -0.75], p1 = [0, -0.05, -2.05], p2 = [0, -0.55, -1.0];   // di dalam finPath
   // koordinat lokal kepala
    var mt = 1 - t;
    return [
      mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
      mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
      mt * mt * p0[2] + 2 * mt * t * p1[2] + t * t * p2[2],
    ];
  }

  part("dorsalFin", "head",
    builder.applyDisplacement(builder.generateSweepFin(finPath, 0.21, 0.42, 110, 110, COLOR.blue), finGroove),
    [0, 0, 0], null, [0, 0.5, -0.8]);

  // ---------------- GURITA KECIL (di kiri-atas kepala) ----------------
  // Kepala bulat + 8 tentakel gemuk melebar seperti rok + wajah:
  // mata tertutup "^ ^" (tube melengkung), bercak pink oval, dan hidung kecil.
  part("octopus", "head",
    builder.generateEllipsoid(0.36, 0.38, 0.34, 20, 28, COLOR.red),
    [-0.95, 1.55, 0.28], [0, 0, 0.4], [-0.9, 1.28, 0.2]);

  for (var k = 0; k < 8; k++) {
    var ph = k * 2 * Math.PI / 8 + 0.2, tau = 0.95;          // tau = seberapa melebar keluar (rad)
    part("tent" + k, "octopus",
      builder.generateEllipsoid(0.11, 0.25, 0.1, 10, 14, COLOR.red),
      [0.25 * Math.cos(ph), -0.27, 0.25 * Math.sin(ph)],
      [-tau * Math.sin(ph), 0, tau * Math.cos(ph)],
      // pivot = ujung ATAS tentakel (tempat menempel di kepala gurita)
      [0.25 * Math.cos(ph) - 0.25 * Math.sin(tau) * Math.cos(ph), -0.27 + 0.25 * Math.cos(tau), 0.25 * Math.sin(ph) - 0.25 * Math.sin(tau) * Math.sin(ph)]);
  }

  function eyeArc(t) {                                       // mata tertutup ∩
    var a = (8 + 164 * t) * Math.PI / 180;
    return [0.095 * Math.cos(a), 0.1 * Math.sin(a), 0];
  }
  [-1, 1].forEach(function (s) {
    part("octoEye" + (s < 0 ? "L" : "R"), "octopus",
      builder.generateTube(eyeArc, 0.03, 20, 10, COLOR.black),
      [s * 0.15, 0.04, 0.315], [0, s * 0.45, -s * 0.1]);
  });

  part("octoPatch", "octopus",                               // bercak pink + hidung
    builder.generateEllipsoid(0.13, 0.095, 0.035, 14, 20, COLOR.patch),
    [-0.01, -0.1, 0.35], [0, -0.1, 0.1]);
  part("octoNose", "octoPatch",
    builder.generateEllipsoid(0.04, 0.03, 0.025, 8, 12, COLOR.red),
    [0, 0, 0.03]);

  // ---------------- SIRIP EKOR (daun tebal di punggung bawah) ----------------
  part("tailFin", "body",
    builder.applyDisplacement(builder.generateHyperbolicParaboloid(0.4, 0.42, 0.08, 0.2, 50, 110, COLOR.blue), tailSlit),
    [0, -0.15, -1.5], [-0.3, 0, Math.PI / 2], [0, -0.15, -1.25]);                   // world: (0, -0.8, -1.47)

  // ---------------- LENGAN: ellips gemuk + telapak, menggantung & terayun ke depan ----------------
  // Pangkal di bahu (±1.1, 0.2, 0.1). Sudut: miring ke luar 0.2 rad, ke depan 0.85 rad.
  [-1, 1].forEach(function (s) {
    var L = s < 0 ? "L" : "R";
    part("arm" + L, "body",
      builder.generateEllipsoid(0.3, 0.8, 0.3, 14, 20, COLOR.body),
      sub([s * 1.14, -0.48, 0.48], BODY_W), [-0.65, 0, s * 0.14],
      sub([s * 1.12, 0.3, 0.1], BODY_W));                           // pivot animasi: bahu
    part("hand" + L, "arm" + L,
      builder.applyDisplacement(builder.generateEllipsoid(0.34, 0.32, 0.28, 80, 120, COLOR.body), handGroove),
      [0, -0.7, 0], null, [0, -0.45, 0]);                                               // di ujung lengan (sumbu lokal lengan)
  });

  // ---------------- KAKI: pangkal gemuk + telapak besar pipih ----------------
  [-1, 1].forEach(function (s) {
    var L = s < 0 ? "L" : "R";
    part("leg" + L, "body",
      builder.generateEllipsoid(0.42, 0.42, 0.45, 14, 20, COLOR.body),
      sub([s * 0.74, -1.68, 0.1], BODY_W));
    part("foot" + L, "leg" + L,
      builder.applyDisplacement(builder.generateEllipsoid(0.7, 0.32, 0.8, 80, 120, COLOR.body), toeGroove),
      [s * 0.11, -0.3, 0.24], [0, s * 0.12, 0]);                    // telapak: dasar di y = -2.1
  });

    // ---------------- MATA SENANG ^ ^ (dipakai Happy & Walk; tersembunyi saat tidak dianimasikan) ----------------
  function happyEyeArc(t) {
    var a = (12 + 156 * t) * Math.PI / 180;
    var x = 0.3 * Math.cos(a), y = -0.2 + 0.24 * Math.sin(a);
    var z = 0.36 * Math.sqrt(Math.max(0, 1 - Math.pow(x / 0.5, 2) - Math.pow(y / 0.52, 2))) + 0.03;   // ikut lengkung bola mata
    return [x, y, z];
  }
  [-1, 1].forEach(function (s) {
    var L = s < 0 ? "L" : "R";
    part("happyEye" + L, "eye" + L, builder.generateTube(happyEyeArc, 0.055, 24, 10, COLOR.black), [0, 0, 0]);
    PARTS["happyEye" + L].hiddenDefault = true;
  });

    // ---------------- MATA MERINGIS > < (dipakai Slip: terpeleset & mengibas kering; tersembunyi saat tidak dianimasikan) ----------------
  // dir = +1 -> ujung ">" menghadap +X (mata kiri layar), dir = -1 -> "<" (mata kanan layar): ujung selalu menghadap tengah wajah.
  // Jalur: lengan atas -> sudut membulat (bezier kuadrat) -> lengan bawah, lalu dilengkungkan mengikuti bola mata.
  function painEyeArc(dir) {
    var A = [-0.2 * dir, 0.10], V = [0.2 * dir, -0.05], B = [-0.2 * dir, -0.20];     // ujung atas, sudut, ujung bawah
    var C1 = [V[0] + (A[0] - V[0]) * 0.18, V[1] + (A[1] - V[1]) * 0.18];            // awal pembulatan sudut
    var C2 = [V[0] + (B[0] - V[0]) * 0.18, V[1] + (B[1] - V[1]) * 0.18];            // akhir pembulatan sudut
    return function (t) {
      var x, y;
      if (t < 0.45) { var u = t / 0.45; x = A[0] + (C1[0] - A[0]) * u; y = A[1] + (C1[1] - A[1]) * u; }
      else if (t < 0.55) {
        var q = (t - 0.45) / 0.1, a = (1 - q) * (1 - q), b = 2 * (1 - q) * q, c = q * q;
        x = a * C1[0] + b * V[0] + c * C2[0]; y = a * C1[1] + b * V[1] + c * C2[1];
      } else { var w = (t - 0.55) / 0.45; x = C2[0] + (B[0] - C2[0]) * w; y = C2[1] + (B[1] - C2[1]) * w; }
      var z = 0.36 * Math.sqrt(Math.max(0, 1 - Math.pow(x / 0.5, 2) - Math.pow(y / 0.52, 2))) + 0.03;   // ikut lengkung bola mata
      return [x, y, z];
    };
  }
  [-1, 1].forEach(function (s) {
    var L = s < 0 ? "L" : "R";
    part("painEye" + L, "eye" + L, builder.generateTube(painEyeArc(-s), 0.06, 40, 10, COLOR.black), [0, 0, 0]);
    PARTS["painEye" + L].hiddenDefault = true;
  });

  // ---------------- EFEK HAPPY EMOTE: 1 hati besar, 3 hati kecil, 6 kilau (anak dari kepala) ----------------
  part("heartBig", "head", generateHeart(0.5, 0.2, 12, 48, COLOR.heart), [0.05, 2.2, -0.3]);
  PARTS.heartBig.hiddenDefault = true;
  [[-1.95, 1.2, 0.6], [2.0, 1.5, 0.6], [0.9, 2.0, 0.8]].forEach(function (p, i) {
    part("heartS" + i, "head", generateHeart(0.22, 0.08, 8, 32, COLOR.heart), p);
    PARTS["heartS" + i].hiddenDefault = true;
  });
  [[-2.1, 0.9, 0.3], [-1.9, 0.1, 0.4], [2.1, 1.5, 0.3], [1.5, 2.1, 0.4], [-1.2, 2.2, 0.4], [2.2, 0.3, 0.4]].forEach(function (p, i) {
    part("spark" + i, "head", generateSparkle(0.32, 0.07, COLOR.spark), p);
    PARTS["spark" + i].hiddenDefault = true;
  });

  // ---------------- EFEK PERCIKAN AIR (slip & dry): bola lonjong kecil, anak dari badan ----------------
  for (var di = 0; di < DROP_COUNT; di++) {
    part("drop" + di, "body", builder.generateEllipsoid(0.1, 0.1, 0.1, 10, 14, COLOR.water), [0, 0, 0]);
    PARTS["drop" + di].hiddenDefault = true;
  }

  /*========================= HIERARCHY: world matrix dihitung TIAP FRAME =========================
    world = parentWorld * (A_anim * local), A_anim = animasi di sekitar pivot (kosong kalau tidak ada animasi).
    Karena anak selalu dikalikan dengan world parent-nya, gerak kepala otomatis membawa mata, mulut, telinga,
    jambul, gurita (+ tentakelnya); gerak lengan membawa tangan, dst. (Hierarchical Transformation) */
  function updateWorld(deltas) {
    ORDER.forEach(function (name) {
      var p = PARTS[name];
      var d = deltas[name];
      var local = d ? mul(animMatrix(d, p.pivot), p.local) : p.local;
      p.world = p.parent === null ? local : mul(PARTS[p.parent].world, local);
    });
  }

  /*========================= UPLOAD BUFFERS =========================*/
  ORDER.forEach(function (name) {
    var p = PARTS[name];
    p.VBO = GL.createBuffer();
    GL.bindBuffer(GL.ARRAY_BUFFER, p.VBO);
    GL.bufferData(GL.ARRAY_BUFFER, new Float32Array(p.geo.vertices), GL.STATIC_DRAW);
    p.EBO = GL.createBuffer();
    GL.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, p.EBO);
    GL.bufferData(GL.ELEMENT_ARRAY_BUFFER, new Uint16Array(p.geo.faces), GL.STATIC_DRAW);
    p.count = p.geo.faces.length;
  });

  /*========================= DRAW =========================*/
  var STRIDE = 4 * 9;

  /*========================= STATE ANIMASI =========================
    Hanya 1 animasi aktif pada satu waktu. Ganti animasi = yang lama fade-out dulu, lalu yang baru fade-in.
    Mulai otomatis di IDLE.

    Tiap animasi bisa punya:
      evaluate(t, w)  -> delta tiap part (pose tubuh)
      move(t)         -> { v: kecepatan maju, turn: laju belok, k: seberapa cepat mengejar target }  (opsional)
      instant         -> true = langsung mulai tanpa fade-out animasi lama (dipakai slip supaya spontan)
      duration, next  -> animasi sekali-jalan: setelah `duration` detik otomatis pindah ke `next` */
  var ANIMS = {
    idle:   { evaluate: evaluateIdle },
    happy:  { evaluate: evaluateHappy },
    walk:   { evaluate: evaluateWalk,       move: function () { return { v: WALK_SPEED }; } },                     // jalan LURUS (translasi)
    circle: { evaluate: evaluateWalkCircle, move: function () { return { v: CIRCLE_SPEED, turn: CIRCLE_TURN }; } },   // jalan melingkar
    slip:   { evaluate: evaluateSlip, move: slipMove, instant: true, duration: SLIP_DURATION, next: "idle" }          // terpeleset -> jatuh -> bangun -> mengeringkan badan
  };
  var anim = { current: "idle", requested: "idle", weight: 1, time: 0 };

  function setAnim(name) { anim.requested = name || "idle"; }
  function toggleAnim(name) { anim.requested = (anim.requested === name) ? "idle" : name; }   // tekan lagi = berhenti (kembali idle)

  /*========================= POSE: POSISI & ARAH HADAP YANG TERSIMPAN =========================
    Posisi (x, z) dan arah hadap (yaw) disimpan DI SINI, bukan di dalam animasi. Jadi pindah animasi
    (mis. sedang jalan melingkar lalu tekan Happy) = berhenti tepat di tempat itu, tidak balik ke titik awal.
    Koordinat pose = ruang model dari matriks M milik world.js (spawn = titik awal karakter). */
  var pose = { x: 0, z: 0, yaw: 0, speed: 0, turn: 0 };
  var worldPos = null;

  var lastT = null;

  // M = model matrix dunia (translasi * rotasi Y * skala) dari world.js, t = detik
  // groundAt(x, z) = tinggi tanah dunia (opsional, ENV.groundHeight) supaya karakter mengikuti kontur tanah
  function draw(M, t, groundAt) {
    var dt = lastT === null ? 0 : Math.min(Math.max(t - lastT, 0), 0.1);
    lastT = t;

    // animasi sekali-jalan selesai -> lanjut ke animasi berikutnya (idle)
    var cur = anim.current ? ANIMS[anim.current] : null;
    if (cur && cur.duration && anim.current === anim.requested && anim.time >= cur.duration) anim.requested = cur.next || "idle";

    if (anim.current !== anim.requested) {
      var nxt = ANIMS[anim.requested];
      if (nxt && nxt.instant) {                     // langsung ganti, tanpa fade
        anim.current = anim.requested; anim.weight = 1; anim.time = 0;
      } else {                                      // fade-out dulu
        anim.weight += (0 - anim.weight) * (1 - Math.exp(-dt * 9));
        if (anim.weight < 0.02) { anim.weight = 0; anim.current = anim.requested; anim.time = 0; }
      }
    } else {                                        // animasi yang sama: fade-in
      anim.weight += (1 - anim.weight) * (1 - Math.exp(-dt * 5));
    }
    if (anim.current) anim.time += dt;

    var def = anim.current ? ANIMS[anim.current] : null;
    var deltas = (def && anim.weight > 0) ? def.evaluate(anim.time, anim.weight) : {};
    updateWorld(deltas);

    // ---- gerak badan: integrasi kecepatan -> posisi & arah hadap ----
    // sedang transisi / animasi tanpa move() => berhenti SEKETIKA di tempat (k sangat besar)
    var mv = (def && def.move && anim.current === anim.requested) ? def.move(anim.time) : null;
    var tv = mv ? (mv.v || 0) : 0, tw = mv ? (mv.turn || 0) : 0, kk = mv ? (mv.k || 8) : 1e9;
    var ak = 1 - Math.exp(-kk * dt);
    pose.speed += (tv - pose.speed) * ak;
    pose.turn  += (tw - pose.turn) * ak;
    pose.yaw += pose.turn * dt;
    pose.x += Math.sin(pose.yaw) * pose.speed * dt;     // maju = searah hadap (lokal +Z diputar yaw)
    pose.z += Math.cos(pose.yaw) * pose.speed * dt;

    // ---- ikuti kontur tanah di posisi baru ----
    var dy = 0;
    if (groundAt) {
      var wx = M[0] * pose.x + M[8] * pose.z + M[12];
      var wz = M[2] * pose.x + M[10] * pose.z + M[14];
      var sc = Math.hypot(M[4], M[5], M[6]) || 1;
      dy = (groundAt(wx, wz) - groundAt(M[12], M[14])) / sc;
    }

    // Mroot = M * Translate(pose) * RotateY(yaw)   (RotateY lewat Rodrigues = rotasi sumbu sembarang [0,1,0])
    var Mroot = mul(M, mul(translationM([pose.x, dy, pose.z]), axisAngleM([0, 1, 0], pose.yaw)));
    worldPos = [Mroot[12], Mroot[13], Mroot[14]];

    // Context dipakai bersama: set ulang program & attribute milik Hangyodon tiap draw
    GL.useProgram(PROG);
    for (var a = 0; a < 8; a++) GL.disableVertexAttribArray(a);
    GL.enableVertexAttribArray(_position);
    GL.enableVertexAttribArray(_normal);
    GL.enableVertexAttribArray(_color);
    GL.uniformMatrix4fv(_Pmatrix, false, cam.P);
    GL.uniformMatrix4fv(_Vmatrix, false, cam.V);

    ORDER.forEach(function (name) {
      var p = PARTS[name];
      var d = deltas[name];
      if (d ? d.hidden : p.hiddenDefault) return;           // kelopak/efek: hanya tampil saat dipakai animasi
      var Mp = mul(Mroot, p.world);                          // world karakter * hierarki bagian
      GL.uniformMatrix4fv(_Mmatrix, false, Mp);
      GL.uniformMatrix3fv(_Nmatrix, false, normalMatrix(Mp));
      GL.bindBuffer(GL.ARRAY_BUFFER, p.VBO);
      GL.vertexAttribPointer(_position, 3, GL.FLOAT, false, STRIDE, 0);
      GL.vertexAttribPointer(_normal, 3, GL.FLOAT, false, STRIDE, 12);
      GL.vertexAttribPointer(_color, 3, GL.FLOAT, false, STRIDE, 24);
      GL.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, p.EBO);
      GL.drawElements(GL.TRIANGLES, p.count, GL.UNSIGNED_SHORT, 0);
    });
  }

  // Dipakai world.js: obj.draw(M, t, groundAt) + kontrol animasi
  return {
    draw: draw,
    animations: ["idle", "happy", "walk", "circle", "slip"],
    play: function (name) { setAnim(name); },            // "idle" | "happy" | "walk" | "circle" | "slip"
    toggle: function (name) { toggleAnim(name); },       // tekan lagi = kembali idle
    stop: function () { setAnim("idle"); },
    current: function () { return anim.requested; },
    getPos: function () { return worldPos; }             // posisi dunia karakter sekarang (kamera mengikuti)
  };
}
