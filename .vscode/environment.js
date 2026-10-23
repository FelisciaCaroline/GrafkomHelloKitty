/* =====================================================================
   environment.js  -  360° WebGL world, "cozy storybook valley" style

   Matches the reference: pink scalloped-canopy trees on thick trunks,
   terraced mossy stone-brick cliffs, waterfalls, a turquoise pond,
   bright meadow, tulip beds, a crop plot, stacked rocks, curly vines,
   puffy clouds on a saturated blue sky.

   SHADING (all real WebGL, no textures):
     - world-space sun light + soft cel-style ramp (cool tinted shadows)
     - hemisphere ambient (sky colour from above, grass bounce from below)
     - baked sun shadows + ambient occlusion on the terrain (cliffs cast
       shadows onto the lower terraces)
     - height-based AO on trees / clouds / rocks (darker, purple-tinted base)
     - soft blob shadows under trees, bushes, rocks
     - rim light, soft specular, animated water with fresnel + sun glints
     - distance fog into the horizon colour

   NO NEED to call it from the main code. Just load it with <script>:
   when the main code calls canvas.getContext("webgl"), this file hooks
   into that context, reads the camera matrices (Pmatrix / Vmatrix) and
   draws the environment right before the first draw call of every frame.
   <script> order does not matter.

   Requirements for the main code (unchanged):
     - projection / view uniforms named "Pmatrix" and "Vmatrix"
     - camera far plane >= 600 and GL.clearColor(0.80, 0.93, 1.0, 1.0)
     - calls GL.clear(COLOR | DEPTH) every frame

   Optional: window.ENV.groundHeight(x, z) and window.ENV.groundY
   ===================================================================== */

function createEnvironment(GL) {

    /* ------------------------- small math helpers ------------------------- */
    function clamp(a, lo, hi) { return Math.min(Math.max(a, lo), hi); }
    function smooth01(a) { a = clamp(a, 0, 1); return a * a * (3 - 2 * a); }
    function cross(a, b) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }
    function norm(a) {
        var l = Math.hypot(a[0], a[1], a[2]) || 1;
        return [a[0] / l, a[1] / l, a[2] / l];
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
    function basisMatrix(X, Y, Z) {
        return new Float32Array([X[0], X[1], X[2], 0, Y[0], Y[1], Y[2], 0, Z[0], Z[1], Z[2], 0, 0, 0, 0, 1]);
    }
    // rotation that maps local +Y onto the normal n (used to lay shadows on slopes)
    function alignUp(n) {
        var Z = norm(cross([1, 0, 0], n));
        return basisMatrix(cross(n, Z), n, Z);
    }

    /* ----------------------------- geometry ----------------------------- */
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

    // rounded cylinder (y -1..1, radius <= 1): trunks, stems, posts
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

    function makeDisc(seg) { // flat unit disc in XZ (shadows, water)
        var v = [0, 0, 0, 0, 1, 0], idx = [];
        for (var i = 0; i <= seg; i++) {
            var a = i * 2 * Math.PI / seg;
            v.push(Math.cos(a), 0, Math.sin(a), 0, 1, 0);
        }
        for (var j = 0; j < seg; j++) idx.push(0, j + 1, j + 2);
        return { vertices: v, indices: idx };
    }

    function makeBox() { // unit cube (-1..1) with flat normals
        var v = [], idx = [];
        var N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
        for (var f = 0; f < 6; f++) {
            var n = N[f];
            var a = n[1] !== 0 ? [1, 0, 0] : [0, 1, 0];
            var b = cross(n, a);
            var base = v.length / 6;
            [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) {
                v.push(n[0] + a[0] * c[0] + b[0] * c[1], n[1] + a[1] * c[0] + b[1] * c[1],
                       n[2] + a[2] * c[0] + b[2] * c[1], n[0], n[1], n[2]);
            });
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
        return { vertices: v, indices: idx };
    }

    // tube around a polyline of 3D points (vines)
    function tubeAlong(pts, radiusFn, seg) {
        var n = pts.length, v = [], N = null, i, j;
        for (i = 0; i < n; i++) {
            var a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
            var T = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
            if (!N) N = norm(cross(Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], T));
            else {
                var d = N[0] * T[0] + N[1] * T[1] + N[2] * T[2];
                N = norm([N[0] - d * T[0], N[1] - d * T[1], N[2] - d * T[2]]);
            }
            var B = cross(T, N), r = radiusFn(i / (n - 1)), p = pts[i];
            for (j = 0; j <= seg; j++) {
                var ang = j * 2 * Math.PI / seg, c = Math.cos(ang), s = Math.sin(ang);
                var nx = c * N[0] + s * B[0], ny = c * N[1] + s * B[1], nz = c * N[2] + s * B[2];
                v.push(p[0] + r * nx, p[1] + r * ny, p[2] + r * nz, nx, ny, nz);
            }
        }
        return { vertices: v, indices: gridIndices(n, seg) };
    }

    function bez(P, t) {
        var u = 1 - t;
        return [0, 1, 2].map(function (k) {
            return u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k];
        });
    }

    /* ----------------------------- shaders ----------------------------- */
    // uMode: 0 lit | 1 terrain | 2 sky | 3 flat colour | 4 blob shadow
    //        5 waterfall | 6 pond water | 9 lit + trunk stripes
    var VS = [
        "attribute vec3 position;",
        "attribute vec3 normal;",
        "attribute float aShade;",          // baked light (terrain) / flow coord (waterfall); constant 1 elsewhere
        "uniform mat4 Pmatrix, Vmatrix;",
        "uniform vec3 uOffset, uScale;",
        "uniform mat4 uLocalRotation;",
        "uniform float uWS;",                // world scale (1 for sky / clouds)
        "varying vec3 vWN;",
        "varying vec3 vWorld;",              // design-space position (patterns, pond, AO)
        "varying vec3 vPosW;",               // real world-space position (view vector)
        "varying vec3 vLocal;",
        "varying float vDist;",
        "varying float vShade;",
        "void main(void) {",
        "    vec3 p = (uLocalRotation * vec4(position * uScale, 1.0)).xyz + uOffset;",
        "    vec3 pw = vec3(p.x * uWS, -2.1 + (p.y + 2.1) * uWS, p.z * uWS);",   // scale around Kuromi's feet
        "    vec4 clip = Pmatrix * Vmatrix * vec4(pw, 1.0);",
        "    gl_Position = clip;",
        "    vDist = clip.w;",
        "    vWorld = p;",
        "    vPosW = pw;",
        "    vLocal = position;",
        "    vWN = normalize((uLocalRotation * vec4(normalize(normal / uScale), 0.0)).xyz);",
        "    vShade = aShade;",
        "}"
    ].join("\n");

    var FS = [
        "#ifdef GL_FRAGMENT_PRECISION_HIGH",
        "precision highp float;",
        "#else",
        "precision mediump float;",
        "#endif",
        "uniform vec3 uColor;",
        "uniform float uMode;",
        "uniform float uTime;",
        "uniform vec3 uLight;",
        "uniform vec3 uCam;",
        "varying vec3 vPosW;",
        "uniform vec2 uAO;",                 // x = base height, y = 1/height (0 = off)
        "varying vec3 vWN;",
        "varying vec3 vWorld;",
        "varying vec3 vLocal;",
        "varying float vDist;",
        "varying float vShade;",
        "const vec3 HORIZON = vec3(0.80, 0.93, 1.0);",
        "const vec2 POND = vec2(15.0, -8.5);",
        "float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
        "float vnoise(vec2 p) {",
        "    vec2 i = floor(p); vec2 f = fract(p);",
        "    f = f * f * (3.0 - 2.0 * f);",
        "    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),",
        "               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);",
        "}",
        "vec3 fogged(vec3 c) { return mix(c, HORIZON, smoothstep(150.0, 520.0, vDist)); }",
        "void main(void) {",
        "    float mode = uMode;",
        "    vec3 V = normalize(uCam - vPosW);",
        /* ---- sky ---- */
        "    if (mode > 1.5 && mode < 2.5) {",
        "        vec3 d = normalize(vWorld - uCam);",
        "        float t = clamp(d.y * 1.7, 0.0, 1.0);",
        "        vec3 c = mix(HORIZON, vec3(0.14, 0.58, 0.97), pow(t, 0.55));",
        "        float sd = max(dot(d, uLight), 0.0);",
        "        c += vec3(1.0, 0.92, 0.65) * pow(sd, 20.0) * 0.30;",
        "        c = mix(c, vec3(1.0, 0.98, 0.86), smoothstep(0.9982, 0.9992, sd));",
        "        gl_FragColor = vec4(c, 1.0);",
        "        return;",
        "    }",
        /* ---- flat colour ---- */
        "    if (mode > 2.5 && mode < 3.5) { gl_FragColor = vec4(uColor, 1.0); return; }",
        /* ---- blob shadow ---- */
        "    if (mode > 3.5 && mode < 4.5) {",
        "        float r = length(vLocal.xz);",
        "        float a = (1.0 - smoothstep(0.30, 1.0, r)) * 0.40;",
        "        gl_FragColor = vec4(0.16, 0.18, 0.42, a);",
        "        return;",
        "    }",
        /* ---- pond water ---- */
        "    if (mode > 5.5 && mode < 6.5) {",
        "        vec2 p = vWorld.xz;",
        "        vec3 N = normalize(vec3(0.07 * sin(p.x * 1.7 + uTime * 1.3) + 0.04 * sin(p.y * 3.1 - uTime * 1.9), 1.0,",
        "                                0.07 * sin(p.y * 1.5 - uTime * 1.1) + 0.04 * sin(p.x * 2.9 + uTime * 1.7)));",
        "        float d = length(p - POND);",
        "        vec3 col = mix(vec3(0.07, 0.60, 0.72), vec3(0.44, 0.91, 0.88), smoothstep(2.5, 8.0, d));",
        "        float ring = smoothstep(0.90, 1.0, sin((d - uTime * 0.35) * 3.2)) * 0.14 * smoothstep(4.5, 8.0, d);",
        "        col += vec3(ring);",
        "        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);",
        "        col = mix(col, vec3(0.78, 0.92, 1.0), fres * 0.5);",
        "        vec3 H = normalize(uLight + V);",
        "        col += vec3(1.0, 0.97, 0.88) * pow(max(dot(N, H), 0.0), 110.0) * 0.9;",
        "        gl_FragColor = vec4(fogged(col), 1.0);",
        "        return;",
        "    }",
        /* ---- waterfall ---- */
        "    if (mode > 4.5 && mode < 5.5) {",
        "        float w1 = sin(vWorld.x * 3.0 + vWorld.z * 2.4 + vShade * 0.9 - uTime * 3.5) * 0.5 + 0.5;",
        "        float w2 = sin(vShade * 1.7 - uTime * 2.8 + sin(vWorld.x * 1.7 + vWorld.z * 1.3) * 1.6) * 0.5 + 0.5;",
        "        vec3 c = mix(vec3(0.52, 0.85, 0.97), vec3(0.97, 1.0, 1.0), smoothstep(0.35, 0.95, w1 * 0.45 + w2 * 0.65));",
        "        float nd = dot(normalize(vWN), uLight) * 0.5 + 0.5;",
        "        c *= 0.80 + 0.24 * nd;",
        "        float rim = pow(1.0 - max(dot(normalize(vWN), V), 0.0), 3.0);",
        "        c += vec3(0.10) * rim;",
        "        gl_FragColor = vec4(fogged(c), 1.0);",
        "        return;",
        "    }",
        /* ---- surfaces with lighting ---- */
        "    vec3 N = normalize(vWN);",
        "    vec3 base = uColor;",
        "    if (mode > 0.5 && mode < 1.5) {",
        "        vec2 p = vWorld.xz;",
        "        float n = sin(p.x * 0.7) * sin(p.y * 0.7) + 0.5 * sin(p.x * 0.23 + p.y * 0.31);",
        "        vec3 grass = mix(uColor * 0.84, uColor * 1.08, smoothstep(-0.6, 0.8, n));",
        "        grass *= 0.90 + 0.20 * vnoise(p * 0.11);",
        // tiny white / pink clover flowers sprinkled on the grass
        "        vec2 gp = p * 1.6; vec2 id = floor(gp); vec2 f = fract(gp) - 0.5;",
        "        float hh = hash(id);",
        "        vec2 off = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;",
        "        float spot = (1.0 - smoothstep(0.05, 0.11, length(f - off * 0.6))) * step(0.90, hh) * (1.0 - smoothstep(25.0, 60.0, vDist));",
        "        grass = mix(grass, mix(vec3(1.0, 0.98, 0.9), vec3(1.0, 0.78, 0.88), step(0.95, hh)), spot * 0.9);",
        // mossy stone bricks on steep slopes
        "        float rad = length(p);",
        "        float stone = (1.0 - smoothstep(0.62, 0.86, N.y)) * (1.0 - smoothstep(90.0, 102.0, rad));",
        "        vec3 stoneC = grass;",
        "        if (stone > 0.01) {",
        "            float rowH = 0.85; float bw = 1.7;",
        "            float row = floor(vWorld.y / rowH);",
        "            vec2 td = normalize(vec2(-N.z, N.x) + vec2(0.0001));",
        "            float s = dot(p, td);",
        "            float sc = (s + mod(row, 2.0) * bw * 0.5) / bw;",
        "            vec2 cell = vec2(floor(sc), row);",
        "            float u = fract(sc); float v = fract(vWorld.y / rowH);",
        "            float edge = min(min(u, 1.0 - u) * bw, min(v, 1.0 - v) * rowH);",
        "            float mortar = (1.0 - smoothstep(0.03, 0.10, edge)) * (1.0 - smoothstep(60.0, 150.0, vDist));",
        "            float h1 = hash(cell);",
        "            stoneC = mix(vec3(0.83, 0.70, 0.63), vec3(0.70, 0.60, 0.58), h1);",
        "            stoneC *= 1.0 - 0.30 * mortar;",
        "            float moss = smoothstep(0.50, 0.74, vnoise(vec2(s * 0.45, vWorld.y * 0.8)) + 0.28 * smoothstep(0.65, 1.0, v));",
        "            stoneC = mix(stoneC, vec3(0.42, 0.68, 0.24) * (0.85 + 0.3 * h1), moss * 0.9);",
        "        }",
        "        base = mix(grass, stoneC, stone);",
        // sandy bank around the pond
        "        float sand = (1.0 - smoothstep(-1.15, -0.95, vWorld.y)) * (1.0 - smoothstep(9.0, 11.0, length(p - POND)));",
        "        base = mix(base, vec3(0.95, 0.87, 0.62), sand * (1.0 - stone));",
        "    } else {",
        "        if (mode > 8.5) {",
        "            float ang = atan(vLocal.z, vLocal.x);",
        "            base *= 0.86 + 0.14 * sin(ang * 13.0);",
        "        }",
        "        if (uAO.y > 0.0) {",
        "            float a = smoothstep(0.0, 1.0, clamp((vWorld.y - uAO.x) * uAO.y, 0.0, 1.0));",
        "            base *= mix(vec3(0.78, 0.66, 0.86), vec3(1.0), a);",   // cool purple-ish occlusion
        "        }",
        "    }",
        "    float ndl = dot(N, uLight);",
        "    float ramp = smoothstep(0.30, 0.78, ndl * 0.5 + 0.5);",         // soft cel step
        "    float hemi = N.y * 0.5 + 0.5;",
        "    vec3 amb = mix(vec3(0.46, 0.50, 0.36), vec3(0.64, 0.76, 1.0), hemi);",
        "    float sh = vShade;",
        "    vec3 light = amb * 0.62 * (0.68 + 0.32 * sh) + vec3(1.0, 0.95, 0.84) * 0.62 * ramp * sh;",
        "    vec3 col = base * light * 1.10;",
        "    if (mode < 0.5 || mode > 8.5) {",
        "        vec3 H = normalize(uLight + V);",
        "        col += vec3(0.16) * pow(max(dot(N, H), 0.0), 40.0) * ramp * sh;",
        "        col += vec3(1.0, 0.9, 1.0) * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.14 * (0.4 + 0.6 * hemi);",
        "    }",
        "    gl_FragColor = vec4(fogged(col), 1.0);",
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
    GL.bindAttribLocation(prog, 3, "aShade");
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
    var uTime = GL.getUniformLocation(prog, "uTime");
    var uLightLoc = GL.getUniformLocation(prog, "uLight");
    var uCam = GL.getUniformLocation(prog, "uCam");
    var uAOloc = GL.getUniformLocation(prog, "uAO");
    var uWSloc = GL.getUniformLocation(prog, "uWS");

    var IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    function makeMesh(data) {
        var vb = GL.createBuffer(), ib = GL.createBuffer();
        GL.bindBuffer(GL.ARRAY_BUFFER, vb);
        GL.bufferData(GL.ARRAY_BUFFER, new Float32Array(data.vertices), GL.STATIC_DRAW);
        GL.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, ib);
        GL.bufferData(GL.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.indices), GL.STATIC_DRAW);
        return { vb: vb, ib: ib, count: data.indices.length, st: (data.stride || 6) * 4 };
    }

    // rot: null | [rx, ry, rz] (Euler) | array 16 (rotation matrix)
    var lastMesh = null, lastRot = null, lastMode = -1;
    function draw(mesh, pos, scale, color, rot, mode) {
        if (mesh !== lastMesh) {
            GL.bindBuffer(GL.ARRAY_BUFFER, mesh.vb);
            GL.vertexAttribPointer(0, 3, GL.FLOAT, false, mesh.st, 0);
            GL.vertexAttribPointer(1, 3, GL.FLOAT, false, mesh.st, 12);
            if (mesh.st === 28) {
                GL.enableVertexAttribArray(3);
                GL.vertexAttribPointer(3, 1, GL.FLOAT, false, 28, 24);
            } else {
                GL.disableVertexAttribArray(3);
                GL.vertexAttrib1f(3, 1.0);
            }
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

    // height-based occlusion for the next draws (base height, height). (0,0) = off
    var curAOb = 1e9, curAOh = -1;
    function setAO(b, h) {
        var inv = h > 0 ? 1 / h : 0;
        if (b !== curAOb || inv !== curAOh) { GL.uniform2f(uAOloc, b, inv); curAOb = b; curAOh = inv; }
    }

    /* ------------------------------ light ------------------------------ */
    var LIGHT = norm([-0.60, 0.60, 0.55]);                       // direction TOWARD the sun (world space)
    var LH = norm([LIGHT[0], 0, LIGHT[2]]);                      // horizontal part

    /* ----------------------------- terrain ----------------------------- */
    var GROUND_Y = -2.1;      // Kuromi's feet
    // WORLD SCALE: the whole environment is authored in "design units" and enlarged by this factor
    // around Kuromi's feet. Raise it to make everything bigger relative to the character.
    var WS = 2.5;
    var FLOWER_SCALE = 0.55;   // size of wild flowers + tulips (1 = previous size)
    var WATER_Y = -1.45;
    var POND = { x: 15, z: -8.5 }, POND_D = 2.8;
    function PR(a) { return 7.0 + 0.7 * Math.sin(3 * a + 1.0); }  // wobbly pond radius

    // terraces (stone-brick cliffs): centre radius wobbles with angle
    var RINGS = [
        { C: 32, a1: 3.2, k1: 3, p1: 0.4, a2: 1.6, k2: 5, p2: 1.0, w: 4.6, R: 4.6 },
        { C: 54, a1: 3.6, k1: 2, p1: 2.2, a2: 1.8, k2: 4, p2: 0.3, w: 5.2, R: 6.0 },
        { C: 78, a1: 4.0, k1: 3, p1: 4.0, a2: 2.0, k2: 6, p2: 1.2, w: 6.0, R: 7.5 }
    ];
    function ringC(R, th) { return R.C + R.a1 * Math.sin(R.k1 * th + R.p1) + R.a2 * Math.cos(R.k2 * th + R.p2); }

    function groundH(x, z) {
        var r = Math.hypot(x, z), th = Math.atan2(z, x);
        var k = smooth01((r - 5) / 11);
        var bumps = 0.5 * Math.sin(x * 0.17 + 1.0) * Math.cos(z * 0.13)
                  + 0.25 * Math.sin(x * 0.41 + z * 0.23) * Math.sin(z * 0.37);
        var dx = x - POND.x, dz = z - POND.z, d = Math.hypot(dx, dz);
        var pr = PR(Math.atan2(dz, dx));
        var m = 1 - smooth01((d - (pr + 3)) / 5);                // keep the pond surroundings flat
        var meadow = k * (1.2 + bumps) * (1 - m) + 1.2 * m;
        var dip = POND_D * (1 - smooth01((d - (pr - 1.5)) / 4));
        var h = GROUND_Y + meadow - dip;
        for (var i = 0; i < RINGS.length; i++) {
            var Rg = RINGS[i];
            h += Rg.R * smooth01((r - ringC(Rg, th)) / Rg.w + 0.5);
        }
        return h + smooth01((r - 94) / 50) * 40;                  // distant hills
    }

    function groundNormal(x, z) {
        var e = 0.4;
        var gx = groundH(x - e, z) - groundH(x + e, z);
        var gz = groundH(x, z - e) - groundH(x, z + e);
        var l = Math.hypot(gx, 2 * e, gz);
        return [gx / l, 2 * e / l, gz / l];
    }

    // terrain mesh: pos(3) normal(3) baked-shade(1). Sun shadows + AO are baked per vertex.
    function buildGround() {
        var GN = 200, X0 = -130, X1 = 130, step = (X1 - X0) / GN, W = GN + 1;
        var hg = new Float32Array(W * W), i, j;
        for (i = 0; i <= GN; i++) for (j = 0; j <= GN; j++) hg[i * W + j] = groundH(X0 + j * step, X0 + i * step);
        function hAt(x, z) {
            var fx = clamp((x - X0) / step, 0, GN - 0.001), fz = clamp((z - X0) / step, 0, GN - 0.001);
            var ix = Math.floor(fx), iz = Math.floor(fz), ax = fx - ix, az = fz - iz;
            var a = hg[iz * W + ix], b = hg[iz * W + ix + 1], c = hg[(iz + 1) * W + ix], d = hg[(iz + 1) * W + ix + 1];
            return (a * (1 - ax) + b * ax) * (1 - az) + (c * (1 - ax) + d * ax) * az;
        }
        var slope = LIGHT[1] / Math.hypot(LIGHT[0], LIGHT[2]);
        var v = [];
        for (i = 0; i <= GN; i++) {
            var z = X0 + i * step;
            for (j = 0; j <= GN; j++) {
                var x = X0 + j * step, h = hg[i * W + j];
                var sh = 1, t;
                for (t = 1.5; t <= 30; t += 1.5) {                        // march toward the sun
                    var occ = hAt(x + LH[0] * t, z + LH[2] * t) - (h + t * slope) - 0.2;
                    sh = Math.min(sh, 1 - clamp(occ / 2.0, 0, 1));
                }
                var o2 = 0;
                for (var a = 0; a < 8; a++) {                              // cheap concavity AO
                    var ca = Math.cos(a * Math.PI / 4), sa = Math.sin(a * Math.PI / 4);
                    o2 += Math.max(0, hAt(x + ca * 3, z + sa * 3) - h - 0.5)
                        + 0.5 * Math.max(0, hAt(x + ca * 6, z + sa * 6) - h - 1.5);
                }
                var n = groundNormal(x, z);
                v.push(x, h, z, n[0], n[1], n[2], clamp(sh * (1 - clamp(o2 * 0.07, 0, 0.55)), 0, 1));
            }
        }
        return { vertices: v, indices: gridIndices(GN + 1, GN), stride: 7 };
    }

    /* ----------------------------- meshes ----------------------------- */
    var sphere = makeMesh(makeSphere(1, 20, 20));
    var cone = makeMesh(makeCone(1, 2, 16));
    var pill = makeMesh(makePill(20, 16));
    var disc = makeMesh(makeDisc(32));
    var box = makeMesh(makeBox());
    var groundMesh = makeMesh(buildGround());

    /* ----------------------------- palette ----------------------------- */
    var WHITE = [0.97, 0.97, 0.97];
    var GRASS = [0.50, 0.84, 0.22], GRASS_L = [0.62, 0.90, 0.30], GRASS_D = [0.40, 0.76, 0.24];
    var STEM = [0.30, 0.68, 0.25], LEAF = [0.35, 0.75, 0.28], YELLOW = [1.0, 0.85, 0.2];
    var TRUNK = [0.80, 0.42, 0.21];
    var PINK_L = [1.0, 0.70, 0.83], PINK_M = [0.97, 0.55, 0.74], PINK_D = [0.90, 0.42, 0.66];
    var BUSH_D = [0.24, 0.62, 0.30], BUSH_L = [0.46, 0.82, 0.34];
    var VINE = [0.17, 0.50, 0.27];
    var ROCK_D = [0.66, 0.66, 0.73], ROCK_M = [0.74, 0.75, 0.81], ROCK_L = [0.84, 0.86, 0.91];
    var WOOD = [0.80, 0.50, 0.26], WOOD_L = [0.88, 0.60, 0.33], SOIL = [0.47, 0.30, 0.20];
    var FOAM = [0.95, 0.99, 1.0], LILY = [0.34, 0.74, 0.34];
    var RED = [0.92, 0.12, 0.14], PNK = [0.98, 0.52, 0.72], YEL = [1.0, 0.86, 0.25], ORG = [1.0, 0.55, 0.12];
    var FLOWER_COLORS = [RED, RED, PNK, [0.96, 0.38, 0.62], YEL, WHITE];

    /* -------------------- scene data (fixed random seed) -------------------- */
    var seed = 11;
    function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    function spot(r0, r1, bias) {
        var r = r0 + (r1 - r0) * Math.pow(rnd(), bias || 1);
        var a = rnd() * 2 * Math.PI;
        return [r * Math.cos(a), r * Math.sin(a)];
    }

    var BED1 = { x: -8, z: 5 }, BED2 = { x: -3, z: -10 }, PLOT = { x: 6, z: 12 };
    var EXCL = [[BED1.x, BED1.z, 5.5], [BED2.x, BED2.z, 5.5], [PLOT.x, PLOT.z, 6.5]];  // [x, z, radius] keep-out circles

    // is (x,z) a good place for decoration? (flat, not on Kuromi / pond / beds / waterfalls)
    function okSpot(x, z, m) {
        if (Math.hypot(x, z) < 2.4 + m) return false;
        var pd = Math.hypot(x - POND.x, z - POND.z);
        if (pd < PR(Math.atan2(z - POND.z, x - POND.x)) + 2.5 + m) return false;
        for (var q = 0; q < EXCL.length; q++)
            if (Math.hypot(x - EXCL[q][0], z - EXCL[q][1]) < EXCL[q][2] + m) return false;
        return groundNormal(x, z)[1] > 0.975;
    }
    function scatter(n, r0, r1, bias, margin, minSep, list, make) {
        var tries = 0;
        while (list.length < n && tries++ < n * 40) {
            var p = spot(r0, r1, bias);
            if (!okSpot(p[0], p[1], margin)) continue;
            if (minSep) {
                var bad = false;
                for (var q = 0; q < list.length; q++)
                    if (Math.hypot(list[q].x - p[0], list[q].z - p[1]) < minSep) { bad = true; break; }
                if (bad) continue;
            }
            list.push(make(p[0], p[1]));
        }
    }

    /* ---- blob shadows laid on the slope ---- */
    var shadows = [];
    function addShadow(x, z, r, h) {
        var px = x - LH[0] * h * 0.35, pz = z - LH[2] * h * 0.35;
        shadows.push({ p: [px, groundH(px, pz) + 0.05, pz], s: [r, 1, r * 0.9], rot: alignUp(groundNormal(px, pz)), r: r });
    }

    /* ---- waterfalls: strips that follow the terrain exactly ---- */
    var waterfallMeshes = [], foams = [];
    function buildWaterfall(R, th) {
        var ct = Math.cos(th), st = Math.sin(th);
        var c = ringC(R, th), rTop = c + R.w * 0.5 + 1.4, rBot = c - R.w * 0.5 - 1.0;
        var NR = 22, NC = 6, hw = 1.9, v = [], s = 0, prev = null, i, j;
        for (i = 0; i <= NR; i++) {
            var r = rTop + (rBot - rTop) * i / NR;
            var cx = ct * r, cz = st * r, cy = groundH(cx, cz) + 0.16;
            if (prev) s += Math.hypot(cx - prev[0], cy - prev[1], cz - prev[2]);
            prev = [cx, cy, cz];
            for (j = 0; j <= NC; j++) {
                var u = (j / NC - 0.5) * 2 * hw * (1 + 0.25 * i / NR);
                var x = ct * r - st * u, z = st * r + ct * u;
                var n = groundNormal(x, z);
                v.push(x, groundH(x, z) + 0.16, z, n[0], n[1], n[2], s);
            }
        }
        waterfallMeshes.push(makeMesh({ vertices: v, indices: gridIndices(NR + 1, NC), stride: 7 }));
        var fx = ct * (rBot - 0.3), fz = st * (rBot - 0.3);
        foams.push({ x: fx, y: groundH(fx, fz) + 0.1, z: fz, ph: rnd() * 6 });
        EXCL.push([fx, fz, 5], [ct * rTop, st * rTop, 3.5]);
    }
    [[0, -0.515], [0, 1.9], [0, 3.9], [1, 0.5], [1, 2.6], [1, 4.8], [2, 1.2], [2, 3.4], [2, 5.5]].forEach(function (w) {
        buildWaterfall(RINGS[w[0]], w[1]);
    });

    /* ---- climbing vines on the cliff faces ---- */
    var vineMeshes = [], vineLeaves = [];
    function buildVine(R, th) {
        var ct = Math.cos(th), st = Math.sin(th);
        var c = ringC(R, th), rb = c - R.w * 0.5 - 0.6, rt = c + R.w * 0.5 + 0.4, n = 26, ph = rnd() * 6, pts = [], k;
        for (k = 0; k <= n; k++) {
            var t = k / n, r = rb + (rt - rb) * t, u = Math.sin(t * 7 + ph) * 0.9;
            var x = ct * r - st * u, z = st * r + ct * u;
            pts.push([x, groundH(x, z) + 0.22, z]);
        }
        vineMeshes.push(makeMesh(tubeAlong(pts, function (t) { return 0.16 * (1 - 0.55 * t); }, 6)));
        for (k = 2; k < n; k += 2) {
            var sd = (k % 4 === 0) ? 1 : -1, p = pts[k];
            vineLeaves.push({
                p: [p[0] - st * 0.22 * sd, p[1] + 0.05, p[2] + ct * 0.22 * sd],
                s: 0.30 + rnd() * 0.2, rot: rotationMatrix(0, rnd() * 3.14, sd * 0.5),
                c: rnd() < 0.5 ? [0.30, 0.68, 0.26] : [0.44, 0.80, 0.30]
            });
        }
    }
    [[0, 0.9], [0, 2.9], [0, 4.2], [0, 5.6], [1, 0.2], [1, 1.5], [1, 3.1], [1, 5.1], [2, 0.7], [2, 2.2], [2, 4.0], [2, 5.9]]
        .forEach(function (w) { buildVine(RINGS[w[0]], w[1]); });

    // free-standing vines: corkscrew + arch
    var spiralPts = [], archPts = [], q;
    for (q = 0; q <= 40; q++) {
        var tt = q / 40, ang = tt * 4 * Math.PI;
        spiralPts.push([0.45 * (1 - 0.4 * tt) * Math.cos(ang), tt * 6.5, 0.45 * (1 - 0.4 * tt) * Math.sin(ang)]);
    }
    for (q = 0; q <= 24; q++) archPts.push(bez([[0, 0, 0], [0, 3.2, 0], [3.6, 3.2, 0], [3.6, 0, 0]], q / 24));
    var spiralMesh = makeMesh(tubeAlong(spiralPts, function (t) { return 0.05 + 0.22 * (1 - 0.65 * t); }, 8));
    var archMesh = makeMesh(tubeAlong(archPts, function (t) { return 0.24 * (0.55 + 0.45 * Math.sin(Math.PI * t)); }, 8));

    /* ---- decoration lists ---- */
    var flowers = [], tulips = [], tufts = [], mushrooms = [], stacks = [], rocks = [];
    var bigTrees = [], smallTrees = [], domes = [], bushes = [], spirals = [], arches = [], crops = [];

    // tulip beds (rows of different colours)
    function makeBed(cx, cz, cols, rows, dx, dz, colors) {
        for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
            var x = cx + (c - (cols - 1) / 2) * dx + (rnd() - 0.5) * 0.12;
            var z = cz + (r - (rows - 1) / 2) * dz + (rnd() - 0.5) * 0.12;
            tulips.push({ x: x, y: groundH(x, z), z: z, s: (0.9 + rnd() * 0.35) * FLOWER_SCALE, c: colors[r % colors.length], ph: rnd() * 6.28 });
        }
    }
    makeBed(BED1.x, BED1.z, 11, 4, 0.5, 0.65, [RED, YEL, ORG, PNK]);
    makeBed(BED2.x, BED2.z, 11, 4, 0.5, 0.65, [YEL, RED, WHITE, ORG]);

    // crop plot
    var PLOT_Y = groundH(PLOT.x, PLOT.z);
    for (var cr = 0; cr < 4; cr++) for (var cc = 0; cc < 6; cc++) {
        crops.push({ x: PLOT.x + (cc - 2.5) * 1.2, y: PLOT_Y + 0.5, z: PLOT.z + (cr - 1.5) * 1.15,
                     s: 0.85 + rnd() * 0.3, white: (cr + cc) % 3 === 0 });
    }

    scatter(240, 2.4, 34, 1.2, 0, 0, flowers, function (x, z) {
        return { x: x, z: z, y: groundH(x, z), s: (0.8 + rnd() * 0.7) * FLOWER_SCALE,
                 c: FLOWER_COLORS[Math.floor(rnd() * FLOWER_COLORS.length)], ph: rnd() * 6.28 };
    });
    scatter(520, 2.4, 55, 1.1, 0, 0, tufts, function (x, z) {
        return { x: x, z: z, y: groundH(x, z), s: 0.7 + rnd() * 0.9, c: rnd() < 0.5 ? GRASS_L : GRASS_D };
    });
    scatter(12, 3, 40, 1.1, 0, 0, mushrooms, function (x, z) {
        var o = { x: x, z: z, y: groundH(x, z), s: 0.8 + rnd() * 0.6 };
        addShadow(x, z, 0.4 * o.s, 0.5);
        return o;
    });
    scatter(6, 4.5, 30, 1, 1, 6, stacks, function (x, z) {
        var o = { x: x, z: z, y: groundH(x, z), s: 0.9 + rnd() * 0.7, rot: rotationMatrix(0, rnd() * 6, 0) };
        addShadow(x, z, 1.1 * o.s, 2 * o.s);
        return o;
    });
    scatter(14, 3, 60, 1.1, 0, 0, rocks, function (x, z) {
        var o = { x: x, z: z, y: groundH(x, z), s: 0.6 + rnd() * 0.9, rot: rotationMatrix(0, rnd() * 6, 0) };
        addShadow(x, z, 0.7 * o.s, 0.5);
        return o;
    });
    scatter(36, 36, 96, 1, 2, 15, bigTrees, function (x, z) {        // giant pink trees on the terraces
        var s = 0.9 + rnd() * 0.6, o = { x: x, z: z, y: groundH(x, z), s: s, H: 9 * s, rad: 1.5 * s, R: 7.5 * s, ph: rnd() * 6.28 };
        addShadow(x, z, 0.95 * o.R, o.H + o.R * 0.3);
        return o;
    });
    scatter(10, 6, 28, 1, 1, 7, smallTrees, function (x, z) {        // small meadow trees
        var s = 0.85 + rnd() * 0.5, o = { x: x, z: z, y: groundH(x, z), s: s, H: 2.8 * s, rad: 0.5 * s, R: 2.4 * s, ph: rnd() * 6.28 };
        addShadow(x, z, 0.95 * o.R, o.H);
        return o;
    });
    scatter(9, 5, 34, 1, 1, 4, domes, function (x, z) {              // pink scalloped dome bushes
        var o = { x: x, z: z, y: groundH(x, z), R: 1.2 + rnd() * 1.1, ph: rnd() * 6.28 };
        addShadow(x, z, 1.0 * o.R, o.R);
        return o;
    });
    scatter(20, 4, 60, 1, 0, 3, bushes, function (x, z) {
        var o = { x: x, z: z, y: groundH(x, z), s: 0.8 + rnd() * 0.7 };
        addShadow(x, z, 1.1 * o.s, 0.9 * o.s);
        return o;
    });
    scatter(5, 6, 30, 1, 1, 6, spirals, function (x, z) {
        return { x: x, z: z, y: groundH(x, z), s: 0.8 + rnd() * 0.5 };
    });
    scatter(6, 5, 34, 1, 2, 7, arches, function (x, z) {
        var s = 0.8 + rnd() * 0.6;
        return { x: x, z: z, y: groundH(x, z), s: s, rot: rotationMatrix(0, rnd() * 6.28, 0) };
    });

    // lily pads on the pond
    var pads = [];
    for (q = 0; q < 7; q++) {
        var pa = rnd() * 6.28, pd = 1 + rnd() * 4.2;
        pads.push({ x: POND.x + Math.cos(pa) * pd, z: POND.z + Math.sin(pa) * pd, s: 0.5 + rnd() * 0.35, ph: rnd() * 6, flower: q % 3 === 0 });
    }

    // curvy wooden fence: a wavy line of chunky posts joined by round rails that
    // arch (top) and sag (bottom) between the posts, all following the terrain
    function crom(p0, p1, p2, p3, t) { // Catmull-Rom
        var t2 = t * t, t3 = t2 * t;
        return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    }
    function buildFence(x0, z0, x1, z1, n, amp, phase) {
        var dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), px = -dz / len, pz = dx / len;
        var posts = [], meshes = [], k;
        for (k = 0; k <= n; k++) {
            var t = k / n, u = amp * Math.sin(t * Math.PI * 3 + phase);
            var x = x0 + dx * t + px * u, z = z0 + dz * t + pz * u;
            posts.push({ x: x, y: groundH(x, z), z: z, h: 0.95 + 0.2 * rnd() });
        }
        [{ h: 0.84, a: 0.14 }].forEach(function (lv) {
            var pts = [], i, j, M = 10;
            for (i = 0; i < n; i++) {
                var q0 = posts[Math.max(0, i - 1)], q1 = posts[i], q2 = posts[i + 1], q3 = posts[Math.min(n, i + 2)];
                for (j = 0; j < M; j++) {
                    var f = j / M, x = crom(q0.x, q1.x, q2.x, q3.x, f), z = crom(q0.z, q1.z, q2.z, q3.z, f);
                    pts.push([x, groundH(x, z) + lv.h + lv.a * Math.sin(Math.PI * f), z]);
                }
            }
            var e = posts[n];
            pts.push([e.x, e.y + lv.h, e.z]);
            meshes.push(makeMesh(tubeAlong(pts, function () { return 0.085; }, 7)));
        });
        return { posts: posts, meshes: meshes, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
    }
    var fences = [buildFence(-12, 1, -12, 12, 7, 0.8, 0), buildFence(0.5, 7, 0.5, 18, 7, 0.8, 1.5), buildFence(-8, -16, 3, -17, 6, 0.7, 3)];

    // [centre x, centre z, radius, speed, phase, colour]
    var butterflies = [
        [-5, -2, 3.5, 0.7, 0, [0.98, 0.55, 0.80]], [7, -7, 4.0, 0.55, 2, [0.70, 0.55, 1.00]],
        [-13, -10, 5.0, 0.5, 4, [1.0, 0.80, 0.30]], [6, 4, 2.5, 0.9, 1, [0.60, 0.85, 1.00]],
        [12, 14, 4.5, 0.6, 3, [0.98, 0.55, 0.80]], [-10, 12, 3.5, 0.8, 5, [0.60, 0.85, 1.00]],
        [-18, -4, 4.0, 0.65, 2.5, [1.0, 0.80, 0.30]], [16, -2, 3.0, 0.75, 0.7, [0.70, 0.55, 1.00]]
    ];

    // [azimuth deg, distance, height, scale]
    var clouds = [[-35, 95, 38, 7], [10, 110, 50, 8], [40, 90, 34, 6.5], [75, 100, 42, 7.5], [120, 95, 36, 7],
                  [160, 105, 50, 8], [-160, 100, 40, 7], [-120, 92, 33, 6], [-80, 100, 44, 8], [-10, 128, 64, 9]];

    /* --------------------------- camera culling --------------------------- */
    var CWX = 0, CWY = 0, CWZ = 0; // camera in real world units
    var EX = 0, EY = 0, EZ = 0, FX = 0, FY = 0, FZ = -1, COSH = 0.6;
    function vis(x, y, z, r, maxD) {
        var dx = x - EX, dy = y - EY, dz = z - EZ;
        var d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxD * maxD) return false;
        var d = Math.sqrt(d2);
        return dx * FX + dy * FY + dz * FZ > COSH * d - 2 * r;
    }

    /* ----------------------------- drawing ----------------------------- */
    var TILT = 0.9, cT = Math.cos(TILT), sT = Math.sin(TILT);
    var ROT_TILT = rotationMatrix(TILT, 0, 0), ROT_LEAF = rotationMatrix(0, 0, 0.5), ROT_LEAFN = rotationMatrix(0, 0, -0.5);
    var ROT_ZP = rotationMatrix(0, 0, 0.35), ROT_ZN = rotationMatrix(0, 0, -0.35);
    var ROT_XP = rotationMatrix(0.35, 0, 0), ROT_XN = rotationMatrix(-0.35, 0, 0);

    function drawFlower(f, t, near) {
        var s = f.s, h = 0.9 * s;
        draw(pill, [f.x, f.y + h * 0.5 - 0.05, f.z], [0.035 * s, h * 0.5, 0.035 * s], STEM);
        var cx = f.x + Math.sin(t * 1.6 + f.ph) * 0.05 * s, cy = f.y + h, cz = f.z;
        if (!near) { draw(sphere, [cx, cy, cz], [0.30 * s, 0.10 * s, 0.30 * s], f.c, ROT_TILT); return; }
        draw(sphere, [f.x + 0.12 * s, f.y + 0.28 * s, f.z], [0.14 * s, 0.04 * s, 0.07 * s], LEAF, ROT_LEAF);
        var R = 0.16 * s, pr = 0.13 * s;
        for (var k = 0; k < 5; k++) {
            var a = k * 2 * Math.PI / 5 + f.ph, u = Math.cos(a), v = Math.sin(a);
            draw(sphere, [cx + R * u, cy - R * v * sT, cz + R * v * cT], [pr, pr * 0.35, pr], f.c, ROT_TILT);
        }
        draw(sphere, [cx, cy + 0.04 * s * cT, cz + 0.04 * s * sT], [0.10 * s, 0.06 * s, 0.10 * s], YELLOW, ROT_TILT);
    }

    function drawTulip(f, t, near) {
        var s = f.s, sw = Math.sin(t * 1.4 + f.ph) * 0.02;
        draw(pill, [f.x, f.y + 0.34 * s, f.z], [0.025 * s, 0.36 * s, 0.025 * s], STEM);
        draw(sphere, [f.x + sw, f.y + 0.78 * s, f.z], [0.13 * s, 0.19 * s, 0.13 * s], f.c);
        if (near) {
            draw(sphere, [f.x + 0.12 * s, f.y + 0.22 * s, f.z], [0.16 * s, 0.03 * s, 0.06 * s], LEAF, ROT_LEAF);
            draw(sphere, [f.x - 0.10 * s, f.y + 0.20 * s, f.z], [0.16 * s, 0.03 * s, 0.06 * s], LEAF, ROT_LEAFN);
        }
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
        draw(pill, [m.x, m.y + 0.18 * s, m.z], [0.10 * s, 0.20 * s, 0.10 * s], [0.98, 0.93, 0.84]);
        setAO(m.y + 0.2 * s, 0.4 * s);
        draw(sphere, [m.x, m.y + 0.38 * s, m.z], [0.30 * s, 0.20 * s, 0.30 * s], [0.96, 0.46, 0.60]);
        setAO(0, 0);
        draw(sphere, [m.x, m.y + 0.585 * s, m.z], [0.06 * s, 0.03 * s, 0.06 * s], [1, 0.88, 0.92]);
        for (var k = 0; k < 5; k++) {
            var a = k * 2 * Math.PI / 5 + 0.5;
            draw(sphere, [m.x + 0.2 * s * Math.cos(a), m.y + 0.53 * s, m.z + 0.2 * s * Math.sin(a)],
                [0.055 * s, 0.055 * s, 0.055 * s], [1, 0.88, 0.92]);
        }
    }

    function drawStack(o) { // stacked pebble tower
        var s = o.s, x = o.x, y = o.y, z = o.z;
        setAO(y, 2.4 * s);
        draw(sphere, [x, y + 0.35 * s, z], [1.0 * s, 0.70 * s, 0.9 * s], ROCK_D, o.rot);
        draw(sphere, [x + 0.05 * s, y + 1.05 * s, z], [0.78 * s, 0.55 * s, 0.72 * s], ROCK_M, o.rot);
        draw(sphere, [x, y + 1.62 * s, z], [0.52 * s, 0.40 * s, 0.50 * s], ROCK_L, o.rot);
        draw(sphere, [x, y + 2.02 * s, z], [0.30 * s, 0.24 * s, 0.30 * s], ROCK_L, o.rot);
        setAO(0, 0);
    }

    function drawRock(r) {
        setAO(r.y, 0.8 * r.s);
        draw(sphere, [r.x, r.y + 0.1 * r.s, r.z], [0.5 * r.s, 0.3 * r.s, 0.4 * r.s], ROCK_M, r.rot);
        draw(sphere, [r.x + 0.45 * r.s, r.y + 0.02 * r.s, r.z + 0.2 * r.s], [0.25 * r.s, 0.17 * r.s, 0.22 * r.s], ROCK_L, r.rot);
        setAO(0, 0);
    }

    // pink scalloped canopy (the signature look): dome + frill of lobes + highlight cap
    function drawCanopy(x, cy, z, R, ph) {
        setAO(cy - 0.55 * R, 1.25 * R);
        draw(sphere, [x, cy + 0.05 * R, z], [R, R * 0.5, R], PINK_M);
        var k, a, N1 = 12, N2 = 7;
        for (k = 0; k < N1; k++) {
            a = k * 2 * Math.PI / N1 + ph;
            draw(sphere, [x + Math.cos(a) * 0.80 * R, cy - 0.22 * R, z + Math.sin(a) * 0.80 * R],
                [0.36 * R, 0.27 * R, 0.36 * R], PINK_D);
        }
        for (k = 0; k < N2; k++) {
            a = k * 2 * Math.PI / N2 + ph * 1.7;
            draw(sphere, [x + Math.cos(a) * 0.50 * R, cy + 0.20 * R, z + Math.sin(a) * 0.50 * R],
                [0.38 * R, 0.25 * R, 0.38 * R], PINK_M);
        }
        draw(sphere, [x, cy + 0.40 * R, z], [0.55 * R, 0.28 * R, 0.55 * R], PINK_L);
        setAO(0, 0);
    }

    function drawPinkTree(o) {
        setAO(o.y, o.H * 0.9);
        draw(pill, [o.x, o.y + o.H * 0.5 - 0.2, o.z], [o.rad, o.H * 0.5 + 0.2, o.rad], TRUNK, null, 9);
        draw(sphere, [o.x, o.y + 0.1, o.z], [o.rad * 1.5, o.rad * 0.55, o.rad * 1.5], TRUNK, null, 9);
        setAO(0, 0);
        drawCanopy(o.x, o.y + o.H + 0.2 * o.R, o.z, o.R, o.ph);
    }

    function drawDome(o) {
        var R = o.R, y = o.y;
        setAO(y, 1.2 * R);
        draw(sphere, [o.x, y + 0.15 * R, o.z], [R, 0.62 * R, R], PINK_M);
        for (var k = 0; k < 10; k++) {
            var a = k * 2 * Math.PI / 10 + o.ph;
            draw(sphere, [o.x + Math.cos(a) * 0.85 * R, y + 0.10 * R, o.z + Math.sin(a) * 0.85 * R],
                [0.30 * R, 0.20 * R, 0.30 * R], PINK_D);
        }
        draw(sphere, [o.x - 0.15 * R, y + 0.55 * R, o.z - 0.1 * R], [0.55 * R, 0.25 * R, 0.5 * R], PINK_L);
        setAO(0, 0);
    }

    function drawBush(o) {
        var x = o.x, z = o.z, s = o.s, y = o.y;
        setAO(y, 1.1 * s);
        draw(sphere, [x, y + 0.45 * s, z], [0.9 * s, 0.7 * s, 0.8 * s], BUSH_D);
        draw(sphere, [x - 0.7 * s, y + 0.35 * s, z + 0.1 * s], [0.65 * s, 0.55 * s, 0.6 * s], BUSH_L);
        draw(sphere, [x + 0.7 * s, y + 0.35 * s, z + 0.1 * s], [0.65 * s, 0.55 * s, 0.6 * s], BUSH_L);
        draw(sphere, [x, y + 0.35 * s, z - 0.6 * s], [0.6 * s, 0.5 * s, 0.55 * s], BUSH_L);
        setAO(0, 0);
    }

    function drawFence(f) {
        var k, p;
        for (k = 0; k < f.posts.length; k++) {
            p = f.posts[k];
            draw(pill, [p.x, p.y + 0.5 * p.h, p.z], [0.14, 0.55 * p.h, 0.14], WOOD);
            draw(sphere, [p.x, p.y + 1.05 * p.h, p.z], [0.19, 0.14, 0.19], WOOD_L);   // rounded cap
        }
        for (k = 0; k < f.meshes.length; k++) draw(f.meshes[k], [0, 0, 0], [1, 1, 1], WOOD_L);
    }

    function drawPlot() {
        var hx = 4.2, hz = 3.0, y = PLOT_Y;
        draw(box, [PLOT.x, y, PLOT.z], [hx, 0.5, hz], SOIL);
        draw(box, [PLOT.x, y + 0.05, PLOT.z - hz], [hx + 0.2, 0.6, 0.15], WOOD_L);
        draw(box, [PLOT.x, y + 0.05, PLOT.z + hz], [hx + 0.2, 0.6, 0.15], WOOD_L);
        draw(box, [PLOT.x - hx, y + 0.05, PLOT.z], [0.15, 0.6, hz], WOOD_L);
        draw(box, [PLOT.x + hx, y + 0.05, PLOT.z], [0.15, 0.6, hz], WOOD_L);
        setAO(y + 0.5, 0.6);
        for (var k = 0; k < crops.length; k++) {
            var c = crops[k], s = c.s;
            draw(sphere, [c.x, c.y + 0.12 * s, c.z], [0.30 * s, 0.22 * s, 0.30 * s], [0.42, 0.78, 0.30]);
            draw(sphere, [c.x, c.y + 0.26 * s, c.z], [0.14 * s, 0.12 * s, 0.14 * s], c.white ? WHITE : [0.70, 0.92, 0.50]);
        }
        setAO(0, 0);
    }

    function drawCloud(c, t) {
        var K = 2.8; // clouds are drawn unscaled (uWS = 1), so enlarge them here
        var az = c[0] * Math.PI / 180 + t * 0.0026, d = c[1] * K, s = c[3] * K;
        var x = d * Math.sin(az), z = -d * Math.cos(az), y = c[2] * K;
        var parts = [[0, 0.2, 0, 1.5], [-1.6, 0.0, 0.2, 1.15], [1.7, 0.0, 0.1, 1.2], [0.5, 0.9, 0, 1.3],
                     [-0.8, 0.8, 0.1, 1.05], [0.2, 0.2, 1.2, 1.0], [-0.3, 0.3, -1.1, 1.0]];
        setAO(y - 0.9 * s, 2.6 * s);
        draw(sphere, [x, y - 0.35 * s, z], [2.9 * s, 0.7 * s, 1.7 * s], [0.97, 0.98, 1.0]);   // flat belly
        for (var k = 0; k < parts.length; k++) {
            var q = parts[k];
            draw(sphere, [x + q[0] * s, y + q[1] * s, z + q[2] * s],
                [q[3] * s, q[3] * s * 0.8, q[3] * s * 0.9], [0.99, 0.995, 1.0]);
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

    /* ----------------------------- public API ----------------------------- */
    function renderScene(t) {
        var k, o, dd;

        // sky dome follows the camera, then clouds
        GL.uniform1f(uWSloc, 1.0);
        GL.depthMask(false);
        draw(sphere, [CWX, CWY, CWZ], [280, 280, 280], WHITE, null, 2);
        GL.depthMask(true);
        for (k = 0; k < clouds.length; k++) drawCloud(clouds[k], t);
        setAO(0, 0);
        GL.uniform1f(uWSloc, WS);          // everything below is enlarged by WS

        // terrain (grass + mossy brick cliffs, baked shadows)
        draw(groundMesh, [0, 0, 0], [1, 1, 1], GRASS, null, 1);

        // soft blob shadows (blended, no depth write)
        GL.enable(GL.BLEND);
        GL.blendFuncSeparate(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA, GL.ZERO, GL.ONE);
        GL.depthMask(false);
        GL.enable(GL.POLYGON_OFFSET_FILL);
        GL.polygonOffset(-2, -4);
        for (k = 0; k < shadows.length; k++) {
            o = shadows[k];
            if (vis(o.p[0], o.p[1], o.p[2], o.r, 150)) draw(disc, o.p, o.s, WHITE, o.rot, 4);
        }
        GL.disable(GL.POLYGON_OFFSET_FILL);
        GL.depthMask(true);
        GL.disable(GL.BLEND);

        // pond, lilies, waterfalls
        draw(disc, [POND.x, WATER_Y, POND.z], [10, 1, 10], WHITE, null, 6);
        for (k = 0; k < pads.length; k++) {
            o = pads[k];
            var py = WATER_Y + 0.05 + 0.015 * Math.sin(t * 1.3 + o.ph);
            draw(sphere, [o.x, py, o.z], [0.7 * o.s, 0.05, 0.7 * o.s], LILY);
            if (o.flower) draw(sphere, [o.x, py + 0.1, o.z], [0.16, 0.12, 0.16], PINK_M);
        }
        for (k = 0; k < waterfallMeshes.length; k++) draw(waterfallMeshes[k], [0, 0, 0], [1, 1, 1], WHITE, null, 5);
        for (k = 0; k < foams.length; k++) {
            o = foams[k];
            if (!vis(o.x, o.y, o.z, 3, 130)) continue;
            var fs = 1 + 0.12 * Math.sin(t * 3 + o.ph);
            draw(sphere, [o.x, o.y + 0.15, o.z], [1.7 * fs, 0.55, 1.7 * fs], FOAM);
            draw(sphere, [o.x + 0.9, o.y + 0.1, o.z + 0.4], [0.9, 0.4, 0.9], FOAM);
            draw(sphere, [o.x - 0.8, o.y + 0.1, o.z - 0.5], [0.8, 0.35, 0.8], FOAM);
        }

        // vines on the cliffs
        for (k = 0; k < vineMeshes.length; k++) draw(vineMeshes[k], [0, 0, 0], [1, 1, 1], VINE);
        for (k = 0; k < vineLeaves.length; k++) {
            o = vineLeaves[k];
            if (vis(o.p[0], o.p[1], o.p[2], 1, 90))
                draw(sphere, o.p, [o.s, o.s * 0.16, o.s * 0.55], o.c, o.rot);
        }

        // trees, domes, bushes
        for (k = 0; k < bigTrees.length; k++) {
            o = bigTrees[k];
            if (vis(o.x, o.y + o.H, o.z, o.R * 1.4 + o.H * 0.5, 175)) drawPinkTree(o);
        }
        for (k = 0; k < smallTrees.length; k++) {
            o = smallTrees[k];
            if (vis(o.x, o.y + o.H, o.z, o.R * 1.5, 130)) drawPinkTree(o);
        }
        for (k = 0; k < domes.length; k++) {
            o = domes[k];
            if (vis(o.x, o.y, o.z, o.R * 1.3, 120)) drawDome(o);
        }
        for (k = 0; k < bushes.length; k++) {
            o = bushes[k];
            if (vis(o.x, o.y, o.z, 2 * o.s, 120)) drawBush(o);
        }

        // vines standing in the meadow
        for (k = 0; k < spirals.length; k++) {
            o = spirals[k];
            if (!vis(o.x, o.y + 3, o.z, 5, 110)) continue;
            setAO(o.y, 4 * o.s);
            draw(spiralMesh, [o.x, o.y - 0.1, o.z], [o.s, o.s, o.s], VINE);
            draw(sphere, [o.x, o.y + 6.6 * o.s, o.z], [0.30 * o.s, 0.30 * o.s, 0.30 * o.s], [0.42, 0.80, 0.34]);
            setAO(0, 0);
        }
        for (k = 0; k < arches.length; k++) {
            o = arches[k];
            if (!vis(o.x, o.y + 1.5, o.z, 5, 110)) continue;
            draw(archMesh, [o.x, o.y - 0.12, o.z], [o.s, o.s, o.s], VINE, o.rot);
        }

        // rocks, fences, crop plot
        for (k = 0; k < stacks.length; k++) {
            o = stacks[k];
            if (vis(o.x, o.y + 1, o.z, 3, 120)) drawStack(o);
        }
        for (k = 0; k < rocks.length; k++) {
            o = rocks[k];
            if (vis(o.x, o.y, o.z, 1.5, 100)) drawRock(o);
        }
        for (k = 0; k < fences.length; k++) {
            o = fences[k];
            if (vis(o.cx, 0, o.cz, 10, 140)) drawFence(o);
        }
        if (vis(PLOT.x, PLOT_Y, PLOT.z, 6, 120)) drawPlot();

        // ground cover: grass tufts, wild flowers, tulip beds, mushrooms
        for (k = 0; k < tufts.length; k++) {
            o = tufts[k];
            if (vis(o.x, o.y, o.z, 0.6, 48)) {
                dd = (o.x - EX) * (o.x - EX) + (o.z - EZ) * (o.z - EZ);
                drawTuft(o, dd < 400);
            }
        }
        for (k = 0; k < flowers.length; k++) {
            o = flowers[k];
            if (vis(o.x, o.y, o.z, 1.2, 70)) {
                dd = (o.x - EX) * (o.x - EX) + (o.z - EZ) * (o.z - EZ);
                drawFlower(o, t, dd < 625);
            }
        }
        for (k = 0; k < tulips.length; k++) {
            o = tulips[k];
            if (vis(o.x, o.y, o.z, 1, 80)) {
                dd = (o.x - EX) * (o.x - EX) + (o.z - EZ) * (o.z - EZ);
                drawTulip(o, t, dd < 400);
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

    function drawAll(PMAT, VMAT, t) {
        // camera position / look direction from the view matrix (for culling + lighting)
        var t0 = VMAT[12], t1 = VMAT[13], t2 = VMAT[14];
        CWX = -(VMAT[0] * t0 + VMAT[1] * t1 + VMAT[2] * t2);
        CWY = -(VMAT[4] * t0 + VMAT[5] * t1 + VMAT[6] * t2);
        CWZ = -(VMAT[8] * t0 + VMAT[9] * t1 + VMAT[10] * t2);
        EX = CWX / WS; EZ = CWZ / WS; EY = GROUND_Y + (CWY - GROUND_Y) / WS;   // design-space camera for culling
        FX = -VMAT[2]; FY = -VMAT[6]; FZ = -VMAT[10];
        var tn2 = 1 / (PMAT[0] * PMAT[0]) + 1 / (PMAT[5] * PMAT[5]);
        COSH = Math.max(0.15, 0.93 / Math.sqrt(1 + tn2));
        lastMesh = null; lastRot = null; lastMode = -1; curAOb = 1e9; curAOh = -1;

        // remember the fixed-function state of the main code, restore it afterwards
        var wasDepth = GL.isEnabled(GL.DEPTH_TEST), wasCull = GL.isEnabled(GL.CULL_FACE);
        var wasBlend = GL.isEnabled(GL.BLEND), wasPO = GL.isEnabled(GL.POLYGON_OFFSET_FILL);
        var wasMask = GL.getParameter(GL.DEPTH_WRITEMASK);
        var bSrc = GL.getParameter(GL.BLEND_SRC_RGB), bDst = GL.getParameter(GL.BLEND_DST_RGB);
        var bSrcA = GL.getParameter(GL.BLEND_SRC_ALPHA), bDstA = GL.getParameter(GL.BLEND_DST_ALPHA);
        var poF = GL.getParameter(GL.POLYGON_OFFSET_FACTOR), poU = GL.getParameter(GL.POLYGON_OFFSET_UNITS);

        try {
            GL.useProgram(prog);
            GL.enableVertexAttribArray(0);
            GL.enableVertexAttribArray(1);
            GL.disableVertexAttribArray(2);   // 'uv' of the Kuromi shader, not used here
            GL.enable(GL.DEPTH_TEST);
            GL.disable(GL.CULL_FACE);
            GL.disable(GL.BLEND);
            GL.depthMask(true);
            GL.uniformMatrix4fv(uP, false, PMAT);
            GL.uniformMatrix4fv(uV, false, VMAT);
            GL.uniform3fv(uLightLoc, LIGHT);
            GL.uniform3f(uCam, CWX, CWY, CWZ);
            GL.uniform1f(uTime, t);
            setAO(0, 0);
            renderScene(t);
        } finally {
            GL.disableVertexAttribArray(3);
            if (!wasDepth) GL.disable(GL.DEPTH_TEST);
            if (wasCull) GL.enable(GL.CULL_FACE);
            if (wasBlend) GL.enable(GL.BLEND); else GL.disable(GL.BLEND);
            if (wasPO) GL.enable(GL.POLYGON_OFFSET_FILL); else GL.disable(GL.POLYGON_OFFSET_FILL);
            GL.depthMask(wasMask);
            GL.blendFuncSeparate(bSrc, bDst, bSrcA, bDstA);
            GL.polygonOffset(poF, poU);
        }
    }

    // groundHeight is reported in real world units (what the main code sees)
    function groundWorld(x, z) { return GROUND_Y + (groundH(x / WS, z / WS) - GROUND_Y) * WS; }

    return { draw: drawAll, groundHeight: groundWorld, groundY: GROUND_Y, scale: WS };
}


/* ---------------------------------------------------------------------
   AUTO-ATTACH: hook into the WebGL context created by the main code
   --------------------------------------------------------------------- */
(function () {
    if (typeof HTMLCanvasElement === "undefined") return;
    var root = (typeof window !== "undefined") ? window : this;

    var origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type) {
        var ctx = origGetContext.apply(this, arguments);
        if (ctx && (type === "webgl" || type === "experimental-webgl") && !ctx.__kuromiEnvAttached) {
            ctx.__kuromiEnvAttached = true;
            try { attach(ctx); } catch (err) { console.error("environment.js failed to attach:", err); }
        }
        return ctx;
    };

    // save the main code's WebGL state, run fn, then restore it exactly
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
        // created BEFORE the hooks, so the environment's own uniforms are not mistaken for the main code's
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
            if (mask & GL.DEPTH_BUFFER_BIT) drawn = false; // new frame
            return origClear(mask);
        };

        GL.drawElements = function (mode, count, type, offset) {
            if (!drawn && !busy && P && V) { // before the main code's first draw of this frame
                drawn = true;
                busy = true;
                try {
                    withSavedState(GL, function () { env.draw(P, V, performance.now() / 1000); });
                } catch (err) {
                    console.error("environment failed to draw:", err);
                } finally {
                    busy = false;
                }
            }
            return origDE(mode, count, type, offset);
        };
    }
})();