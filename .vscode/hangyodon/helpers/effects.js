// =====================================================================
// EFFECT GEOMETRY (hati + kilau bintang) untuk Happy Emote.
// Format sama seperti builders.js: { vertices: [px,py,pz, nx,ny,nz, r,g,b, ...], faces: [i0,i1,i2, ...] }
// =====================================================================

// ---------------------------------------------------------------------
// HATI 3D "gembung" (puffy). Kurva hati 2D di-skala r (0..1) ke tengah lalu
// diberi kedalaman z = ±thickness * sqrt(1 - r²) -> depan & belakang menyatu mulus di tepi.
//   size      : skala (lebar hati ~ 1.9 * size)
//   thickness : setengah tebal hati
// ---------------------------------------------------------------------
export function generateHeart(size, thickness, stack, step, color) {
    color = color || [1, 0.23, 0.35];
    var vertices = [], faces = [];

    function outline(t) {                       // kurva hati klasik, sudah dipusatkan & dinormalkan
        return [
            16 * Math.pow(Math.sin(t), 3) / 17,
            (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 2.5) / 17
        ];
    }
    function P(r, t, side) {
        var o = outline(t);
        return [o[0] * r * size, o[1] * r * size, side * thickness * Math.sqrt(Math.max(0, 1 - r * r))];
    }
    function normalAt(r, t, side) {             // normal = cross(dP/dr, dP/dt), dihitung numerik
        var d = 1e-3, re = Math.min(Math.max(r, 0.04), 0.985);
        var a = P(re + d, t, side), b = P(re - d, t, side);
        var c = P(re, t + d, side), e = P(re, t - d, side);
        var pr = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        var pt = [c[0] - e[0], c[1] - e[1], c[2] - e[2]];
        var n = [pr[1] * pt[2] - pr[2] * pt[1], pr[2] * pt[0] - pr[0] * pt[2], pr[0] * pt[1] - pr[1] * pt[0]];
        var len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) || 1;
        n = [n[0] / len, n[1] / len, n[2] / len];
        var p = P(re, t, side);                  // arahkan keluar (menjauhi pusat hati)
        if (n[0] * p[0] + n[1] * p[1] + n[2] * p[2] < 0) n = [-n[0], -n[1], -n[2]];
        return n;
    }

    [1, -1].forEach(function (side) {
        for (var i = 0; i <= stack; i++) {
            var r = i / stack;
            for (var j = 0; j <= step; j++) {
                var t = j / step * 2 * Math.PI;
                var p = P(r, t, side);
                var n = i === 0 ? [0, 0, side] : normalAt(r, t, side);
                vertices.push(p[0], p[1], p[2], n[0], n[1], n[2], color[0], color[1], color[2]);
            }
        }
    });
    var perSide = (stack + 1) * (step + 1);
    for (var s = 0; s < 2; s++) {
        for (var i2 = 0; i2 < stack; i2++) {
            for (var j2 = 0; j2 < step; j2++) {
                var a = s * perSide + i2 * (step + 1) + j2;
                var b = a + step + 1;
                faces.push(a, b, a + 1, b, b + 1, a + 1);
            }
        }
    }
    return { vertices: vertices, faces: faces };
}

// ---------------------------------------------------------------------
// KILAU BINTANG 4 ujung (✦) berbentuk 3D: dua bintang pipih bersilangan 90°,
// jadi tetap kelihatan berkilau dari sudut putar mana pun.
//   size = jari-jari ujung, thickness = tinggi "bubungan" tengah
// ---------------------------------------------------------------------
export function generateSparkle(size, thickness, color) {
    color = color || [1, 0.92, 0.65];
    var vertices = [], faces = [];

    var ring = [];                              // 8 titik: ujung (jauh) & lekuk (dekat) bergantian
    for (var k = 0; k < 8; k++) {
        var ang = k * Math.PI / 4, rad = (k % 2 === 0) ? size : size * 0.22;
        ring.push([rad * Math.cos(ang), rad * Math.sin(ang), 0]);
    }
    function tri(a, b, c, rotate) {             // 1 segitiga flat-shaded (+ opsi diputar 90° di sumbu Y)
        var u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        var n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        var len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) || 1;
        n = [n[0] / len, n[1] / len, n[2] / len];
        var base = vertices.length / 9;
        [a, b, c].forEach(function (p) {
            var q = rotate ? [p[2], p[1], -p[0]] : p;
            var m = rotate ? [n[2], n[1], -n[0]] : n;
            vertices.push(q[0], q[1], q[2], m[0], m[1], m[2], color[0], color[1], color[2]);
        });
        faces.push(base, base + 1, base + 2);
    }
    [false, true].forEach(function (rotate) {
        for (var k2 = 0; k2 < 8; k2++) {
            var p0 = ring[k2], p1 = ring[(k2 + 1) % 8];
            tri([0, 0, thickness], p0, p1, rotate);       // sisi depan (bubungan)
            tri([0, 0, -thickness], p1, p0, rotate);      // sisi belakang
        }
    });
    return { vertices: vertices, faces: faces };
}
