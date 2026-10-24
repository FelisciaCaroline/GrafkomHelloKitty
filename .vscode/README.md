# Sanrio World – Hello Kitty Island Adventure (WebGL)

Jalankan lewat **Live Server** (bukan file://) → buka `index.html` di root.

## Struktur
```
index.html            satu-satunya halaman; memuat library -> environment -> karakter -> world.js
world.js              canvas, 1 WebGL context, kamera, input, render loop, penempatan 3 karakter
libs.js               LIBS + VEC3 (satu-satunya library matriks; global)
environment.js        langit, tanah, pohon, air, dll (nge-hook context otomatis, tidak perlu dipanggil)
settings.json         setting Live Server (sebaiknya dipindah ke .vscode/)
kuromi/
  kuromi.js           window.createKuromi(GL, cam)  -> { draw(M,t), cheer() }
  skull.png
hangyodon/
  main_hangyodon.js   export createHangyodon(GL, cam) -> { draw(M,t), play(name), stop() }
  helpers/            builders, effects, emote_animation, idle_animation, transform
BadtzMaru/
  glUtils.js          createEllipsoid, createBuffer, drawBuffer, ...
  BadtzMaru.js        class BadtzMaru (dulu pengu.js)
  badtz_entry.js      window.createBadtz(GL, cam) -> { draw(M,t), play('idle'|'dance') }
  standalone/         index_badtz.html, dance.html (halaman uji lama, tetap jalan sendiri)
```

## Kontrak karakter
Setiap karakter = factory `createXxx(GL, cam)` yang mengembalikan object dengan `draw(M, t)`.
- `GL`  : satu-satunya WebGL context (punya world.js)
- `cam` : `{P, V}` matriks proyeksi & view (dibaca tiap frame)
- `M`   : model matrix dunia (translasi * rotasi Y * skala) dari world.js
- `t`   : waktu dalam detik
Karakter TIDAK boleh membuat canvas/kamera/loop sendiri, dan harus memanggil
`useProgram` + set ulang attribute di awal `draw()` (context dipakai bersama).

## Kontrol
0/1/2 fokus karakter · drag = putar kamera · scroll = zoom · WASD/QE = geser titik bidik
I/H/J/K = animasi karakter terfokus (daftar tampil di HUD)
Badtz-Maru (tekan 1): I idle · J jalan rotasi · L jalan lurus · M jamur tumbuh lalu tersandung & jatuh · T marah · N dance · R reset posisi
  setiap animasi berjalan TERUS sampai tombol lain ditekan; saat berganti, posisi & arah hadap terakhir dipertahankan
  M = sekali jalan: jamur tumbuh di depan -> jalan sedikit -> tersandung -> jatuh -> bangun -> idle

## Menambah animasi baru
1. Tulis fungsi animasinya di file karakter (Hangyodon: tambah `evaluateXxx` + entry di `ANIMS`).
2. Daftarkan tombol di `chars[n].actions` di `world.js`.
