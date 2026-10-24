// Badtz-Maru sebagai "factory": window.createBadtz(GL, cam)
// Isi file ini = bagian <script> inline dari index_badtz.html (shader + programInfo + new BadtzMaru),
// dipindah ke sini supaya canvas, kamera, dan loop dipegang world.js saja.
// Butuh (sudah dimuat index.html): gl-matrix (mat4), glUtils.js, BadtzMaru.js
(function () {

window.createBadtz = function (GL, cam) {

    const vsSource = `
        attribute vec4 aVertexPosition; attribute vec3 aVertexNormal; attribute vec4 aVertexColor;
        uniform mat4 uModelViewMatrix; uniform mat4 uProjectionMatrix; uniform mat4 uNormalMatrix;
        varying vec4 vColor; varying vec3 vLightWeighting;
        void main() {
            gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
            vec3 normal = normalize((uNormalMatrix * vec4(aVertexNormal, 1.0)).xyz);
            float directional = max(dot(normal, normalize(vec3(0.4, 1.0, 0.6))), 0.0);
            vLightWeighting = vec3(0.4) + vec3(0.6) * directional;
            vColor = aVertexColor;
        }
    `;
    const fsSource = `
        precision mediump float; varying vec4 vColor; varying vec3 vLightWeighting;
        void main() { gl_FragColor = vec4(vColor.rgb * vLightWeighting, vColor.a); }
    `;

    const prog = GL.createProgram();
    GL.attachShader(prog, loadShader(GL, GL.VERTEX_SHADER, vsSource));
    GL.attachShader(prog, loadShader(GL, GL.FRAGMENT_SHADER, fsSource));
    GL.linkProgram(prog);

    const programInfo = {
        attribLocations: {
            vertexPosition: GL.getAttribLocation(prog, 'aVertexPosition'),
            vertexNormal: GL.getAttribLocation(prog, 'aVertexNormal'),
            vertexColor: GL.getAttribLocation(prog, 'aVertexColor'),
        },
        uniformLocations: {
            projectionMatrix: GL.getUniformLocation(prog, 'uProjectionMatrix'),
            modelViewMatrix: GL.getUniformLocation(prog, 'uModelViewMatrix'),
            normalMatrix: GL.getUniformLocation(prog, 'uNormalMatrix'),
        },
    };

    // bindKeys = false: tombol dikelola world.js (hanya karakter yang sedang difokus yang bereaksi)
    const badtz = new BadtzMaru(GL, programInfo, 'idle', false);
    badtz.init();

    const mv = mat4.create();
    let lastM = null;

    // Tinggi tanah relatif (satuan lokal) di titik (xl, zl) lokal karakter, supaya jalan tidak melayang / tenggelam
    badtz.groundFn = function (xl, zl) {
        if (!lastM || !window.ENV || !window.ENV.groundHeight) return 0;
        const s = Math.hypot(lastM[0], lastM[1], lastM[2]) || 1;
        const x0 = lastM[12], z0 = lastM[14];
        const x1 = x0 + lastM[0] * xl + lastM[8] * zl;
        const z1 = z0 + lastM[2] * xl + lastM[10] * zl;
        return (window.ENV.groundHeight(x1, z1) - window.ENV.groundHeight(x0, z0)) / s;
    };

    return {
        animations: ['idle', 'dance', 'walk', 'rage', 'straight', 'trip', 'reset'],
        // 'idle' | 'dance' | 'walk' (jalan melingkar) | 'rage' (marah) | 'straight' (jalan lurus)
        // semuanya berjalan terus sampai animasi lain dipicu; 'trip' = jamur tumbuh, jalan sedikit, jatuh, bangun, idle
        // 'reset' = kembali ke titik awal
        play: function (name) {
            switch (name) {
                case 'idle':     badtz.idle(); break;
                case 'dance':    badtz.dance(); break;
                case 'walk':     badtz.walk(); break;
                case 'rage':     badtz.rage(); break;
                case 'straight': badtz.walkStraight(); break;
                case 'trip':     badtz.tripOver(); break;
                case 'reset':    badtz.resetPosition(); break;
            }
        },
        current: function () { return badtz.mode; },
        // dipakai kamera world.js supaya mengikuti Badtz saat jalan lurus (offset dunia dari titik awal)
        focusOffset: function (M) {
            const x = badtz.pos.x, z = badtz.pos.z;
            return [M[0] * x + M[8] * z, 0, M[2] * x + M[10] * z];
        },

        // M = model matrix dunia dari world.js (translasi * rotasi * skala)
        draw: function (M, t) {
            // Context dipakai bersama: set ulang program & attribute milik Badtz tiap draw
            GL.useProgram(prog);
            for (let a = 0; a < 8; a++) GL.disableVertexAttribArray(a);
            GL.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);
            GL.enableVertexAttribArray(programInfo.attribLocations.vertexNormal);
            GL.enableVertexAttribArray(programInfo.attribLocations.vertexColor);

            // BadtzMaru.render() menerima "viewMatrix" lalu menggambar di atasnya,
            // jadi kita kirim View * Model supaya karakter muncul di posisi dunianya.
            lastM = M;
            mat4.multiply(mv, cam.V, M);
            badtz.render(cam.P, mv, t, 0, 0, 0);
        }
    };
};

})();
