// kuromi_shaders.js
// Shader (vertex + fragment), kompilasi, dan lokasi uniform/attribute Kuromi.
// Dimuat SEBELUM kuromi.js. Mengisi window.KuromiLib.createShaders(GL).
(function () {

var L = window.KuromiLib = window.KuromiLib || {};

L.createShaders = function (GL) {
    var shader_vertex_source = `
        attribute vec3 position;
        attribute vec3 normal;
        attribute vec2 uv;
        uniform mat4 Pmatrix, Vmatrix, Mmatrix;
        uniform vec3 uOffset, uScale;
        uniform mat4 uLocalRotation;
        varying vec3 vNormal;
        varying vec2 vUV;

        void main(void) {
            vec3 p = (uLocalRotation * vec4(position * uScale, 1.0)).xyz + uOffset;
            gl_Position = Pmatrix * Vmatrix * Mmatrix * vec4(p, 1.0);

            vec3 n = normalize(normal / uScale);
            vNormal = (Vmatrix * Mmatrix * uLocalRotation * vec4(n, 0.0)).xyz;
            vUV = uv;
        }`;

    var shader_fragment_source = `
        precision mediump float;
        uniform vec3 uColor;
        uniform sampler2D uTex;
        uniform float uUseTex;
        varying vec3 vNormal;
        varying vec2 vUV;

        void main(void) {
            vec3 base = uColor;
            if (uUseTex > 0.5) {
                vec4 t = texture2D(uTex, vUV);
                if (t.a < 0.5) discard;
                base = t.rgb * uColor;
            }

            vec3 N = normalize(vNormal);
            vec3 L = normalize(vec3(-0.4, 0.7, 0.8));
            vec3 V = vec3(0.0, 0.0, 1.0);
            vec3 H = normalize(L + V);

            float diff = max(dot(N, L), 0.0);
            float spec = pow(max(dot(N, H), 0.0), 28.0);
            float rim  = pow(1.0 - max(dot(N, V), 0.0), 3.0);

            vec3 col = base * (0.5 + 0.6 * diff) + vec3(0.22) * spec + vec3(0.10) * rim;
            gl_FragColor = vec4(col, 1.0);
        }`;

    var compile_shader = function (source, type, typeString) {
        var shader = GL.createShader(type);
        GL.shaderSource(shader, source);
        GL.compileShader(shader);
        if (!GL.getShaderParameter(shader, GL.COMPILE_STATUS)) {
            alert("KUROMI " + typeString + " SHADER: " + GL.getShaderInfoLog(shader));
            return false;
        }
        return shader;
    };

    var SHADER_PROGRAM = GL.createProgram();
    GL.attachShader(SHADER_PROGRAM, compile_shader(shader_vertex_source, GL.VERTEX_SHADER, "VERTEX"));
    GL.attachShader(SHADER_PROGRAM, compile_shader(shader_fragment_source, GL.FRAGMENT_SHADER, "FRAGMENT"));
    GL.linkProgram(SHADER_PROGRAM);
    GL.useProgram(SHADER_PROGRAM);

    var _position = GL.getAttribLocation(SHADER_PROGRAM, "position");
    var _normal = GL.getAttribLocation(SHADER_PROGRAM, "normal");
    var _uv = GL.getAttribLocation(SHADER_PROGRAM, "uv");

    var _Pmatrix = GL.getUniformLocation(SHADER_PROGRAM, "Pmatrix");
    var _Vmatrix = GL.getUniformLocation(SHADER_PROGRAM, "Vmatrix");
    var _Mmatrix = GL.getUniformLocation(SHADER_PROGRAM, "Mmatrix");
    var _uOffset = GL.getUniformLocation(SHADER_PROGRAM, "uOffset");
    var _uScale = GL.getUniformLocation(SHADER_PROGRAM, "uScale");
    var _uColor = GL.getUniformLocation(SHADER_PROGRAM, "uColor");
    var _uRot = GL.getUniformLocation(SHADER_PROGRAM, "uLocalRotation");
    var _uTex = GL.getUniformLocation(SHADER_PROGRAM, "uTex");
    var _uUseTex = GL.getUniformLocation(SHADER_PROGRAM, "uUseTex");

    return {
        program: SHADER_PROGRAM,
        position: _position, normal: _normal, uv: _uv,
        Pmatrix: _Pmatrix, Vmatrix: _Vmatrix, Mmatrix: _Mmatrix,
        uOffset: _uOffset, uScale: _uScale, uColor: _uColor,
        uRot: _uRot, uTex: _uTex, uUseTex: _uUseTex
    };
};

})();