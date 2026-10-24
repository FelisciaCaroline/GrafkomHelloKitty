// Kuromi sebagai "factory": window.createKuromi(GL, cam)
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

function gridIndices(rows, cols) {
    var idx = [];
    for (var i = 0; i < rows - 1; i++) {
        for (var j = 0; j < cols; j++) {
            var a = i * (cols + 1) + j;
            var b = a + cols + 1;
            idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    return idx;
}

function makeSphere(r, lats, longs) {
    var v = [];
    for (var i = 0; i <= lats; i++) {
        var lat = i * Math.PI / lats;
        for (var j = 0; j <= longs; j++) {
            var lon = j * 2 * Math.PI / longs;
            var x = Math.cos(lon) * Math.sin(lat);
            var y = Math.cos(lat);
            var z = Math.sin(lon) * Math.sin(lat);
            v.push(r * x, r * y, r * z, x, y, z);
        }
    }
    return { vertices: v, indices: gridIndices(lats + 1, longs) };
}

function makeEyePatch(cx, cy, rx, ry, side, n, lift) {
    var LID_A = 0.35;
    var LID_S = 0.45;
    var v = [];
    for (var i = 0; i <= n; i++) {
        var w = i / n;
        for (var j = 0; j <= n; j++) {
            var lx = -Math.cos(Math.PI * j / n);
            var e = Math.sqrt(Math.max(1 - lx * lx, 0));
            var yb = -e;
            var yt = Math.max(Math.min(e, LID_A + LID_S * lx), yb);
            var ly = yb + (yt - yb) * w;

            var x = cx + side * lx * rx;
            var y = cy + ly * ry;
            var q = Math.max(1 - (x / 1.5) * (x / 1.5) - (y - 1.3) * (y - 1.3), 0);
            var z = 0.8 + 0.9 * Math.sqrt(q) + lift;

            var nx = x / 2.25, ny = (y - 1.3), nz = (z - 0.8) / 0.81;
            var l = Math.hypot(nx, ny, nz) || 1;
            v.push(x, y, z, nx / l, ny / l, nz / l);
        }
    }
    return { vertices: v, indices: gridIndices(n + 1, n) };
}

function makePeakPatch(cy, halfW, height, n) {
    var v = [];
    for (var i = 0; i <= n; i++) {
        var t = i / n;
        var curWidth = halfW * (1 - t);
        var y = cy - t * height;
        for (var j = 0; j <= n; j++) {
            var u = j / n;
            var x = (u * 2 - 1) * curWidth;

            var qh = Math.max(1 - (x / 1.9) * (x / 1.9) - ((y - 1.6) / 1.55) * ((y - 1.6) / 1.55), 0);
            var zh = 1.6 * Math.sqrt(qh);
            var qf = Math.max(1 - (x / 1.5) * (x / 1.5) - (y - 1.3) * (y - 1.3), 0);
            var zf = 0.8 + 0.9 * Math.sqrt(qf);

            var z, nx, ny, nz;
            if (zf > zh) {
                z = zf + 0.03;
                nx = x / 2.25; ny = (y - 1.3) / 1.0; nz = (z - 0.8) / 0.81;
            } else {
                z = zh + 0.03;
                nx = x / 3.61; ny = (y - 1.6) / 2.4025; nz = z / 2.56;
            }
            var l = Math.hypot(nx, ny, nz) || 1;
            v.push(x, y, z, nx / l, ny / l, nz / l);
        }
    }
    return { vertices: v, indices: gridIndices(n + 1, n) };
}

function makeCone(r, h, seg) {
    var slope = r / h;
    var len = Math.hypot(1, slope);
    var v = [0, h, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0];
    var idx = [];
    for (var i = 0; i <= seg; i++) {
        var c = Math.cos(i * 2 * Math.PI / seg);
        var s = Math.sin(i * 2 * Math.PI / seg);
        v.push(c * r, 0, s * r, c / len, slope / len, s / len);
    }
    for (var j = 0; j < seg; j++) {
        idx.push(0, j + 2, j + 3, 1, j + 3, j + 2);
    }
    return { vertices: v, indices: idx };
}

function makeDiamond(rMid, hBot, hTop, seg) {
    var v = [0, 0, 0, 0, -1, 0, 0, hBot + hTop, 0, 0, 1, 0];
    var idx = [];
    var sides = [[hBot, -1], [hTop, 1]];

    for (var side = 0; side < sides.length; side++) {
        var h = sides[side][0];
        var sign = sides[side][1];
        var slope = rMid / h;
        var len = Math.hypot(1, slope);
        var start = v.length / 6;

        for (var i = 0; i <= seg; i++) {
            var c = Math.cos(i * 2 * Math.PI / seg);
            var s = Math.sin(i * 2 * Math.PI / seg);
            v.push(c * rMid, hBot, s * rMid, c / len, sign * slope / len, s / len);
        }
        for (var j = 0; j < seg; j++) {
            idx.push(side, start + j, start + j + 1);
        }
    }
    return { vertices: v, indices: idx };
}

function makeLeg(rows, seg) {
    var f = function (t) {
        var w = 0.82 + 0.18 * t;
        var k = 0.24, c = 1, q;
        if (t < k) { q = (k - t) / k; c = Math.sqrt(Math.max(0, 1 - q * q)); }
        else if (t > 1 - k) { q = (t - (1 - k)) / k; c = Math.sqrt(Math.max(0, 1 - q * q)); }
        return w * c;
    };
    var v = [];
    for (var i = 0; i <= rows; i++) {
        var t = i / rows;
        var y = 1 - 2 * t;
        var r = f(t);
        var t0 = Math.max(0, t - 0.002), t1 = Math.min(1, t + 0.002);
        var dr = (f(t1) - f(t0)) / (t1 - t0);
        var nr = 2, ny = dr;
        var nl = Math.hypot(nr, ny);
        nr /= nl; ny /= nl;
        for (var j = 0; j <= seg; j++) {
            var a = j * 2 * Math.PI / seg;
            var c = Math.cos(a), s = Math.sin(a);
            v.push(r * c, y, r * s, nr * c, ny, nr * s);
        }
    }
    return { vertices: v, indices: gridIndices(rows + 1, seg) };
}

// pos(3) normal(3) uv(2) => stride 32 bytes
function makeSkullPatch(cy, halfW, halfH, n, lift) {
    var v = [];
    for (var i = 0; i <= n; i++) {
        for (var j = 0; j <= n; j++) {
            var u = j / n, w = i / n;
            var x = (u * 2 - 1) * halfW;
            var y = cy + (1 - w * 2) * halfH;
            var q = 1 - (x / 1.9) * (x / 1.9) - ((y - 1.6) / 1.55) * ((y - 1.6) / 1.55);
            var z = 1.6 * Math.sqrt(Math.max(q, 0)) + lift;
            var nx = x / 3.61, ny = (y - 1.6) / 2.4025, nz = z / 2.56;
            var l = Math.hypot(nx, ny, nz);
            v.push(x, y, z, nx / l, ny / l, nz / l, u, 1 - w);
        }
    }
    return { vertices: v, indices: gridIndices(n + 1, n), stride: 32, textured: true };
}

function sweepVertices(P, profile, steps, seg) {
    var cross = function (a, b) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    };
    var norm = function (a) {
        var l = Math.hypot(a[0], a[1], a[2]) || 1;
        return [a[0] / l, a[1] / l, a[2] / l];
    };
    var point = function (t) {
        var u = 1 - t;
        return [0, 1, 2].map(function (k) {
            return u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k];
        });
    };
    var tangent = function (t) {
        var u = 1 - t;
        return norm([0, 1, 2].map(function (k) {
            return 3 * u * u * (P[1][k] - P[0][k]) + 6 * u * t * (P[2][k] - P[1][k]) + 3 * t * t * (P[3][k] - P[2][k]);
        }));
    };

    var v = [];
    var N = null;
    for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        var C = point(t);
        var T = tangent(t);

        if (!N) {
            N = norm(cross(Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], T));
        } else {
            var d = N[0] * T[0] + N[1] * T[1] + N[2] * T[2];
            N = norm(N.map(function (n, k) { return n - d * T[k]; }));
        }
        var B = cross(T, N);
        var prof = profile(t);
        var rx = prof[0], ry = prof[1];

        for (var j = 0; j <= seg; j++) {
            var c = Math.cos(j * 2 * Math.PI / seg);
            var s = Math.sin(j * 2 * Math.PI / seg);
            var n = norm([0, 1, 2].map(function (k) { return (c / rx) * N[k] + (s / ry) * B[k]; }));
            v.push(
                C[0] + rx * c * N[0] + ry * s * B[0],
                C[1] + rx * c * N[1] + ry * s * B[1],
                C[2] + rx * c * N[2] + ry * s * B[2],
                n[0], n[1], n[2]
            );
        }
    }
    return v;
}

/*========================= MATRIX HELPERS (column-major) ========================= */
function mul4(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
        for (var r = 0; r < 4; r++) {
            for (var k = 0; k < 4; k++) {
                o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
            }
        }
    }
    return o;
}

function translateM(x, y, z) {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function scaleM(x, y, z) {
    return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
}

function rotationMatrix(rx, ry, rz) {
    var cx = Math.cos(rx), sx = Math.sin(rx);
    var cy = Math.cos(ry), sy = Math.sin(ry);
    var cz = Math.cos(rz), sz = Math.sin(rz);
    var RX = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
    var RY = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
    var RZ = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    return mul4(RZ, mul4(RY, RX));
}

// ROTASI: putar "child" di sekitar titik pivot (px,py,pz), di dalam ruang parent
function pivotRot(parent, px, py, pz, rx, ry, rz) {
    return mul4(parent, mul4(translateM(px, py, pz), mul4(rotationMatrix(rx, ry, rz), translateM(-px, -py, -pz))));
}

// SCALING: skala di sekitar y = py (squash & stretch dari telapak kaki)
function pivotScale(parent, sx, sy, py) {
    return mul4(parent, mul4(translateM(0, py, 0), mul4(scaleM(sx, sy, sx), translateM(0, -py, 0))));
}

// ARBITRARY ROTATE: rotasi sebesar 'ang' di sekitar SUMBU SEMBARANG (ax,ay,az) - rumus Rodrigues
function axisAngleM(ax, ay, az, ang) {
    var l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
    var c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    return new Float32Array([
        t * ax * ax + c,      t * ax * ay + s * az, t * ax * az - s * ay, 0,
        t * ax * ay - s * az, t * ay * ay + c,      t * ay * az + s * ax, 0,
        t * ax * az + s * ay, t * ay * az - s * ax, t * az * az + c,      0,
        0, 0, 0, 1
    ]);
}

// ARBITRARY ROTATE: rotasi sumbu sembarang + titik pivot sembarang
function pivotAxis(parent, px, py, pz, ax, ay, az, ang) {
    return mul4(parent, mul4(translateM(px, py, pz), mul4(axisAngleM(ax, ay, az, ang), translateM(-px, -py, -pz))));
}

/*========================= EASING HELPERS ========================= */
function clamp01(x) { return Math.min(1, Math.max(0, x)); }
function smooth(x) { x = clamp01(x); return x * x * (3 - 2 * x); }

// Interpolasi keyframe [[t, nilai], ...] memakai spline Hermite (kecepatan halus, tidak berhenti di tiap key).
// Di puncak/lembah/plateau kecepatan dibuat nol supaya tidak overshoot.
function keys(t, k) {
    var n = k.length;
    if (t <= k[0][0]) return k[0][1];
    if (t >= k[n - 1][0]) return k[n - 1][1];
    var slope = function (i) {
        if (i <= 0 || i >= n - 1) return 0;
        var a = k[i][1] - k[i - 1][1], b = k[i + 1][1] - k[i][1];
        if (a * b <= 0) return 0;
        return (k[i + 1][1] - k[i - 1][1]) / (k[i + 1][0] - k[i - 1][0]);
    };
    for (var i = 1; i < n; i++) {
        if (t < k[i][0]) {
            var h = k[i][0] - k[i - 1][0];
            var u = (t - k[i - 1][0]) / h;
            var u2 = u * u, u3 = u2 * u;
            return (2 * u3 - 3 * u2 + 1) * k[i - 1][1] + (u3 - 2 * u2 + u) * h * slope(i - 1)
                 + (-2 * u3 + 3 * u2) * k[i][1] + (u3 - u2) * h * slope(i);
        }
    }
    return k[n - 1][1];
}

function easeOutBack(x) {
    var c1 = 1.70158, c3 = c1 + 1, y = x - 1;
    return 1 + c3 * y * y * y + c1 * y * y;
}

function removeWhiteBackground(p, w, h) {
    var isBg = function (i) {
        return p[i + 3] < 10 || (p[i] > 200 && p[i + 1] > 200 && p[i + 2] > 200);
    };
    var seen = new Uint8Array(w * h), stack = [], k, x, y;
    var push = function (px, py) {
        var n = py * w + px;
        if (px < 0 || py < 0 || px >= w || py >= h || seen[n]) return;
        if (!isBg(n * 4)) return;
        seen[n] = 1; stack.push(n);
    };
    for (x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (stack.length) {
        var n = stack.pop(), px = n % w, py = (n - px) / w;
        push(px + 1, py); push(px - 1, py); push(px, py + 1); push(px, py - 1);
    }
    for (var pass = 0; pass < 2; pass++) {
        var add = [];
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
            var m = y * w + x;
            if (seen[m]) continue;
            var near = (x > 0 && seen[m - 1]) || (x < w - 1 && seen[m + 1]) || (y > 0 && seen[m - w]) || (y < h - 1 && seen[m + w]);
            if (!near) continue;
            var i = m * 4, mn = Math.min(p[i], p[i + 1], p[i + 2]), mx = Math.max(p[i], p[i + 1], p[i + 2]);
            if (mn > 140 && mx - mn < 45) add.push(m);
        }
        for (k = 0; k < add.length; k++) seen[add[k]] = 1;
    }
    for (k = 0; k < w * h; k++) {
        if (seen[k]) { p[k * 4] = 0; p[k * 4 + 1] = 0; p[k * 4 + 2] = 0; p[k * 4 + 3] = 0; }
        else p[k * 4 + 3] = 255;
    }
}

function nextPOT(n) { var v = 1; while (v < n) v *= 2; return v; }

window.createKuromi = function (GL, cam) {

    /*========================= SHADERS ========================= */
    var shader_vertex_source = `
        attribute vec3 position;
        attribute vec3 normal;
        attribute vec2 uv;
        uniform mat4 Pmatrix, Vmatrix, Mmatrix;
        uniform vec3 uOffset, uScale;
        uniform mat4 uLocalRotation;
        varying vec3 vNormal;
        varying vec2 vUV;

        void main(void) {
            vec3 p = (uLocalRotation * vec4(position * uScale, 1.0)).xyz + uOffset;
            gl_Position = Pmatrix * Vmatrix * Mmatrix * vec4(p, 1.0);

            vec3 n = normalize(normal / uScale);
            vNormal = (Vmatrix * Mmatrix * uLocalRotation * vec4(n, 0.0)).xyz;
            vUV = uv;
        }`;

    var shader_fragment_source = `
        precision mediump float;
        uniform vec3 uColor;
        uniform sampler2D uTex;
        uniform float uUseTex;
        varying vec3 vNormal;
        varying vec2 vUV;

        void main(void) {
            vec3 base = uColor;
            if (uUseTex > 0.5) {
                vec4 t = texture2D(uTex, vUV);
                if (t.a < 0.5) discard;
                base = t.rgb * uColor;
            }

            vec3 N = normalize(vNormal);
            vec3 L = normalize(vec3(-0.4, 0.7, 0.8));
            vec3 V = vec3(0.0, 0.0, 1.0);
            vec3 H = normalize(L + V);

            float diff = max(dot(N, L), 0.0);
            float spec = pow(max(dot(N, H), 0.0), 28.0);
            float rim  = pow(1.0 - max(dot(N, V), 0.0), 3.0);

            vec3 col = base * (0.5 + 0.6 * diff) + vec3(0.22) * spec + vec3(0.10) * rim;
            gl_FragColor = vec4(col, 1.0);
        }`;

    var compile_shader = function (source, type, typeString) {
        var shader = GL.createShader(type);
        GL.shaderSource(shader, source);
        GL.compileShader(shader);
        if (!GL.getShaderParameter(shader, GL.COMPILE_STATUS)) {
            alert("KUROMI " + typeString + " SHADER: " + GL.getShaderInfoLog(shader));
            return false;
        }
        return shader;
    };

    var SHADER_PROGRAM = GL.createProgram();
    GL.attachShader(SHADER_PROGRAM, compile_shader(shader_vertex_source, GL.VERTEX_SHADER, "VERTEX"));
    GL.attachShader(SHADER_PROGRAM, compile_shader(shader_fragment_source, GL.FRAGMENT_SHADER, "FRAGMENT"));
    GL.linkProgram(SHADER_PROGRAM);
    GL.useProgram(SHADER_PROGRAM);

    var _position = GL.getAttribLocation(SHADER_PROGRAM, "position");
    var _normal = GL.getAttribLocation(SHADER_PROGRAM, "normal");
    var _uv = GL.getAttribLocation(SHADER_PROGRAM, "uv");

    var _Pmatrix = GL.getUniformLocation(SHADER_PROGRAM, "Pmatrix");
    var _Vmatrix = GL.getUniformLocation(SHADER_PROGRAM, "Vmatrix");
    var _Mmatrix = GL.getUniformLocation(SHADER_PROGRAM, "Mmatrix");
    var _uOffset = GL.getUniformLocation(SHADER_PROGRAM, "uOffset");
    var _uScale = GL.getUniformLocation(SHADER_PROGRAM, "uScale");
    var _uColor = GL.getUniformLocation(SHADER_PROGRAM, "uColor");
    var _uRot = GL.getUniformLocation(SHADER_PROGRAM, "uLocalRotation");
    var _uTex = GL.getUniformLocation(SHADER_PROGRAM, "uTex");
    var _uUseTex = GL.getUniformLocation(SHADER_PROGRAM, "uUseTex");

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
    var SKULL_FILE = "kuromi/skull.png";

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
    var STAR_O = [1.0, 0.62, 0.42];
    var HEART = [0.95, 0.25, 0.42];
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
    var IDLE_LEN = 6.1, CHEER_LEN = 4.4, HAPPY_END = 3.4;

    // goyang kepala (-1..1) per fase siklus 4.1 dtk: lembah (tahan) -> naik cepat ~1.1 dtk -> puncak (tahan) -> turun pelan
    var SWAY_KEYS = [[0, -1], [0.03, -1], [0.27, 1], [0.34, 1], [1, -1]];
    var SWAY_PERIOD = 4.1, SWAY_OFFSET = 0.5;

    // kurva cheer (ukur dari video): squash badan, menunduk kepala (rad), lebar tangan ke samping
    var SQ_KEYS = [[0, 0], [0.1, 0.05], [0.3, 0.35], [0.5, 0.6], [0.6, 0.65], [0.7, 0.55], [0.8, 0.0], [0.9, -0.35], [1.1, -0.2], [1.5, -0.1], [3.2, -0.06], [4.2, 0]];
    var PITCH_KEYS = [[0, 0], [0.1, 0.05], [0.3, 0.2], [0.5, 0.36], [0.6, 0.4], [0.7, 0.35], [0.8, 0.05], [0.9, -0.1], [1.1, -0.06], [1.5, -0.05], [3.2, -0.03], [4.2, 0]];
    var ARMOUT_KEYS = [[0, 0], [0.15, 0.15], [0.35, 0.6], [0.55, 1.0], [0.68, 1.0], [0.8, 0.2], [0.9, 0]];
    // TRANSLASI: lompatan saat "pop" (unit model). Naik cepat di c 0.75-0.95, turun pelan, mendarat di c 1.35
    var JUMP_KEYS = [[0, 0], [0.75, 0], [0.95, 0.45], [1.15, 0.22], [1.35, 0], [4.4, 0]];

    // dekorasi muncul berurutan seperti di video (posisi dalam ruang model, di depan telinga)
    var DECOR = [
        { on: 1.10, x: 2.45, y: 1.35, z: 1.8, size: 0.30, type: 'star', col: STAR_Y, k: 0.0 },
        { on: 1.35, x: 2.75, y: 0.55, z: 1.8, size: 0.22, type: 'star', col: STAR_Y, k: 2.1 },
        { on: 1.40, x: -0.45, y: 4.95, z: 2.0, size: 0.95, type: 'star', col: [1.0, 1.0, 0.92], k: 4.0 },
        { on: 1.55, x: 0.55, y: 4.60, z: 2.0, size: 0.55, type: 'star', col: STAR_O, fat: 1.9, k: 1.2 },
        { on: 1.75, x: 1.50, y: 4.60, z: 2.0, size: 0.46, type: 'heart', col: HEART, k: 3.1 }
    ];

    /* ---- parameter jalan ----
       Mode 'line'   : jalan LURUS satu arah (tanpa putar balik), terus sampai J ditekan lagi (atau sampai STRAIGHT_DIST).
         LINE_ANGLE : arah jalan. 0 = ke bawah layar / arah kamera, Math.PI/2 = ke kanan layar
       Mode 'circle' : jalan memutar membentuk lingkaran berjari-jari CIRCLE_R.
       Posisi terakhir (A.x, A.z) selalu disimpan, jadi setelah animasi lain dia lanjut dari titik itu. */
    var WALK_SPEED = 2.3;                 // kecepatan (unit/detik)
    var STRAIGHT_DIST = Infinity;         // jarak maksimum jalan lurus. Infinity = jalan terus sampai tombol J ditekan lagi
    var LINE_ANGLE = 0;                   // arah jalan lurus: 0 = ke bawah layar (arah kamera), Math.PI = ke atas, Math.PI/2 = kanan, -Math.PI/2 = kiri
    var TURN_SPEED = 4.0;                 // kecepatan berputar badan (rad/detik)
    var WALK_RELATIVE_TO_CAMERA = true;   // true = arah jalan lurus mengikuti LAYAR saat J ditekan (dikunci selama jalan); false = pakai LINE_ANGLE (arah dunia)
    var WALK_SCREEN_OFFSET = -0.25;       // relatif layar: 0 = ke bawah layar, negatif = ke kiri, positif = ke kanan (Math.PI = ke atas)
    var CIRCLE_R = 2.2;                   // jari-jari lingkaran
    var CIRCLE_DIR = 1;                   // 1 = satu arah putar, -1 = kebalikannya

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

    /* ---- parameter idle "melambai" ---- */
    var WAVE_LEN = 3.6;                   // durasi total (detik)
    var WAVE_SIDE = 1;                    // 1 = tangan di sisi +x (kanan layar), -1 = kiri layar
    var WAVE_RATE = 2.6;                  // ayunan tangan per detik

    var worldPos = null;                  // posisi dunia Kuromi sekarang (null sebelum frame pertama), dipakai kamera
    var t0 = performance.now() / 1000;
    var A = {
        last: null, cycStart: t0, nextAct: 0,           // nextAct: 0 = berikutnya cheer, 1 = berikutnya melambai (bergantian)
        cheering: false, cheerStart: 0,
        waving: false, waveStart: 0, wavePh: 0,
        breath: 0, armPh: 0, tailPh: 0, bobPh: 0,
        happy: 0, eyeHappy: 0, earRoll: 0,
        walking: false, followPath: true, walkAmt: 0, walkPh: 0,
        x: 0, z: 0, walked: 0, myaw: 0, lineAngle: LINE_ANGLE, heading: 0,              // posisi dunia terakhir, jarak tempuh jalan lurus, arah hadap badan (rad)
        mode: 'line', cpsi: 0, wasCircling: false,      // mode jalan: 'line' | 'circle'
        laughing: false, laugh: 0, laughPh: 0,
        gdy: null                                       // koreksi tinggi ke tanah (unit model), dihaluskan
    };

    var triggerCheer = function () {
        if (A.cheering) return;
        A.waving = false;
        A.cheering = true;
        A.cheerStart = performance.now() / 1000;
    };

    var triggerWave = function () {
        if (A.cheering || A.waving) return;
        A.waving = true;
        A.waveStart = performance.now() / 1000;
    };

    var update = function (now) {
        var dt = A.last === null ? 0.016 : Math.min(0.05, Math.max(0.0005, now - A.last));
        A.last = now;
        var damp = function (cur, target, lambda) { return cur + (target - cur) * (1 - Math.exp(-lambda * dt)); };

        /* ---- saat jalan / ketawa, jadwal idle otomatis ditahan ---- */
        if ((A.walking || A.laughing) && !A.cheering && !A.waving) A.cycStart = now;

        /* ---- jadwal: idle -> (cheer | melambai, bergantian) -> idle ---- */
        if (!A.cheering && !A.waving && now - A.cycStart >= IDLE_LEN) {
            if (A.nextAct === 0) { A.cheering = true; A.cheerStart = now; }
            else { A.waving = true; A.waveStart = now; }
            A.nextAct = 1 - A.nextAct;
        }
        var c = A.cheering ? now - A.cheerStart : -1;
        if (A.cheering && c >= CHEER_LEN) { A.cheering = false; A.cycStart = now; c = -1; }
        var ti = now - A.cycStart;

        /* ---- idle "melambai": envelope naik 0.45 dtk, tahan, turun 0.5 dtk ---- */
        var wc = A.waving ? now - A.waveStart : -1;
        if (A.waving && wc >= WAVE_LEN) { A.waving = false; A.cycStart = now; wc = -1; }
        var wv = wc >= 0 ? smooth(wc / 0.45) * (1 - smooth((wc - (WAVE_LEN - 0.5)) / 0.5)) : 0;
        A.wavePh += dt * 2 * Math.PI * WAVE_RATE * wv;

        /* ---- envelope senang ---- */
        var happyOn = (c > 0.78 && c < HAPPY_END);
        A.happy = damp(A.happy, happyOn ? 1 : 0, happyOn ? 9 : 3.2);
        /* ---- ketawa ---- */
        A.laugh = damp(A.laugh, (A.laughing && !A.cheering && !A.waving) ? 1 : 0, 7);
        var lf = A.laugh;                               // 0 = tenang, 1 = ketawa penuh
        A.laughPh += dt * 2 * Math.PI * 4.5;            // 4.5 "ha" per detik (ubah 4.5 untuk kecepatan ketawa)
        var eyeOn = (c > 0.95 && c < HAPPY_END) || lf > 0.3 || wv > 0.5;
        A.eyeHappy = damp(A.eyeHappy, eyeOn ? 1 : 0, eyeOn ? 22 : 8);
        var h = A.happy;

        /* ---- jalan ---- */
        var wOn = A.walking && !A.cheering && !A.laughing && !A.waving;
        A.walkAmt = damp(A.walkAmt, wOn ? 1 : 0, 6);
        var w = A.walkAmt;
        A.walkPh += dt * 2 * Math.PI * 1.1 * w;          // 1.1 siklus langkah / detik

        /* ---- jalan: LURUS (satu arah) atau MUTER (lingkaran) ----
           Posisi (A.x, A.z) disimpan terus, jadi setelah cheer/ketawa/melambai dia lanjut dari titik terakhir.
           Berhenti jalan -> badan berputar menghadap kamera (heading 0), posisi tetap.
           Arah maju badan pada heading psi = (sin psi, cos psi) di bidang (x, z). */
        var moving = wOn && A.followPath;

        if (moving && A.mode === 'circle') {
            // MUTER: arah hadap terus berputar, posisi dihitung eksak sepanjang busur
            if (!A.wasCircling) A.cpsi = A.heading;               // mulai dari arah hadap saat ini
            var dpsi = CIRCLE_DIR * (WALK_SPEED * w / CIRCLE_R) * dt;
            var p2 = A.cpsi + dpsi;
            A.x += CIRCLE_DIR * CIRCLE_R * (Math.cos(A.cpsi) - Math.cos(p2));   // TRANSLASI
            A.z += CIRCLE_DIR * CIRCLE_R * (Math.sin(p2) - Math.sin(A.cpsi));
            A.cpsi = p2;
            A.heading = p2;                                        // ROTASI: badan ikut menyinggung lingkaran
            A.wasCircling = true;
        } else {
            // LURUS (atau berhenti): putar badan ke arah jalan / ke kamera
            A.wasCircling = false;
            var wantHeading = moving ? A.lineAngle : 0;
            var err = Math.atan2(Math.sin(wantHeading - A.heading), Math.cos(wantHeading - A.heading));
            var maxTurn = TURN_SPEED * dt;
            A.heading += Math.max(-maxTurn, Math.min(maxTurn, err));   // ROTASI: berputar di tempat
            if (moving && Math.abs(err) < 0.2) {
                var step = w * WALK_SPEED * dt;
                A.x += step * Math.sin(A.lineAngle);                    // TRANSLASI: bergeser lurus, satu arah
                A.z += step * Math.cos(A.lineAngle);
                A.walked += step;
                if (A.walked >= STRAIGHT_DIST) A.walking = false;      // sampai tujuan -> berhenti (tidak putar balik)
            }
        }
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
        var sq = 0, pk = 0, ao = 0, jp = 0;
        if (c >= 0) { sq = keys(c, SQ_KEYS); pk = keys(c, PITCH_KEYS); ao = keys(c, ARMOUT_KEYS); jp = keys(c, JUMP_KEYS); }

        var bob = Math.sin(2 * Math.PI * A.bobPh);
        var S = {
            c: c, happy: h, sq: sq, ao: ao,
            walk: w, step: wStep, stepCos: wCos,
            px: A.x, pz: A.z, heading: A.heading,
            wave: wv, wavePh: A.wavePh,
            waddle: w * 0.10 * wStep + wv * 0.06 * Math.sin(A.wavePh * 0.5),   // ARBITRARY ROTATE: goyang pinggul
            hop: h * 0.025 * (1 + bob) + w * 0.07 * (0.5 + 0.5 * Math.cos(2 * A.walkPh)),
            jump: jp,                                                          // TRANSLASI: lompatan cheer
            sy: 1 + 0.012 * br - 0.17 * sq + w * 0.02 * Math.cos(2 * A.walkPh),
            sxz: 1 - 0.006 * br + 0.10 * sq
        };

        /* ---- kepala ---- */
        S.roll = -0.06 * sway + h * 0.07 * Math.sin(A.bobPh * Math.PI + 0.7) - w * 0.05 * wStep - wv * 0.10 * WAVE_SIDE;
        S.yaw = 0.10 * sway + h * 0.05 * Math.sin(A.bobPh * Math.PI * 0.7) + wv * 0.06 * WAVE_SIDE * Math.sin(A.wavePh * 0.5);
        S.pitch = 0.025 * br + pk - 0.04 * h + w * 0.08 - wv * 0.05;      // condong ke depan
        S.headY = 0.03 * Math.sin(A.breath - 0.6) + 0.065 * sway - 0.05 * sq + h * 0.04 * bob - w * 0.03 * Math.cos(2 * A.walkPh)
                  + wv * 0.025 * Math.sin(A.wavePh);

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
        S.earDelta = (A.earRoll - S.roll) * 2.4 + 0.05 * Math.sin(A.breath * 1.7) + 0.06 * h * Math.sin(now * 14);
        S.earFlare = 0.06 * sq + 0.75 * Math.max(pk, 0) + 0.10 * wv * Math.max(0, Math.sin(A.wavePh));

        /* ---- kedip: sekali per siklus idle, garis datar ---- */
        var bp = (ti - 0.16) / 0.15;
        var blinkO = (!A.cheering && !A.waving && bp > 0 && bp < 1) ? 1 - clamp01(1.7 * Math.sin(Math.PI * bp)) : 1;
        S.eyeO = Math.min(blinkO, 1 - A.eyeHappy);
        S.eyeK = 0.15 + 0.85 * A.eyeHappy;

        /* ---- mulut & pipi ---- */
        S.mouth = h * (0.95 + 0.05 * Math.sin(now * 8));
        S.blush = clamp01(h * 1.2);
        if (lf > 0.01) {
            S.mouth = Math.max(S.mouth, lf * (0.85 + 0.55 * hh));   // mulut terbuka lebar, membesar tiap "ha"
            S.blush = Math.max(S.blush, lf);
        }
        if (wv > 0.01) {
            S.mouth = Math.max(S.mouth, 1.2 * wv);                 // senyum lebar saat melambai
            S.blush = Math.max(S.blush, 0.8 * wv);
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
        A.gdy = (A.gdy === null) ? dy : A.gdy + (dy - A.gdy) * 0.3; // dihaluskan supaya tidak patah di tanah miring
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
           melambai: lengan WAVE_SIDE terangkat ke samping-atas, lalu diayun kiri-kanan */
        for (var si = 0; si < 2; si++) {
            var side = si === 0 ? -1 : 1;
            var swing = Math.sin(A.armPh + (side > 0 ? 0 : 1.1));
            var rx = (-0.20 - 0.25 * S.ao) * (1 - h) - 1.0 * h + 0.07 * swing * h + 0.03 * swing * (1 - h)
                     - side * 0.40 * S.step * S.walk
                     - S.laugh * (0.75 - 0.15 * S.ha);                 // tangan memegang perut & bergetar
            var ry = -side * (0.10 * (1 - h) + 0.42 * h + 0.30 * S.laugh);
            var rz = side * ((0.08 + 0.05 * swing + 0.60 * S.ao) * (1 - h));

            var wvS = (side === WAVE_SIDE) ? S.wave : 0;               // hanya satu tangan yang melambai
            if (wvS > 0.001) {
                rx = rx * (1 - wvS) + (-0.45) * wvS;                   // sedikit ke depan supaya tidak tertutup kepala
                ry = ry * (1 - wvS);
                rz = rz * (1 - wvS) + side * (1.5 + 0.32 * Math.sin(S.wavePh)) * wvS;   // ROTASI: terangkat + diayun
            }

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
        if (S.c >= 0) {
            var hv = clamp01(h * 2);
            for (var i = 0; i < DECOR.length; i++) {
                var d = DECOR[i];
                var u = (S.c - d.on) / 0.3;
                if (u <= 0 || hv <= 0.01) continue;
                var sc = d.size * easeOutBack(clamp01(u)) * hv * (1 + 0.12 * Math.sin(now * 7 + d.k));
                var yy = d.y + 0.06 * Math.sin(now * 2.2 + d.k);
                if (d.type === 'heart') drawHeart(d.x, yy, d.z, sc, d.col);
                else drawStar(d.x, yy, d.z, sc, d.col, now * 1.5 + d.k, d.fat);   // bintang berputar
            }
        }

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
        if (A.walking && A.mode === mode) { A.walking = false; return; }
        if (typeof angle !== "number" && mode === 'line' && WALK_RELATIVE_TO_CAMERA) {
            // yaw kamera dibaca dari matriks view: V[0] = cos(yaw), V[8] = -sin(yaw)
            // dikurangi yaw dari M (arah hadap awal Kuromi di world.js), karena gerakan dihitung di ruang model
            angle = Math.atan2(-cam.V[8], cam.V[0]) + WALK_SCREEN_OFFSET - A.myaw;
        }
        if (typeof angle === "number") A.lineAngle = angle;
        A.mode = mode;
        A.walked = 0;
        A.walking = true;
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
        setGround: function (fn) { groundFn = (typeof fn === "function") ? fn : null; A.gdy = null; },
        walkPath: function (on) { A.followPath = !!on; }   // false = jalan di tempat
    };

};

})();