// File: BadtzMaru.js
// mode 'idle'  -> animasi idle (halaman index.html)
// mode 'dance' -> animasi joget senang (halaman dance.html)
//
// TOMBOL (mode standalone): J = Jalan melingkar | L = Jalan lurus | M = Tersandung jamur | T = Marah | D = Dance | I = Idle
// (di world.js tombol dikelola world.js -> constructor dipanggil dengan bindKeys = false)
//
// ATURAN ANIMASI: tiap animasi yang dipicu berjalan TERUS sampai ada animasi lain dipicu.
// Saat berganti, posisi & arah hadap terakhir dipertahankan (this.pos, this.heading).
// Satu-satunya animasi sekali-jalan: tripOver() (jamur tumbuh -> jalan sedikit -> tersandung -> jatuh -> bangun -> idle).
//
// API:
//   badtz.walk()          // jalan melingkar terus-menerus (walk(false) = idle)
//   badtz.walkPath(false) // false = jalan di tempat (tidak berkeliling lingkaran)
//   badtz.walkStraight()  // jalan lurus terus-menerus ke arah hadap (walkStraight(false) = idle)
//   badtz.tripOver()      // jamur tumbuh di depan, jalan sedikit, tersandung, jatuh, bangun, lalu idle
//   badtz.rage()          // tantrum terus-menerus (rage(false) = idle)
//   badtz.dance() / badtz.idle()   // joget / idle di posisi terakhir
//   badtz.resetPosition() // kembali ke titik awal & arah awal
//   badtz.walkRadius = 3  // radius lingkaran jalan
//   badtz.walkSpeed  = 1.4 // kecepatan jalan melingkar (unit/detik)
//   badtz.straightSpeed = 1.6 // kecepatan jalan lurus (unit/detik)
// Catatan: parameter `time` pada render() harus dalam DETIK.

class BadtzMaru {
    constructor(gl, programInfo, mode = 'idle', bindKeys = true) {
        this.gl = gl;
        this.programInfo = programInfo;
        this.mode = mode;
        this.buffers = {};
        this.mvMatrix = mat4.create();
        this.mvMatrixStack = [];

        // ===== animasi aktif: 'idle' | 'walk' | 'straight' | 'rage' | 'dance' | 'trip' =====
        this.action = (mode === 'dance') ? 'dance' : 'idle';

        // ===== posisi & arah hadap TERAKHIR (koordinat lokal karakter; dipertahankan antar animasi) =====
        this.pos = { x: 0, z: 0 };
        this.heading = 0;              // rotasi sumbu Y (radian); 0 = menghadap +z
        this.moveType = 'none';        // 'circle' | 'straight' | 'none'
        this.groundFn = null;          // diisi badtz_entry.js: tinggi tanah relatif di (x, z) lokal

        // ===== state jalan =====
        this.walking = false;
        this.followPath = true;     // true = berkeliling lingkaran, false = jalan di tempat
        this.walkRadius = 3.0;
        this.walkSpeed = 1.4;
        this.straightSpeed = 1.6;
        this.walkState = { last: null, amt: 0, ph: 0, pathAng: 0 };

        // ===== state tantrum =====
        this.raging = false;
        this.rageState = { amt: 0, ph: 0, armPh: 0, spin: 0 };

        // ===== state tersandung jamur =====
        this.tripGap = 2.8;            // jarak jamur tumbuh di depan Badtz
        this.tripContact = 1.4;        // Badtz berhenti jalan & tersandung saat jamur tinggal sejauh ini
        this.trip = { active: false, phase: 'idle', t: 0, slideApplied: 0, dir: [0, 1] };
        this.tripFx = { pitch: 0, st: 0, fall: 0 };      // efek tubuh (dihaluskan saat animasi dibatalkan)
        this.mush = { on: false, state: 'stay', t: 0, grow: 0, x: 0, z: 0 };

        // Tombol standalone (di world.js: bindKeys = false)
        if (bindKeys && typeof document !== 'undefined') {
            document.addEventListener('keydown', (e) => {
                const tg = e.target && e.target.tagName;
                if (tg === 'INPUT' || tg === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
                const k = (e.key || '').toLowerCase();
                if (k === 'j') this.walk();
                else if (k === 't') this.rage();
                else if (k === 'l') this.walkStraight();
                else if (k === 'm') this.tripOver();
                else if (k === 'd') this.dance();
                else if (k === 'i') this.idle();
            });
        }
    }

    // ===== PENGATUR ANIMASI =====
    // Ganti animasi. Posisi & arah hadap TIDAK diubah (dipertahankan dari animasi sebelumnya).
    _set(action) {
        // jamur sisa animasi jatuh menyusut begitu ada tombol lain ditekan
        if (action !== 'trip' && this.mush.on && this.mush.state !== 'shrink') this.mush.state = 'shrink';
        if (action === 'trip' && this.trip.active) return false;
        if (this.action === action && action !== 'trip') return false;

        // keluar dari tantrum: putaran badan "dilebur" ke arah hadap supaya tidak loncat & arah terakhir tetap
        if (this.action === 'rage') {
            this.heading += this.rageState.spin;
            this.rageState.spin = 0;
        }
        this.action = action;
        this.mode = (action === 'dance') ? 'dance' : 'idle';
        this.walking = (action === 'walk');
        this.raging = (action === 'rage');
        if (action === 'walk') this.moveType = this.followPath ? 'circle' : 'none';
        else if (action === 'straight') this.moveType = 'straight';
        if (action !== 'trip') { this.trip.active = false; this.trip.phase = 'idle'; }
        return true;
    }
    // Jalan melingkar, terus-menerus sampai animasi lain dipicu
    walk(on) { this._set(on === false ? 'idle' : 'walk'); }
    walkPath(on) { this.followPath = !!on; if (this.action === 'walk') this.moveType = this.followPath ? 'circle' : 'none'; }
    // Jalan lurus ke arah hadap, terus-menerus sampai animasi lain dipicu
    walkStraight(on) { this._set(on === false ? 'idle' : 'straight'); }
    // Tantrum, terus-menerus sampai animasi lain dipicu
    rage(on) { this._set(on === false ? 'idle' : 'rage'); }
    dance() { this._set('dance'); }
    idle() { this._set('idle'); }
    // Tersandung: jamur tumbuh di depan -> jalan sedikit (lanjut dari posisi sekarang) -> tersandung -> jatuh -> bangun -> idle
    tripOver() {
        if (this.trip.active) return;
        this._set('trip');
        this.moveType = 'straight';
        const dx = Math.sin(this.heading), dz = Math.cos(this.heading);
        const gap = this.tripGap;
        this.trip = { active: true, phase: 'grow', t: 0, slideApplied: 0, dir: [dx, dz] };
        this.mush = { on: true, state: 'grow', t: 0, grow: 0, x: this.pos.x + dx * gap, z: this.pos.z + dz * gap };
    }
    // Kembali ke titik awal & arah awal
    resetPosition() {
        this._set('idle');
        this.pos.x = 0; this.pos.z = 0; this.heading = 0;
        this.rageState.spin = 0;
        this.trip.active = false;
        this.mush.on = false;
    }

    pushMatrix() { this.mvMatrixStack.push(mat4.clone(this.mvMatrix)); }
    popMatrix() { if (this.mvMatrixStack.length > 0) this.mvMatrix = this.mvMatrixStack.pop(); }

    init() {
        const colorBlack = [0.08, 0.08, 0.1, 1.0];
        const colorWhite = [1.0, 1.0, 1.0, 1.0];
        const colorYellow = [0.95, 0.95, 0.0, 1.0];
        const colorRed = [0.95, 0.12, 0.1, 1.0];
        const colorCheek = [0.95, 0.25, 0.25, 1.0];
        const colorSmoke = [0.92, 0.92, 0.96, 1.0];
        const colorDust = [0.78, 0.74, 0.68, 1.0];

        // Kepala & Badan
        this.headEquatorY = -0.28;
        this.buffers.headTop = createBuffer(this.gl, createEllipsoid(1.56, 1.5, 1.15, colorBlack, 0.5)); // dipakai dalam keadaan dibalik (setengah atas)
        this.buffers.headBottom = createBuffer(this.gl, createEllipsoid(1.56, 0.95, 1.15, colorBlack, 0.5)); // setengah bawah, lebih pipih
        this.buffers.body = createBuffer(this.gl, createEllipsoid(1.15, 1.5, 0.95, colorBlack));
        this.buffers.belly = createBuffer(this.gl, createEllipsoid(0.9, 1.05, 0.45, colorWhite));

        // Bawah badan dibuat rata
        const bodyBottom = -1.5;
        this.bodyLayers = [
            [0.9,  1.06, 0.87],   // [ry, rx, rz]
            [0.65, 0.97, 0.80],
            [0.4,  0.85, 0.70],
        ].map(([ry, rx, rz]) => ({
            y: bodyBottom + ry,
            buf: createBuffer(this.gl, createEllipsoid(rx, ry, rz, colorBlack))
        }));

        // Mata & Pupil
        const colorEyeWhite = [2.3, 2.3, 2.3, 1.0];
        const eyeRx = 0.5, eyeRz = 0.17, eyeBands = 80;
        this.eyeLidY = 0.267;
        const eyeBottom = -0.35;
        const eyeLayersDef = [0.60, 0.525, 0.45, 0.375, 0.315, 0.26]
            .map(ry => [eyeBottom + ry, ry]);
        this.eyeLayers = eyeLayersDef.map(([yc, ry]) => {
            const c = (this.eyeLidY - yc) / ry;
            let cut = 0.0;
            if (c < 1) {
                const k = Math.round(eyeBands * Math.acos(c) / Math.PI);
                cut = (k + 0.5) / eyeBands;
            }
            return { y: yc, buf: createBuffer(this.gl, createEllipsoid(eyeRx, ry, eyeRz, colorEyeWhite, cut, eyeBands, 40)) };
        });
        this.buffers.eyeBlack = createBuffer(this.gl, createEllipsoid(eyeRx, 0.22, 0.16, colorBlack, 0.5));
        this.buffers.pupil = createBuffer(this.gl, createEllipsoid(0.22, 0.22, 0.1, colorBlack, 0.5));

        // Pupil bulan sabit (mode joget): kubah hitam dikurangi kubah putih yang lebih rendah
        // -> tersisa lengkung hitam "^" dengan ujung meruncing
        this.buffers.crescentBlack = createBuffer(this.gl, createEllipsoid(0.2, 0.2, 0.05, colorBlack, 0.5));
        this.buffers.crescentCut   = createBuffer(this.gl, createEllipsoid(0.2, 0.2, 0.05, colorEyeWhite, 0.5));

        // Mulut
        this.buffers.upperBeak = createBuffer(this.gl, createBeak(colorYellow));
        this.buffers.lowerBeak = createBuffer(this.gl, createEllipsoid(0.5, 0.15, 0.3, colorYellow));

        // Rambut Duri
        this.buffers.spike = createBuffer(this.gl, createEllipticParaboloid(0.46, 0.5, 1.2, colorBlack));

        // Tangan & Kaki
        // Tangan: elipsoid gemuk memanjang ke bawah
        this.buffers.arm = createBuffer(this.gl, createEllipsoid(0.2, 0.7, 0.26, colorBlack));
        // Telapak kaki: SATU lembar hyperboloid of two sheets (setengah dari bentuk dua lembarnya)
        // createHyperboloidSheet(a, b, c, vMax, baseY, warna)
        // dasar elips = (a·sinh vMax) x (b·sinh vMax) = 0.42 x 0.5, tinggi gundukan = c·(cosh vMax - 1) = 0.44
        this.buffers.foot = createBuffer(this.gl, createHyperboloidSheet(0.278, 0.331, 0.54, 1.2, -0.22, colorYellow));

        // ===== Efek marah (tantrum) =====
        this.buffers.veinBar = createBuffer(this.gl, createEllipsoid(0.07, 0.24, 0.05, colorRed));      // batang tanda marah "💢"
        this.buffers.cheek   = createBuffer(this.gl, createEllipsoid(0.24, 0.15, 0.07, colorCheek));    // pipi merah
        this.buffers.smoke   = createBuffer(this.gl, createEllipsoid(0.3, 0.3, 0.3, colorSmoke));       // uap di kepala
        this.buffers.dust    = createBuffer(this.gl, createEllipsoid(0.3, 0.3, 0.3, colorDust));        // debu hentakan kaki

        // ===== Jamur (rintangan) =====
        this.buffers.mushStem = createBuffer(this.gl, createEllipsoid(0.27, 0.27, 0.27, [0.98, 0.93, 0.84, 1.0]));
        this.buffers.mushCap  = createBuffer(this.gl, createEllipsoid(0.85, 0.5, 0.85, [0.96, 0.46, 0.60, 1.0], 0.5)); // setengah (dipakai dibalik = kubah)
        this.buffers.mushDot  = createBuffer(this.gl, createEllipsoid(0.14, 0.14, 0.14, [1.0, 0.92, 0.95, 1.0]));
    }

    render(projectionMatrix, viewMatrix, time, xOffset = 0, yOffset = 0, zOffset = 0) {
        mat4.copy(this.mvMatrix, viewMatrix);
        mat4.translate(this.mvMatrix, this.mvMatrix, [xOffset, yOffset, zOffset]);

        const dance = this.mode === 'dance';
        const TWO_PI = 2 * Math.PI;

        // ===== DELTA WAKTU =====
        const ws = this.walkState;
        let dtw = ws.last === null ? 0.016 : time - ws.last;
        if (!(dtw > 0)) dtw = 0.0005;
        dtw = Math.min(0.05, dtw);
        ws.last = time;

        // ===== STATE TANTRUM =====
        const rs = this.rageState;
        const rageActive = !dance && this.raging;
        rs.amt += ((rageActive ? 1 : 0) - rs.amt) * (1 - Math.exp(-7 * dtw));
        const r = rs.amt;                                   // 0 = tenang, 1 = tantrum penuh
        rs.ph    += dtw * TWO_PI * 1.6 * r;                 // fase hentakan kaki
        rs.armPh += dtw * TWO_PI * 0.6 * r;                 // fase lempar tangan
        if (rageActive) rs.spin += dtw * 1.6 * r;           // muter-muter (~0.9 putaran/detik); dilebur ke heading saat berganti animasi
        const sSt = Math.sin(rs.ph);                        // + = kaki kanan terangkat, - = kaki kiri terangkat
        const impact = Math.pow(1 - Math.abs(sSt), 6);      // lonjakan tajam saat telapak menghantam tanah
        const pulse = 0.5 + 0.5 * Math.sin(time * 20);      // denyut napas marah

        const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
        const tr = this.trip, ms = this.mush, fx = this.tripFx;

        // ===== STATE JAMUR (tumbuh / diam / menyusut) =====
        if (ms.on) {
            if (ms.state === 'grow') {
                ms.t = Math.min(1, ms.t + dtw / 1.0);
                const x1 = ms.t - 1, c1 = 1.70158, c3 = c1 + 1;
                ms.grow = 1 + c3 * x1 * x1 * x1 + c1 * x1 * x1;      // easeOutBack: tumbuh lalu "pop" sedikit
                if (ms.t >= 1) { ms.state = 'stay'; ms.grow = 1; }
            } else if (ms.state === 'shrink') {
                ms.grow -= dtw / 0.4;
                if (ms.grow <= 0) { ms.on = false; ms.grow = 0; }
            }
        }

        // ===== STATE JALAN (gait) =====
        const tripWalking = tr.active && tr.phase === 'walk';
        const wOn = !dance && !rageActive && (this.action === 'walk' || this.action === 'straight' || tripWalking);
        ws.amt += ((wOn ? 1 : 0) - ws.amt) * (1 - Math.exp(-6 * dtw));
        const w = ws.amt;                                            // 0 = berdiri, 1 = jalan penuh
        ws.ph += dtw * TWO_PI * 1.1 * w;                             // 1.1 siklus langkah / detik

        // ===== PERPINDAHAN: posisi & arah hadap diintegrasi, jadi tetap di tempat terakhir saat berganti animasi =====
        if (w > 0.0005 && this.moveType !== 'none') {
            const v = dtw * w * (this.moveType === 'circle' ? this.walkSpeed : this.straightSpeed);
            if (this.moveType === 'circle') this.heading += v / this.walkRadius;   // belok terus -> melingkar
            this.pos.x += Math.sin(this.heading) * v;
            this.pos.z += Math.cos(this.heading) * v;
        }

        // ===== ALUR TERSANDUNG: tumbuh -> jalan sedikit -> tersandung -> jatuh -> tergeletak -> bangun =====
        const T_GROW = 1.25, T_STUMBLE = 0.40, T_FALL = 0.55, T_LIE = 1.10, T_RISE = 0.90;
        const T_TOTAL = T_STUMBLE + T_FALL + T_LIE + T_RISE;
        let pitchT = 0, stT = 0, fallT = 0, tripLive = false;
        if (tr.active) {
            if (tr.phase === 'grow') {
                tr.t += dtw;                                         // diam menunggu jamur tumbuh
                if (tr.t >= T_GROW) { tr.phase = 'walk'; tr.t = 0; }
            } else if (tr.phase === 'walk') {
                const ahead = (ms.x - this.pos.x) * tr.dir[0] + (ms.z - this.pos.z) * tr.dir[1];
                if (ahead <= this.tripContact) { tr.phase = 'trip'; tr.t = 0; this.moveType = 'none'; }
            }
            if (tr.phase === 'trip') {
                tr.t += dtw;
                const t1 = T_STUMBLE, t2 = t1 + T_FALL, t3 = t2 + T_LIE;
                let slide;
                if (tr.t < t1) {                                     // tersandung: badan condong, kaki depan nyangkut
                    stT = ease(tr.t / t1);
                    pitchT = 0.28 * stT;
                    slide = 0.12 * stT;
                } else if (tr.t < t2) {                              // jatuh: tengkurap ke depan (makin cepat)
                    const p = (tr.t - t1) / T_FALL;
                    stT = 1 - p; fallT = ease(p);
                    pitchT = 0.28 + (Math.PI / 2 - 0.28) * p * p;
                    slide = 0.12 + 0.55 * ease(p);
                } else if (tr.t < t3) {                              // tergeletak (sedikit memantul saat mendarat)
                    const q = tr.t - t2;
                    pitchT = Math.PI / 2 - 0.05 * Math.exp(-q * 7) * Math.abs(Math.sin(q * 16));
                    fallT = 1; slide = 0.67;
                } else if (tr.t < T_TOTAL) {                         // bangun lagi (di tempat)
                    const p = ease((tr.t - t3) / T_RISE);
                    pitchT = (Math.PI / 2) * (1 - p);
                    fallT = 1 - p; slide = 0.67;
                } else {                                             // selesai -> idle di tempat jatuh tadi (jamur tetap)
                    tr.active = false; tr.phase = 'idle';
                    this.action = 'idle'; this.mode = 'idle';
                    slide = 0.67;
                }
                // badan meluncur ke depan: dimasukkan ke posisi (bukan efek sementara) -> tidak balik saat animasi berganti
                const dSlide = slide - tr.slideApplied;
                tr.slideApplied = slide;
                this.pos.x += tr.dir[0] * dSlide;
                this.pos.z += tr.dir[1] * dSlide;
                tripLive = tr.active;
            }
        }
        if (tripLive) { fx.pitch = pitchT; fx.st = stT; fx.fall = fallT; }
        else {                                                       // animasi dibatalkan/selesai: efek tubuh kembali halus ke normal
            const k = 1 - Math.exp(-7 * dtw);
            fx.pitch -= fx.pitch * k; fx.st -= fx.st * k; fx.fall -= fx.fall * k;
        }
        const pitch = fx.pitch, stumbleAmt = fx.st, fallAmt = fx.fall;
        const gOff = this.groundFn ? this.groundFn(this.pos.x, this.pos.z) : 0;   // menapak tanah yang naik-turun

        const stepS = Math.sin(ws.ph), stepC = Math.cos(ws.ph);
        const stepB = Math.cos(2 * ws.ph);                           // 2x per siklus = tiap langkah

        // ===== ANIMASI IDLE =====
        const idleSpeed = 1.5;
        const holdAmt   = 1.8;
        const ph = time * idleSpeed + 0.5 * Math.sin(time * 0.37) + 0.3 * Math.sin(time * 0.91 + 1.3);
        const vary = 0.85 + 0.15 * Math.sin(time * 0.23 + 2.0) + 0.1 * Math.sin(time * 0.61);
        const rawSway = Math.sin(ph);
        const held  = Math.max(-1, Math.min(1, rawSway * holdAmt));
        const sway  = Math.sin(held * Math.PI / 2);
        const beat = sway * sway;

        // ===== ANIMASI JOGET (mode 'dance') =====
        const danceSpeed = 2 * Math.PI / 1.8;      // 1 siklus kiri-kanan = 1.8 detik (sama dengan video)
        const dph = time * danceSpeed;
        const ds  = Math.sin(dph);                 // -1..1 : goyang kiri <-> kanan
        const up  = (1 + Math.cos(2 * dph)) / 2;   // 0..1  : tinggi pantulan (puncak di tengah, turun di ujung)

        // ===== TEPUK TANGAN =====
        const clapSpeed = 2 * Math.PI / 0.6;       // 1 tepukan = 0.6 detik (kecil = lebih lambat)
        const cph  = time * clapSpeed;
        const open = Math.pow((1 - Math.cos(cph)) / 2, 0.6);   // 0 = tangan menempel (tepuk), 1 = terbuka lebar

        // idle meredup saat jalan / tantrum, lalu kembali saat berhenti
        const calm = (1 - w) * (1 - r);
        let headTilt = sway * 0.14 * vary * calm - w * 0.04 * stepS + r * 0.22 * Math.sin(time * 13);
        let headNod  = beat * 0.10 * vary * calm + w * 0.07 + r * (0.14 + 0.10 * Math.sin(time * 9));
        let armLift  = beat * 0.30 * vary * calm;
        let bodyBob  = (1 - beat) * 0.08 * calm;
        if (dance) {
            headTilt = ds * 0.08;
            headNod  = 0.03 + (1 - open) * 0.05;   // sedikit mengangguk tiap tepukan
            bodyBob  = 0;
        }

        // ===== KEDIPAN MATA =====
        const blinkPulse = (t, period, dur) => { const m = t % period; return m < dur ? Math.sin(Math.PI * m / dur) : 0; };
        const blink = Math.max(blinkPulse(time, 3.7, 0.16), blinkPulse(time + 1.1, 5.3, 0.16));
        // saat marah mata menyipit (scaling) + miring galak (rotasi, lihat bagian mata)
        const eyeScaleY = dance ? 1 : (1 - blink * 0.92) * (1 - 0.3 * r);

        // ===== GERAKAN MATA KIRI-KANAN =====
        const glance = Math.sin(time * 0.7) * Math.sin(time * 0.43) * 0.06;

        // ===== JAMUR (tumbuh saat tombol jatuh ditekan; digambar di dunia, sebelum transformasi karakter) =====
        if (ms.on && ms.grow > 0.001) {
            const gm = this.groundFn ? this.groundFn(ms.x, ms.z) : 0;
            const groundLocal = -2.57 + gm;                        // tinggi tanah di koordinat lokal (sama dgn `foot` di world.js)
            const sc = ms.grow;
            // gepeng saat ditendang, lalu tertimpa badan saat jatuh (mengembang lagi saat Badtz bangun)
            const squash = Math.max(0.12, 1 - 0.25 * stumbleAmt - 0.85 * fallAmt);
            this.pushMatrix();
                mat4.translate(this.mvMatrix, this.mvMatrix, [ms.x, groundLocal, ms.z]);
                mat4.scale(this.mvMatrix, this.mvMatrix, [sc, sc * squash, sc]);
                this.pushMatrix();
                    mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 0.27, 0.0]);
                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.mushStem);
                this.popMatrix();
                this.pushMatrix();
                    mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 0.42, 0.0]);
                    mat4.scale(this.mvMatrix, this.mvMatrix, [1.0, -1.0, 1.0]);       // setengah bawah dibalik = kubah
                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.mushCap);
                this.popMatrix();
                for (let k = 0; k < 5; k++) {
                    const a = k * 2 * Math.PI / 5 + 0.5, rr = 0.52;
                    const dy = 0.5 * Math.sqrt(Math.max(0, 1 - (rr * rr) / (0.85 * 0.85)));
                    this.pushMatrix();
                        mat4.translate(this.mvMatrix, this.mvMatrix, [rr * Math.cos(a), 0.42 + dy - 0.02, rr * Math.sin(a)]);
                        drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.mushDot);
                    this.popMatrix();
                }
                this.pushMatrix();
                    mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 0.42 + 0.5 - 0.02, 0.0]);
                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.mushDot);
                this.popMatrix();
            this.popMatrix();
        }

        // ===== TRANSFORMASI ROOT POSISI + ARAH HADAP: semua bagian karakter ikut (hierarchy) =====
        // Posisi (pos) & arah (heading) adalah posisi TERAKHIR; bagian ini tidak mengubah apa-apa saat masih di titik awal.
        if (this.pos.x !== 0 || this.pos.z !== 0 || gOff !== 0) {
            // TRANSLASI ke posisi terakhir (+ mengikuti tinggi tanah)
            mat4.translate(this.mvMatrix, this.mvMatrix, [this.pos.x, gOff, this.pos.z]);
        }
        if (this.heading !== 0) {
            // ROTASI hadap (sumbu Y) di titik berdiri
            mat4.rotate(this.mvMatrix, this.mvMatrix, this.heading, [0, 1, 0]);
        }
        if (pitch > 0.0005) {
            // ROTASI (sumbu X) pivot di telapak kaki: badan condong/rebah ke depan; diangkat sedikit agar perut/kepala tidak menembus tanah
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 1.1 * Math.sin(Math.min(pitch, Math.PI / 2)), 0.0]);
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -2.6, 0.0]);
            mat4.rotate(this.mvMatrix, this.mvMatrix, pitch, [1, 0, 0]);
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 2.6, 0.0]);
        }

        // ===== TRANSFORMASI ROOT JALAN (gaya langkah): semua bagian karakter ikut (hierarchy) =====
        // Saat w = 0, bagian ini tidak mengubah apa-apa.
        if (w > 0.0005) {
            // 1. TRANSLASI: memantul tiap langkah
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, w * 0.06 * (0.5 + 0.5 * stepB), 0.0]);
            // 2. SCALING (squash & stretch tipis), pusat di telapak kaki
            const wsy  = 1 + w * 0.02 * stepB;
            const wsxz = 1 - w * 0.01 * stepB;
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -2.6, 0.0]);
            mat4.scale(this.mvMatrix, this.mvMatrix, [wsxz, wsy, wsxz]);
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 2.6, 0.0]);
            // 3. ROTASI biasa: badan miring (roll) mengikuti langkah
            mat4.rotate(this.mvMatrix, this.mvMatrix, -w * 0.03 * stepS, [0, 0, 1]);
            // 4. ARBITRARY ROTATE: goyang pinggul pada sumbu miring, pusat di tengah badan
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.5, 0.0]);
            mat4.rotate(this.mvMatrix, this.mvMatrix, w * 0.1 * stepS, [0.25, 1, 0.15]);
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 0.5, 0.0]);
        }

        // ===== TRANSFORMASI ROOT TANTRUM: semua bagian karakter ikut (hierarchy) =====
        if (r > 0.0005) {
            // 1. TRANSLASI: badan gemetar marah + naik saat kaki terangkat
            mat4.translate(this.mvMatrix, this.mvMatrix, [
                Math.sin(time * 47) * 0.03 * r,
                r * 0.08 * Math.abs(sSt),
                Math.cos(time * 39) * 0.02 * r
            ]);
            // 2. SCALING: badan menggembung marah + gepeng saat menghentak, pusat di telapak kaki
            const inflate = 1 + 0.05 * r * pulse;
            const rsy  = inflate * (1 - 0.07 * impact * r);
            const rsxz = inflate * (1 + 0.04 * impact * r);
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -2.6, 0.0]);
            mat4.scale(this.mvMatrix, this.mvMatrix, [rsxz, rsy, rsxz]);
            // 3. ARBITRARY ROTATE: muter-muter pada sumbu miring (badan oleng seperti gasing), pusat di telapak kaki
            mat4.rotate(this.mvMatrix, this.mvMatrix, rs.spin, [0, 1, 0]);
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 2.6, 0.0]);
            // 4. ROTASI biasa: badan bergetar miring (roll)
            mat4.rotate(this.mvMatrix, this.mvMatrix, Math.sin(time * 30) * 0.04 * r, [0, 0, 1]);
        }

        // ===== TRANSFORMASI ROOT JOGET: semua bagian karakter ikut (hierarchy) =====
        if (dance) {
            // 1. TRANSLASI: bergeser ke sisi goyangan + memantul
            mat4.translate(this.mvMatrix, this.mvMatrix, [ds * 0.05, up * 0.04 + (1 - open) * 0.02, 0.0]);
            // 2. SCALING (squash & stretch), pusat di telapak kaki
            const sy  = 0.99 + 0.02 * up;
            const sxz = 1.01 - 0.015 * up;
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -2.6, 0.0]);
            mat4.scale(this.mvMatrix, this.mvMatrix, [sxz, sy, sxz]);
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 2.6, 0.0]);
            // 3. ROTASI biasa: badan miring (roll) searah goyangan
            mat4.rotate(this.mvMatrix, this.mvMatrix, -ds * 0.03, [0, 0, 1]);
            // 4. ARBITRARY ROTATE: badan memutar bolak-balik pada sumbu miring, pusat di tengah badan
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.5, 0.0]);
            mat4.rotate(this.mvMatrix, this.mvMatrix, ds * 0.1, [0.25, 1, 0.15]);
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 0.5, 0.0]);
        }

        this.pushMatrix();
            // Badan & Perut
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -1.0 + bodyBob, 0.0]);
            drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.body);

            // Bawah badan yang lebih rata
            this.bodyLayers.forEach(layer => {
                this.pushMatrix();
                    mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, layer.y, 0.0]);
                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, layer.buf);
                this.popMatrix();
            });

            this.pushMatrix();
                mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.25, 0.78]);
                mat4.rotate(this.mvMatrix, this.mvMatrix, 0.05, [1, 0, 0]);
                drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.belly);
            this.popMatrix();

            // Kaki (joget: telapak bergantian terangkat tipis | jalan: berayun dari pinggul | tantrum: dihentak bergantian + debu)
            [-1, 1].forEach(side => {
                const footLift = dance ? Math.max(0, side * ds) * 0.05 : 0;
                const rageLift = 0.32 * r * Math.pow(Math.max(0, side * sSt), 1.2);   // terangkat tinggi sebelum dihentak
                const tripFoot = side > 0 ? stumbleAmt : 0;                           // kaki kanan nyangkut di jamur
                const swingAng = side * stepS * 0.55 * w + rageLift * 1.6 + tripFoot * 0.7 - fallAmt * side * 0.15;   // ayun maju-mundur
                const stepLift = Math.max(0, side * stepC) * 0.12 * w + rageLift + tripFoot * 0.2;     // terangkat

                // debu muncul sesaat setelah telapak menghantam tanah
                const m = (((rs.ph + (side < 0 ? Math.PI : 0)) % TWO_PI) + TWO_PI) % TWO_PI;
                const tau = m > Math.PI ? (m - Math.PI) / Math.PI : -1;               // 0..1 sejak mendarat
                const dust = (tau >= 0 && tau < 0.45) ? Math.sin(Math.PI * tau / 0.45) : 0;
                if (dust * r > 0.03) {
                    [-1, 1].forEach(d => {
                        this.pushMatrix();
                            mat4.translate(this.mvMatrix, this.mvMatrix, [side * 0.5 + d * (0.45 + 1.1 * tau), -1.55 - bodyBob + 0.12 * dust, 0.2]);
                            mat4.scale(this.mvMatrix, this.mvMatrix, [0.35 * dust * r, 0.22 * dust * r, 0.35 * dust * r]);
                            drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.dust);
                        this.popMatrix();
                    });
                }

                this.pushMatrix();
                    // pivot di pinggul, lalu turun ke posisi telapak (total sama dengan posisi lama saat w = 0 dan r = 0)
                    mat4.translate(this.mvMatrix, this.mvMatrix, [side * 0.5, -0.9, 0.2]);
                    mat4.rotate(this.mvMatrix, this.mvMatrix, -swingAng, [1, 0, 0]);
                    mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.52 - bodyBob + footLift + stepLift, 0.0]);
                    mat4.rotate(this.mvMatrix, this.mvMatrix, -0.1 - footLift * 1.5 - stepLift * 1.2, [1, 0, 0]);
                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.foot);
                this.popMatrix();
            });

            // Tangan
            [-1, 1].forEach(side => {
                this.pushMatrix();
                    if (dance) {
                        // Tangan terangkat ke depan dada, lalu bertepuk
                        const gap   = 0.80 - 0.42 * open;              // sudut ke tengah: 0.80 = menempel, 0.38 = terbuka
                        const pitch = 1.25 - 0.10 * open;              // angkat ke depan; sedikit naik saat terbuka
                        mat4.translate(this.mvMatrix, this.mvMatrix, [side * 1.02, 0.3, 0.55 + (side > 0 ? 0.1 : 0)]);
                        mat4.rotate(this.mvMatrix, this.mvMatrix, -pitch, [1, 0, 0]);          // maju ke depan
                        mat4.rotate(this.mvMatrix, this.mvMatrix, -side * gap, [0, 0, 1]);     // menutup/membuka ke tengah
                        mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.7, 0.0]);
                    } else {
                        const armRest = 0.0;
                        // tantrum: tangan dilempar-lempar ke segala arah (dua frekuensi berbeda per tangan)
                        const aph = rs.armPh + (side > 0 ? 0 : 1.9);
                        const rageArmX = r * 2.3 * Math.sin(aph);                              // ayun depan <-> belakang lewat atas kepala
                        const rageArmZ = r * (0.9 + 0.7 * Math.sin(aph * 1.3 + 1.0));          // melebar ke samping
                        const rageStretch = 1 + r * 0.15 * Math.abs(Math.sin(aph));            // lengan memanjang saat dilempar

                        mat4.translate(this.mvMatrix, this.mvMatrix, [side * 1.02, 0.3, 0.1]);
                        // ayun saat jalan: berlawanan dengan kaki di sisi yang sama
                        // tersandung: tangan terkibas panik, lalu terjulur ke depan menahan jatuh (rotasi X negatif = ke depan)
                        const flail = stumbleAmt * (0.9 + 0.5 * Math.sin(time * 22 + (side > 0 ? 0 : 1.7)));
                        const tripArmX = -(flail + fallAmt * 1.6);
                        const tripArmZ = stumbleAmt * 0.5 + fallAmt * 0.35;
                        mat4.rotate(this.mvMatrix, this.mvMatrix, side * stepS * 0.45 * w + rageArmX + tripArmX, [1, 0, 0]);
                        mat4.rotate(this.mvMatrix, this.mvMatrix, side * (armRest + armLift + rageArmZ + tripArmZ), [0, 0, 1]);
                        mat4.scale(this.mvMatrix, this.mvMatrix, [1.0, rageStretch, 1.0]);
                        mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.7, 0.0]);
                    }
                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.arm);
                this.popMatrix();
            });

            // Uap marah keluar dari kedua sisi kepala (naik, membesar lalu mengecil)
            if (r > 0.03) {
                for (let i = 0; i < 6; i++) {
                    const sd = i % 2 === 0 ? -1 : 1;
                    const u = (time * 0.8 + i / 6) % 1;
                    const sc = r * (0.12 + 0.28 * Math.sin(Math.PI * u));
                    this.pushMatrix();
                        mat4.translate(this.mvMatrix, this.mvMatrix, [sd * (1.5 + 0.5 * u + 0.08 * Math.sin(time * 9 + i)), 1.3 + 2.2 * u, 0.1]);
                        mat4.scale(this.mvMatrix, this.mvMatrix, [sc, sc, sc]);
                        drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.smoke);
                    this.popMatrix();
                }
            }

            // Kepala
            this.pushMatrix();
                mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 1.4, 0.12]);
                // pivot di leher
                mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.8, 0.0]);
                mat4.rotate(this.mvMatrix, this.mvMatrix, headTilt, [0, 0, 1]);
                mat4.rotate(this.mvMatrix, this.mvMatrix, headNod,  [1, 0, 0]);
                mat4.rotate(this.mvMatrix, this.mvMatrix, r * 0.4 * Math.sin(time * 11), [0, 1, 0]);   // kepala menggeleng marah
                mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 0.8, 0.0]);

                this.pushMatrix();
                    mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, this.headEquatorY, 0.0]);
                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.headBottom);
                    mat4.scale(this.mvMatrix, this.mvMatrix, [1.0, -1.0, 1.0]);
                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.headTop);
                this.popMatrix();

                // Duri
                const headRx = 1.7, headRy = this.headEquatorY + 1.4;
                const spikeSink = 0.19;
                const spikeSpread = 1.3;
                [-0.9, -0.3, 0.3, 0.9].forEach(x => {
                    const dy = headRy * Math.sqrt(1 - (x * x) / (headRx * headRx));
                    const y = this.headEquatorY + dy - spikeSink;
                    const nx = x / (headRx * headRx);
                    const ny = dy / (headRy * headRy);
                    const angle = Math.atan2(-nx, ny) * spikeSpread;

                    this.pushMatrix();
                        mat4.translate(this.mvMatrix, this.mvMatrix, [x, y, -0.05]);
                        mat4.rotate(this.mvMatrix, this.mvMatrix, angle, [0, 0, 1]);
                        drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.spike);
                    this.popMatrix();
                });

                // Mata
                [-0.66, 0.66].forEach((xPos, idx) => {
                    this.pushMatrix();
                        let yPos = 0.08;
                        mat4.translate(this.mvMatrix, this.mvMatrix, [xPos, yPos, 0.98]);
                        mat4.rotate(this.mvMatrix, this.mvMatrix, (idx === 0 ? -0.35 : 0.35), [0, 1, 0]);

                        this.pushMatrix();
                            // saat marah: sudut dalam mata turun -> tatapan galak
                            let eyelidTilt = (idx === 0 ? -1 : 1) * 0.32 * r;
                            mat4.rotate(this.mvMatrix, this.mvMatrix, eyelidTilt, [0, 0, 1]);

                            // Kedip: seluruh mata menutup ke arah garis kelopak atas
                            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, this.eyeLidY, 0.0]);
                            mat4.scale(this.mvMatrix, this.mvMatrix, [1.0, eyeScaleY, 1.0]);
                            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -this.eyeLidY, 0.0]);

                            // Tutup kelopak hitam
                            this.pushMatrix();
                                mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, this.eyeLidY, 0.0]);
                                mat4.scale(this.mvMatrix, this.mvMatrix, [1.0, -1.0, 1.0]);
                                drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.eyeBlack);
                            this.popMatrix();

                            // Bagian putih mata
                            this.eyeLayers.forEach(layer => {
                                this.pushMatrix();
                                    mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, layer.y, 0.015]);
                                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, layer.buf);
                                this.popMatrix();
                            });

                            if (dance) {
                                // Pupil bulan sabit "^" kecil, seluruhnya di dalam mata putih
                                const crY = 0.02;                                  // dasar lengkung (puncaknya ~0.22, di bawah kelopak 0.267)
                                const crX = idx === 0 ? 0.12 : -0.12;              // sedikit ke arah tengah, seperti pupil lama
                                this.pushMatrix();
                                    mat4.translate(this.mvMatrix, this.mvMatrix, [crX, crY, 0.16]);
                                    mat4.scale(this.mvMatrix, this.mvMatrix, [1.0, -1.0, 1.0]);
                                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.crescentBlack);
                                this.popMatrix();
                                this.pushMatrix();
                                    mat4.translate(this.mvMatrix, this.mvMatrix, [crX, crY - 0.07, 0.17]);
                                    mat4.scale(this.mvMatrix, this.mvMatrix, [1.0, -1.0, 1.0]);
                                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.crescentCut);
                                this.popMatrix();
                            } else {
                                // Pupil biasa (mengecil saat marah)
                                this.pushMatrix();
                                    let lookCenterX = (idx === 0 ? 0.16 : -0.16) + glance;
                                    mat4.translate(this.mvMatrix, this.mvMatrix, [lookCenterX, this.eyeLidY + 0.05, 0.16]);
                                    mat4.scale(this.mvMatrix, this.mvMatrix, [1 - 0.3 * r, 1 - 0.3 * r, 1.0]);
                                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.pupil);
                                this.popMatrix();
                            }
                        this.popMatrix();
                    this.popMatrix();
                });

                // Efek marah di wajah: pipi merah + tanda urat marah berdenyut di samping kepala
                if (r > 0.02) {
                    const rr = Math.min(1, r * 1.5);
                    [-1, 1].forEach(side => {
                        this.pushMatrix();
                            mat4.translate(this.mvMatrix, this.mvMatrix, [side * 1.0, -0.12, 0.84]);
                            mat4.rotate(this.mvMatrix, this.mvMatrix, side * 0.55, [0, 1, 0]);
                            mat4.scale(this.mvMatrix, this.mvMatrix, [rr, rr, rr]);
                            drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.cheek);
                        this.popMatrix();
                    });

                    const vs = rr * (0.85 + 0.25 * Math.sin(time * 18));
                    this.pushMatrix();
                        mat4.translate(this.mvMatrix, this.mvMatrix, [1.35, 1.0, 0.6]);
                        mat4.rotate(this.mvMatrix, this.mvMatrix, Math.sin(time * 6) * 0.2, [0, 0, 1]);
                        mat4.scale(this.mvMatrix, this.mvMatrix, [vs, vs, vs]);
                        for (let k = 0; k < 4; k++) {
                            const a = Math.PI / 4 + k * Math.PI / 2;
                            this.pushMatrix();
                                mat4.translate(this.mvMatrix, this.mvMatrix, [0.2 * Math.cos(a), 0.2 * Math.sin(a), 0.0]);
                                mat4.rotate(this.mvMatrix, this.mvMatrix, a - Math.PI / 2, [0, 0, 1]);
                                drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.veinBar);
                            this.popMatrix();
                        }
                    this.popMatrix();
                }

                // Mulut (saat marah: rahang bawah membuka-menutup seperti berteriak)
                this.pushMatrix();
                    this.pushMatrix();
                        mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.46, 1.2]);
                        mat4.scale(this.mvMatrix, this.mvMatrix, [0.32, 0.32, 0.32]);
                        drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.upperBeak);
                    this.popMatrix();

                    this.pushMatrix();
                        mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.48 - r * 0.05, 1.17]);
                        mat4.scale(this.mvMatrix, this.mvMatrix, [0.4, 0.55, 0.55]);
                        mat4.rotate(this.mvMatrix, this.mvMatrix, 0.2 + r * 0.4 * (0.6 + 0.4 * Math.sin(time * 22)), [1, 0, 0]);
                        drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.lowerBeak);
                    this.popMatrix();
                this.popMatrix();

            this.popMatrix();
        this.popMatrix();
    }
}