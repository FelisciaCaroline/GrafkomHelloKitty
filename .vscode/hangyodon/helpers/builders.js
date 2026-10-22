import { VEC3 } from "./libs.js";

// =====================================================================
// Semua generator punya layout vertex yang SAMA:
//      [x, y, z,  nx, ny, nz,  r, g, b]   -> 9 float per vertex
// dan mengembalikan { vertices, faces }.
// Semua normal dihitung ANALITIK (gradien permukaan implisit), jadi
// tidak ada normal yang kebalik / bolong seperti versi sebelumnya.
// =====================================================================

// Index segitiga untuk grid (stack x step). `offset` dipakai kalau satu
// mesh terdiri dari beberapa grid (mis. sisi atas + sisi bawah telinga).
function buildGridFaces(stack, step, offset = 0) {
    var faces = [];
    for (var i = 0; i < stack; i++) {
        for (var j = 0; j < step; j++) {
            var first = offset + i * (step + 1) + j;
            var second = first + 1;
            var third = first + (step + 1);
            var fourth = third + 1;
            faces.push(first, second, fourth);
            faces.push(first, fourth, third);
        }
    }
    return faces;
}

// ---------------------------------------------------------------------
// ELLIPSOID  (mata, pupil, jambul, tangan, kaki, gurita)
// x = a cos(v)cos(u), y = b sin(u), z = c sin(v)cos(u)
// Normal = gradien x²/a² + y²/b² + z²/c² = 1  ->  (x/a², y/b², z/c²)
// ---------------------------------------------------------------------
export function generateEllipsoid(a, b, c, stack, step, color = [0.6, 0.85, 0.85]) {
    var vertices = [];
    for (var i = 0; i <= stack; i++) {
        var u = i / stack * Math.PI - (Math.PI / 2);
        for (var j = 0; j <= step; j++) {
            var v = j / step * 2 * Math.PI - Math.PI;
            var x = a * Math.cos(v) * Math.cos(u);
            var y = b * Math.sin(u);
            var z = c * Math.sin(v) * Math.cos(u);
            var n = VEC3.normalize([x / (a * a), y / (b * b), z / (c * c)]);
            vertices.push(x, y, z, n[0], n[1], n[2], color[0], color[1], color[2]);
        }
    }
    return { vertices: vertices, faces: buildGridFaces(stack, step) };
}

// ---------------------------------------------------------------------
// SUPER-ELLIPSOID  (kepala & badan)  |x/a|^p + |y/b|^p + |z/c|^p = 1
// p = 2 -> ellipsoid biasa. p > 2 -> makin "kotak membulat" (squircle).
// `bias` membuat bentuk TELUR: x & z dikali g(y) = 1 - bias*(y/b), jadi
// bagian bawah lebih lebar (+bias) dan bagian atas lebih sempit (-bias),
// seperti badan/kepala Hangyodon di referensi.
// Normal = gradien F(x,y,z) = |x/(a g)|^p + |y/b|^p + |z/(c g)|^p, dihitung
// analitik (termasuk turunan g terhadap y).
// ---------------------------------------------------------------------
export function generateSuperEllipsoid(a, b, c, p, stack, step, color = [0.6, 0.85, 0.85], bias = 0) {
    var vertices = [];
    var e = 2 / p;
    var sgnpow = function (t, k) { return Math.sign(t) * Math.pow(Math.abs(t), k); };

    for (var i = 0; i <= stack; i++) {
        var u = i / stack * Math.PI - (Math.PI / 2);
        for (var j = 0; j <= step; j++) {
            var v = j / step * 2 * Math.PI - Math.PI;
            // titik pada super-ellipsoid satuan
            var Xb = sgnpow(Math.cos(u), e) * sgnpow(Math.cos(v), e);
            var Yb = sgnpow(Math.sin(u), e);
            var Zb = sgnpow(Math.cos(u), e) * sgnpow(Math.sin(v), e);

            var g = 1 - bias * Yb;
            var x = a * g * Xb;
            var y = b * Yb;
            var z = c * g * Zb;

            var dFx = Math.sign(Xb) * Math.pow(Math.abs(Xb), p - 1) / (a * g);
            var dFz = Math.sign(Zb) * Math.pow(Math.abs(Zb), p - 1) / (c * g);
            var dFy = (Math.sign(Yb) * Math.pow(Math.abs(Yb), p - 1) +
                (Math.pow(Math.abs(Xb), p) + Math.pow(Math.abs(Zb), p)) * bias / g) / b;
            var n = VEC3.normalize([dFx, dFy, dFz]);

            vertices.push(x, y, z, n[0], n[1], n[2], color[0], color[1], color[2]);
        }
    }
    return { vertices: vertices, faces: buildGridFaces(stack, step) };
}

// ---------------------------------------------------------------------
// ELLIPTIC PARABOLOID  (mulut)   quadric #1 (bukan ellipsoid/cylinder)
// x = a*u*cos(v), y = u²*height, z = c*u*sin(v),  u = 0..1
// Puncak (apex) di origin, bibir di y = height. Normal luar = gradien
// (2x/a², -1/height, 2z/c²). `closeRim` menutup bibir dengan tutup datar
// supaya tidak ada lubang kelihatan dari samping.
// Di main file, paraboloid ini diputar supaya apex menghadap +Z (ke depan).
// ---------------------------------------------------------------------
export function generateEllipticParaboloid(a, c, height, stack, step, color = [1, 0.75, 0.8], closeRim = true) {
    var vertices = [];
    for (var i = 0; i <= stack; i++) {
        var u = i / stack;
        var y = u * u * height;
        for (var j = 0; j <= step; j++) {
            var v = j / step * 2 * Math.PI - Math.PI;
            var x = a * u * Math.cos(v);
            var z = c * u * Math.sin(v);
            var n = VEC3.normalize([2 * x / (a * a), -1 / height, 2 * z / (c * c)]);
            vertices.push(x, y, z, n[0], n[1], n[2], color[0], color[1], color[2]);
        }
    }
    var faces = buildGridFaces(stack, step);

    if (closeRim) {
        // tutup datar di y = height: titik tengah + cincin, normal (0,1,0)
        var centerIdx = vertices.length / 9;
        vertices.push(0, height, 0, 0, 1, 0, color[0], color[1], color[2]);
        var ringStart = vertices.length / 9;
        for (var j2 = 0; j2 <= step; j2++) {
            var v2 = j2 / step * 2 * Math.PI - Math.PI;
            vertices.push(a * Math.cos(v2), height, c * Math.sin(v2), 0, 1, 0, color[0], color[1], color[2]);
        }
        for (var k = 0; k < step; k++) faces.push(centerIdx, ringStart + k, ringStart + k + 1);
    }
    return { vertices: vertices, faces: faces };
}

// ---------------------------------------------------------------------
// HYPERBOLIC PARABOLOID "TEBAL"  (telinga & sirip ekor)   quadric #2
// Permukaan pelana:  y = height * (X² - Z²),  X = x/a, Z = z/c
//                    (= height*(x²/a² - z²/c²), persis persamaan quadric-nya)
// dibatasi piringan oval X²+Z² <= 1, lalu DIGANDAKAN menjadi sisi atas
// (+thickness*sqrt(1-X²-Z²)) dan sisi bawah (-...) yang bertemu di tepi
// -> hasilnya bentuk "daun" tebal tertutup, sedikit melengkung seperti
// pelana. Normal analitik dari turunan f(X,Z), jadi mulus sampai ke tepi.
//
// Arah lokal: x = lebar (a), z = kedalaman (c), y = ketebalan (normal daun)
// ---------------------------------------------------------------------
export function generateHyperbolicParaboloid(a, c, height, thickness, stack, step, color = [0.3, 0.55, 0.8]) {
    var vertices = [];
    var faces = [];
    var gridSize = (stack + 1) * (step + 1);

    [1, -1].forEach(function (sigma, sideIdx) {
        for (var i = 0; i <= stack; i++) {
            var phi = (i / stack) * (Math.PI / 2);   // r = sin(phi) -> titik rapat di tepi
            var r = Math.sin(phi);
            var S = Math.cos(phi);                    // S = sqrt(1 - r²)
            var Ssafe = Math.max(S, 1e-3);
            for (var j = 0; j <= step; j++) {
                var theta = j / step * 2 * Math.PI - Math.PI;
                var X = r * Math.cos(theta);
                var Z = r * Math.sin(theta);

                var x = a * X;
                var z = c * Z;
                var y = height * (X * X - Z * Z) + sigma * thickness * S;

                var n;
                if (sigma === 1) {
                    n = [(thickness * X / Ssafe - 2 * height * X) / a, 1, (thickness * Z / Ssafe + 2 * height * Z) / c];
                } else {
                    n = [(thickness * X / Ssafe + 2 * height * X) / a, -1, (thickness * Z / Ssafe - 2 * height * Z) / c];
                }
                n = VEC3.normalize(n);
                vertices.push(x, y, z, n[0], n[1], n[2], color[0], color[1], color[2]);
            }
        }
        faces = faces.concat(buildGridFaces(stack, step, sideIdx * gridSize));
    });
    return { vertices: vertices, faces: faces };
}

// ---------------------------------------------------------------------
// CYLINDER (tidak dipakai di versi simpel; disimpan kalau nanti perlu)
// ---------------------------------------------------------------------
// export function generateCylinder(radius, height, stack, step, color = [0.6, 0.85, 0.85]) {
//     var vertices = [];
//     for (var i = 0; i <= stack; i++) {
//         var y = (i / stack) * height;
//         for (var j = 0; j <= step; j++) {
//             var v = j / step * 2 * Math.PI - Math.PI;
//             var x = radius * Math.cos(v);
//             var z = radius * Math.sin(v);
//             var n = VEC3.normalize([x, 0, z]);
//             vertices.push(x, y, z, n[0], n[1], n[2], color[0], color[1], color[2]);
//         }
//     }
//     return { vertices: vertices, faces: buildGridFaces(stack, step) };
// }

// ---------------------------------------------------------------------
// SWEEP CURVE (sirip punggung) -- mesh mengikuti kurva Bezier
// Di tiap titik kurva digambar penampang elips (rx = tebal, ry = lebar
// kipas), frame-nya dibangun dari tangent kurva. Ukuran penampang mengecil
// ke ujung dengan profil elips sqrt(1 - t²) sehingga ujung sirip TERTUTUP
// membulat (tidak ada lubang seperti versi sebelumnya).
// ---------------------------------------------------------------------
export function generateSweepFin(pathFn, rx, ry, segments, step, color = [0.3, 0.55, 0.8]) {
    var vertices = [];
    var eps = 1e-3;
    var globalUp = [0, 0, 1];

    for (var i = 0; i <= segments; i++) {
        var t = i / segments;
        var center = pathFn(t);
        var tA = Math.min(t + eps, 1), tB = Math.max(t - eps, 0);
        var tangent = VEC3.normalize(VEC3.sub(pathFn(tA), pathFn(tB)));

        var side = VEC3.cross(tangent, globalUp);
        if (Math.sqrt(side[0] * side[0] + side[1] * side[1] + side[2] * side[2]) < 1e-6) {
            side = VEC3.cross(tangent, [1, 0, 0]);
        }
        side = VEC3.normalize(side);
        var up = VEC3.normalize(VEC3.cross(side, tangent));

        var taper = Math.sqrt(Math.max(0, 1 - t * t));

        for (var j = 0; j <= step; j++) {
            var theta = j / step * 2 * Math.PI - Math.PI;
            var cx = Math.cos(theta) * rx * taper;
            var cy = Math.sin(theta) * ry * taper;

            var x = center[0] + side[0] * cx + up[0] * cy;
            var y = center[1] + side[1] * cx + up[1] * cy;
            var z = center[2] + side[2] * cx + up[2] * cy;

            // normal penampang elips: (cosθ/rx, sinθ/ry) pada basis (side, up)
            var nx = Math.cos(theta) / rx, ny = Math.sin(theta) / ry;
            var n = VEC3.normalize([
                side[0] * nx + up[0] * ny,
                side[1] * nx + up[1] * ny,
                side[2] * nx + up[2] * ny
            ]);
            // dekat ujung, miringkan normal sedikit searah tangent supaya ujung terlihat membulat
            var tip = Math.pow(t, 3) * 0.9;
            n = VEC3.normalize([n[0] + tangent[0] * tip * 1.5, n[1] + tangent[1] * tip * 1.5, n[2] + tangent[2] * tip * 1.5]);

            vertices.push(x, y, z, n[0], n[1], n[2], color[0], color[1], color[2]);
        }
    }
    return { vertices: vertices, faces: buildGridFaces(segments, step) };
}

// ---------------------------------------------------------------------
// DISPLACEMENT  -- menggeser vertex mesh APA PUN ({vertices, faces}) sepanjang
// normalnya. fn(x, y, z) -> jumlah geser (positif = masuk/cekung, negatif = menonjol),
// dengan (x, y, z) = posisi vertex ASLI di koordinat lokal mesh.
// Setelah digeser, normal dihitung ulang dari segitiga (area-weighted).
// Vertex yang posisinya sama (seam grid, kutub, tepi telinga) digabung supaya
// tidak ada garis sambungan pada shading.
// Pakai mesh dengan resolusi cukup rapat (stack/step besar), kalau tidak
// groove kecil tidak akan terlihat.
// ---------------------------------------------------------------------
export function applyDisplacement(geo, fn) {
    var v = geo.vertices;
    var count = v.length / 9;
    var keys = new Array(count);
    var origN = new Array(count);
    var key = function (x, y, z) {
        return Math.round(x * 1e4) + "," + Math.round(y * 1e4) + "," + Math.round(z * 1e4);
    };

    for (var i = 0; i < count; i++) {
        var o = i * 9;
        var x = v[o], y = v[o + 1], z = v[o + 2];
        keys[i] = key(x, y, z);
        origN[i] = [v[o + 3], v[o + 4], v[o + 5]];
        var amt = fn(x, y, z);
        if (amt) {
            v[o] = x - v[o + 3] * amt;
            v[o + 1] = y - v[o + 4] * amt;
            v[o + 2] = z - v[o + 5] * amt;
        }
    }

    var acc = {};
    for (var f = 0; f < geo.faces.length; f += 3) {
        var ia = geo.faces[f], ib = geo.faces[f + 1], ic = geo.faces[f + 2];
        var pa = [v[ia * 9], v[ia * 9 + 1], v[ia * 9 + 2]];
        var pb = [v[ib * 9], v[ib * 9 + 1], v[ib * 9 + 2]];
        var pc = [v[ic * 9], v[ic * 9 + 1], v[ic * 9 + 2]];
        var fn_ = VEC3.cross(VEC3.sub(pb, pa), VEC3.sub(pc, pa));   // panjangnya = 2 x luas -> area-weighted
        [ia, ib, ic].forEach(function (idx) {
            var a = acc[keys[idx]] || (acc[keys[idx]] = [0, 0, 0]);
            a[0] += fn_[0]; a[1] += fn_[1]; a[2] += fn_[2];
        });
    }

    for (var k = 0; k < count; k++) {
        var n = acc[keys[k]];
        var len = n ? Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) : 0;
        if (len < 1e-9) continue;
        n = [n[0] / len, n[1] / len, n[2] / len];
        // arah winding bisa terbalik -> samakan dengan normal asli
        if (n[0] * origN[k][0] + n[1] * origN[k][1] + n[2] * origN[k][2] < 0) n = [-n[0], -n[1], -n[2]];
        v[k * 9 + 3] = n[0]; v[k * 9 + 4] = n[1]; v[k * 9 + 5] = n[2];
    }
    return geo;
}

// ---------------------------------------------------------------------
// TUBE (selang melengkung dengan kedua ujung membulat) -- dipakai untuk mata
// tertutup "^ ^" pada gurita. Penampang lingkaran radius `radius` disapu
// sepanjang kurva pathFn(t), mengecil di kedua ujung (profil sqrt(1 - s^6)).
// Kurva diasumsikan di bidang XY (frame memakai sumbu Z sebagai acuan).
// ---------------------------------------------------------------------
export function generateTube(pathFn, radius, segments, step, color = [0.1, 0.1, 0.1]) {
    var vertices = [];
    var eps = 1e-3;
    var taperFn = function (t) {
        var s = 2 * Math.min(Math.max(t, 0), 1) - 1;
        return Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(s), 6)));
    };

    for (var i = 0; i <= segments; i++) {
        var t = i / segments;
        var tA = Math.min(t + eps, 1), tB = Math.max(t - eps, 0);
        var center = pathFn(t);
        var d = VEC3.sub(pathFn(tA), pathFn(tB));
        var speed = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) / (tA - tB);
        var tangent = VEC3.normalize(d);

        var side = VEC3.normalize(VEC3.cross(tangent, [0, 0, 1]));
        var up = VEC3.normalize(VEC3.cross(side, tangent));

        var taper = taperFn(t);
        var dTaperDl = (taperFn(tA) - taperFn(tB)) / (tA - tB) / speed;   // turunan taper terhadap panjang busur

        for (var j = 0; j <= step; j++) {
            var th = j / step * 2 * Math.PI - Math.PI;
            var rad = [side[0] * Math.cos(th) + up[0] * Math.sin(th),
                       side[1] * Math.cos(th) + up[1] * Math.sin(th),
                       side[2] * Math.cos(th) + up[2] * Math.sin(th)];
            var r = radius * taper;
            var n = VEC3.normalize([rad[0] - radius * dTaperDl * tangent[0],
                                    rad[1] - radius * dTaperDl * tangent[1],
                                    rad[2] - radius * dTaperDl * tangent[2]]);
            vertices.push(center[0] + rad[0] * r, center[1] + rad[1] * r, center[2] + rad[2] * r,
                          n[0], n[1], n[2], color[0], color[1], color[2]);
        }
    }
    return { vertices: vertices, faces: buildGridFaces(segments, step) };
}

