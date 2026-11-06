'use strict';
/* Native renderer for the club's existing portal meshes and baked steel materials. */
$(function () {
  const hero = $('.portal-hero')[0];
  const canvas = $('#portal-canvas')[0];
  const visual = $('.portal-visual')[0];
  const controls = $('.portal-motion-controls')[0];
  const motionButton = $('#portal-motion')[0];
  if (!hero || !canvas || !visual) return;
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const mobileQuery = matchMedia('(max-width: 767px)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const lowPower = (navigator.deviceMemory && navigator.deviceMemory <= 4) || navigator.connection?.saveData;
  const mobile = () => mobileQuery.matches;
  const lite = () => mobile() || lowPower;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  function multiply(left, right) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) for (let row = 0; row < 4; row += 1) {
      for (let k = 0; k < 4; k += 1) out[column * 4 + row] += left[k * 4 + row] * right[column * 4 + k];
    }
    return out;
  }
  function transform(position, rotation, scale) {
    const [x, y, z] = rotation;
    const rx = identity(), ry = identity(), rz = identity();
    rx[5] = Math.cos(x); rx[6] = Math.sin(x); rx[9] = -Math.sin(x); rx[10] = Math.cos(x);
    ry[0] = Math.cos(y); ry[2] = -Math.sin(y); ry[8] = Math.sin(y); ry[10] = Math.cos(y);
    rz[0] = Math.cos(z); rz[1] = Math.sin(z); rz[4] = -Math.sin(z); rz[5] = Math.cos(z);
    const out = multiply(multiply(rx, ry), rz);
    for (let axis = 0; axis < 3; axis += 1) for (let row = 0; row < 4; row += 1) out[axis * 4 + row] *= scale[axis];
    out[12] = position[0]; out[13] = position[1]; out[14] = position[2];
    return out;
  }
  function perspective(aspect) {
    const f = 1 / Math.tan(38 * Math.PI / 360), near = .1, far = 65;
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
  }
  function viewMatrix(eye, target, up = [0, 1, 0]) {
    const normalize = vector => { const length = Math.hypot(...vector); return vector.map(value => value / length); };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const z = normalize(eye.map((value, index) => value - target[index]));
    const x = normalize(cross(up, z)), y = cross(z, x);
    const dot = a => a.reduce((sum, value, index) => sum + value * eye[index], 0);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x), -dot(y), -dot(z), 1]);
  }
  function showControls(show) {
    $(controls).removeAttr('hidden');
    $(controls).toggleClass('d-none', !show);
  }
  function fallback() {
    $(hero).removeClass('scene-ready');
    hero.dataset.renderer = 'fallback';
    showControls(false);
  }
  const loadImage = url => new Promise((resolve, reject) => {
    const image = new Image(); $(image).on('load', () => resolve(image)).on('error', reject); image.src = url;
  });
  let gl = null, resources = null, assets = null;
  let materialRevision = 0, loadingVariant = null;
  let request = 0, previousTime = 0, activeTime = 0, zoom = 0, zoomTarget = 0;
  let paused = false, reduced = reducedQuery.matches, visible = true, contextLost = false, disposed = false;
  let qualityLowered = false, samples = [], width = 1, height = 1;
  const pointer = {x: 0, y: 0}, pointerTarget = {x: 0, y: 0};
  function stop() { cancelAnimationFrame(request); request = 0; previousTime = 0; }
  function compile(type, source) {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Portal shader unavailable'); }
    return shader;
  }
  function program(vertex, fragment, names) {
    const result = gl.createProgram(), a = compile(gl.VERTEX_SHADER, vertex), b = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(result, a); gl.attachShader(result, b); gl.linkProgram(result); gl.deleteShader(a); gl.deleteShader(b);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) { gl.deleteProgram(result); throw new Error('Portal renderer unavailable'); }
    return {value: result, position: gl.getAttribLocation(result, 'a_position'), uv: gl.getAttribLocation(result, 'a_uv'),
      uniforms: Object.fromEntries(names.map(name => [name, gl.getUniformLocation(result, name)]))};
  }
  function buffer(values) {
    const result = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, result); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW); return result;
  }
  function texture(image) {
    const result = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, result); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
    if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return result;
  }
  function mesh(position, uv, map, translation = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
    return {position: buffer(position), uv: buffer(uv), texture: map, count: position.length / 3, translation, rotation, scale};
  }
  function plane(w, h, map, z) {
    return mesh([-w / 2, -h / 2, 0, w / 2, -h / 2, 0, -w / 2, h / 2, 0, -w / 2, h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0],
      [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1], map, [0, 0, z], [0, 0, -.035]);
  }
  function selectVariant(scene) {
    const rect = visual.getBoundingClientRect(), aspect = rect.width / Math.max(1, rect.height);
    return scene.variants.filter(variant => variant.mobile === mobile())
      .reduce((best, variant) => Math.abs(Math.log(variant.aspect / aspect)) < Math.abs(Math.log(best.aspect / aspect)) ? variant : best);
  }
  function updateMaterials() {
    if (!assets || !resources) return;
    const variant = selectVariant(assets.scene);
    if (variant.id === assets.variant) { materialRevision += 1; loadingVariant = null; return; }
    if (variant.id === loadingVariant) return;
    const revision = ++materialRevision; loadingVariant = variant.id;
    Promise.all(variant.atlases.map(file => loadImage(`assets/portal/${file}`))).then(images => {
      if (revision !== materialRevision || disposed) return;
      loadingVariant = null; assets.images.splice(0, 6, ...images); assets.variant = variant.id;
      if (contextLost || !resources) return;
      for (let index = 0; index < 6; index += 1) {
        const previous = resources.maps[index], next = texture(images[index]);
        resources.maps[index] = next; resources.rings[index].texture = next; gl.deleteTexture(previous);
      }
      draw(0); if (!paused && !reduced) wake();
    }).catch(() => { if (revision === materialRevision) loadingVariant = null; });
  }
  function release() {
    if (!resources || !gl || contextLost) { resources = null; return; }
    for (const object of [...resources.rings, resources.photo, resources.backing, resources.floor]) { gl.deleteBuffer(object.position); gl.deleteBuffer(object.uv); }
    for (const map of resources.maps) gl.deleteTexture(map);
    gl.deleteTexture(resources.reflection.texture); gl.deleteFramebuffer(resources.reflection.framebuffer); gl.deleteRenderbuffer(resources.reflection.depth);
    gl.deleteProgram(resources.material.value); gl.deleteProgram(resources.ground.value); resources = null;
  }
  function initialize() {
    const material = program(`
      attribute vec3 a_position; attribute vec2 a_uv;
      uniform mat4 u_mvp; varying vec2 v_uv;
      void main(){v_uv=a_uv;gl_Position=u_mvp*vec4(a_position,1.0);}`, `
      precision mediump float;
      uniform sampler2D u_texture; uniform vec3 u_tint; uniform vec2 u_crop; uniform float u_light;
      varying vec2 v_uv;
      void main(){vec3 color=texture2D(u_texture,vec2(v_uv.x*u_crop.x+u_crop.y,v_uv.y)).rgb;
        gl_FragColor=vec4(color*u_tint*u_light,1.0);}`, ['u_mvp', 'u_texture', 'u_tint', 'u_crop', 'u_light']);
    const ground = program(`
      attribute vec3 a_position; attribute vec2 a_uv;
      uniform mat4 u_mvp; uniform mat4 u_reflection; varying vec4 v_reflection; varying vec3 v_world;
      void main(){v_world=a_position;v_reflection=u_reflection*vec4(a_position,1.0);gl_Position=u_mvp*vec4(a_position,1.0);}`, `
      precision highp float; uniform sampler2D u_texture; varying vec4 v_reflection; varying vec3 v_world;
      vec3 linearColor(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
      vec3 displayColor(vec3 c){
        mat3 inputMatrix=mat3(.59719,.07600,.02840,.35458,.90834,.13383,.04823,.01566,.83777);
        mat3 outputMatrix=mat3(1.60475,-.10208,-.00327,-.53108,1.10813,-.07276,-.07367,-.00605,1.07602);
        vec3 v=inputMatrix*(c*(1.25/.6));
        v=(v*(v+.0245786)-.000090537)/(v*(.983729*v+.432951)+.238081);
        v=clamp(outputMatrix*v,0.0,1.0);
        return mix(v*12.92,1.055*pow(v,vec3(1.0/2.4))-.055,step(vec3(.0031308),v));
      }
      void main(){vec2 uv=v_reflection.xy/v_reflection.w*.5+.5;
        float blur=.005+max(v_world.z,0.0)*.0018;
        vec3 base=linearColor(texture2D(u_texture,uv).rgb)*.28;
        base+=linearColor(texture2D(u_texture,uv+vec2(blur,blur*.5)).rgb)*.18;
        base+=linearColor(texture2D(u_texture,uv-vec2(blur,blur*.5)).rgb)*.18;
        base+=linearColor(texture2D(u_texture,uv+vec2(-blur,blur*.5)).rgb)*.18;
        base+=linearColor(texture2D(u_texture,uv+vec2(blur,-blur*.5)).rgb)*.18;
        float grain=fract(sin(dot(v_world.xz*vec2(180.0,750.0),vec2(12.9898,78.233)))*43758.5453);
        float fade=exp(-max(v_world.z+1.0,0.0)*.30);
        float pool=exp(-length(v_world.xz-vec2(2.3,1.5))*.24);
        vec3 floorColor=vec3(.010,.021,.030)*(.8+grain*.08+pool);
        vec3 reflected=base*vec3(.32,.47,.60)*(.23+grain*.012);
        gl_FragColor=vec4(displayColor(floorColor+reflected*fade),.93*smoothstep(-8.0,-1.0,v_world.z));}`, ['u_mvp', 'u_reflection', 'u_texture']);
    const maps = assets.images.map(texture);
    const rings = assets.scene.meshes.map((item, index) => mesh(item.position, item.uv, maps[index], item.translation, item.rotation, item.scale));
    const photo = plane(4, 4.32, maps[6], .65), backing = plane(4.06, 4.38, maps[7], .62);
    const floor = mesh([-22.5, -3.16, -22.5, -22.5, -3.16, 22.5, 22.5, -3.16, -22.5, 22.5, -3.16, -22.5, -22.5, -3.16, 22.5, 22.5, -3.16, 22.5], Array(12).fill(0), null);
    const reflection = {size: 768, texture: gl.createTexture(), framebuffer: gl.createFramebuffer(), depth: gl.createRenderbuffer()};
    gl.bindTexture(gl.TEXTURE_2D, reflection.texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, reflection.size, reflection.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const direction of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, direction, gl.CLAMP_TO_EDGE);
    for (const filter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, filter, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, reflection.framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, reflection.texture, 0);
    gl.bindRenderbuffer(gl.RENDERBUFFER, reflection.depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, reflection.size, reflection.size);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, reflection.depth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Portal reflection unavailable');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    resources = {material, ground, maps, rings, photo, backing, floor, reflection};
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);
    hero.dataset.renderer = 'webgl'; hero.dataset.engine = 'native';
  }
  function bind(object, shader) {
    gl.bindBuffer(gl.ARRAY_BUFFER, object.position); gl.enableVertexAttribArray(shader.position); gl.vertexAttribPointer(shader.position, 3, gl.FLOAT, false, 0, 0);
    if (shader.uv >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, object.uv); gl.enableVertexAttribArray(shader.uv); gl.vertexAttribPointer(shader.uv, 2, gl.FLOAT, false, 0, 0); }
  }
  function drawPortal(vp, group, px, py) {
    const shader = resources.material, uniforms = shader.uniforms;
    gl.useProgram(shader.value); gl.uniform1i(uniforms.u_texture, 0);
    const widthFactor = mobile() ? 1 : clamp(1 + (width / height - 1.7) * .40, 1, 1.35);
    const objects = [...resources.rings, resources.backing, resources.photo];
    for (const [index, object] of objects.entries()) {
      if (index === 0 && mobile()) continue;
      const scale = [...object.scale];
      if (index === 0 || index === 1) scale[0] = widthFactor;
      if (index === 2 || index === 4) scale[0] = 1 + (widthFactor - 1) * .4;
      const position = [...object.translation];
      if (object === resources.photo) { position[0] = px * .035; position[1] = -py * .025; }
      const matrix = multiply(group, transform(position, object.rotation, scale));
      bind(object, shader); gl.uniformMatrix4fv(uniforms.u_mvp, false, multiply(vp, matrix));
      const photograph = object === resources.photo;
      gl.uniform3f(uniforms.u_tint, photograph ? 200 / 255 : 1, photograph ? 205 / 255 : 1, photograph ? 211 / 255 : 1);
      gl.uniform1f(uniforms.u_light, index < 6 && !reduced ? 1 + Math.sin(activeTime * .32 + index * .2) * .012 : 1);
      const crop = (4 / 4.32) / (assets.images[6].width / assets.images[6].height);
      gl.uniform2f(uniforms.u_crop, photograph ? crop : 1, photograph ? (1 - crop) * .15 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, object.texture); gl.drawArrays(gl.TRIANGLES, 0, object.count);
    }
  }
  function draw(dt) {
    if (!resources || contextLost || disposed) return;
    const smooth = 1 - Math.exp(-dt * 5.5);
    pointer.x += (pointerTarget.x - pointer.x) * smooth; pointer.y += (pointerTarget.y - pointer.y) * smooth;
    zoom += (zoomTarget - zoom) * smooth;
    const moving = !reduced && !paused;
    const px = moving && !mobile() ? pointer.x : 0, py = moving && !mobile() ? pointer.y : 0;
    const scale = mobile() ? .72 : .88;
    const halfWidth = Math.tan(38 * Math.PI / 360) * 11.8 * width / height;
    const group = transform([mobile() ? .05 : halfWidth * .37, mobile() ? -.08 : -.20, 0], [.035 + py * .027, -.39 + px * .075, .115 - px * .012], [scale, scale, scale]);
    const eye = [px * .13, .32 + py * .10, (mobile() ? 11.35 : 11.8) - (moving ? zoom * (lite() ? .35 : 1.3) : 0)];
    const target = [mobile() ? .02 : .1, mobile() ? 0 : -.38, 0];
    const projection = perspective(width / height), vp = multiply(projection, viewMatrix(eye, target));
    const floorEnabled = !lite() && !qualityLowered;
    let reflectedVP = null;
    if (floorEnabled) {
      const reflection = resources.reflection;
      reflectedVP = multiply(projection, viewMatrix([eye[0], -6.32 - eye[1], eye[2]], [target[0], -6.32 - target[1], target[2]], [0, -1, 0]));
      gl.bindFramebuffer(gl.FRAMEBUFFER, reflection.framebuffer); gl.viewport(0, 0, reflection.size, reflection.size); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawPortal(reflectedVP, group, px, py);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (floorEnabled) {
      const shader = resources.ground, uniforms = shader.uniforms;
      gl.useProgram(shader.value); bind(resources.floor, shader);
      gl.uniformMatrix4fv(uniforms.u_mvp, false, vp); gl.uniformMatrix4fv(uniforms.u_reflection, false, reflectedVP);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, resources.reflection.texture); gl.uniform1i(uniforms.u_texture, 0);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, resources.floor.count); gl.disable(gl.BLEND);
    }
    drawPortal(vp, group, px, py);
  }
  function frame(time) {
    request = 0;
    if (!visible || document.hidden || contextLost || disposed) return;
    const elapsed = previousTime ? (time - previousTime) / 1000 : 1 / 60;
    if (lite() && elapsed < .031 && !paused && !reduced) { request = requestAnimationFrame(frame); return; }
    previousTime = time; const dt = Math.min(elapsed, .08);
    if (!paused && !reduced) activeTime += dt;
    draw(dt);
    if (!lite() && !qualityLowered && activeTime > 2 && activeTime < 7) {
      samples.push(elapsed);
      if (samples.length >= 90) {
        if (samples.reduce((sum, value) => sum + value, 0) / samples.length > 1 / 50) { qualityLowered = true; resize(); }
        samples = [];
      }
    }
    if (!paused && !reduced) wake();
  }
  function wake() { if (!request && resources && visible && !paused && !reduced && !document.hidden && !contextLost && !disposed) request = requestAnimationFrame(frame); }
  function resize() {
    if (!resources || contextLost) return;
    const rect = visual.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    const ratio = Math.min(devicePixelRatio || 1, lite() || qualityLowered ? 1.25 : 1.6);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    hero.dataset.quality = lite() || qualityLowered ? 'light' : 'cinematic';
    draw(.05); updateMaterials(); if (!paused && !reduced) wake();
  }
  function onScroll() {
    if (paused) return;
    const rect = hero.getBoundingClientRect(); zoomTarget = reduced ? 0 : clamp(-rect.top / (rect.height * .85), 0, 1); wake();
  }
  async function start() {
    const response = await fetch('assets/portal/scene.json');
    if (!response.ok) throw new Error('Portal assets unavailable');
    const scene = await response.json();
    if (scene.version !== 1 || !Array.isArray(scene.meshes) || scene.meshes.length !== 6 || !Array.isArray(scene.variants)) throw new Error('Invalid portal scene');
    const variant = selectVariant(scene);
    const images = await Promise.all([...variant.atlases.map(file => `assets/portal/${file}`), 'assets/pixel/slide-5.png'].map(loadImage));
    const backing = document.createElement('canvas'); backing.width = 2; backing.height = 2;
    const context = backing.getContext('2d'); context.fillStyle = '#020507'; context.fillRect(0, 0, 2, 2); images.push(backing);
    assets = {scene, images, variant: variant.id};
    gl = canvas.getContext('webgl', {alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power'});
    if (!gl) throw new Error('WebGL unavailable');
    initialize(); resize(); $(hero).addClass('scene-ready'); showControls(true); onScroll();
  }
  $(hero).on('pointermove', event => {
    if (!finePointer.matches || lite() || paused || reduced) return;
    const rect = hero.getBoundingClientRect(); pointerTarget.x = clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1);
    pointerTarget.y = clamp((event.clientY - rect.top) / rect.height * 2 - 1, -1, 1); wake();
  });
  $(hero).on('pointerleave', () => { pointerTarget.x = 0; pointerTarget.y = 0; wake(); });
  $(window).on('scroll', onScroll);
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) wake(); else stop(); }); observer.observe(hero);
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(visual);
  $(document).on('visibilitychange', () => { if (document.hidden) stop(); else wake(); });
  $(reducedQuery).on('change', () => { reduced = reducedQuery.matches; stop(); zoomTarget = 0; pointerTarget.x = 0; pointerTarget.y = 0; draw(.05); if (!reduced && !paused) wake(); });
  $(mobileQuery).on('change', resize);
  $(motionButton).on('click', () => {
    paused = !paused; $(motionButton).attr('aria-pressed', String(paused));
    $(motionButton).attr('aria-label', paused ? 'Возобновить движение сцены' : 'Приостановить движение сцены');
    $(motionButton).find('span').text(paused ? 'Продолжить' : 'Пауза');
    if (paused) stop(); else { previousTime = 0; onScroll(); wake(); }
  });
  $(canvas).on('webglcontextlost', event => { event.preventDefault(); contextLost = true; stop(); resources = null; fallback(); });
  $(canvas).on('webglcontextrestored', () => {
    contextLost = false;
    try { initialize(); resize(); $(hero).addClass('scene-ready'); showControls(true); if (!paused && !reduced) wake(); }
    catch { release(); fallback(); }
  });
  $(window).on('pagehide', event => {
    stop();
    if (!event.originalEvent.persisted) { disposed = true; observer.disconnect(); resizeObserver.disconnect(); release(); }
  });
  $(window).on('pageshow', () => { draw(0); if (!paused && !reduced) wake(); });
  start().catch(() => { stop(); release(); fallback(); });
});
