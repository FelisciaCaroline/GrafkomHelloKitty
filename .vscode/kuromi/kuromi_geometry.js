// kuromi_geometry.js
// Pembuat bentuk 3D (bola, kerucut, kaki, mata, tengkorak, sweep ekor/senyum). Fungsi murni: input angka -> output {vertices, indices}.
// Dimuat SEBELUM kuromi.js. Mengisi namespace window.KuromiLib.
(function () {

var L = window.KuromiLib = window.KuromiLib || {};

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

L.gridIndices = gridIndices;
L.makeSphere = makeSphere;
L.makeEyePatch = makeEyePatch;
L.makePeakPatch = makePeakPatch;
L.makeCone = makeCone;
L.makeDiamond = makeDiamond;
L.makeLeg = makeLeg;
L.makeSkullPatch = makeSkullPatch;
L.sweepVertices = sweepVertices;

})();