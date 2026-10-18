import * as builder from "./helpers/builders.js";
// LIBS sekarang global dari /libs.js (tidak perlu import)

// Hangyodon sebagai "factory": createHangyodon(GL, cam) -> { draw(M) }
// Canvas, kamera, input, dan loop ada di ../world.js.
// Sistem koordinat: +X = sisi kiri karakter, +Y = atas, +Z = depan.

function hex(h) {
  return [parseInt(h.substr(1, 2), 16) / 255, parseInt(h.substr(3, 2), 16) / 255, parseInt(h.substr(5, 2), 16) / 255];
}
var COLOR = {
  head:  hex("#82cbd6"),
  body:  hex("#66b8c4"),
  blue:  hex("#4b8ecb"),
  pink:  hex("#eba3bd"),
  white: hex("#f4f4f4"),
  black: hex("#1b1212"),
  red:   hex("#e0706a"),
};

// Urutan transform lokal: rotZ -> rotX -> rotY, lalu translate.
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
// world = parentWorld * local  (LIBS.multiply(m1, m2) mengembalikan m2 * m1)
function mul(parentWorld, local) { return LIBS.multiply(local, parentWorld); }

// a * b untuk matriks column-major 4x4 (dipakai untuk Model * world bagian tubuh)
function mmul(a, b) {
  var o = new Float32Array(16);
  for (var c = 0; c < 4; c++) {
    for (var r = 0; r < 4; r++) {
      var s = 0;
      for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

export function createHangyodon(GL, cam) {

  /*========================= SHADERS (Phong) =========================*/
  // Normal sekarang dihitung di view space, jadi cahaya tetap terhadap kamera
  // (sama seperti Kuromi & Badtz) dan tetap benar saat kamera mengorbit.
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
        vNormal = vec3(Vmatrix * Mmatrix * vec4(normal, 0.));
        vView = vec3(Vmatrix * Mmatrix * vec4(position, 1.));
    }`;

  var shader_fragment_source = `
    precision mediump float;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vView;

    const vec3 keyDir  = vec3(0.45, 0.70, 1.00);
    const vec3 fillDir = vec3(-0.60, 0.20, -0.80);

    void main(void) {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(-vView);
        vec3 L1 = normalize(keyDir);
        vec3 L2 = normalize(fillDir);

        vec3 ambient = mix(vec3(0.38, 0.42, 0.45), vec3(0.58, 0.60, 0.62), 0.5 + 0.5 * N.y);

        float d1 = max(0., dot(N, L1));
        float d2 = max(0., dot(N, L2));

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
    if (!GL.getShaderParameter(s, GL.COMPILE_STATUS)) { alert("HANGYODON " + name + " SHADER: " + GL.getShaderInfoLog(s)); return false; }
    return s;
  };
  var PROG = GL.createProgram();
  GL.attachShader(PROG, compile(shader_vertex_source, GL.VERTEX_SHADER, "VERTEX"));
  GL.attachShader(PROG, compile(shader_fragment_source, GL.FRAGMENT_SHADER, "FRAGMENT"));
  GL.linkProgram(PROG);

  var _position = GL.getAttribLocation(PROG, "position");
  var _normal = GL.getAttribLocation(PROG, "normal");
  var _color = GL.getAttribLocation(PROG, "color");
  var _Pmatrix = GL.getUniformLocation(PROG, "Pmatrix");
  var _Vmatrix = GL.getUniformLocation(PROG, "Vmatrix");
  var _Mmatrix = GL.getUniformLocation(PROG, "Mmatrix");

  /*========================= DEFINISI BAGIAN TUBUH =========================*/
  var PARTS = {};
  var ORDER = [];
  function part(name, parent, geo, pos, rot) {
    PARTS[name] = { parent: parent, geo: geo, local: xf(pos, rot) };
    ORDER.push(name);
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

  var BODY_W = [0, -0.65, 0.03];
  var HEAD_W = [0, 1.61, 0];
  var HEAD_L = sub(HEAD_W, BODY_W);

  // BADAN (root)
  part("body", null, builder.generateSuperEllipsoid(1.22, 1.13, 1.25, 2.3, 28, 40, COLOR.body, 0.12), BODY_W);

  // KEPALA
  part("head", "body", builder.generateSuperEllipsoid(1.36, 1.3, 1.2, 2.8, 30, 44, COLOR.head, 0.08), HEAD_L);

  // MATA
  [-1, 1].forEach(function (s) {
    var L = s < 0 ? "L" : "R";
    part("eye" + L, "head",
      builder.generateEllipsoid(0.5, 0.52, 0.36, 18, 24, COLOR.white),
      [s * 0.62, -0.14, 0.98], [0, s * 0.2, 0]);
    part("pupil" + L, "eye" + L,
      builder.generateEllipsoid(0.085, 0.095, 0.06, 10, 14, COLOR.black),
      [-s * 0.2, -0.05, 0.31]);
  });

  // MULUT
  part("mouth", "head",
    builder.generateEllipticParaboloid(1.22, 0.38, 0.9, 12, 40, COLOR.pink, true),
    [0, -0.99, 1.38], [-Math.PI / 2 + 0.12, 0, 0]);

  // TELINGA
  [-1, 1].forEach(function (s) {
    var L = s < 0 ? "L" : "R";
    part("ear" + L, "head",
      builder.generateHyperbolicParaboloid(0.64, 0.3, 0.10, 0.2, 14, 28, COLOR.blue),
      [s * 1.56, -0.08, 0.1], [0, -s * 0.8, -s * Math.PI / 2]);
  });

  // JAMBUL
  part("crestBig", "head",
    builder.generateEllipsoid(0.42, 0.52, 0.36, 14, 20, COLOR.blue),
    [-0.05, 1.49, 0.0], [0, 0, -0.12]);
  part("crestSmall", "head",
    builder.generateEllipsoid(0.34, 0.44, 0.3, 14, 20, COLOR.blue),
    [0.62, 1.39, 0.02], [0, 0, -0.5]);

  // SIRIP BELAKANG KEPALA
  function finPath(t) {
    var p0 = [0, 0.58, -0.95], p1 = [0, -0.05, -2.05], p2 = [0, -0.55, -1.0];
    var mt = 1 - t;
    return [
      mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
      mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
      mt * mt * p0[2] + 2 * mt * t * p1[2] + t * t * p2[2],
    ];
  }
  part("dorsalFin", "head", builder.generateSweepFin(finPath, 0.21, 0.42, 22, 16, COLOR.blue), [0, 0, 0]);

  // GURITA KECIL MERAH
  part("octopus", "head",
    builder.generateEllipsoid(0.36, 0.38, 0.34, 14, 20, COLOR.red),
    [-0.95, 1.45, 0.25], [0, 0, 0.4]);
  for (var k = 0; k < 5; k++) {
    var ph = k * 2 * Math.PI / 5 + 0.3, tau = 0.5;
    part("tent" + k, "octopus",
      builder.generateEllipsoid(0.1, 0.2, 0.1, 8, 10, COLOR.red),
      [0.27 * Math.cos(ph), -0.3, 0.27 * Math.sin(ph)],
      [-tau * Math.sin(ph), 0, tau * Math.cos(ph)]);
  }

  // SIRIP EKOR
  part("tailFin", "body",
    builder.generateHyperbolicParaboloid(0.4, 0.42, 0.08, 0.2, 12, 24, COLOR.blue),
    [0, -0.15, -1.5], [-0.3, 0, Math.PI / 2]);

  // LENGAN
  [-1, 1].forEach(function (s) {
    var L = s < 0 ? "L" : "R";
    part("arm" + L, "body",
      builder.generateEllipsoid(0.3, 0.6, 0.3, 14, 20, COLOR.body),
      sub([s * 1.14, -0.2, 0.48], BODY_W), [-0.85, 0, s * 0.14]);
    part("hand" + L, "arm" + L,
      builder.generateEllipsoid(0.34, 0.32, 0.28, 12, 18, COLOR.body),
      [0, -0.62, 0]);
  });

  // KAKI
  [-1, 1].forEach(function (s) {
    var L = s < 0 ? "L" : "R";
    part("leg" + L, "body",
      builder.generateEllipsoid(0.42, 0.42, 0.45, 14, 20, COLOR.body),
      sub([s * 0.74, -1.68, 0.1], BODY_W));
    part("foot" + L, "leg" + L,
      builder.generateEllipsoid(0.7, 0.28, 0.8, 14, 24, COLOR.body),
      [s * 0.11, -0.3, 0.24], [0, s * 0.12, 0]);
  });

  /*========================= HIERARCHY =========================*/
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

  var STRIDE = 4 * 9;

  /*========================= DRAW (dipanggil world.js tiap frame) =========================*/
  // M = model matrix (posisi + arah hadap + skala) dari world.js
  function draw(M) {
    GL.useProgram(PROG);
    for (var a = 0; a < 8; a++) GL.disableVertexAttribArray(a);
    GL.enableVertexAttribArray(_position);
    GL.enableVertexAttribArray(_normal);
    GL.enableVertexAttribArray(_color);

    GL.uniformMatrix4fv(_Pmatrix, false, cam.P);
    GL.uniformMatrix4fv(_Vmatrix, false, cam.V);

    ORDER.forEach(function (name) {
      var p = PARTS[name];
      GL.uniformMatrix4fv(_Mmatrix, false, mmul(M, p.world));
      GL.bindBuffer(GL.ARRAY_BUFFER, p.VBO);
      GL.vertexAttribPointer(_position, 3, GL.FLOAT, false, STRIDE, 0);
      GL.vertexAttribPointer(_normal, 3, GL.FLOAT, false, STRIDE, 12);
      GL.vertexAttribPointer(_color, 3, GL.FLOAT, false, STRIDE, 24);
      GL.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, p.EBO);
      GL.drawElements(GL.TRIANGLES, p.count, GL.UNSIGNED_SHORT, 0);
    });
  }

  return { draw: draw };
}