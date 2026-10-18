import * as builder from "./helpers/builders.js";
import { LIBS } from "./helpers/libs.js";

// =====================================================================
// VERSI SIMPEL: hanya bentuk (shape), tata letak (layout), dan hierarchy.
// Tanpa animasi. Hanya bisa diputar mengelilingi sumbu vertikal (Y).
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

function mul(parentWorld, local) { return LIBS.multiply(local, parentWorld); }

function main() {
  var CANVAS = document.getElementById("mycanvas");
  var GL = CANVAS.getContext("webgl", { antialias: true });
  if (!GL) { alert("WebGL context cannot be initialized"); return false; }

  /*========================= SHADERS (Phong) =========================*/
  var shader_vertex_source = `
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec3 color;
    uniform mat4 Pmatrix, Vmatrix, Mmatrix;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vView;
    void main(void) {
        gl_Position = Pmatrix * Vmatrix * Mmatrix * vec4(position, 1.);
        vColor = color;
        vNormal = vec3(Mmatrix * vec4(normal, 0.));
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

  /*========================= CAMERA =========================*/
  var PROJMATRIX, VIEWMATRIX;
  function resize() {
    var dpr = window.devicePixelRatio || 1;
    CANVAS.width = Math.floor(CANVAS.clientWidth * dpr);
    CANVAS.height = Math.floor(CANVAS.clientHeight * dpr);
    var aspect = CANVAS.width / CANVAS.height;
    PROJMATRIX = LIBS.get_projection(24, aspect, 1, 100);
    // jarak kamera otomatis supaya seluruh karakter (tinggi ~6) selalu muat
    // di layar landscape maupun portrait
    var dist = Math.max(9.2 * aspect, 7.0);
    VIEWMATRIX = LIBS.get_I4();
    LIBS.translateY(VIEWMATRIX, -0.55);   // titik pandang: tengah karakter (sedikit di bawah, ruang untuk tombol)
    LIBS.translateZ(VIEWMATRIX, -dist);
  }
  window.addEventListener("resize", resize);
  resize();

  /*========================= KONTROL: HANYA PUTAR VERTIKAL (sumbu Y) =========================*/
  var THETA = 0;
  var drag = false, x_prev = 0;
  CANVAS.addEventListener("pointerdown", function (e) {
    drag = true; x_prev = e.clientX; CANVAS.setPointerCapture(e.pointerId); CANVAS.classList.add("dragging");
  });
  CANVAS.addEventListener("pointermove", function (e) {
    if (!drag) return;
    THETA += (e.clientX - x_prev) * 2 * Math.PI / CANVAS.clientWidth;
    x_prev = e.clientX;
  });
  var end = function () { drag = false; CANVAS.classList.remove("dragging"); };
  CANVAS.addEventListener("pointerup", end);
  CANVAS.addEventListener("pointercancel", end);
  window.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") THETA -= 0.1;
    if (e.key === "ArrowRight") THETA += 0.1;
  });
  var VIEWS = { front: 0, side: -Math.PI / 2, back: Math.PI };   // side = sisi kiri karakter, sama seperti foto referensi
  document.querySelectorAll("#ui button").forEach(function (b) {
    b.addEventListener("click", function () { THETA = VIEWS[b.dataset.view]; });
  });

  /*========================= DEFINISI BAGIAN TUBUH =========================
    Tiap part = { parent, geo, local }. world = parentWorld * local.
    Semua posisi `local` di bawah adalah posisi RELATIF ke parent-nya.
    Di komentar ditulis juga posisi world-nya supaya gampang dicek ke foto. */
  var PARTS = {};
  var ORDER = [];
  function part(name, parent, geo, pos, rot) {
    PARTS[name] = { parent: parent, geo: geo, local: xf(pos, rot) };
    ORDER.push(name);   // parent selalu didefinisikan sebelum anaknya
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

  // Posisi world pusat badan & kepala (acuan untuk menghitung posisi relatif anak)
  var BODY_W = [0, -0.65, 0.03];
  var HEAD_W = [0, 1.61, 0];
  var HEAD_L = sub(HEAD_W, BODY_W);   // kepala relatif ke badan
  
  function smoothstep(e0, e1, x) {
  var t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

// Groove perut: busur "senyum" ∪. Posisi dalam koordinat WORLD (titik terendah busur)
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

// Goresan di muka telinga: 2 celah horizontal, hanya sisi luar
function earSlit(x, y, z) {
  if (y <= 0) return 0;
  var along = smoothstep(0.24, 0.12, Math.abs(z + 0.02));
  var across = Math.max(Math.exp(-Math.pow((x - 0.17) / 0.032, 2)), Math.exp(-Math.pow((x + 0.17) / 0.032, 2)));
  return 0.05 * along * across;
}

// Sirip ekor: 3 celah searah kedalaman (z lokal), dari pangkal keluar ke ujung. Kedua sisi daun digores.
function tailSlit(x, y, z) {
  var along = smoothstep(0.22, 0.08, z) * smoothstep(-0.34, -0.18, z);
  var across = Math.max(
    Math.exp(-Math.pow((x + 0.15) / 0.03, 2)),
    Math.exp(-Math.pow(x / 0.03, 2)),
    Math.exp(-Math.pow((x - 0.15) / 0.03, 2)));
  return 0.045 * along * across;
}

// Sirip belakang kepala (mesh sweep, koordinat lokal KEPALA): 3 garis horizontal menjauh dari kepala (-z),
// hanya di bagian yang sudah keluar dari kepala, dan hanya di sisi lebar sirip (|x| besar).
function finGroove(x, y, z) {
  var side = smoothstep(0.07, 0.14, Math.abs(x));
  var along = smoothstep(-1.15, -1.35, z) * smoothstep(-1.95, -1.75, z);
  var across = Math.max(
    Math.exp(-Math.pow((y - 0.36) / 0.03, 2)),
    Math.exp(-Math.pow((y - 0.17) / 0.03, 2)),
    Math.exp(-Math.pow((y + 0.02) / 0.03, 2)));
  return 0.045 * side * along * across;
}

// Rusuk jambul: kurva vertikal di sisi DEPAN gelambir. ribs = [[x0, k], ...], kurva x = x0 + k*y²
// (k>0 -> "(" , k<0 -> ")"), dari y = -0.1 sampai 0.4 di koordinat lokal elipsoid.
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
var crestBigRibs   = makeCrestRibs([[-0.13, 0.35], [0.1, -0.35]]);
var crestSmallRibs = makeCrestRibs([[0.0, 0.3]]);

  // ---------------- BADAN (root) ----------------
  // Telur gemuk, agak kotak membulat. Lebar 2.5, tinggi 1.96, tebal 2.5.
  part("body", null,
  builder.applyDisplacement(
    builder.generateSuperEllipsoid(1.22, 1.13, 1.25, 2.3, 150, 260, COLOR.body, 0.12),
    bellyGroove),
  BODY_W);

  // ---------------- KEPALA ----------------
  // Lebar 2.72, tinggi 2.6, tebal 2.4. Kotak membulat (p=2.8), sedikit lebih sempit di atas, pusat y=1.61.
  part("head", "body", builder.generateSuperEllipsoid(1.36, 1.3, 1.2, 2.8, 30, 44, COLOR.head, 0.08), HEAD_L);

  // ---------------- MATA (bola putih + pupil kecil di bawah-tengah) ----------------
  [-1, 1].forEach(function (s) {
    var L = s < 0 ? "L" : "R";   // s = -1 -> sisi kiri layar (kanan karakter)
    part("eye" + L, "head",
      builder.generateEllipsoid(0.5, 0.52, 0.36, 18, 24, COLOR.white),
      [s * 0.62, -0.14, 0.98], [0, s * 0.2, 0]);                 // world: (±0.62, 1.47, 0.98)
    part("pupil" + L, "eye" + L,
      builder.generateEllipsoid(0.11, 0.12, 0.07, 12, 16, COLOR.black),   // sebelumnya 0.085, 0.095, 0.06
      [-s * 0.2, -0.05, 0.31]);                                    // pupil agak ke arah tengah wajah
  });

  // ---------------- MULUT (elliptic paraboloid, paruh bebek lebar & pipih) ----------------
  // Lebar 2.4, tinggi 0.66, menonjol ~0.45 dari wajah, ujung sedikit turun.
  // Paraboloid aslinya "mangkuk" menghadap +Y -> diputar -90° di X supaya apex-nya menghadap +Z.
  part("mouthUpper", "head",
    builder.generateEllipticParaboloid(1.18, 0.33, 0.9, 12, 40, COLOR.pink, true),
    [0, -0.9, 1.5], [-Math.PI / 2 + 0.04, 0, 0]);
  part("mouthLower", "head",
    builder.generateEllipticParaboloid(1.1, 0.3, 0.9, 12, 40, COLOR.pinkDark, true),
    [0, -1.08, 1.5], [-Math.PI / 2 + 0.14, 0, 0]);
  // ---------------- TELINGA (hyperbolic paraboloid tebal, daun oval berdiri di sisi kepala) ----------------
  // Tinggi 1.24, lebar 0.54, tebal 0.4. Menonjol ~0.4 dari siluet kepala, agak menghadap depan.
  [-1, 1].forEach(function (s) {
    var L = s < 0 ? "L" : "R";
    part("ear" + L, "head",
      builder.applyDisplacement(builder.generateHyperbolicParaboloid(0.64, 0.3, 0.10, 0.2, 40, 90, COLOR.blue), earSlit),
      [s * 1.56, -0.08, 0.1], [0, -s * 0.8, -s * Math.PI / 2]);  // world: (±1.55, 1.53, 0.12)
  });

  // ---------------- JAMBUL (2 gelambir di atas kepala, miring ke kanan layar) ----------------
  part("crestBig", "head",
    builder.applyDisplacement(builder.generateEllipsoid(0.42, 0.52, 0.36, 90, 140, COLOR.blue), crestBigRibs),
    [-0.05, 1.49, 0.0], [0, 0, -0.12]);
  part("crestSmall", "head",
    builder.applyDisplacement(builder.generateEllipsoid(0.34, 0.44, 0.3, 90, 140, COLOR.blue), crestSmallRibs),
    [0.62, 1.39, 0.02], [0, 0, -0.5]);

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
    [0, 0, 0]);

  // ---------------- GURITA KECIL MERAH (di kiri-atas kepala di foto) ----------------
  part("octopus", "head",
  builder.generateEllipsoid(0.36, 0.38, 0.34, 20, 28, COLOR.red),
  [-0.95, 1.55, 0.28], [0, 0, 0.4]);

  for (var k = 0; k < 8; k++) {                              // 8 tentakel, melebar seperti rok
    var ph = k * 2 * Math.PI / 8 + 0.2, tau = 0.95;
    part("tent" + k, "octopus",
      builder.generateEllipsoid(0.11, 0.25, 0.1, 10, 14, COLOR.red),
      [0.25 * Math.cos(ph), -0.27, 0.25 * Math.sin(ph)],
      [-tau * Math.sin(ph), 0, tau * Math.cos(ph)]);
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
    [0, -0.15, -1.5], [-0.3, 0, Math.PI / 2]);                     // world: (0, -0.8, -1.47)

  // ---------------- LENGAN: sosis gemuk + telapak, menggantung & terayun ke depan ----------------
  // Pangkal di bahu (±1.1, 0.2, 0.1). Sudut: miring ke luar 0.2 rad, ke depan 0.85 rad.
  [-1, 1].forEach(function (s) {
    var L = s < 0 ? "L" : "R";
    part("arm" + L, "body",
      builder.generateEllipsoid(0.3, 0.6, 0.3, 14, 20, COLOR.body),
      sub([s * 1.14, -0.2, 0.48], BODY_W), [-0.85, 0, s * 0.14]);
    part("hand" + L, "arm" + L,
      builder.generateEllipsoid(0.34, 0.32, 0.28, 12, 18, COLOR.body),
      [0, -0.62, 0]);                                               // di ujung lengan (sumbu lokal lengan)
  });

  // ---------------- KAKI: pangkal gemuk + telapak besar pipih ----------------
  [-1, 1].forEach(function (s) {
    var L = s < 0 ? "L" : "R";
    part("leg" + L, "body",
      builder.generateEllipsoid(0.42, 0.42, 0.45, 14, 20, COLOR.body),
      sub([s * 0.74, -1.68, 0.1], BODY_W));
    part("foot" + L, "leg" + L,
      builder.generateEllipsoid(0.7, 0.28, 0.8, 14, 24, COLOR.body),
      [s * 0.11, -0.3, 0.24], [0, s * 0.12, 0]);                    // telapak: dasar di y = -2.1
  });

  /*========================= HIERARCHY: hitung world matrix sekali =========================*/
  ORDER.forEach(function (name) {
    var p = PARTS[name];
    p.world = p.parent === null ? p.local : mul(PARTS[p.parent].world, p.local);
  });

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
  GL.enable(GL.DEPTH_TEST);
  GL.depthFunc(GL.LEQUAL);
  GL.clearColor(0.867, 0.867, 0.867, 1.0);   // abu-abu terang, sama seperti latar foto referensi
  var STRIDE = 4 * 9;

  function draw() {
    GL.viewport(0, 0, CANVAS.width, CANVAS.height);
    GL.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);

    // rotasi turntable: hanya sumbu Y (vertikal)
    var rootRot = LIBS.get_I4();
    LIBS.rotateY(rootRot, THETA);

    GL.uniformMatrix4fv(_Pmatrix, false, PROJMATRIX);
    GL.uniformMatrix4fv(_Vmatrix, false, VIEWMATRIX);

    ORDER.forEach(function (name) {
      var p = PARTS[name];
      GL.uniformMatrix4fv(_Mmatrix, false, mul(rootRot, p.world));
      GL.bindBuffer(GL.ARRAY_BUFFER, p.VBO);
      GL.vertexAttribPointer(_position, 3, GL.FLOAT, false, STRIDE, 0);
      GL.vertexAttribPointer(_normal, 3, GL.FLOAT, false, STRIDE, 12);
      GL.vertexAttribPointer(_color, 3, GL.FLOAT, false, STRIDE, 24);
      GL.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, p.EBO);
      GL.drawElements(GL.TRIANGLES, p.count, GL.UNSIGNED_SHORT, 0);
    });
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  window.__setTheta = function (t) { THETA = t; };   // dipakai untuk screenshot/debug
}

window.addEventListener("load", main);
