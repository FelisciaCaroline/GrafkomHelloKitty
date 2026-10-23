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

    const badtz = new BadtzMaru(GL, programInfo);   // mode: 'idle' | 'dance'
    badtz.init();

    const mv = mat4.create();

    return {
        animations: ['idle', 'dance'],
        play: function (name) { badtz.mode = name; },    // 'idle' | 'dance'
        current: function () { return badtz.mode; },

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
            mat4.multiply(mv, cam.V, M);
            badtz.render(cam.P, mv, t, 0, 0, 0);
        }
    };
};

})();
