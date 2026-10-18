// Badtz-Maru sebagai "factory": window.createBadtz(GL, cam)
// BadtzMaru.js dan glUtils.js TIDAK diubah. Shader-nya dibuat di sini
// (nama atribut/uniform cocok dengan programInfo yang dipakai BadtzMaru.js).
(function () {

    var VS = [
        "attribute vec3 vertexPosition;",
        "attribute vec3 vertexNormal;",
        "attribute vec4 vertexColor;",
        "uniform mat4 modelViewMatrix;",
        "uniform mat4 projectionMatrix;",
        "uniform mat4 normalMatrix;",
        "varying vec3 vNormal;",
        "varying vec4 vColor;",
        "varying vec3 vView;",
        "void main(void) {",
        "    vec4 p = modelViewMatrix * vec4(vertexPosition, 1.0);",
        "    gl_Position = projectionMatrix * p;",
        "    vNormal = (normalMatrix * vec4(vertexNormal, 0.0)).xyz;",
        "    vColor = vertexColor;",
        "    vView = p.xyz;",
        "}"
    ].join("\n");

    // pencahayaan sama dengan Kuromi (cahaya tetap terhadap kamera)
    var FS = [
        "precision mediump float;",
        "varying vec3 vNormal;",
        "varying vec4 vColor;",
        "varying vec3 vView;",
        "void main(void) {",
        "    vec3 N = normalize(vNormal);",
        "    vec3 L = normalize(vec3(-0.4, 0.7, 0.8));",
        "    vec3 V = normalize(-vView);",
        "    vec3 H = normalize(L + V);",
        "    float diff = max(dot(N, L), 0.0);",
        "    float spec = pow(max(dot(N, H), 0.0), 28.0);",
        "    float rim  = pow(1.0 - max(dot(N, V), 0.0), 3.0);",
        "    vec3 col = vColor.rgb * (0.5 + 0.6 * diff) + vec3(0.22) * spec + vec3(0.10) * rim;",
        "    gl_FragColor = vec4(col, 1.0);",
        "}"
    ].join("\n");

    window.createBadtz = function (GL, cam) {
        function compile(type, src, name) {
            var s = GL.createShader(type);
            GL.shaderSource(s, src);
            GL.compileShader(s);
            if (!GL.getShaderParameter(s, GL.COMPILE_STATUS)) {
                alert("BADTZ " + name + " SHADER: " + GL.getShaderInfoLog(s));
            }
            return s;
        }

        var prog = GL.createProgram();
        GL.attachShader(prog, compile(GL.VERTEX_SHADER, VS, "VERTEX"));
        GL.attachShader(prog, compile(GL.FRAGMENT_SHADER, FS, "FRAGMENT"));
        GL.linkProgram(prog);
        if (!GL.getProgramParameter(prog, GL.LINK_STATUS)) {
            alert("BADTZ LINK: " + GL.getProgramInfoLog(prog));
        }

        var programInfo = {
            program: prog,
            attribLocations: {
                vertexPosition: GL.getAttribLocation(prog, "vertexPosition"),
                vertexNormal: GL.getAttribLocation(prog, "vertexNormal"),
                vertexColor: GL.getAttribLocation(prog, "vertexColor")
            },
            uniformLocations: {
                projectionMatrix: GL.getUniformLocation(prog, "projectionMatrix"),
                modelViewMatrix: GL.getUniformLocation(prog, "modelViewMatrix"),
                normalMatrix: GL.getUniformLocation(prog, "normalMatrix")
            }
        };

        var badtz = new BadtzMaru(GL, programInfo);
        badtz.init();

        var modelView = mat4.create();
        var loc = programInfo.attribLocations;

        return {
            // M = model matrix dari world.js, time = detik
            draw: function (M, time) {
                GL.useProgram(prog);
                for (var a = 0; a < 8; a++) GL.disableVertexAttribArray(a);
                GL.enableVertexAttribArray(loc.vertexPosition);
                GL.enableVertexAttribArray(loc.vertexNormal);
                GL.enableVertexAttribArray(loc.vertexColor);

                // BadtzMaru.render() menganggap argumen ke-2 sebagai "view matrix"
                // lalu menambahkan transform tiap bagian di atasnya, jadi kirim View * Model.
                mat4.multiply(modelView, cam.V, M);
                badtz.render(cam.P, modelView, time, 0, 0, 0);
            }
        };
    };
})();