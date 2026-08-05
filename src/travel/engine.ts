// 3D 여행 엔진 — animal_crossing/rebuild 걷기 플랫폼(WebGL2)의 클론 포트.
// 원본은 로컬 1인용(전역 P + 전역 클립 상태)이었던 것을, 멀티플레이를 위해
// "엔티티(플레이어)별 애니메이션/이동 상태"로 리팩토링했다. 렌더링·충돌·보간
// 알고리즘 자체(원통 되말기 셰이더, 높이맵 충돌, ROM 방식 원소 lerp 보간,
// 크로스페이드, 감정표현 스테이지, PAT0 표정)는 원본 그대로다.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface EmoteDef {
  key: string;
  label: string;
  c1: number;
  c2: number;
  f1: number;
  f2: number;
}

export interface Ent {
  uid: string;
  nick: string;
  me: boolean;
  x: number;
  s: number;
  h: number;
  yaw: number;
  char: number;
  // 애니메이션 상태 (원본의 전역 clipIdx/clipT/fade/emote/faceIdx 를 엔티티로 이동)
  clipIdx: number;
  clipT: number;
  fade: { idx: number; t: number; w: number } | null;
  emote: { def: EmoteDef; stage: number; until: number } | null;
  faceIdx: number;
  // 원격 보간 (raid cursorStream 과 같은 데드레커닝)
  net: {
    x: number;
    s: number;
    yaw: number;
    clip: number;
    vx: number;
    vs: number;
    sampleAt: number;
  } | null;
  lastEmoSeq: number;
  // 이번 프레임의 머리 위 화면 좌표 (이름표/말풍선 오버레이용)
  screen: { x: number; y: number; visible: boolean };
}

let gl: WebGL2RenderingContext;
let cv: HTMLCanvasElement;
let DATA: any;
let U: Record<string, WebGLUniformLocation | null> = {};

export const entities = new Map<string, Ent>();
export let me: Ent | null = null;

// 원본의 체크박스(원통 곡면·물 흐름·애니 보간)는 항상 켠다.
const BEND = true;
const FLOW = true;
const SMOOTH = true;

/* ── 행렬 (열우선 mat4) — 원본 그대로 ── */
function ident(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
function mul(a: Float32Array, b: Float32Array): Float32Array {
  const r = new Float32Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      r[i * 4 + j] = s;
    }
  return r;
}
function persp(f: number, as: number, n: number, fa: number): Float32Array {
  const t = 1 / Math.tan(f / 2);
  return new Float32Array([t / as, 0, 0, 0, 0, t, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, (2 * fa * n) / (n - fa), 0]);
}
function trs(x: number, y: number, z: number): Float32Array {
  const m = ident();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}
function rotY(a: number): Float32Array {
  const c = Math.cos(a),
    s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}
function lookAt(e: number[], t: number[]): Float32Array {
  let zx = e[0] - t[0],
    zy = e[1] - t[1],
    zz = e[2] - t[2];
  const zl = Math.hypot(zx, zy, zz);
  zx /= zl;
  zy /= zl;
  zz /= zl;
  let xx = zz,
    xy = 0,
    xz = -zx; // x = up(0,1,0) × z
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl;
  xz /= xl;
  const yx = zy * xz - zz * xy,
    yy = zz * xx - zx * xz,
    yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * e[0] + xy * e[1] + xz * e[2]),
    -(yx * e[0] + yy * e[1] + yz * e[2]),
    -(zx * e[0] + zy * e[1] + zz * e[2]),
    1,
  ]);
}
function m34to4(m: Float32Array, o: number): Float32Array {
  /* 행우선 3x4 → 열우선 mat4 */
  return new Float32Array([
    m[o], m[o + 4], m[o + 8], 0,
    m[o + 1], m[o + 5], m[o + 9], 0,
    m[o + 2], m[o + 6], m[o + 10], 0,
    m[o + 3], m[o + 7], m[o + 11], 1,
  ]);
}

/* ── base64 디코드 — 원본 그대로 ── */
function b64i16(s: string): Int16Array {
  const bin = atob(s),
    n = bin.length >> 1,
    a = new Int16Array(n);
  for (let i = 0; i < n; i++) a[i] = (((bin.charCodeAt(i * 2 + 1) << 8) | bin.charCodeAt(i * 2)) << 16) >> 16;
  return a;
}
function b64u8(s: string): Uint8Array {
  const bin = atob(s),
    a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

/* ── GPU 리소스 ── */
let TEX: WebGLTexture[] = [];
let WRAP: Record<string, number> = {};
interface Group {
  vao: WebGLVertexArrayObject;
  count: number;
  tex: number | null;
  mat: string | null;
  ws: number;
  wt: number;
  water: boolean;
}
let tplGpu: Group[][] = [];
let treeGpu: Group[] = [];
let headGpu: Group[][] = [];
let charGpu: Group[][] = [];
let shadowVao: { vao: WebGLVertexArrayObject; count: number };
let seaVao: { vao: WebGLVertexArrayObject; count: number; tex: number | null };

function buildGroups(model: any, skinned: boolean): Group[] {
  return model.groups.map((g: any) => {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.pos), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const ub = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ub);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.uv), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    if (skinned && g.slot) {
      const sb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, sb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.slot), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    } else {
      gl.disableVertexAttribArray(2);
      gl.vertexAttrib1f(2, 0);
    }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const texEntry = g.tex !== null && g.tex !== undefined ? model.textures[g.tex] : null;
    const water = /riv|sea|wavs|awa/.test(g.mat || "");
    return {
      vao,
      count: g.idx.length,
      tex: texEntry ? texEntry.g : null,
      mat: g.mat,
      ws: WRAP[g.wrapS] ?? gl.REPEAT,
      wt: WRAP[g.wrapT] ?? gl.REPEAT,
      water,
    };
  });
}

/* ── 높이맵 ── */
interface Hmap {
  nx: number;
  ns: number;
  s0: number;
  h: Int16Array;
  cls: Uint8Array;
}
let HMAPS: Hmap[] = [];

export function groundAt(x: number, s: number): { h: number; cls: number } | null {
  let best: { h: number; cls: number } | null = null;
  for (const [ti, ox, os] of DATA.terrain.layout) {
    const m = HMAPS[ti];
    const lx = x - ox,
      ls = s - os - m.s0;
    if (lx < 0 || lx > m.nx - 1 || ls < 0 || ls > m.ns - 1) continue;
    const x0 = Math.min(Math.floor(lx), m.nx - 2),
      s0 = Math.min(Math.floor(ls), m.ns - 2);
    const fx = lx - x0,
      fs = ls - s0;
    let hs = 0,
      ws = 0,
      cls: number | null = null,
      cbest = 2;
    for (const [dx, ds, w] of [
      [0, 0, (1 - fx) * (1 - fs)],
      [1, 0, fx * (1 - fs)],
      [0, 1, (1 - fx) * fs],
      [1, 1, fx * fs],
    ] as [number, number, number][]) {
      const k = (s0 + ds) * m.nx + (x0 + dx);
      if (m.cls[k] === 2) continue;
      hs += (m.h[k] / 256) * w;
      ws += w;
      const near = Math.abs(dx - fx) + Math.abs(ds - fs);
      if (cls === null || near < cbest) {
        cls = m.cls[k];
        cbest = near;
      }
    }
    if (ws < 0.3) continue; /* 구멍 위 */
    const h = hs / ws;
    if (best === null || h > best.h) best = { h, cls: cls! };
  }
  return best;
}

/* ── 애니메이션 → 뼈 행렬 — 원본 그대로 (엔티티 파라미터화만 추가) ── */
const BONEBUF = new Float32Array(96 * 4);
function unpack12(v: Int16Array, o: number, out: Float32Array, p: number): void {
  out[p] = v[o] / 4096;
  out[p + 1] = v[o + 1] / 4096;
  out[p + 2] = v[o + 2] / 4096;
  out[p + 3] = v[o + 9] / 2048;
  out[p + 4] = v[o + 3] / 4096;
  out[p + 5] = v[o + 4] / 4096;
  out[p + 6] = v[o + 5] / 4096;
  out[p + 7] = v[o + 10] / 2048;
  out[p + 8] = v[o + 6] / 4096;
  out[p + 9] = v[o + 7] / 4096;
  out[p + 10] = v[o + 8] / 4096;
  out[p + 11] = v[o + 11] / 2048;
}
function mul34(A: Float32Array, B: Float32Array, out: Float32Array): Float32Array {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++)
      out[r * 4 + c] = A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c] + A[r * 4 + 2] * B[8 + c];
    out[r * 4 + 3] = A[r * 4] * B[3] + A[r * 4 + 1] * B[7] + A[r * 4 + 2] * B[11] + A[r * 4 + 3];
  }
  return out;
}
const LOC_A = new Float32Array(32 * 12),
  LOC_B = new Float32Array(32 * 12);

/* 정수 프레임 f 의 지역변환을 out 에 채운다. 클립은 뼈 길이(이동)까지 담는다 —
   PBody 전용 값이다. PBody 는 그대로, 다른 몸(NPC)은 회전만 받고 이동은 제
   정지 포즈를 쓴다 (안 그러면 짜부). */
function fillLocals(ch: any, C: any, f: number, out: Float32Array): void {
  if (!C._d) {
    C._d = b64i16(C.d);
    C._c = b64i16(C.c);
    C._mv = new Set(C.mv);
  }
  const off = f * C.mv.length * 12;
  const keep = !ch.file.startsWith("PBody/");
  let ci = 0,
    mi = 0;
  for (let i = 0; i < C.nodes; i++) {
    if (C._mv.has(i)) unpack12(C._d, off + mi++ * 12, out, i * 12);
    else unpack12(C._c, ci++ * 12, out, i * 12);
    if (C.rest[i]) {
      for (let k = 0; k < 12; k++) out[i * 12 + k] = ch.rest[i * 12 + k];
    } else if (keep) {
      out[i * 12 + 3] = ch.rest[i * 12 + 3];
      out[i * 12 + 7] = ch.rest[i * 12 + 7];
      out[i * 12 + 11] = ch.rest[i * 12 + 11];
    }
  }
}

/* a ← a·(1−t) + b·t.  ROM 보간기 0x01FFB040 과 같은 방식 — 원소별 가중 합,
   회전 1·2행 정규화 후 3행 외적 재구성. */
function blendLocals(a: Float32Array, b: Float32Array, t: number, nodes: number): void {
  const s = 1 - t;
  for (let i = 0; i < nodes; i++) {
    const o = i * 12;
    for (let k = 0; k < 12; k++) a[o + k] = a[o + k] * s + b[o + k] * t;
    const l0 = Math.hypot(a[o], a[o + 1], a[o + 2]);
    const l1 = Math.hypot(a[o + 4], a[o + 5], a[o + 6]);
    if (!l0 || !l1 || Math.abs(l0 - 1) > 0.25 || Math.abs(l1 - 1) > 0.25) continue;
    a[o] /= l0;
    a[o + 1] /= l0;
    a[o + 2] /= l0;
    a[o + 4] /= l1;
    a[o + 5] /= l1;
    a[o + 6] /= l1;
    a[o + 8] = a[o + 1] * a[o + 6] - a[o + 2] * a[o + 5]; /* 3행 = 1행 × 2행 */
    a[o + 9] = a[o + 2] * a[o + 4] - a[o] * a[o + 6];
    a[o + 10] = a[o] * a[o + 5] - a[o + 1] * a[o + 4];
  }
}

/* 원샷 클립(loop=0)은 마지막 프레임에 붙잡아 둔다. */
function clipFrame(C: any, ft: number): number {
  const f = Math.floor(ft);
  return C.loop ? f % C.frames : Math.min(f, C.frames - 1);
}

const CLIP_FPS: Record<string, number> = { wait1: 10, walk1: 22, run1: 26 }; /* 그 밖(감정표현)은 20 */
const fpsOf = (name: string): number => CLIP_FPS[name] || 20;
const FADE_S = 0.12; /* 클립 전환 크로스페이드 초 (근사) */

export function setClip(ent: Ent, i: number): void {
  ent.fade = { idx: ent.clipIdx, t: ent.clipT, w: 0 };
  ent.clipIdx = i;
  ent.clipT = 0;
}

/* 감정표현: mr_X1(시작)을 한 번 → mr_X2(유지)를 2초 → wait 로 복귀. */
export function startEmote(ent: Ent, k: number): boolean {
  const E: EmoteDef = DATA.emotes[k];
  if (!E) return false;
  if (!ent.emote && ent.clipIdx !== 0) return false; /* 서 있을 때만 시작한다 */
  ent.emote = { def: E, stage: 1, until: 0 };
  ent.faceIdx = E.f1;
  setClip(ent, E.c1);
  return true;
}

function poseStack(ent: Ent, ch: any): Float32Array {
  const C = DATA.clips[ent.clipIdx];
  const local = LOC_A;
  if (SMOOTH) {
    const f0 = clipFrame(C, ent.clipT),
      t = ent.clipT - Math.floor(ent.clipT);
    fillLocals(ch, C, f0, local);
    const f1 = C.loop ? (f0 + 1) % C.frames : Math.min(f0 + 1, C.frames - 1);
    if (t > 0.001 && f1 !== f0) {
      fillLocals(ch, C, f1, LOC_B);
      blendLocals(local, LOC_B, t, C.nodes);
    }
    if (ent.fade) {
      const Cp = DATA.clips[ent.fade.idx];
      fillLocals(ch, Cp, clipFrame(Cp, ent.fade.t), LOC_B);
      blendLocals(local, LOC_B, 1 - ent.fade.w, C.nodes);
    }
  } else {
    fillLocals(ch, C, clipFrame(C, ent.clipT), local);
  }
  const stack = new Float32Array(32 * 12);
  const has = new Uint8Array(32);
  let cm = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  const tmp = new Float32Array(12),
    lm = new Float32Array(12);
  for (let o = 0; o < ch.ops.length; o += 4) {
    const node = ch.ops[o],
      dest = ch.ops[o + 2],
      src = ch.ops[o + 3];
    if (src >= 0 && has[src]) cm.set(stack.subarray(src * 12, src * 12 + 12));
    lm.set(local.subarray(node * 12, node * 12 + 12));
    cm = new Float32Array(mul34(cm, lm, tmp));
    if (dest >= 0) {
      stack.set(cm, dest * 12);
      has[dest] = 1;
    }
  }
  return stack;
}

/* 표정(PAT0) — 프레임 이하인 마지막 키프레임의 텍스처로 갈아끼운다 (ROM 0x02107C34). */
function faceTexFor(ent: Ent, src: any, mat: string | null): number | null {
  if (ent.faceIdx < 0 || !src || mat === null || mat === undefined) return null;
  const F = DATA.faces[ent.faceIdx];
  const ff = Math.min(Math.floor(ent.clipT), F.frames - 1);
  for (const tg of F.tg) {
    if (tg.mat !== mat) continue;
    let best: any = null;
    for (const k of tg.k) {
      if (k[0] <= ff) best = k;
      else break;
    }
    if (!best) return null;
    if (!src._tix) {
      src._tix = {};
      src.textures.forEach((x: any, i: number) => (src._tix[x.name] = i));
    }
    const li = src._tix[best[1]];
    return li === undefined ? null : src.textures[li].g;
  }
  return null;
}

/* ── 그리기 ── */
let uvT = 0;

function drawGroups(
  groups: Group[],
  model: Float32Array,
  skinned: boolean,
  stack: Float32Array | null,
  ent?: Ent,
  src?: any,
): void {
  gl.uniformMatrix4fv(U.uModel, false, model);
  gl.uniform1i(U.uSkin, skinned ? 1 : 0);
  if (skinned && stack) {
    BONEBUF.fill(0);
    const n = Math.min(stack.length / 12, 32);
    for (let s = 0; s < n; s++)
      for (let r = 0; r < 3; r++)
        for (let k = 0; k < 4; k++) BONEBUF[(s * 3 + r) * 4 + k] = stack[s * 12 + r * 4 + k];
    gl.uniform4fv(U.uBone, BONEBUF);
  }
  for (const g of groups) {
    let ti = g.tex;
    if (ent && src) {
      const o = faceTexFor(ent, src, g.mat);
      if (o !== null) ti = o;
    }
    const has = ti !== null && ti !== undefined;
    gl.uniform1i(U.uHasTex, has ? 1 : 0);
    gl.uniform2f(U.uUVoff, g.water && FLOW ? uvT * 0.06 : 0, g.water && FLOW ? uvT * 0.025 : 0);
    if (has) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, TEX[ti!]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, g.ws);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, g.wt);
    }
    gl.bindVertexArray(g.vao);
    gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_SHORT, 0);
  }
}

/* ── 입력 + 로컬 이동 ── */
const keys: Record<string, boolean> = {};
let camDist = 10.5;
const WALK = 3.4,
  RUN = 6.8; /* 유닛/초 (타일 = 2유닛) */

export function pressKey(k: string, down: boolean): void {
  keys[k] = down;
}
export function zoom(deltaY: number): void {
  camDist = Math.max(5, Math.min(24, camDist * (deltaY > 0 ? 1.1 : 0.9)));
}

function tryMove(ent: Ent, dt: number): void {
  /* 월드 s 는 남쪽으로 증가한다 — 북쪽 = s 감소 */
  let dx = 0,
    ds = 0;
  if (keys["w"] || keys["arrowup"]) ds -= 1;
  if (keys["s"] || keys["arrowdown"]) ds += 1;
  if (keys["a"] || keys["arrowleft"]) dx -= 1;
  if (keys["d"] || keys["arrowright"]) dx += 1;
  const moving = dx || ds;
  if (moving && ent.emote) {
    ent.emote = null;
    ent.faceIdx = -1;
  }
  const run = keys["shift"];
  const want = moving ? (run ? 2 : 1) : ent.emote ? ent.clipIdx : 0;
  if (want !== ent.clipIdx) setClip(ent, want);
  if (!moving) return;
  const L = Math.hypot(dx, ds);
  dx /= L;
  ds /= L;
  const target = Math.atan2(dx, ds);
  let dy = target - ent.yaw;
  while (dy > Math.PI) dy -= 2 * Math.PI;
  while (dy < -Math.PI) dy += 2 * Math.PI;
  ent.yaw += dy * Math.min(1, dt * 14);
  const sp = (run ? RUN : WALK) * dt;
  const step = (nx: number, ns: number): boolean => {
    nx = Math.max(1, Math.min(DATA.terrain.width - 1, nx));
    ns = Math.max(24, Math.min(DATA.terrain.depth - 1.5, ns));
    const g = groundAt(nx, ns);
    if (!g) return false;
    if (g.cls === 1) return false; /* 물 */
    const dist = Math.hypot(nx - ent.x, ns - ent.s) || 1e-6;
    if (Math.abs(g.h - ent.h) / dist > 1.25) return false; /* 절벽 */
    for (const [tx, ts] of DATA.trees.at)
      if ((nx - tx) ** 2 + (ns - ts) ** 2 < 0.72 ** 2) return false;
    ent.x = nx;
    ent.s = ns;
    ent.h = g.h;
    return true;
  };
  step(ent.x + dx * sp, ent.s + ds * sp) ||
    (dx && ds && step(ent.x + dx * sp, ent.s)) ||
    (dx && ds && step(ent.x, ent.s + ds * sp));
}

/* ── 원격 보간 — raid cursorStream 의 데드레커닝을 지형 좌표에 적용 ── */
const EXTRAP_MS = 350;

export function applyNetSample(
  ent: Ent,
  x: number,
  s: number,
  yaw: number,
  clip: number,
  now: number,
): void {
  const t = ent.net;
  if (!t) {
    ent.net = { x, s, yaw, clip, vx: 0, vs: 0, sampleAt: now };
    ent.x = x;
    ent.s = s;
    ent.yaw = yaw;
    const g = groundAt(x, s);
    if (g) ent.h = g.h;
    return;
  }
  if (t.x !== x || t.s !== s) {
    const dt = Math.max(now - t.sampleAt, 1);
    t.vx = (x - t.x) / dt;
    t.vs = (s - t.s) / dt;
    t.sampleAt = now;
  }
  t.x = x;
  t.s = s;
  t.yaw = yaw;
  t.clip = clip;
}

function tickRemote(ent: Ent, dt: number, now: number): void {
  const t = ent.net;
  if (!t) return;
  const elapsed = Math.min(now - t.sampleAt, EXTRAP_MS);
  const tx = t.x + t.vx * elapsed;
  const ts = t.s + t.vs * elapsed;
  /* 프레임레이트 독립 지수 이징 */
  const a = 1 - Math.pow(1 - 0.22, dt * 60);
  ent.x += (tx - ent.x) * a;
  ent.s += (ts - ent.s) * a;
  const g = groundAt(ent.x, ent.s);
  if (g && g.cls !== 1) ent.h += (g.h - ent.h) * Math.min(1, a * 2);
  let dy = t.yaw - ent.yaw;
  while (dy > Math.PI) dy -= 2 * Math.PI;
  while (dy < -Math.PI) dy += 2 * Math.PI;
  ent.yaw += dy * Math.min(1, dt * 10);
  /* 클립은 네트워크 값 신뢰 — 감정표현 중엔 건드리지 않는다 */
  if (!ent.emote && t.clip !== ent.clipIdx && t.clip >= 0 && t.clip <= 2) setClip(ent, t.clip);
}

/* 클립/페이드/감정표현 시간 전진 — 원본 frame() 의 해당 부분을 엔티티별로 */
function advanceAnim(ent: Ent, dt: number, tMs: number): void {
  const C = DATA.clips[ent.clipIdx];
  ent.clipT += dt * fpsOf(C.name);
  if (ent.fade) {
    ent.fade.t += dt * fpsOf(DATA.clips[ent.fade.idx].name);
    ent.fade.w += dt / FADE_S;
    if (ent.fade.w >= 1) ent.fade = null;
  }
  if (ent.emote) {
    const CE = DATA.clips[ent.clipIdx];
    if (ent.emote.stage === 1 && ent.clipT >= CE.frames - 1) {
      ent.emote.stage = 2;
      ent.emote.until = tMs + 2000;
      ent.faceIdx = ent.emote.def.f2;
      setClip(ent, ent.emote.def.c2);
    } else if (ent.emote.stage === 2 && tMs >= ent.emote.until) {
      ent.emote = null;
      ent.faceIdx = -1;
      setClip(ent, 0);
    }
  }
}

/* 이름표 오버레이용: 월드 (x, h+headY, s) → 화면 px (되말기+뷰+투영을 JS 로 재현) */
function project(
  x: number,
  h: number,
  s: number,
  s0: number,
  view: Float32Array,
  proj: Float32Array,
  w: number,
  hpx: number,
): { x: number; y: number; visible: boolean } {
  let q: number[];
  if (BEND) {
    const phi = (s - s0) / DATA.R;
    const r = DATA.R + h;
    q = [x, r * Math.cos(phi) - DATA.R, r * Math.sin(phi)];
  } else {
    q = [x, h, s - s0];
  }
  const vx = view[0] * q[0] + view[4] * q[1] + view[8] * q[2] + view[12];
  const vy = view[1] * q[0] + view[5] * q[1] + view[9] * q[2] + view[13];
  const vz = view[2] * q[0] + view[6] * q[1] + view[10] * q[2] + view[14];
  const cx = proj[0] * vx;
  const cy = proj[5] * vy;
  const cz = proj[10] * vz + proj[14];
  const cw = -vz;
  if (cw <= 0.01) return { x: 0, y: 0, visible: false };
  const nx = cx / cw,
    ny = cy / cw,
    nz = cz / cw;
  return {
    x: (nx * 0.5 + 0.5) * w,
    y: (1 - (ny * 0.5 + 0.5)) * hpx,
    visible: nz < 1 && Math.abs(nx) < 1.2 && Math.abs(ny) < 1.2,
  };
}

/* ── 엔티티 생성/제거 ── */
export function createEnt(uid: string, nick: string, isMe: boolean, char: number): Ent {
  const jitter = isMe ? 0 : (uid.charCodeAt(0) % 7) - 3;
  const ent: Ent = {
    uid,
    nick,
    me: isMe,
    x: DATA.spawn[0] + jitter,
    s: DATA.spawn[1],
    h: 0,
    yaw: 0,
    char: Math.max(0, Math.min(DATA.chars.length - 1, char)),
    clipIdx: 0,
    clipT: 0,
    fade: null,
    emote: null,
    faceIdx: -1,
    net: null,
    lastEmoSeq: -1,
    screen: { x: 0, y: 0, visible: false },
  };
  const g = groundAt(ent.x, ent.s);
  if (g) ent.h = g.h;
  entities.set(uid, ent);
  if (isMe) me = ent;
  return ent;
}

export function removeEnt(uid: string): void {
  entities.delete(uid);
}

export function charCount(): number {
  return DATA.chars.length;
}
export function charLabel(i: number): string {
  return DATA.chars[i]?.label ?? "?";
}
export function charFile(i: number): string {
  return DATA.chars[i]?.file ?? "";
}
export function emoteDefs(): EmoteDef[] {
  return DATA.emotes;
}

/* ── 초기화 ── */
export function initEngine(canvas: HTMLCanvasElement, data: any): void {
  cv = canvas;
  DATA = data;
  const ctx = cv.getContext("webgl2", { antialias: true, alpha: false });
  if (!ctx) throw new Error("WebGL2 필요");
  gl = ctx;

  const VS = `#version 300 es
in vec3 aPos; in vec2 aUV; in float aSlot;
uniform mat4 uProj, uView, uModel;
uniform vec4 uBone[96];
uniform int uSkin, uBend;
uniform float uR, uS0;
out vec3 vPos; out vec2 vUV;
void main(){
  vec3 p = aPos;
  if(uSkin == 1){
    int b = int(aSlot) * 3;
    p = vec3(dot(uBone[b].xyz,   aPos) + uBone[b].w,
             dot(uBone[b+1].xyz, aPos) + uBone[b+1].w,
             dot(uBone[b+2].xyz, aPos) + uBone[b+2].w);
  }
  vec3 w = (uModel * vec4(p, 1.0)).xyz;
  vec3 q;
  if(uBend == 1){
    float phi = (w.z - uS0) / uR;
    float r = uR + w.y;
    q = vec3(w.x, r * cos(phi) - uR, r * sin(phi));
  }else{
    q = vec3(w.x, w.y, w.z - uS0);
  }
  vec4 mv = uView * vec4(q, 1.0);
  vPos = mv.xyz; vUV = aUV;
  gl_Position = uProj * mv;
}`;
  const FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec2 vUV;
uniform sampler2D uTex; uniform int uHasTex;
uniform vec2 uUVoff; uniform vec4 uTint;
out vec4 o;
void main(){
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  if(n.z < 0.0) n = -n;
  float d = clamp(dot(n, normalize(vec3(0.25, 0.75, 0.45))), 0.0, 1.0);
  float l = 0.42 + 0.58 * d;
  vec4 base = (uHasTex == 1) ? texture(uTex, vUV + uUVoff) : vec4(0.8, 0.8, 0.85, 1.0);
  base *= uTint;
  if(base.a < 0.08) discard;
  o = vec4(base.rgb * l, base.a);
}`;
  const sh = (t: number, s: string): WebGLShader => {
    const x = gl.createShader(t)!;
    gl.shaderSource(x, s);
    gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(x));
    return x;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.bindAttribLocation(prog, 0, "aPos");
  gl.bindAttribLocation(prog, 1, "aUV");
  gl.bindAttribLocation(prog, 2, "aSlot");
  gl.linkProgram(prog);
  gl.useProgram(prog);
  for (const n of ["uProj", "uView", "uModel", "uBone", "uSkin", "uBend", "uR", "uS0", "uTex", "uHasTex", "uUVoff", "uTint"])
    U[n] = gl.getUniformLocation(prog, n);
  gl.uniform1i(U.uTex, 0);
  gl.uniform1f(U.uR, DATA.R);
  gl.uniform4f(U.uTint, 1, 1, 1, 1);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.53, 0.72, 0.87, 1);

  /* 텍스처 풀 */
  TEX = DATA.tex.map((uri: string) => {
    const tx = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([160, 180, 140, 255]));
    const im = new Image();
    im.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    };
    im.src = uri;
    return tx;
  });
  WRAP = { repeat: gl.REPEAT, mirror: gl.MIRRORED_REPEAT, clamp: gl.CLAMP_TO_EDGE };

  tplGpu = DATA.terrain.templates.map((t: any) => buildGroups(t, false));
  treeGpu = buildGroups(DATA.trees.model, false);
  headGpu = DATA.heads.map((h: any) => buildGroups(h, false));
  charGpu = DATA.chars.map((c: any) => buildGroups(c, true));

  /* 그림자 원판 (16각형) */
  shadowVao = (() => {
    const pos = [0, 0, 0],
      uv = [0, 0],
      idx: number[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pos.push(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
      uv.push(0, 0);
    }
    for (let i = 1; i <= 16; i++) idx.push(0, i, i + 1);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const ub = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ub);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(2);
    gl.vertexAttrib1f(2, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: idx.length };
  })();

  /* 남쪽 바다 판 (배경 메움용) */
  seaVao = (() => {
    let seaTex: number | null = null;
    outer: for (const t of DATA.terrain.templates)
      for (const g of t.groups)
        if (/grd_sea/.test(g.mat || "") && g.tex !== null) {
          seaTex = t.textures[g.tex].g;
          break outer;
        }
    const x0 = -48,
      x1 = 176,
      s0 = 126.5,
      s1 = 210,
      h = -2.62,
      rep = 14;
    const pos = [x0, h, s0, x1, h, s0, x1, h, s1, x0, h, s1];
    const uv = [0, 0, rep, 0, rep, (rep * (s1 - s0)) / (x1 - x0), 0, (rep * (s1 - s0)) / (x1 - x0)];
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const ub = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ub);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(2);
    gl.vertexAttrib1f(2, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: 6, tex: seaTex };
  })();

  HMAPS = DATA.terrain.templates.map((t: any) => ({
    nx: t.hmap.nx,
    ns: t.hmap.ns,
    s0: t.hmap.s0,
    h: b64i16(t.hmap.h),
    cls: b64u8(t.hmap.cls),
  }));
}

/* ── 메인 프레임 — 지형/바다/나무 + 모든 엔티티 렌더 ── */
export function frame(tMs: number, dt: number): void {
  if (!me) return;
  const w = cv.clientWidth,
    h = cv.clientHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (cv.width !== w * dpr || cv.height !== h * dpr) {
    cv.width = w * dpr;
    cv.height = h * dpr;
  }
  gl.viewport(0, 0, cv.width, cv.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const now = Date.now();
  tryMove(me, dt);
  for (const ent of entities.values()) {
    if (!ent.me) tickRemote(ent, dt, now);
    advanceAnim(ent, dt, tMs);
  }
  uvT = tMs / 1000;

  gl.uniform1i(U.uBend, BEND ? 1 : 0);
  gl.uniform1f(U.uS0, me.s);

  /* 남쪽 위에서 북쪽을 내려다본다 — 원작의 하이앵글 추적 카메라 */
  const eye = [me.x, me.h + camDist * 0.82, camDist * 0.72];
  const view = lookAt(eye, [me.x, me.h + 0.6, -2.2]);
  const proj = persp(0.62, w / h, 0.3, 260);
  gl.uniformMatrix4fv(U.uProj, false, proj);
  gl.uniformMatrix4fv(U.uView, false, view);

  /* 지형 + 바다 + 나무 */
  gl.uniform4f(U.uTint, 1, 1, 1, 1);
  for (const [ti, ox, os] of DATA.terrain.layout) drawGroups(tplGpu[ti], trs(ox, 0, os), false, null);
  if (seaVao.tex !== null) {
    gl.uniformMatrix4fv(U.uModel, false, ident());
    gl.uniform1i(U.uSkin, 0);
    gl.uniform1i(U.uHasTex, 1);
    gl.uniform2f(U.uUVoff, uvT * 0.02, uvT * 0.012);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, TEX[seaVao.tex]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.bindVertexArray(seaVao.vao);
    gl.drawElements(gl.TRIANGLES, seaVao.count, gl.UNSIGNED_SHORT, 0);
  }
  for (const [tx, ts, rot] of DATA.trees.at) drawGroups(treeGpu, mul(trs(tx, 0, ts), rotY(rot)), false, null);

  /* 그림자 (반투명 검정 원판) — 모든 엔티티 */
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.uniform4f(U.uTint, 0, 0, 0, 0.33);
  gl.uniform1i(U.uHasTex, 0);
  gl.uniform1i(U.uSkin, 0);
  gl.uniform2f(U.uUVoff, 0, 0);
  for (const ent of entities.values()) {
    gl.uniformMatrix4fv(U.uModel, false, trs(ent.x, ent.h + 0.04, ent.s));
    gl.bindVertexArray(shadowVao.vao);
    gl.drawElements(gl.TRIANGLES, shadowVao.count, gl.UNSIGNED_SHORT, 0);
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.uniform4f(U.uTint, 1, 1, 1, 1);

  /* 캐릭터 — 모든 엔티티 (yaw 0 = 남쪽/카메라 쪽) */
  for (const ent of entities.values()) {
    const ch = DATA.chars[ent.char];
    if (!ch) continue;
    const stack = poseStack(ent, ch);
    const modelM = mul(trs(ent.x, ent.h, ent.s), rotY(ent.yaw));
    drawGroups(charGpu[ent.char], modelM, true, stack, ent, ch);
    if (ch.head !== undefined && ch.head !== null) {
      const hm = m34to4(stack, ch.head.slot * 12);
      const hd = DATA.heads[ch.head.model];
      drawGroups(headGpu[ch.head.model], mul(modelM, hm), false, null, ent, hd);
    }
    /* 이름표 앵커 (머리 위) */
    ent.screen = project(ent.x, ent.h + 2.35, ent.s, me.s, view, proj, w, h);
  }
}

export function hudText(): string {
  if (!me) return "";
  const C = DATA.clips[me.clipIdx];
  return `x ${me.x.toFixed(1)}  s ${me.s.toFixed(1)}  h ${me.h.toFixed(2)}  ${C.name}`;
}
