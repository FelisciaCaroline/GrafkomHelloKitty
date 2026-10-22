/* =====================================================================
   enviroment.js  -  DUNIA 3D 360 DERAJAT (padang rumput gaya Sanrio)

   TIDAK PERLU dipanggil dari kode utama. Cukup muat file ini lewat <script>:
   saat kode utama memanggil canvas.getContext("webgl"), file ini otomatis
   memasang diri ke context itu, membaca matriks kamera (Pmatrix / Vmatrix)
   yang dipakai kode utama, dan menggambar environment tepat sebelum draw
   pertama tiap frame. Urutan tag <script> tidak penting.

   Syarat kode utama:
     - uniform matriks proyeksi & view bernama "Pmatrix" dan "Vmatrix"
     - far plane kamera >= 600 dan GL.clearColor(0.80, 0.93, 1.0, 1.0)
     - memanggil GL.clear(COLOR | DEPTH) tiap frame

   Opsional: window.ENV.groundHeight(x, z) dan window.ENV.groundY
   (tinggi tanah) bisa dipakai kode utama kalau mau menempel ke tanah.
   ===================================================================== */

function createEnvironment(GL) {

    /* ------------------------- helper geometri ------------------------- */
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
        for (var j = 0; j < seg; j++) idx.push(0, j + 2, j + 3, 1, j + 3, j + 2);
        return { vertices: v, indices: idx };
    }

    // silinder membulat (y -1..1, radius <= 1): batang, pagar, sinar matahari
    function makePill(rows, seg) {
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
        var v = [], N = null;
        for (var i = 0; i <= steps; i++) {
            var t = i / steps;
            var C = point(t), T = tangent(t);
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

    function mul4(a, b) {
        var o = new Float32Array(16);
        for (var c = 0; c < 4; c++)
            for (var r = 0; r < 4; r++)
                for (var k = 0; k < 4; k++)
                    o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
        return o;
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

    /* ----------------------------- shader ----------------------------- */
    // uMode: 0 = normal, 1 = tanah (belang rumput), 2 = langit gradasi, 3 = warna polos
    var VS = [
        "attribute vec3 position;",
        "attribute vec3 normal;",
        "uniform mat4 Pmatrix, Vmatrix;",
        "uniform vec3 uOffset, uScale;",
        "uniform mat4 uLocalRotation;",
        "varying vec3 vNormal;",
        "varying vec3 vWorld;",
        "varying float vDist;",
        "void main(void) {",
        "    vec3 p = (uLocalRotation * vec4(position * uScale, 1.0)).xyz + uOffset;",
        "    vec4 clip = Pmatrix * Vmatrix * vec4(p, 1.0);",
        "    gl_Position = clip;",
        "    vDist = clip.w;",
        "    vWorld = p;",
        "    vec3 n = normalize(normal / uScale);",
        "    vNormal = (Vmatrix * uLocalRotation * vec4(n, 0.0)).xyz;",
        "}"
    ].join("\n");

    var FS = [
        "precision mediump float;",
        "uniform vec3 uColor;",
        "uniform float uMode;",
        "varying vec3 vNormal;",
        "varying vec3 vWorld;",
        "varying float vDist;",
        "void main(void) {",
        "    if (uMode > 1.5 && uMode < 2.5) {",
        "        float t = clamp(vWorld.y / 150.0, 0.0, 1.0);",
        "        vec3 c = mix(vec3(0.80, 0.93, 1.0), vec3(0.10, 0.52, 0.97), pow(t, 0.45));",
        "        gl_FragColor = vec4(c, 1.0);",
        "        return;",
        "    }",
        "    if (uMode > 2.5) { gl_FragColor = vec4(uColor, 1.0); return; }",
        "    vec3 base = uColor;",
        "    if (uMode > 0.5) {",
        "        float n = sin(vWorld.x * 0.7) * sin(vWorld.z * 0.7) + 0.5 * sin(vWorld.x * 0.23 + vWorld.z * 0.31);",
        "        base = mix(uColor * 0.80, uColor * 1.08, smoothstep(-0.6, 0.8, n));",
        "    }",
        "    vec3 N = normalize(vNormal);",
        "    vec3 L = normalize(vec3(-0.4, 0.7, 0.8));",
        "    vec3 V = vec3(0.0, 0.0, 1.0);",
        "    vec3 H = normalize(L + V);",
        "    float diff = max(dot(N, L), 0.0);",
        "    float spec = pow(max(dot(N, H), 0.0), 28.0);",
        "    float rim  = pow(1.0 - max(dot(N, V), 0.0), 3.0);",
        "    vec3 col = base * (0.5 + 0.6 * diff) + vec3(0.22) * spec + vec3(0.10) * rim;",
        "    float fog = smoothstep(70.0, 300.0, vDist);",
        "    col = mix(col, vec3(0.80, 0.93, 1.0), fog);",
        "    gl_FragColor = vec4(col, 1.0);",
        "}"
    ].join("\n");

    function compile(src, type) {
        var s = GL.createShader(type);
        GL.shaderSource(s, src);
        GL.compileShader(s);
        if (!GL.getShaderParameter(s, GL.COMPILE_STATUS)) {
            console.error("ENV shader error: " + GL.getShaderInfoLog(s));
        }
        return s;
    }

    var prog = GL.createProgram();
    GL.attachShader(prog, compile(VS, GL.VERTEX_SHADER));
    GL.attachShader(prog, compile(FS, GL.FRAGMENT_SHADER));
    GL.bindAttribLocation(prog, 0, "position");
    GL.bindAttribLocation(prog, 1, "normal");
    GL.linkProgram(prog);
    if (!GL.getProgramParameter(prog, GL.LINK_STATUS)) {
        console.error("ENV program link error: " + GL.getProgramInfoLog(prog));
    }

    var uP = GL.getUniformLocation(prog, "Pmatrix");
    var uV = GL.getUniformLocation(prog, "Vmatrix");
    var uOffset = GL.getUniformLocation(prog, "uOffset");
    var uScale = GL.getUniformLocation(prog, "uScale");
    var uColor = GL.getUniformLocation(prog, "uColor");
    var uRot = GL.getUniformLocation(prog, "uLocalRotation");
    var uMode = GL.getUniformLocation(prog, "uMode");

    var IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    function makeMesh(data) {
        var vb = GL.createBuffer(), ib = GL.createBuffer();
        GL.bindBuffer(GL.ARRAY_BUFFER, vb);
        GL.bufferData(GL.ARRAY_BUFFER, new Float32Array(data.vertices), GL.STATIC_DRAW);
        GL.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, ib);
        GL.bufferData(GL.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.indices), GL.STATIC_DRAW);
        return { vb: vb, ib: ib, count: data.indices.length };
    }

    // rot: null | [rx, ry, rz] (Euler) | array 16 (matriks rotasi langsung)
    var lastMesh = null, lastRot = null, lastMode = -1;
    function draw(mesh, pos, scale, color, rot, mode) {
        if (mesh !== lastMesh) {
            GL.bindBuffer(GL.ARRAY_BUFFER, mesh.vb);
            GL.vertexAttribPointer(0, 3, GL.FLOAT, false, 24, 0);
            GL.vertexAttribPointer(1, 3, GL.FLOAT, false, 24, 12);
            GL.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, mesh.ib);
            lastMesh = mesh;
        }
        var R = IDENT;
        if (rot) R = rot.length === 16 ? rot : rotationMatrix(rot[0], rot[1], rot[2]);
        if (R !== lastRot) { GL.uniformMatrix4fv(uRot, false, R); lastRot = R; }
        var m = mode || 0;
        if (m !== lastMode) { GL.uniform1f(uMode, m); lastMode = m; }
        GL.uniform3fv(uOffset, pos);
        GL.uniform3fv(uScale, scale);
        GL.uniform3fv(uColor, color);
        GL.drawElements(GL.TRIANGLES, mesh.count, GL.UNSIGNED_SHORT, 0);
    }

    /* ----------------------------- tanah ----------------------------- */
    var GROUND_Y = -2.1; // telapak kaki Kuromi
    var WHITE = [0.97, 0.97, 0.97];

    function smooth01(a) { a = Math.min(Math.max(a, 0), 1); return a * a * (3 - 2 * a); }

    // Mangkuk lembah: datar di sekitar Kuromi (r<5), bergelombang di tengah,
    // lalu naik jadi punggung bukit di semua sisi (r > ~35)
    function groundH(x, z) {
        var r = Math.hypot(x, z);
        var th = Math.atan2(z, x);
        var k = smooth01((r - 5) / 11);
        var bumps = 1.1 * Math.sin(x * 0.17 + 1.0) * Math.cos(z * 0.13)
                  + 0.5 * Math.sin(x * 0.41 + z * 0.23) * Math.sin(z * 0.37);
        var rim = smooth01((r - 32) / 55) * (15 + 4 * Math.sin(3 * th) + 3 * Math.cos(5 * th + 1));
        return GROUND_Y + k * (1.2 + bumps) + rim;
    }

    function makeGround(x0, x1, z0, z1, nx, nz) {
        var v = [], e = 0.2;
        for (var i = 0; i <= nz; i++) {
            var z = z0 + (z1 - z0) * i / nz;
            for (var j = 0; j <= nx; j++) {
                var x = x0 + (x1 - x0) * j / nx;
                var gx = groundH(x - e, z) - groundH(x + e, z);
                var gz = groundH(x, z - e) - groundH(x, z + e);
                var l = Math.hypot(gx, 2 * e, gz);
                v.push(x, groundH(x, z), z, gx / l, 2 * e / l, gz / l);
            }
        }
        return { vertices: v, indices: gridIndices(nz + 1, nx) };
    }

    /* ----------------------------- mesh ----------------------------- */
    var sphere = makeMesh(makeSphere(1, 24, 24));
    var cone = makeMesh(makeCone(1, 2, 20));
    var pill = makeMesh(makePill(24, 20));
    var groundMesh = makeMesh(makeGround(-160, 160, -160, 160, 160, 160));

    // Pelangi: 6 pita lengkung tebal (3D), pusat di (0, 0, -100)
    var RAINBOW_POS = [-12, 0, -100];
    var rainbowColors = [[1, 0.45, 0.5], [1, 0.7, 0.4], [1, 0.92, 0.45], [0.55, 0.88, 0.55], [0.5, 0.75, 1], [0.75, 0.6, 1]];
    var rainbowMeshes = rainbowColors.map(function (c, i) {
        var hw = 55 - i * 3.2, cy = 82 - i * 5;
        var P = [[-hw, -10, 0], [-hw, cy, 0], [hw, cy, 0], [hw, -10, 0]];
        return makeMesh({
            vertices: sweepVertices(P, function () { return [1.2, 1.8]; }, 56, 12),
            indices: gridIndices(57, 12)
        });
    });

    /* ----------------------------- warna ----------------------------- */
    var STEM = [0.30, 0.68, 0.25], LEAF = [0.35, 0.75, 0.28], YELLOW = [1.0, 0.85, 0.2];
    var GRASS_L = [0.58, 0.88, 0.38], GRASS_D = [0.38, 0.74, 0.26];
    var BROWN = [0.45, 0.28, 0.16], TREE_D = [0.22, 0.55, 0.20], TREE_L = [0.32, 0.68, 0.24];
    var FLOWER_COLORS = [[0.92, 0.12, 0.14], [0.92, 0.12, 0.14], [0.98, 0.52, 0.72],
                         [0.96, 0.38, 0.62], [1.0, 0.86, 0.25], [1, 1, 1]];

    /* ------------------- data scene (random seed tetap) ------------------- */
    var seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

    // titik acak di cincin r0..r1 (lebih rapat di dekat tengah bila bias > 1)
    function spot(r0, r1, bias) {
        var r = r0 + (r1 - r0) * Math.pow(rnd(), bias || 1);
        var a = rnd() * 2 * Math.PI;
        return [r * Math.cos(a), r * Math.sin(a)];
    }

    var flowers = [], tufts = [], mushrooms = [], rocks = [], trees = [], bushes = [];
    var i, p, tries;

    for (i = 0; i < 170; i++) {
        p = spot(3, 62, 1.5);
        flowers.push({ x: p[0], z: p[1], y: groundH(p[0], p[1]), s: 0.8 + rnd() * 0.7,
            c: FLOWER_COLORS[Math.floor(rnd() * FLOWER_COLORS.length)], ph: rnd() * 6.28 });
    }
    for (i = 0; i < 420; i++) {
        p = spot(3, 62, 1.4);
        tufts.push({ x: p[0], z: p[1], y: groundH(p[0], p[1]), s: 0.7 + rnd() * 0.9, c: rnd() < 0.5 ? GRASS_L : GRASS_D });
    }
    for (i = 0; i < 14; i++) {
        p = spot(4, 50, 1.2);
        mushrooms.push({ x: p[0], z: p[1], y: groundH(p[0], p[1]), s: 0.8 + rnd() * 0.6 });
    }
    for (i = 0; i < 14; i++) {
        p = spot(4, 58, 1.1);
        rocks.push({ x: p[0], z: p[1], y: groundH(p[0], p[1]), s: 0.6 + rnd() * 0.9 });
    }
    // pohon: jarak antar pohon minimal 11 supaya tidak menumpuk
    tries = 0;
    while (trees.length < 16 && tries++ < 500) {
        p = spot(13, 62, 1);
        var ok = true;
        for (var q = 0; q < trees.length; q++) {
            if (Math.hypot(trees[q].x - p[0], trees[q].z - p[1]) < 11) { ok = false; break; }
        }
        if (ok) trees.push({ x: p[0], z: p[1], s: 0.95 + rnd() * 0.75 });
    }
    for (i = 0; i < 22; i++) {
        p = spot(7, 56, 1.1);
        bushes.push({ x: p[0], z: p[1], s: 0.8 + rnd() * 0.7 });
    }

    // [x0, z0, x1, z1, jumlah ruas]
    var fences = [[7, -9, 19, -9, 10], [-24, 8, -24, 22, 9], [22, 12, 36, 20, 9], [-32, -22, -16, -30, 10]];

    // [pusat x, pusat z, radius, kecepatan, fase, warna]
    var butterflies = [
        [-5, -2, 3.5, 0.7, 0, [0.98, 0.55, 0.80]],
        [7, -7, 4.0, 0.55, 2, [0.70, 0.55, 1.00]],
        [-13, -10, 5.0, 0.5, 4, [1.0, 0.80, 0.30]],
        [6, 4, 2.5, 0.9, 1, [0.60, 0.85, 1.00]],
        [12, 14, 4.5, 0.6, 3, [0.98, 0.55, 0.80]],
        [-10, 12, 3.5, 0.8, 5, [0.60, 0.85, 1.00]],
        [-18, -4, 4.0, 0.65, 2.5, [1.0, 0.80, 0.30]],
        [16, -2, 3.0, 0.75, 0.7, [0.70, 0.55, 1.00]]
    ];

    // [azimuth derajat, jarak, tinggi, skala]
    var clouds = [[-35, 95, 38, 7], [10, 110, 50, 8], [40, 90, 34, 6.5], [75, 100, 42, 7.5], [120, 95, 36, 7],
                  [160, 105, 50, 8], [-160, 100, 40, 7], [-120, 92, 33, 6], [-80, 100, 44, 8], [-10, 128, 64, 9]];

    var SUN_P = [58, 48, -110], SUN_R = 13;

    /* --------------------------- culling kamera --------------------------- */
    var EX = 0, EY = 0, EZ = 0, FX = 0, FY = 0, FZ = -1, COSH = 0.6;
    function vis(x, y, z, r, maxD) {
        var dx = x - EX, dy = y - EY, dz = z - EZ;
        var d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxD * maxD) return false;
        var d = Math.sqrt(d2);
        return dx * FX + dy * FY + dz * FZ > COSH * d - 2 * r; // buang yang di luar bidang pandang
    }

    /* --------------------------- fungsi gambar --------------------------- */
    var TILT = 0.9, cT = Math.cos(TILT), sT = Math.sin(TILT);
    var ROT_TILT = rotationMatrix(TILT, 0, 0), ROT_LEAF = rotationMatrix(0, 0, 0.5);
    var ROT_ZP = rotationMatrix(0, 0, 0.35), ROT_ZN = rotationMatrix(0, 0, -0.35);
    var ROT_XP = rotationMatrix(0.35, 0, 0), ROT_XN = rotationMatrix(-0.35, 0, 0);

    function drawFlower(f, t, near) {
        var s = f.s, h = 0.9 * s;
        draw(pill, [f.x, f.y + h * 0.5 - 0.05, f.z], [0.035 * s, h * 0.5, 0.035 * s], STEM);
        var cx = f.x + Math.sin(t * 1.6 + f.ph) * 0.05 * s, cy = f.y + h, cz = f.z;
        if (!near) { // jauh: satu kepala bunga saja
            draw(sphere, [cx, cy, cz], [0.30 * s, 0.10 * s, 0.30 * s], f.c, ROT_TILT);
            return;
        }
        draw(sphere, [f.x + 0.12 * s, f.y + 0.28 * s, f.z], [0.14 * s, 0.04 * s, 0.07 * s], LEAF, ROT_LEAF);
        var R = 0.16 * s, pr = 0.13 * s;
        for (var k = 0; k < 5; k++) {
            var a = k * 2 * Math.PI / 5 + f.ph, u = Math.cos(a), v = Math.sin(a);
            draw(sphere, [cx + R * u, cy - R * v * sT, cz + R * v * cT], [pr, pr * 0.35, pr], f.c, ROT_TILT);
        }
        draw(sphere, [cx, cy + 0.04 * s * cT, cz + 0.04 * s * sT], [0.10 * s, 0.06 * s, 0.10 * s], YELLOW, ROT_TILT);
    }

    function drawTuft(g, near) {
        var s = g.s, y = g.y - 0.03;
        draw(cone, [g.x, y, g.z], [0.11 * s, 0.34 * s, 0.11 * s], g.c);
        if (!near) return;
        draw(cone, [g.x - 0.10 * s, y, g.z], [0.09 * s, 0.26 * s, 0.09 * s], g.c, ROT_ZP);
        draw(cone, [g.x + 0.10 * s, y, g.z], [0.09 * s, 0.26 * s, 0.09 * s], g.c, ROT_ZN);
        draw(cone, [g.x, y, g.z - 0.08 * s], [0.09 * s, 0.24 * s, 0.09 * s], g.c, ROT_XP);
        draw(cone, [g.x, y, g.z + 0.08 * s], [0.09 * s, 0.24 * s, 0.09 * s], g.c, ROT_XN);
    }

    function drawMushroom(m) {
        var s = m.s;
        draw(pill, [m.x, m.y + 0.18 * s, m.z], [0.10 * s, 0.20 * s, 0.10 * s], [0.98, 0.93, 0.82]);
        draw(sphere, [m.x, m.y + 0.38 * s, m.z], [0.30 * s, 0.20 * s, 0.30 * s], [0.90, 0.20, 0.25]);
        draw(sphere, [m.x, m.y + 0.585 * s, m.z], [0.06 * s, 0.03 * s, 0.06 * s], WHITE);
        for (var k = 0; k < 5; k++) {
            var a = k * 2 * Math.PI / 5 + 0.5;
            draw(sphere, [m.x + 0.2 * s * Math.cos(a), m.y + 0.53 * s, m.z + 0.2 * s * Math.sin(a)],
                [0.055 * s, 0.055 * s, 0.055 * s], WHITE);
        }
    }

    function drawRock(r) {
        draw(sphere, [r.x, r.y + 0.1 * r.s, r.z], [0.5 * r.s, 0.3 * r.s, 0.4 * r.s], [0.62, 0.64, 0.68], [0, r.x, 0]);
        draw(sphere, [r.x + 0.45 * r.s, r.y + 0.02 * r.s, r.z + 0.2 * r.s], [0.25 * r.s, 0.17 * r.s, 0.22 * r.s], [0.70, 0.72, 0.76], [0, r.z, 0]);
    }

    function drawTree(x, z, s) {
        var y = groundH(x, z);
        draw(pill, [x, y + 2.0 * s, z], [0.42 * s, 2.3 * s, 0.42 * s], BROWN, [0, 0, 0.08]);
        var cy = y + 5.0 * s;
        var blobs = [[0, 0.6, 0, 2.6], [-1.9, -0.2, 0.5, 2.0], [1.9, -0.1, -0.2, 2.1],
                     [0.3, 1.9, 0.2, 1.9], [-0.9, 1.3, 1.3, 1.6], [1.2, 1.2, 1.2, 1.5],
                     [0.2, -0.2, -1.9, 1.9], [-1.0, 1.0, -1.4, 1.5]];
        for (var k = 0; k < blobs.length; k++) {
            var b = blobs[k];
            draw(sphere, [x + b[0] * s, cy + b[1] * s, z + b[2] * s], [b[3] * s, b[3] * s * 0.9, b[3] * s],
                b[1] > 1 ? TREE_L : TREE_D);
        }
    }

    function drawBush(x, z, s) {
        var y = groundH(x, z);
        draw(sphere, [x, y + 0.45 * s, z], [0.9 * s, 0.7 * s, 0.8 * s], TREE_D);
        draw(sphere, [x - 0.7 * s, y + 0.35 * s, z + 0.1 * s], [0.65 * s, 0.55 * s, 0.6 * s], TREE_L);
        draw(sphere, [x + 0.7 * s, y + 0.35 * s, z + 0.1 * s], [0.65 * s, 0.55 * s, 0.6 * s], TREE_L);
        draw(sphere, [x, y + 0.35 * s, z - 0.6 * s], [0.6 * s, 0.5 * s, 0.55 * s], TREE_L);
    }

    // pagar menghadap arah mana pun: dari (x0,z0) ke (x1,z1)
    function drawFence(x0, z0, x1, z1, n) {
        var FW = [0.98, 0.97, 0.94], px = [], py = [], pz = [], k;
        for (k = 0; k <= n; k++) {
            var x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n, y = groundH(x, z);
            px.push(x); py.push(y); pz.push(z);
            draw(pill, [x, y + 0.45, z], [0.09, 0.50, 0.09], FW);
            draw(cone, [x, y + 0.93, z], [0.09, 0.12, 0.09], FW);
        }
        for (k = 0; k < n; k++) {
            var dx = px[k + 1] - px[k], dz = pz[k + 1] - pz[k], dy = py[k + 1] - py[k];
            var hl = Math.hypot(dx, dz), len = Math.hypot(hl, dy);
            var rot = mul4(rotationMatrix(0, Math.atan2(-dz, dx), 0), rotationMatrix(0, 0, Math.atan2(dy, hl)));
            var mx = (px[k] + px[k + 1]) / 2, my = (py[k] + py[k + 1]) / 2, mz = (pz[k] + pz[k + 1]) / 2;
            draw(sphere, [mx, my + 0.30, mz], [len * 0.5 + 0.05, 0.055, 0.055], FW, rot);
            draw(sphere, [mx, my + 0.65, mz], [len * 0.5 + 0.05, 0.055, 0.055], FW, rot);
        }
    }

    function drawCloud(c, t) {
        var az = c[0] * Math.PI / 180 + t * 0.0026, d = c[1], s = c[3];
        var x = d * Math.sin(az), z = -d * Math.cos(az), y = c[2];
        var parts = [[0, 0, 0, 1.6], [-1.8, -0.2, 0.2, 1.2], [1.9, -0.2, 0.1, 1.3], [0.6, 0.7, 0, 1.2], [-0.7, 0.6, 0.2, 1.0],
                     [0.2, 0.1, 1.3, 1.1], [-0.3, 0.2, -1.2, 1.1]];
        for (var k = 0; k < parts.length; k++) {
            var q = parts[k];
            draw(sphere, [x + q[0] * s, y + q[1] * s, z + q[2] * s],
                [q[3] * s, q[3] * s * 0.8, q[3] * s * 0.9], [0.98, 0.99, 1.0]);
        }
    }

    // Matahari 3D: bola kuning + duri sinar tersebar merata di seluruh permukaan bola
    function drawSun(t) {
        var SUN = [1.0, 0.93, 0.15], R = SUN_R, n = 26;
        draw(sphere, SUN_P, [R, R, R], SUN, null, 3);
        for (var k = 0; k < n; k++) {
            var yy = 1 - 2 * (k + 0.5) / n, rr = Math.sqrt(1 - yy * yy);
            var ph = k * 2.399963 + t * 0.15;
            var dx = rr * Math.cos(ph), dz = rr * Math.sin(ph);
            var alpha = Math.acos(yy), beta = Math.atan2(dx, dz);
            var hl = R * 0.36 * (1 + 0.15 * Math.sin(t * 2 + k));
            draw(cone, [SUN_P[0] + dx * R * 0.9, SUN_P[1] + yy * R * 0.9, SUN_P[2] + dz * R * 0.9],
                [R * 0.17, hl, R * 0.17], SUN, [alpha, beta, 0], 3);
        }
    }

    function drawButterfly(b, t) {
        var a = t * b[3] + b[4];
        var x = b[0] + Math.cos(a) * b[2], z = b[1] + Math.sin(a) * b[2] * 0.7;
        var y = groundH(x, z) + 1.6 + Math.sin(t * 2 + b[4]) * 0.3;
        var dx = -Math.sin(a), dz = Math.cos(a) * 0.7;
        var ry = Math.atan2(-dz, dx), f = Math.sin(t * 18) * 0.8;
        draw(sphere, [x, y, z], [0.12, 0.03, 0.03], [0.2, 0.15, 0.25], [0, ry, 0]);
        for (var s = -1; s <= 1; s += 2) {
            var wy = Math.sin(f) * 0.2, wz = s * Math.cos(f) * 0.2;
            draw(sphere, [x + wz * Math.sin(ry), y + wy, z + wz * Math.cos(ry)], [0.14, 0.015, 0.2], b[5], [-s * f, ry, 0]);
        }
    }

    /* ----------------------------- API publik ----------------------------- */
    function drawAll(PMAT, VMAT, t) {
        // posisi & arah pandang kamera (dari matriks view) untuk culling
        var t0 = VMAT[12], t1 = VMAT[13], t2 = VMAT[14];
        EX = -(VMAT[0] * t0 + VMAT[1] * t1 + VMAT[2] * t2);
        EY = -(VMAT[4] * t0 + VMAT[5] * t1 + VMAT[6] * t2);
        EZ = -(VMAT[8] * t0 + VMAT[9] * t1 + VMAT[10] * t2);
        FX = -VMAT[2]; FY = -VMAT[6]; FZ = -VMAT[10];
        // sudut pandang diagonal dari matriks proyeksi (+ sedikit margin)
        var tn2 = 1 / (PMAT[0] * PMAT[0]) + 1 / (PMAT[5] * PMAT[5]);
        COSH = Math.max(0.15, 0.93 / Math.sqrt(1 + tn2));
        lastMesh = null; lastRot = null; lastMode = -1;

        GL.useProgram(prog);
        GL.enableVertexAttribArray(0);
        GL.enableVertexAttribArray(1);
        GL.disableVertexAttribArray(2); // atribut 'uv' milik shader Kuromi, tidak dipakai di sini
        GL.uniformMatrix4fv(uP, false, PMAT);
        GL.uniformMatrix4fv(uV, false, VMAT);

        var k, o;
        // langit & benda langit (dome besar, tidak ikut kabut)
        draw(sphere, [0, 0, 0], [280, 280, 280], WHITE, null, 2);
        drawSun(t);
        for (k = 0; k < rainbowMeshes.length; k++) draw(rainbowMeshes[k], RAINBOW_POS, [1, 1, 1], rainbowColors[k], null, 3);
        for (k = 0; k < clouds.length; k++) drawCloud(clouds[k], t);

        // tanah / bukit
        draw(groundMesh, [0, 0, 0], [1, 1, 1], [0.46, 0.80, 0.28], null, 1);

        // pohon, semak, batu, pagar
        for (k = 0; k < trees.length; k++) {
            o = trees[k];
            if (vis(o.x, groundH(o.x, o.z) + 6 * o.s, o.z, 6 * o.s, 170)) drawTree(o.x, o.z, o.s);
        }
        for (k = 0; k < bushes.length; k++) {
            o = bushes[k];
            if (vis(o.x, 0, o.z, 2 * o.s, 120)) drawBush(o.x, o.z, o.s);
        }
        for (k = 0; k < rocks.length; k++) {
            o = rocks[k];
            if (vis(o.x, o.y, o.z, 1.5, 100)) drawRock(o);
        }
        for (k = 0; k < fences.length; k++) {
            o = fences[k];
            if (vis((o[0] + o[2]) / 2, 0, (o[1] + o[3]) / 2, 10, 140)) drawFence(o[0], o[1], o[2], o[3], o[4]);
        }

        // rumput, bunga, jamur, kupu-kupu
        for (k = 0; k < tufts.length; k++) {
            o = tufts[k];
            if (vis(o.x, o.y, o.z, 0.6, 48)) {
                var dd = (o.x - EX) * (o.x - EX) + (o.z - EZ) * (o.z - EZ);
                drawTuft(o, dd < 400); // 20 unit
            }
        }
        for (k = 0; k < flowers.length; k++) {
            o = flowers[k];
            if (vis(o.x, o.y, o.z, 1.2, 70)) {
                var df = (o.x - EX) * (o.x - EX) + (o.z - EZ) * (o.z - EZ);
                drawFlower(o, t, df < 625); // 25 unit
            }
        }
        for (k = 0; k < mushrooms.length; k++) {
            o = mushrooms[k];
            if (vis(o.x, o.y, o.z, 1, 70)) drawMushroom(o);
        }
        for (k = 0; k < butterflies.length; k++) {
            o = butterflies[k];
            if (vis(o[0], 0, o[1], 6, 80)) drawButterfly(o, t);
        }

    }

    return { draw: drawAll, groundHeight: groundH, groundY: GROUND_Y };
}


/* ---------------------------------------------------------------------
   AUTO-ATTACH: pasang ke context WebGL milik kode utama
   --------------------------------------------------------------------- */
(function () {
    if (typeof HTMLCanvasElement === "undefined") return;
    var root = (typeof window !== "undefined") ? window : this;

    var origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type) {
        var ctx = origGetContext.apply(this, arguments);
        if (ctx && (type === "webgl" || type === "experimental-webgl") && !ctx.__kuromiEnvAttached) {
            ctx.__kuromiEnvAttached = true;
            try { attach(ctx); } catch (err) { console.error("enviroment.js gagal terpasang:", err); }
        }
        return ctx;
    };

    // simpan state WebGL milik kode utama, jalankan fn, lalu kembalikan persis seperti semula
    function withSavedState(GL, fn) {
        var prog = GL.getParameter(GL.CURRENT_PROGRAM);
        var ab = GL.getParameter(GL.ARRAY_BUFFER_BINDING);
        var eb = GL.getParameter(GL.ELEMENT_ARRAY_BUFFER_BINDING);
        var n = Math.min(8, GL.getParameter(GL.MAX_VERTEX_ATTRIBS)), attrs = [], i;
        for (i = 0; i < n; i++) {
            attrs.push({
                on: GL.getVertexAttrib(i, GL.VERTEX_ATTRIB_ARRAY_ENABLED),
                buf: GL.getVertexAttrib(i, GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),
                size: GL.getVertexAttrib(i, GL.VERTEX_ATTRIB_ARRAY_SIZE),
                type: GL.getVertexAttrib(i, GL.VERTEX_ATTRIB_ARRAY_TYPE),
                norm: GL.getVertexAttrib(i, GL.VERTEX_ATTRIB_ARRAY_NORMALIZED),
                stride: GL.getVertexAttrib(i, GL.VERTEX_ATTRIB_ARRAY_STRIDE),
                off: GL.getVertexAttribOffset(i, GL.VERTEX_ATTRIB_ARRAY_POINTER)
            });
        }
        try { fn(); }
        finally {
            for (i = 0; i < n; i++) {
                var a = attrs[i];
                if (a.buf) {
                    GL.bindBuffer(GL.ARRAY_BUFFER, a.buf);
                    GL.vertexAttribPointer(i, a.size, a.type, a.norm, a.stride, a.off);
                }
                if (a.on) GL.enableVertexAttribArray(i); else GL.disableVertexAttribArray(i);
            }
            GL.bindBuffer(GL.ARRAY_BUFFER, ab);
            GL.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, eb);
            GL.useProgram(prog);
        }
    }

    function attach(GL) {
        // dibuat SEBELUM hook dipasang, supaya uniform milik environment tidak ikut terbaca sebagai milik kode utama
        var env = createEnvironment(GL);
        root.ENV = env;

        var origGUL = GL.getUniformLocation.bind(GL);
        var origUM = GL.uniformMatrix4fv.bind(GL);
        var origClear = GL.clear.bind(GL);
        var origDE = GL.drawElements.bind(GL);

        var pLocs = [], vLocs = [], P = null, V = null, drawn = false, busy = false;

        GL.getUniformLocation = function (program, name) {
            var loc = origGUL(program, name);
            if (loc) {
                if (name === "Pmatrix") pLocs.push(loc);
                else if (name === "Vmatrix") vLocs.push(loc);
            }
            return loc;
        };

        GL.uniformMatrix4fv = function (loc, transpose, value) {
            if (!busy) {
                if (pLocs.indexOf(loc) >= 0) P = new Float32Array(value);
                else if (vLocs.indexOf(loc) >= 0) V = new Float32Array(value);
            }
            return origUM(loc, transpose, value);
        };

        GL.clear = function (mask) {
            if (mask & GL.DEPTH_BUFFER_BIT) drawn = false; // frame baru
            return origClear(mask);
        };

        GL.drawElements = function (mode, count, type, offset) {
            if (!drawn && !busy && P && V) { // sebelum draw pertama kode utama di frame ini
                drawn = true;
                busy = true;
                try {
                    withSavedState(GL, function () { env.draw(P, V, performance.now() / 1000); });
                } catch (err) {
                    console.error("environment gagal digambar:", err);
                } finally {
                    busy = false;
                }
            }
            return origDE(mode, count, type, offset);
        };
    }
})();