import { LIBS } from "./libs.js";

// =====================================================================
// Utilitas transformasi untuk animasi (TIDAK mengubah libs.js).
// Semua matriks = array 16 float, column-major (format WebGL), sama seperti LIBS.
// =====================================================================

// a * b (a diterapkan SETELAH b). LIBS.multiply(m1, m2) hasilnya m2*m1,
// jadi argumennya ditukar di sini supaya mul(parentWorld, local) benar.
export function mul(a, b) { return LIBS.multiply(b, a); }

export function translationM(v) {
    var m = LIBS.get_I4();
    m[12] = v[0]; m[13] = v[1]; m[14] = v[2];
    return m;
}

// Scaling (boleh non-uniform). Normal untuk lighting dikoreksi lewat normalMatrix().
export function scaleM(s) {
    var m = LIBS.get_I4();
    m[0] = s[0]; m[5] = s[1]; m[10] = s[2];
    return m;
}

// Rotasi Euler: urutan Rz -> Rx -> Ry  (== Ry * Rx * Rz)
export function eulerM(r) {
    var m = LIBS.get_I4();
    if (r[2]) LIBS.rotateZ(m, r[2]);
    if (r[0]) LIBS.rotateX(m, r[0]);
    if (r[1]) LIBS.rotateY(m, r[1]);
    return m;
}

// Rotasi di SUMBU SEMBARANG (rumus Rodrigues): axis = [x, y, z] (tidak harus ternormalisasi), angle = radian
//   R = cI + (1-c) a a^T + s [a]x
export function axisAngleM(axis, angle) {
    var len = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
    var x = axis[0] / len, y = axis[1] / len, z = axis[2] / len;
    var c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;
    var m = LIBS.get_I4();
    // m[col*4 + row]
    m[0] = c + x * x * k;      m[4] = x * y * k - z * s;  m[8]  = x * z * k + y * s;
    m[1] = y * x * k + z * s;  m[5] = c + y * y * k;      m[9]  = y * z * k - x * s;
    m[2] = z * x * k - y * s;  m[6] = z * y * k + x * s;  m[10] = c + z * z * k;
    return m;
}

// Matriks normal (mat3, column-major) = inverse-transpose dari 3x3 kiri-atas M.
// Dibutuhkan supaya lighting tetap benar saat ada scaling non-uniform.
export function normalMatrix(M) {
    var a = M[0], b = M[4], c = M[8];     // baris 0
    var d = M[1], e = M[5], f = M[9];     // baris 1
    var g = M[2], h = M[6], i = M[10];    // baris 2
    // kofaktor C[r][c]
    var C00 = e * i - f * h, C01 = f * g - d * i, C02 = d * h - e * g;
    var C10 = c * h - b * i, C11 = a * i - c * g, C12 = b * g - a * h;
    var C20 = b * f - c * e, C21 = c * d - a * f, C22 = a * e - b * d;
    var det = a * C00 + b * C01 + c * C02;
    if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    var inv = 1 / det;
    // inverse-transpose = kofaktor / det. Array column-major: n[col*3 + row] = C[row][col] / det
    return [
        C00 * inv, C10 * inv, C20 * inv,
        C01 * inv, C11 * inv, C21 * inv,
        C02 * inv, C12 * inv, C22 * inv
    ];
}

// Matriks animasi di sekitar PIVOT (dalam ruang parent):
//   A = T(dpos) * T(pivot) * R_axis * R_euler * S * T(-pivot)
// d = { pos:[x,y,z], axis:{axis:[..], angle}, euler:[rx,ry,rz], scale:[sx,sy,sz] } (semua opsional)
export function animMatrix(d, pivot) {
    var m = translationM([-pivot[0], -pivot[1], -pivot[2]]);
    if (d.scale) m = mul(scaleM(d.scale), m);
    if (d.euler) m = mul(eulerM(d.euler), m);
    if (d.axis) m = mul(axisAngleM(d.axis.axis, d.axis.angle), m);
    m = mul(translationM(pivot), m);
    if (d.pos) m = mul(translationM(d.pos), m);
    return m;
}

// ---------------------------------------------------------------------
// Keyframe track berulang. keys = [[waktu, nilai], ...], harus mulai di 0 dan
// berakhir di `period` (nilai akhir = nilai awal supaya loop mulus).
// Interpolasi smoothstep (ease-in-out) antar keyframe.
// ---------------------------------------------------------------------
export function track(keys, t, period) {
    t = ((t % period) + period) % period;
    for (var i = 0; i < keys.length - 1; i++) {
        var t0 = keys[i][0], t1 = keys[i + 1][0];
        if (t >= t0 && t <= t1) {
            var u = (t - t0) / (t1 - t0);
            u = u * u * (3 - 2 * u);
            return keys[i][1] + (keys[i + 1][1] - keys[i][1]) * u;
        }
    }
    return keys[keys.length - 1][1];
}
