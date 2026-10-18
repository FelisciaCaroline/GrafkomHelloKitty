// File: glUtils.js

// GEN 1: Ellipsoid standar (Kepala, Badan, Perut, Mata, Pupil, Kaki, Mulut Bawah)
function createEllipsoid(rx, ry, rz, color, topCutRatio = 0.0, latBands = 40, longBands = 40) {
    let pos = [], norm = [], col = [], idx = [];
    let startLatNumber = Math.floor(latBands * topCutRatio); 

    for (let lat = startLatNumber; lat <= latBands; lat++) {
        let theta = lat * Math.PI / latBands;
        let sinTheta = Math.sin(theta), cosTheta = Math.cos(theta);
        for (let long = 0; long <= longBands; long++) {
            let phi = long * 2 * Math.PI / longBands;
            let sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
            let x = cosPhi * sinTheta, y = cosTheta, z = sinPhi * sinTheta;
            
            pos.push(rx * x, ry * y, rz * z);
            let nx = x / rx, ny = y / ry, nz = z / rz;
            let len = Math.sqrt(nx*nx + ny*ny + nz*nz);
            norm.push(nx/len, ny/len, nz/len);
            col.push(...color);
        }
    }
    let latRange = latBands - startLatNumber;
    for (let lat = 0; lat < latRange; lat++) {
        for (let long = 0; long < longBands; long++) {
            let first = (lat * (longBands + 1)) + long;
            let second = first + longBands + 1;
            idx.push(first, second, first + 1, second, second + 1, first + 1);
        }
    }
    return { pos, norm, col, idx };
}

// GEN 2: Elliptic Paraboloid (Digunakan untuk Rambut Duri & Tangan sesuai permintaan baru)
function createEllipticParaboloid(rx, rz, height, color, segmentsU = 20, segmentsV = 20) {
    let pos = [], norm = [], col = [], idx = [];
    for (let i = 0; i <= segmentsU; i++) {
        let u = i / segmentsU; // dari 0 ke 1 (radius proporsi)
        for (let j = 0; j <= segmentsV; j++) {
            let theta = (j / segmentsV) * 2 * Math.PI;
            let x = u * rx * Math.cos(theta);
            let z = u * rz * Math.sin(theta);
            let y = height * (1.0 - (u * u)); // Rumus paraboloid melengkung
            
            pos.push(x, y, z);
            // Normal kuadrik untuk elliptic paraboloid
            let nx = (2 * x) / (rx * rx);
            let ny = 1.0;
            let nz = (2 * z) / (rz * rz);
            let len = Math.sqrt(nx*nx + ny*ny + nz*nz);
            norm.push(nx/len, ny/len, nz/len);
            col.push(...color);
        }
    }
    for (let i = 0; i < segmentsU; i++) {
        for (let j = 0; j < segmentsV; j++) {
            let p1 = i * (segmentsV + 1) + j;
            let p2 = p1 + segmentsV + 1;
            idx.push(p1, p2, p1 + 1, p1 + 1, p2, p2 + 1);
        }
    }
    return { pos, norm, col, idx };
}

// GEN 3: Extruded Bezier Curve (Mulut Bagian Atas)
function createBeak(color, segmentsT = 30, segmentsRot = 20) {
    let pos = [], norm = [], col = [], idx = [];
    let p0 = {x: -1.0, y: -0.2}, p1 = {x: -0.5, y: 0.3}, p2 = {x: 0.5, y: 0.3}, p3 = {x: 1.0, y: -0.2};

    for (let i = 0; i <= segmentsT; i++) {
        let t = i / segmentsT;
        let omt = 1 - t;
        let bx = omt*omt*omt*p0.x + 3*omt*omt*t*p1.x + 3*omt*t*t*p2.x + t*t*t*p3.x;
        let by = omt*omt*omt*p0.y + 3*omt*omt*t*p1.y + 3*omt*t*t*p2.y + t*t*t*p3.y;

        let dx = 3*omt*omt*(p1.x-p0.x) + 6*omt*t*(p2.x-p1.x) + 3*t*t*(p3.x-p2.x);
        let dy = 3*omt*omt*(p1.y-p0.y) + 6*omt*t*(p2.y-p1.y) + 3*t*t*(p3.y-p2.y);
        let lenD = Math.sqrt(dx*dx + dy*dy);
        let tx = dx / lenD, ty = dy / lenD;
        let nx2d = -ty, ny2d = tx;
        let thickness = Math.sin(t * Math.PI) * 0.25 + 0.05; 

        for (let j = 0; j <= segmentsRot; j++) {
            let angle = (j / segmentsRot) * 2 * Math.PI;
            let cosA = Math.cos(angle), sinA = Math.sin(angle);
            let x = bx + nx2d * cosA * thickness;
            let y = by + ny2d * cosA * thickness;
            let z = sinA * thickness * 1.5; 
            pos.push(x, y, z);
            
            let nx = nx2d * cosA, ny = ny2d * cosA, nz = sinA;
            let len = Math.sqrt(nx*nx + ny*ny + nz*nz);
            norm.push(nx/len, ny/len, nz/len);
            col.push(...color);
        }
    }
    for (let i = 0; i < segmentsT; i++) {
        for (let j = 0; j < segmentsRot; j++) {
            let p1 = i * (segmentsRot + 1) + j;
            let p2 = p1 + segmentsRot + 1;
            idx.push(p1, p2, p1 + 1, p1 + 1, p2, p2 + 1);
        }
    }
    return { pos, norm, col, idx };
}

// SETUP BUFFER & DRAW
function createBuffer(gl, geometry) {
    let buf = {};
    buf.pos = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.pos), gl.STATIC_DRAW);
    buf.norm = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf.norm); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.norm), gl.STATIC_DRAW);
    buf.col = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf.col); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.col), gl.STATIC_DRAW);
    buf.idx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geometry.idx), gl.STATIC_DRAW);
    buf.count = geometry.idx.length;
    return buf;
}

function drawBuffer(gl, programInfo, mvMatrix, pMatrix, buffer) {
    let loc = programInfo.attribLocations;
    let uni = programInfo.uniformLocations;

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer.pos); gl.vertexAttribPointer(loc.vertexPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer.norm); gl.vertexAttribPointer(loc.vertexNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer.col); gl.vertexAttribPointer(loc.vertexColor, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer.idx);
    
    let normalMatrix = mat4.create();
    mat4.invert(normalMatrix, mvMatrix);
    mat4.transpose(normalMatrix, normalMatrix);
    
    gl.uniformMatrix4fv(uni.projectionMatrix, false, pMatrix);
    gl.uniformMatrix4fv(uni.modelViewMatrix, false, mvMatrix);
    gl.uniformMatrix4fv(uni.normalMatrix, false, normalMatrix);
    
    gl.drawElements(gl.TRIANGLES, buffer.count, gl.UNSIGNED_SHORT, 0);
}

function loadShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
}