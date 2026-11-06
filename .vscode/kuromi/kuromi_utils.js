// kuromi_utils.js
// Helper matriks (column-major), easing/keyframe, dan pengolah gambar tengkorak (hapus latar putih).
// Dimuat SEBELUM kuromi.js. Mengisi namespace window.KuromiLib.
(function () {

var L = window.KuromiLib = window.KuromiLib || {};

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

L.mul4 = mul4;
L.translateM = translateM;
L.scaleM = scaleM;
L.rotationMatrix = rotationMatrix;
L.pivotRot = pivotRot;
L.pivotScale = pivotScale;
L.axisAngleM = axisAngleM;
L.pivotAxis = pivotAxis;
L.clamp01 = clamp01;
L.smooth = smooth;
L.keys = keys;
L.easeOutBack = easeOutBack;
L.removeWhiteBackground = removeWhiteBackground;
L.nextPOT = nextPOT;

})();