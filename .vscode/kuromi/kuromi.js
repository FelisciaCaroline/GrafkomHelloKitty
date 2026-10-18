// Kuromi + environment.
// - Tengkorak diambil langsung dari skull.png (satu folder dengan index.html)
// - Environment digambar otomatis oleh enviroment.js (tidak dipanggil dari sini)

// ---------------------------------------------------------------
// Global geometry generator helpers
// ---------------------------------------------------------------
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
    var LID_A = 0.35;   // lid height at eye centre (lower = more squinted)
    var LID_S = 0.45;   // lid slope (higher = more angry)
    var v = [];
    for (var i = 0; i <= n; i++) {
        var w = i / n;                                   // 0 bottom -> 1 top
        for (var j = 0; j <= n; j++) {
            var lx = -Math.cos(Math.PI * j / n);         // -1 inner corner ... +1 outer corner
            var e = Math.sqrt(Math.max(1 - lx * lx, 0));
            var yb = -e;
            var yt = Math.max(Math.min(e, LID_A + LID_S * lx), yb); // ellipse top cut by the slanted lid
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

// Creates a triangular point patch that hugs the head ellipsoid surface
function makePeakPatch(cy, halfW, height, n) {
    var v = [];
    for (var i = 0; i <= n; i++) {
        var t = i / n; // 0 at top, 1 at bottom tip
        var curWidth = halfW * (1 - t);
        var y = cy - t * height;
        for (var j = 0; j <= n; j++) {
            var u = j / n;
            var x = (u * 2 - 1) * curWidth;

            // head ellipsoid: centre [0,1.6,0], radii [1.9,1.55,1.6]
            var qh = Math.max(1 - (x / 1.9) * (x / 1.9) - ((y - 1.6) / 1.55) * ((y - 1.6) / 1.55), 0);
            var zh = 1.6 * Math.sqrt(qh);
            // face ellipsoid: centre [0,1.3,0.8], radii [1.5,1.0,0.9]
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

// Chunky Kuromi leg: rounded top, slight flare toward the bottom, rounded sole.
// Unit-sized (y from -1 to 1, radius <= 1) so it can be scaled with uScale.
function makeLeg(rows, seg) {
    var f = function (t) { // t: 0 = top, 1 = bottom
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

// A textured patch that hugs the front of the hood (head ellipsoid centre [0,1.6,0], radii [1.9,1.55,1.6]).
// Vertex layout: pos(3) normal(3) uv(2) => stride 32 bytes
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

function rotationMatrix(rx, ry, rz) {
    var cx = Math.cos(rx), sx = Math.sin(rx);
    var cy = Math.cos(ry), sy = Math.sin(ry);
    var cz = Math.cos(rz), sz = Math.sin(rz);
    var RX = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
    var RY = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
    var RZ = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    return mul4(RZ, mul4(RY, RX));
}


// Hapus latar putih skull.png: flood-fill dari tepi gambar, jadi hanya putih yang
// tersambung ke tepi yang dihapus (putih di dalam skull aman). Lalu bersihkan sisa
// pinggiran keabu-abuan dan set warna piksel transparan jadi hitam (outline)
// supaya tidak muncul halo putih saat tekstur diperhalus.
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
    // pinggiran abu-abu/putih bekas anti-alias yang menempel ke area transparan (2 putaran)
    for (var pass = 0; pass < 2; pass++) {
        var add = [];
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
            var m = y * w + x;
            if (seen[m]) continue;
            var near = (x > 0 && seen[m - 1]) || (x < w - 1 && seen[m + 1]) || (y > 0 && seen[m - w]) || (y < h - 1 && seen[m + w]);
            if (!near) continue;
            var i = m * 4, mn = Math.min(p[i], p[i + 1], p[i + 2]), mx = Math.max(p[i], p[i + 1], p[i + 2]);
            if (mn > 140 && mx - mn < 45) add.push(m);   // terang & hampir abu-abu (bukan pink)
        }
        for (k = 0; k < add.length; k++) seen[add[k]] = 1;
    }
    for (k = 0; k < w * h; k++) {
        if (seen[k]) { p[k * 4] = 0; p[k * 4 + 1] = 0; p[k * 4 + 2] = 0; p[k * 4 + 3] = 0; }
        else p[k * 4 + 3] = 255;
    }
}

function nextPOT(n) { var v = 1; while (v < n) v *= 2; return v; }

function main() {
    /** @type {HTMLCanvasElement} */
    var CANVAS = document.getElementById('mycanvas');
    // resolusi canvas mengikuti layar retina/HiDPI supaya tidak buram
    var fitCanvas = function () {
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        CANVAS.width = Math.floor(window.innerWidth * dpr);
        CANVAS.height = Math.floor(window.innerHeight * dpr);
        if (CANVAS.style) {
            CANVAS.style.width = window.innerWidth + "px";
            CANVAS.style.height = window.innerHeight + "px";
        }
    };
    fitCanvas();

    /*===================== GET WEBGL CONTEXT ===================== */
    /** @type {WebGLRenderingContext} */
    var GL;
    try {
        GL = CANVAS.getContext("webgl", { antialias: true });
    } catch (e) {
        alert("WebGL context cannot be initialized");
        return false;
    }

    /*========================= SHADERS (karakter) ========================= */
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
            alert("ERROR IN " + typeString + " SHADER: " + GL.getShaderInfoLog(shader));
            return false;
        }
        return shader;
    };

    var shader_vertex = compile_shader(shader_vertex_source, GL.VERTEX_SHADER, "VERTEX");
    var shader_fragment = compile_shader(shader_fragment_source, GL.FRAGMENT_SHADER, "FRAGMENT");

    var SHADER_PROGRAM = GL.createProgram();
    GL.attachShader(SHADER_PROGRAM, shader_vertex);
    GL.attachShader(SHADER_PROGRAM, shader_fragment);
    GL.linkProgram(SHADER_PROGRAM);
    GL.useProgram(SHADER_PROGRAM);

    var _position = GL.getAttribLocation(SHADER_PROGRAM, "position");
    var _normal = GL.getAttribLocation(SHADER_PROGRAM, "normal");
    var _uv = GL.getAttribLocation(SHADER_PROGRAM, "uv");
    GL.enableVertexAttribArray(_position);
    GL.enableVertexAttribArray(_normal);
    GL.enableVertexAttribArray(_uv);

    var _Pmatrix = GL.getUniformLocation(SHADER_PROGRAM, "Pmatrix");
    var _Vmatrix = GL.getUniformLocation(SHADER_PROGRAM, "Vmatrix");
    var _Mmatrix = GL.getUniformLocation(SHADER_PROGRAM, "Mmatrix");
    var _uOffset = GL.getUniformLocation(SHADER_PROGRAM, "uOffset");
    var _uScale = GL.getUniformLocation(SHADER_PROGRAM, "uScale");
    var _uColor = GL.getUniformLocation(SHADER_PROGRAM, "uColor");
    var _uRot = GL.getUniformLocation(SHADER_PROGRAM, "uLocalRotation");
    var _uTex = GL.getUniformLocation(SHADER_PROGRAM, "uTex");
    var _uUseTex = GL.getUniformLocation(SHADER_PROGRAM, "uUseTex");

    /*======================== ENVIRONMENT (opsional, otomatis) ======================== */
    // enviroment.js (kalau dimuat di index.html) memasang dirinya sendiri dan menggambar sendiri.
    // Di sini cuma dipakai untuk tinggi tanah; kalau file itu tidak ada, tanah dianggap datar.
    var ENV = window.ENV || { groundY: -2.1, groundHeight: function () { return -2.1; } };

    /*======================== GEOMETRY & BUFFERS ======================== */
    var makeMesh = function (data, usage) {
        if (!usage) usage = GL.STATIC_DRAW;
        var vb = GL.createBuffer();
        var ib = GL.createBuffer();
        GL.bindBuffer(GL.ARRAY_BUFFER, vb);
        GL.bufferData(GL.ARRAY_BUFFER, new Float32Array(data.vertices), usage);
        GL.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, ib);
        GL.bufferData(GL.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.indices), GL.STATIC_DRAW);
        return { vb: vb, ib: ib, count: data.indices.length, stride: data.stride || 24, textured: !!data.textured };
    };

    var sphere = makeMesh(makeSphere(1, 30, 30));
    var cone = makeMesh(makeCone(1, 2, 30));
    var diamond = makeMesh(makeDiamond(1, 0.22, 0.78, 8));
    var leg = makeMesh(makeLeg(32, 28));

    // Skull sits on the hood, just above the pointed black "widow's peak"
    var SKULL_CY = 2.15, SKULL_HH = 0.8; // skull patch centre y, half-height (width disesuaikan saat gambar skull.png termuat)
    var skullMesh = makeMesh(makeSkullPatch(SKULL_CY, SKULL_HH * 1.0, SKULL_HH, 12, 0.06)); // lebar diganti otomatis sesuai rasio skull.png saat gambar termuat
    var SKULL_TINT = [1.0, 1.0, 1.0]; // multiply the texture (e.g. [1.0, 0.85, 0.95] for a pinker skull)
    var peakMesh = makeMesh(makePeakPatch(2, 1.3, 0.65, 12));
    var eyeL = makeMesh(makeEyePatch(-0.74, 1.17, 0.18, 0.22, -1, 16, 0.02)); // viewer-left (a bit smaller)
    var eyeR = makeMesh(makeEyePatch(0.74, 1.17, 0.21, 0.25, 1, 16, 0.02)); // viewer-right (a bit larger)

    // Static tail
    var TAIL_STEPS = 36, TAIL_SEG = 12;
    var tailProfile = function (t) { return [0.19 * (1 - 0.35 * t), 0.15 * (1 - 0.35 * t)]; };
    var tailPathStatic = [
        [0.30, -1.10, -0.600],
        [0.80, -1.20, -0.733],
        [1.30, -0.733, -0.867],
        [1.80, 0.20, -1.000]
    ];
    var tail = makeMesh({
        vertices: sweepVertices(tailPathStatic, tailProfile, TAIL_STEPS, TAIL_SEG),
        indices: gridIndices(TAIL_STEPS + 1, TAIL_SEG)
    });

    // Smile: a thin tube following a curve resting on the face surface
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

    /*========================= SKULL TEXTURE ========================= */
    var skullTex = GL.createTexture();
    GL.bindTexture(GL.TEXTURE_2D, skullTex);
    GL.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, true);
    GL.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
    GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
    GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
    GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);

    var SKULL_FILE = "skull.png"; // taruh skull.png satu folder dengan index.html
    var isPOT = function (n) { return (n & (n - 1)) === 0; };

    var skullImg = new Image();
    skullImg.onload = function () {
        var w = skullImg.width, h = skullImg.height;

        // 1) gambar ke canvas 2D, hapus latar putih
        var c1 = document.createElement("canvas");
        c1.width = w; c1.height = h;
        var x1 = c1.getContext("2d");
        x1.drawImage(skullImg, 0, 0);
        var id = x1.getImageData(0, 0, w, h);
        removeWhiteBackground(id.data, w, h);
        x1.putImageData(id, 0, 0);

        // 2) skala ke ukuran pangkat dua (min 256) tanpa memperhalus, jadi pixel-art tetap tajam
        var tw = Math.min(1024, Math.max(256, nextPOT(w)));
        var th = Math.min(1024, Math.max(256, nextPOT(h)));
        var c2 = document.createElement("canvas");
        c2.width = tw; c2.height = th;
        var x2 = c2.getContext("2d");
        x2.imageSmoothingEnabled = (w > tw || h > th); // kecilkan: halus, besarkan: tajam
        x2.drawImage(c1, 0, 0, tw, th);

        // 3) upload ke GPU dengan mipmap + anisotropic filtering
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

        // sesuaikan lebar patch dengan rasio asli skull.png
        var aspect = w / h;
        GL.deleteBuffer(skullMesh.vb);
        GL.deleteBuffer(skullMesh.ib);
        skullMesh = makeMesh(makeSkullPatch(SKULL_CY, SKULL_HH * aspect, SKULL_HH, 12, 0.06));
    };
    skullImg.onerror = function () {
        console.warn("skull.png tidak bisa dimuat. Pastikan file ada di folder yang sama dengan index.html " +
            "dan halaman dibuka lewat Live Server (bukan file://).");
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

    /*======================== KAMERA ORBIT (360 derajat) ======================== */
    // far plane 600 supaya langit & bukit jauh tidak terpotong
    var PROJMATRIX = LIBS.get_projection(40, CANVAS.width / CANVAS.height, 1, 600);
    var MOVEMATRIX = LIBS.get_I4();
    var VIEWMATRIX = LIBS.get_I4();

    var camYaw = 0, camPitch = 0.08, camDist = 18;       // posisi kamera mengitari Kuromi
    var CAM_MIN_D = 6, CAM_MAX_D = 45;                   // batas zoom
    var PITCH_MIN = -0.08, PITCH_MAX = 1.2;              // batas naik/turun kamera
    var dYaw = 0, dPitch = 0, FRICTION = 0.08;           // inersia putaran
    var drag = false, x_prev, y_prev;

    var charX = 0, charZ = 0, charYaw = 0, charY = 0;
    var SPEED = 0.12, WORLD_R = 50;
    var keys = {};

    var clampPitch = function () { camPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, camPitch)); };

    // lookAt: kamera di 'eye' menatap 'tgt'
    var buildView = function (out, ex, ey, ez, tx, ty, tz) {
        var zx = ex - tx, zy = ey - ty, zz = ez - tz;
        var l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
        var xx = zz, xy = 0, xz = -zx;                    // up(0,1,0) x z
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
        var tx = charX, ty = charY + 1.5, tz = charZ;
        var cp = Math.cos(camPitch);
        var ex = tx + camDist * Math.sin(camYaw) * cp;
        var ey = ty + camDist * Math.sin(camPitch);
        var ez = tz + camDist * Math.cos(camYaw) * cp;
        var gy = ENV.groundHeight(ex, ez) + 0.8;          // kamera tidak boleh masuk tanah
        if (ey < gy) ey = gy;
        buildView(VIEWMATRIX, ex, ey, ez, tx, ty, tz);
    };

    /*======================== MOUSE, TOUCH & KEYBOARD ======================== */
    var orbit = function (dx, dy) {
        dYaw = -dx * 2 * Math.PI / (CANVAS.clientWidth || window.innerWidth);
        dPitch = dy * Math.PI / (CANVAS.clientHeight || window.innerHeight);
        camYaw += dYaw;
        camPitch += dPitch;
        clampPitch();
    };
    var zoom = function (f) {
        camDist = Math.max(CAM_MIN_D, Math.min(CAM_MAX_D, camDist * f));
    };

    CANVAS.addEventListener("mousedown", function (e) {
        drag = true; x_prev = e.pageX; y_prev = e.pageY;
        e.preventDefault();
    }, false);
    window.addEventListener("mouseup", function () { drag = false; }, false);
    window.addEventListener("mousemove", function (e) {
        if (!drag) return;
        orbit(e.pageX - x_prev, e.pageY - y_prev);
        x_prev = e.pageX; y_prev = e.pageY;
    }, false);
    CANVAS.addEventListener("wheel", function (e) {
        zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
        e.preventDefault();
    }, { passive: false });

    // sentuh: 1 jari = orbit, 2 jari = cubit untuk zoom
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
        if (k.indexOf("arrow") === 0) e.preventDefault();
    }, false);
    window.addEventListener("keyup", function (e) { keys[e.key.toLowerCase()] = false; }, false);

    window.addEventListener("resize", function () {
        fitCanvas();
        PROJMATRIX = LIBS.get_projection(40, CANVAS.width / CANVAS.height, 1, 600);
    }, false);

    /*======================== CHARACTER DRAWING HELPERS ======================== */
    var BLACK = [0.12, 0.12, 0.16];
    var WHITE = [0.97, 0.97, 0.97];
    var PINK = [0.98, 0.62, 0.78];

    // Z of the white face ellipsoid surface (centre [0,1.3,0.8], radii [1.5,1.0,0.9])
    var faceZ = function (x, y) {
        var q = 1 - (x / 1.5) * (x / 1.5) - (y - 1.3) * (y - 1.3);
        return 0.8 + 0.9 * Math.sqrt(Math.max(q, 0));
    };

    var drawEar = function (side) {
        var a = 0.6;
        var H = 2;
        var base = [side * 1, 2.7, -0.1];
        var sinA = 0.564642;
        var cosA = 0.825335;

        draw(diamond, base, [0.95, H, 1], BLACK, [0, 0, -side * a]);
        draw(sphere, [base[0] + side * sinA * (H - 0.05), base[1] + cosA * (H - 0.05), base[2]], [0.26, 0.26, 0.24], BLACK);
    };

    // Asymmetric, slanted "mean" eyes with lash flicks on the outer corner
    // Eye patch + two lash strokes at the outer upper corner
    var drawEye = function (mesh, cx, cy, rx, ry, side) {
        draw(mesh, [0, 0, 0], [1, 1, 1], BLACK);

        var lx = cx + side * rx * 1.0, ly = cy + ry * 0.62;
        draw(sphere, [lx, ly, faceZ(lx, ly) + 0.02], [0.12, 0.024, 0.03], BLACK, [0, 0, side * 0.45]);
        var lx2 = cx + side * rx * 1.3, ly2 = cy + ry * 0.10;
        draw(sphere, [lx2, ly2, faceZ(lx2, ly2) + 0.02], [0.11, 0.024, 0.03], BLACK, [0, 0, side * 0.15]);
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
        draw(cone, [1.8, 0.2, -1.0], [0.32, 0.45, 0.14], BLACK, [0, 0, -0.49]);
    };

    /*========================= DRAWING ========================= */
    GL.enable(GL.DEPTH_TEST);
    GL.depthFunc(GL.LEQUAL);
    GL.clearColor(0.80, 0.93, 1.0, 1.0); // warna horizon langit
    GL.clearDepth(1.0);

    var animate = function () {
        GL.viewport(0, 0, CANVAS.width, CANVAS.height);
        GL.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);

        // --- gerak Kuromi (WASD / panah) relatif terhadap arah kamera ---
        var fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);   // maju
        var rx = Math.cos(camYaw), rz = -Math.sin(camYaw);    // kanan
        var mx = 0, mz = 0;
        if (keys['w'] || keys['arrowup']) { mx += fx; mz += fz; }
        if (keys['s'] || keys['arrowdown']) { mx -= fx; mz -= fz; }
        if (keys['d'] || keys['arrowright']) { mx += rx; mz += rz; }
        if (keys['a'] || keys['arrowleft']) { mx -= rx; mz -= rz; }
        var ml = Math.hypot(mx, mz);
        if (ml > 0) {
            mx /= ml; mz /= ml;
            charX += mx * SPEED; charZ += mz * SPEED;
            var cr = Math.hypot(charX, charZ);
            if (cr > WORLD_R) { charX *= WORLD_R / cr; charZ *= WORLD_R / cr; }
            var diff = Math.atan2(mx, mz) - charYaw;                // hadapkan ke arah jalan
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            charYaw += diff * 0.2;
        }
        charY = ENV.groundHeight(charX, charZ) - ENV.groundY;       // kaki selalu menapak tanah

        // --- inersia kamera ---
        if (!drag) {
            dYaw *= (1 - FRICTION);
            dPitch *= (1 - FRICTION);
            camYaw += dYaw;
            camPitch += dPitch;
            clampPitch();
        }
        updateCamera();

        // --- Kuromi ---
        LIBS.set_I4(MOVEMATRIX);
        MOVEMATRIX[12] = charX;
        MOVEMATRIX[13] = charY;
        MOVEMATRIX[14] = charZ;
        LIBS.rotateY(MOVEMATRIX, charYaw);

        GL.uniformMatrix4fv(_Pmatrix, false, PROJMATRIX);
        GL.uniformMatrix4fv(_Vmatrix, false, VIEWMATRIX);
        GL.uniformMatrix4fv(_Mmatrix, false, MOVEMATRIX);

        GL.activeTexture(GL.TEXTURE0);
        GL.bindTexture(GL.TEXTURE_2D, skullTex);
        GL.uniform1i(_uTex, 0);

        // Head / Face
        draw(sphere, [0, 1.6, 0], [1.9, 1.55, 1.6], BLACK);
        draw(sphere, [0, 1.3, 0.8], [1.5, 1.0, 0.9], WHITE);

        // Pointed black "widow's peak" of the hood that dips into the face (behind the skull)
        draw(peakMesh, [0, 0, 0], [1, 1, 1], BLACK);
        draw(skullMesh, [0, 0, 0], [1, 1, 1], SKULL_TINT);

        drawEar(-1);
        drawEar(1);

        // Eyes (viewer-left smaller, viewer-right larger, like the model)
        drawEye(eyeL, -0.74, 1.17, 0.18, 0.22, -1);
        drawEye(eyeR, 0.74, 1.17, 0.21, 0.25, 1);

        // Nose & smile
        draw(sphere, [0, 1.03, 1.67], [0.17, 0.10, 0.07], PINK);
        draw(smile, [0, -0.10, 0], [0.3, 1, 1], BLACK);

        // Body: egg-shaped torso
        draw(sphere, [0, -0.30, 0], [0.90, 1.0, 1.0], WHITE);
        drawCollar();

        // Arms + round mitts
        draw(sphere, [-1.0, -0.45, 0.15], [0.30, 0.62, 0.32], WHITE, [0, 0, -0.2]);
        draw(sphere, [1.0, -0.45, 0.15], [0.30, 0.62, 0.32], WHITE, [0, 0, 0.2]);
        draw(sphere, [-1.17, -0.90, 0.30], [0.34, 0.40, 0.34], WHITE);
        draw(sphere, [1.17, -0.90, 0.30], [0.34, 0.40, 0.34], WHITE);

        // Legs: stubby, slightly flared columns with rounded soles
        draw(leg, [-0.50, -1.20, 0.05], [0.50, 0.90, 0.50], WHITE);
        draw(leg, [0.50, -1.20, 0.05], [0.50, 0.90, 0.50], WHITE);

        drawTail();

        GL.flush();
        requestAnimationFrame(animate);
    };
    animate();
}

window.addEventListener('load', main);