// File: BadtzMaru.js
// mode 'idle'  -> animasi idle (halaman index.html)
// mode 'dance' -> animasi joget senang (halaman dance.html)

class BadtzMaru {
    constructor(gl, programInfo, mode = 'idle') {
        this.gl = gl;
        this.programInfo = programInfo;
        this.mode = mode;
        this.buffers = {};
        this.mvMatrix = mat4.create();
        this.mvMatrixStack = [];
    }

    pushMatrix() { this.mvMatrixStack.push(mat4.clone(this.mvMatrix)); }
    popMatrix() { if (this.mvMatrixStack.length > 0) this.mvMatrix = this.mvMatrixStack.pop(); }

    init() {
        const colorBlack = [0.08, 0.08, 0.1, 1.0];
        const colorWhite = [1.0, 1.0, 1.0, 1.0];
        const colorYellow = [0.95, 0.95, 0.0, 1.0];

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
    }

    render(projectionMatrix, viewMatrix, time, xOffset = 0, yOffset = 0, zOffset = 0) {
        mat4.copy(this.mvMatrix, viewMatrix);
        mat4.translate(this.mvMatrix, this.mvMatrix, [xOffset, yOffset, zOffset]);

        const dance = this.mode === 'dance';

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

        let headTilt = sway * 0.14 * vary;
        let headNod  = beat * 0.10 * vary;
        let armLift  = beat * 0.30 * vary;
        let bodyBob  = (1 - beat) * 0.08;
        if (dance) {
            headTilt = ds * 0.08;
            headNod  = 0.03 + (1 - open) * 0.05;   // sedikit mengangguk tiap tepukan
            bodyBob  = 0;
        }

        // ===== KEDIPAN MATA =====
        const blinkPulse = (t, period, dur) => { const m = t % period; return m < dur ? Math.sin(Math.PI * m / dur) : 0; };
        const blink = Math.max(blinkPulse(time, 3.7, 0.16), blinkPulse(time + 1.1, 5.3, 0.16));
        const eyeScaleY = dance ? 1 : 1 - blink * 0.92;

        // ===== GERAKAN MATA KIRI-KANAN =====
        const glance = Math.sin(time * 0.7) * Math.sin(time * 0.43) * 0.06;

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

            // Kaki (saat joget: telapak bergantian terangkat tipis mengikuti goyangan)
            [-1, 1].forEach(side => {
                const footLift = dance ? Math.max(0, side * ds) * 0.05 : 0;
                this.pushMatrix();
                    mat4.translate(this.mvMatrix, this.mvMatrix, [side * 0.5, -1.42 - bodyBob + footLift, 0.2]);
                    mat4.rotate(this.mvMatrix, this.mvMatrix, -0.1 - footLift * 1.5, [1, 0, 0]);
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
                        mat4.translate(this.mvMatrix, this.mvMatrix, [side * 1.02, 0.3, 0.1]);
                        mat4.rotate(this.mvMatrix, this.mvMatrix, side * (armRest + armLift), [0, 0, 1]);
                        mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.7, 0.0]);
                    }
                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.arm);
                this.popMatrix();
            });

            // Kepala
            this.pushMatrix();
                mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 1.4, 0.12]);
                // pivot di leher
                mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.8, 0.0]);
                mat4.rotate(this.mvMatrix, this.mvMatrix, headTilt, [0, 0, 1]);
                mat4.rotate(this.mvMatrix, this.mvMatrix, headNod,  [1, 0, 0]);
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
                            let eyelidTilt = 0.0;
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
                                // Pupil biasa
                                this.pushMatrix();
                                    let lookCenterX = (idx === 0 ? 0.16 : -0.16) + glance;
                                    mat4.translate(this.mvMatrix, this.mvMatrix, [lookCenterX, this.eyeLidY + 0.05, 0.16]);
                                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.pupil);
                                this.popMatrix();
                            }
                        this.popMatrix();
                    this.popMatrix();
                });

                // Mulut
                this.pushMatrix();
                    this.pushMatrix();
                        mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.46, 1.2]);
                        mat4.scale(this.mvMatrix, this.mvMatrix, [0.32, 0.32, 0.32]);
                        drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.upperBeak);
                    this.popMatrix();

                    this.pushMatrix();
                        mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.48, 1.17]);
                        mat4.scale(this.mvMatrix, this.mvMatrix, [0.4, 0.55, 0.55]);
                        mat4.rotate(this.mvMatrix, this.mvMatrix, 0.2, [1, 0, 0]);
                        drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.lowerBeak);
                    this.popMatrix();
                this.popMatrix();

            this.popMatrix();
        this.popMatrix();
    }
}