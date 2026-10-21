// File: BadtzMaru.js

class BadtzMaru {
    constructor(gl, programInfo) {
        this.gl = gl;
        this.programInfo = programInfo;
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
        this.buffers.head = createBuffer(this.gl, createEllipsoid(1.62, 1.42, 1.15, colorBlack));
        this.buffers.body = createBuffer(this.gl, createEllipsoid(1.15, 1.5, 0.95, colorBlack)); 
        this.buffers.belly = createBuffer(this.gl, createEllipsoid(0.9, 1.05, 0.45, colorWhite)); 
        
        // Mata & Pupil
        this.buffers.eyeBlack = createBuffer(this.gl, createEllipsoid(0.64, 0.56, 0.3, colorBlack, 0.0));
        this.buffers.eyeWhite = createBuffer(this.gl, createEllipsoid(0.645, 0.565, 0.305, colorWhite, 0.35)); 
        this.buffers.pupil = createBuffer(this.gl, createEllipsoid(0.22, 0.22, 0.1, colorBlack, 0.5));
        
        // Mulut
        this.buffers.upperBeak = createBuffer(this.gl, createBeak(colorYellow));
        this.buffers.lowerBeak = createBuffer(this.gl, createEllipsoid(0.5, 0.15, 0.3, colorYellow));

        // Rambut Duri (Ukuran dipertahankan agar bentuknya tidak berantakan)
        this.buffers.spike = createBuffer(this.gl, createEllipticParaboloid(0.38, 0.38, 1.2, colorBlack)); 
        
        // Tangan & Kaki
        this.buffers.arm = createBuffer(this.gl, createEllipticParaboloid(0.28, 0.22, 0.7, colorBlack)); 
        this.buffers.foot = createBuffer(this.gl, createEllipsoid(0.42, 0.22, 0.5, colorYellow)); 
    }

    render(projectionMatrix, viewMatrix, time, xOffset = 0, yOffset = 0, zOffset = 0) {
        mat4.copy(this.mvMatrix, viewMatrix);
        mat4.translate(this.mvMatrix, this.mvMatrix, [xOffset, yOffset, zOffset]);

        let breathe = Math.sin(time * 3) * 0.03;

        this.pushMatrix();
            // Badan & Perut
            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -1.0 + breathe, 0.0]);
            drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.body);

            this.pushMatrix();
                mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.25, 0.78]); 
                mat4.rotate(this.mvMatrix, this.mvMatrix, 0.05, [1, 0, 0]);
                drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.belly);
            this.popMatrix();

            // Kaki
            let walkAnim = Math.sin(time * 3) * 0.2;
            this.pushMatrix();
                mat4.translate(this.mvMatrix, this.mvMatrix, [-0.48, -1.35, 0.4 + walkAnim]);
                mat4.rotate(this.mvMatrix, this.mvMatrix, -0.2, [1, 0, 0]);
                drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.foot);
            this.popMatrix();
            
            this.pushMatrix();
                mat4.translate(this.mvMatrix, this.mvMatrix, [0.48, -1.35, -0.05 - walkAnim]);
                mat4.rotate(this.mvMatrix, this.mvMatrix, 0.1, [1, 0, 0]);
                drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.foot);
            this.popMatrix();

            // Tangan
            this.pushMatrix();
                mat4.translate(this.mvMatrix, this.mvMatrix, [-1.05, -0.15, 0.2]);
                mat4.rotate(this.mvMatrix, this.mvMatrix, 1.7, [0, 0, 1]); 
                mat4.rotate(this.mvMatrix, this.mvMatrix, 0.2, [1, 0, 0]); 
                drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.arm);
            this.popMatrix();

            this.pushMatrix();
                let armSwing = Math.sin(time * 3) * 0.1;
                mat4.translate(this.mvMatrix, this.mvMatrix, [1.05, -0.1, 0.2]);
                mat4.rotate(this.mvMatrix, this.mvMatrix, -1.2 + armSwing, [0, 0, 1]); 
                mat4.rotate(this.mvMatrix, this.mvMatrix, 0.2, [1, 0, 0]);
                drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.arm);
            this.popMatrix(); 

            // Kepala
            this.pushMatrix();
                mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 1.4, 0.12]); 
                drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.head);

                // ==========================================
                // PERBAIKAN: PANGKAL RAMBUT DIRAPATKAN, UJUNG TETAP MEKAR
                // Koordinat X digeser mendekat ke tengah, sudut rotasi Z dipertahankan lebar
                // ==========================================
                
                // 1. DURI LUAR KIRI
                this.pushMatrix();
                    mat4.translate(this.mvMatrix, this.mvMatrix, [-0.75, 0.92, -0.05]); // Pangkal dirapatkan
                    mat4.rotate(this.mvMatrix, this.mvMatrix, 0.45, [0, 0, 1]); // Rotasi tetap mekar lebar
                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.spike);
                this.popMatrix();

                // 2. DURI DALAM KIRI
                this.pushMatrix();
                    mat4.translate(this.mvMatrix, this.mvMatrix, [-0.26, 1.12, -0.05]);
                    mat4.rotate(this.mvMatrix, this.mvMatrix, 0.15, [0, 0, 1]); 
                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.spike);
                this.popMatrix();

                // 3. DURI DALAM KANAN
                this.pushMatrix();
                    mat4.translate(this.mvMatrix, this.mvMatrix, [0.26, 1.12, -0.05]);
                    mat4.rotate(this.mvMatrix, this.mvMatrix, -0.15, [0, 0, 1]);
                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.spike);
                this.popMatrix();

                // 4. DURI LUAR KANAN
                this.pushMatrix();
                    mat4.translate(this.mvMatrix, this.mvMatrix, [0.75, 0.92, -0.05]);
                    mat4.rotate(this.mvMatrix, this.mvMatrix, -0.45, [0, 0, 1]);
                    drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.spike);
                this.popMatrix();

                // Mata
                [-0.5, 0.5].forEach((xPos, idx) => {
                    this.pushMatrix();
                        let yPos = 0.06; 
                        mat4.translate(this.mvMatrix, this.mvMatrix, [xPos, yPos, 1.15]);
                        mat4.rotate(this.mvMatrix, this.mvMatrix, (idx === 0 ? -0.15 : 0.15), [0, 1, 0]); 

                        drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.eyeBlack);
                        
                        this.pushMatrix();
                            mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, 0.0, 0.015]); 
                            let eyelidTilt = idx === 1 ? -0.15 : 0.0;
                            mat4.rotate(this.mvMatrix, this.mvMatrix, eyelidTilt, [0, 0, 1]);
                            drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.eyeWhite);
                            
                            this.pushMatrix();
                                let lookCenterX = idx === 0 ? 0.16 : -0.16;
                                mat4.translate(this.mvMatrix, this.mvMatrix, [lookCenterX, 0.26, 0.305]);
                                drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.pupil);
                            this.popMatrix();
                        this.popMatrix();
                    this.popMatrix();
                });

                // Mulut
                this.pushMatrix();
                    this.pushMatrix();
                        mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.42, 1.35]); 
                        mat4.scale(this.mvMatrix, this.mvMatrix, [0.32, 0.32, 0.32]); 
                        drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.upperBeak);
                    this.popMatrix();
                    
                    this.pushMatrix();
                        mat4.translate(this.mvMatrix, this.mvMatrix, [0.0, -0.50, 1.32]);
                        mat4.scale(this.mvMatrix, this.mvMatrix, [0.4, 0.55, 0.55]); 
                        mat4.rotate(this.mvMatrix, this.mvMatrix, 0.2, [1, 0, 0]);
                        drawBuffer(this.gl, this.programInfo, this.mvMatrix, projectionMatrix, this.buffers.lowerBeak);
                    this.popMatrix();
                this.popMatrix();

            this.popMatrix(); 
        this.popMatrix(); 
    }
}