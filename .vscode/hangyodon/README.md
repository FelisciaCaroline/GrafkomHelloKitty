# Hangyodon — WebGL murni (versi simpel, tanpa animasi)

Fokus versi ini: **bentuk (shape), tata letak (layout), dan hierarchy** tiap bagian tubuh,
diukur dari foto referensi (depan / samping / belakang). Tanpa animasi mata/telinga.

## Cara menjalankan
1. Buka folder ini di VS Code, klik kanan `index.html` -> **Open with Live Server**
   (wajib server lokal karena pakai ES module `import`).
2. Drag kiri/kanan (atau tombol ← →) untuk memutar 360° mengelilingi sumbu vertikal.
   Tombol **Depan / Samping / Belakang** untuk lompat ke sudut seperti di foto referensi.

## Struktur file
```
index.html            <- canvas + tombol sudut pandang
main_hangyodon.js     <- shader Phong, daftar part (posisi/ukuran), hierarchy, render
helpers/libs.js       <- LIBS (matrix, tidak diubah) + VEC3
helpers/builders.js   <- generator bentuk: tiap fungsi mengembalikan {vertices, faces}
```

## Pemetaan bagian tubuh -> generator
| Bagian | Generator |
|---|---|
| Badan, kepala (bentuk telur/kotak membulat) | `generateSuperEllipsoid` (+ parameter `bias` untuk bentuk telur) |
| Mata, pupil, jambul, gurita, lengan, telapak tangan, kaki, telapak kaki | `generateEllipsoid` |
| Mulut (paruh bebek) | `generateEllipticParaboloid` (quadric #1, bibir ditutup) |
| Telinga, sirip ekor | `generateHyperbolicParaboloid` (quadric #2, dibuat tebal tertutup) |
| Sirip belakang kepala | `generateSweepFin` (sweep mengikuti kurva Bezier) |

## Yang diperbaiki dari versi sebelumnya
- **Bug utama hierarchy:** `LIBS.multiply(m1, m2)` mengembalikan `m2 * m1` (array WebGL itu
  column-major), jadi `multiply(parentWorld, local)` sebelumnya menghasilkan `local * parent`.
  Akibatnya kepala/mata/mulut dsb tidak ikut berputar bersama badan. Sekarang argumennya
  ditukar lewat fungsi `mul()` di `main_hangyodon.js` (LIBS sendiri tidak diubah).
- Posisi & ukuran semua part diukur ulang dari foto referensi, bukan ditebak.
- Telinga & sirip sekarang tertutup (tebal), mulut tidak berlubang, ujung sirip membulat.
- Kamera: FOV sempit (perspektif ringan seperti foto), jarak otomatis menyesuaikan layar.
- Pencahayaan ada cahaya isi dari belakang supaya tampak belakang tidak gelap total.
- Tidak ada `scale` di transform; ukuran diatur lewat radius generator (normal Phong tetap benar).

## Belum dibuat (sengaja, tahap berikutnya)
- Lipatan/garis lengkung di perut, garis-garis sirip, wajah gurita
- Animasi (kedip, goyang telinga, dst)
- Penyempurnaan pose tangan & kaki (sekarang simetris)
