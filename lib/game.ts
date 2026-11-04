import type { BerthRecord } from "./types";

/* ───────── 월드 좌표계 (미터) ─────────
 * 위쪽 안벽 = 신선대 1~5번 선석, 아래쪽 안벽 = 감만 6~8번 선석.
 * 그 사이 수역(감만 수로)을 오른쪽(외해)에서 들어온다.
 */
export const WORLD = { w: 2100, h: 1200 };
export const QUAY_TOP = 170; // 신선대 안벽선 y (이 위는 육지)
export const QUAY_BOTTOM = 1030; // 감만 안벽선 y (이 아래는 육지)
export const SIM_SPEED = 4; // 실제 1초 = 게임 4초 (접안이 너무 길지 않게)

export interface Berth {
  id: number;
  terminal: "신선대" | "감만";
  x0: number;
  x1: number;
  quayY: number;
  landDir: -1 | 1; // -1: 안벽이 위쪽, +1: 안벽이 아래쪽
}

export const BERTHS: Berth[] = [
  ...[1, 2, 3, 4, 5].map(
    (id, i): Berth => ({
      id,
      terminal: "신선대",
      x0: 150 + i * 300,
      x1: 150 + (i + 1) * 300,
      quayY: QUAY_TOP,
      landDir: -1,
    }),
  ),
  ...[6, 7, 8].map(
    (id, i): Berth => ({
      id,
      terminal: "감만",
      x0: 350 + i * 350,
      x1: 350 + (i + 1) * 350,
      quayY: QUAY_BOTTOM,
      landDir: 1,
    }),
  ),
];

export function berthOf(terminal: string, id: number): Berth | undefined {
  return (
    BERTHS.find((b) => b.id === id && b.terminal === terminal) ??
    BERTHS.find((b) => b.id === id)
  );
}

/** TEU 작업량으로 선박 길이를 대략 추정 (제원 데이터가 없으므로) */
export function estimateLength(rec: Pick<BerthRecord, "discharge" | "load">): number {
  const teu = rec.discharge + rec.load;
  return Math.min(260, Math.max(110, 105 + teu * 0.11));
}

export interface Ship {
  x: number;
  y: number; // 선체 중심
  h: number; // 선수 방향 (라디안, 0=동쪽, 시계방향 +)
  u: number; // 전진 속도 m/s
  w: number; // 횡방향 속도 m/s (+는 우현쪽)
  r: number; // 회두율 rad/s
  L: number;
  B: number; // 길이·폭
}

export interface Inputs {
  throttle: number; // -1..1
  rudder: number; // -1(좌현)..1(우현)
  bow: number; // -1..1 바우스러스터
}

export interface DockedShip {
  rec: BerthRecord;
  x: number;
  y: number;
  h: number;
  L: number;
  B: number;
}

const U_MAX = 7;
const PARAMS = {
  thrustAhead: 1.0,
  thrustAstern: 0.5,
  dragQuad: 0.02,
  dragLin: 0.05,
  bowThrust: 0.55,
  swayDrag: 0.9,
  rudderGain: 0.16,
  yawDrag: 1.1,
};

export function stepShip(s: Ship, inp: Inputs, dt: number): void {
  const thr = clamp(inp.throttle, -1, 1);
  const rud = clamp(inp.rudder, -1, 1);
  const bow = clamp(inp.bow, -1, 1);

  const thrustAcc = thr >= 0 ? thr * PARAMS.thrustAhead : thr * PARAMS.thrustAstern;
  const du = thrustAcc - PARAMS.dragQuad * s.u * Math.abs(s.u) - PARAMS.dragLin * s.u;
  const dw = bow * PARAMS.bowThrust - PARAMS.swayDrag * s.w;
  // 타효는 속도에 비례. 후진 중에는 타효가 반대로.
  const flow = Math.abs(s.u) / U_MAX;
  const rudEff = rud * PARAMS.rudderGain * (0.15 + flow) * (s.u < -0.3 ? -1 : 1);
  const dr = rudEff - PARAMS.yawDrag * s.r;

  s.u += du * dt;
  s.w += dw * dt;
  s.r += dr * dt;

  const cos = Math.cos(s.h);
  const sin = Math.sin(s.h);
  s.x += (s.u * cos - s.w * sin) * dt;
  s.y += (s.u * sin + s.w * cos) * dt;
  s.h += s.r * dt;
}

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

/** 선체 사각형의 네 꼭짓점 (월드 좌표). 0번=선수 좌현, 1번=선수 우현 */
export function corners(s: {
  x: number;
  y: number;
  h: number;
  L: number;
  B: number;
}): [number, number][] {
  const cos = Math.cos(s.h);
  const sin = Math.sin(s.h);
  const hl = s.L / 2;
  const hb = s.B / 2;
  const pts: [number, number][] = [
    [hl, -hb],
    [hl, hb],
    [-hl, hb],
    [-hl, -hb],
  ];
  return pts.map(([px, py]) => [s.x + px * cos - py * sin, s.y + px * sin + py * cos]);
}

/** SAT 로 두 회전 사각형 충돌 여부 */
export function obbOverlap(a: [number, number][], b: [number, number][]): boolean {
  const polys = [a, b];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y2 - y1;
      const ny = -(x2 - x1);
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const [px, py] of a) {
        const p = px * nx + py * ny;
        minA = Math.min(minA, p);
        maxA = Math.max(maxA, p);
      }
      for (const [px, py] of b) {
        const p = px * nx + py * ny;
        minB = Math.min(minB, p);
        maxB = Math.max(maxB, p);
      }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

export type CollisionKind = "none" | "quay" | "ship" | "boundary";

export function checkCollision(
  ship: Ship,
  docked: DockedShip[],
): { kind: CollisionKind; with?: DockedShip } {
  const pts = corners(ship);
  for (const [x, y] of pts) {
    if (x < 0 || x > WORLD.w || y < 0 || y > WORLD.h) return { kind: "boundary" };
    if (y < QUAY_TOP || y > QUAY_BOTTOM) return { kind: "quay" };
  }
  for (const d of docked) {
    if (obbOverlap(pts, corners(d))) return { kind: "ship", with: d };
  }
  return { kind: "none" };
}

export interface DockCheck {
  inBerth: boolean; // 선체가 선석 범위 안에 있는가
  gap: number; // 안벽과 선측 간격 (m)
  headingErrDeg: number; // 안벽과 평행 오차
  sideOk: boolean; // 요구 접안현(S/P)이 안벽을 향하는가
  slow: boolean; // 충분히 느린가
  ready: boolean; // 전부 만족
  centerOffset: number; // 선석 중앙에서 벗어난 거리 (m)
}

/** 접안 조건 판정 */
export function checkDock(ship: Ship, berth: Berth, requiredSide: "S" | "P" | ""): DockCheck {
  const pts = corners(ship);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const inBerth = Math.min(...xs) >= berth.x0 - 5 && Math.max(...xs) <= berth.x1 + 5;
  const nearestY = berth.landDir < 0 ? Math.min(...ys) : Math.max(...ys);
  const gap = Math.abs(nearestY - berth.quayY);

  // 안벽 방향(동서)과 선수 방향 사이 각도 오차
  const hdg = normDeg((ship.h * 180) / Math.PI);
  const errEast = Math.abs(angleDiff(hdg, 0));
  const errWest = Math.abs(angleDiff(hdg, 180));
  const headingErrDeg = Math.min(errEast, errWest);

  // 우현 벡터 = 선수 방향을 시계방향 90° 회전 (화면 y 아래가 +) → (-sin h, cos h)
  const stbY = Math.cos(ship.h);
  const stbFacesQuay = stbY * berth.landDir > 0;
  const sideOk =
    requiredSide === "" ? true : requiredSide === "S" ? stbFacesQuay : !stbFacesQuay;

  const slow = Math.abs(ship.u) < 0.6 && Math.abs(ship.w) < 0.45 && Math.abs(ship.r) < 0.025;
  const centerOffset = Math.abs(ship.x - (berth.x0 + berth.x1) / 2);
  const ready = inBerth && gap <= 14 && headingErrDeg <= 7 && sideOk && slow;
  return { inBerth, gap, headingErrDeg, sideOk, slow, ready, centerOffset };
}

export function normDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}
export function angleDiff(a: number, b: number): number {
  let d = normDeg(a - b);
  if (d > 180) d -= 360;
  return d;
}

/* ───────── 실시간 데이터 → 게임 상태 ───────── */

export interface Snapshot {
  alongside: BerthRecord[]; // 지금 접안 중
  upcoming: BerthRecord[]; // 아직 입항 전 (ETA 순)
  departed: BerthRecord[];
}

export function buildSnapshot(records: BerthRecord[], now: Date): Snapshot {
  const t = now.getTime();
  const alongside: BerthRecord[] = [];
  const upcoming: BerthRecord[] = [];
  const departed: BerthRecord[] = [];
  for (const r of records) {
    const ata = r.ata ? Date.parse(r.ata) : null;
    const eta = r.eta ? Date.parse(r.eta) : null;
    const etd = r.etd ? Date.parse(r.etd) : null;
    const arrived = ata !== null ? ata <= t : eta !== null && eta <= t - 30 * 60_000;
    const gone = etd !== null && etd <= t && arrived;
    if (gone) departed.push(r);
    else if (arrived) alongside.push(r);
    else upcoming.push(r);
  }
  upcoming.sort((a, b) => (Date.parse(a.eta ?? "") || 0) - (Date.parse(b.eta ?? "") || 0));
  alongside.sort((a, b) => a.berth - b.berth);
  return { alongside, upcoming, departed };
}

/** 접안 중 선박을 선석 위에 배치. 같은 선석에 둘 이상이면 나란히 밀어 넣는다. */
export function placeDocked(alongside: BerthRecord[], exclude?: BerthRecord): DockedShip[] {
  const out: DockedShip[] = [];
  const byBerth = new Map<string, BerthRecord[]>();
  for (const r of alongside) {
    if (exclude && sameVoyage(r, exclude)) continue;
    const key = r.terminal + "-" + r.berth;
    byBerth.set(key, [...(byBerth.get(key) ?? []), r]);
  }
  for (const [, recs] of byBerth) {
    const berth = berthOf(recs[0].terminal, recs[0].berth);
    if (!berth) continue;
    const totalL = recs.reduce((s, r) => s + estimateLength(r), 0) + (recs.length - 1) * 20;
    let cursor = (berth.x0 + berth.x1) / 2 - totalL / 2;
    for (const r of recs) {
      const L = estimateLength(r);
      const B = L * 0.16;
      const x = cursor + L / 2;
      const y = berth.quayY - berth.landDir * (B / 2 + 4);
      // 우현 접안(S)이면 안벽이 위쪽일 때 선수가 서쪽(180°)을 향한다
      const h = (r.side === "S") === (berth.landDir < 0) ? Math.PI : 0;
      out.push({ rec: r, x, y, h, L, B });
      cursor += L + 20;
    }
  }
  return out;
}

export function sameVoyage(a: BerthRecord, b: BerthRecord): boolean {
  return a.voyage === b.voyage && a.terminal === b.terminal && a.berth === b.berth;
}

export function spawnShip(rec: BerthRecord): Ship {
  const L = estimateLength(rec);
  return { x: WORLD.w - L / 2 - 40, y: 600, h: Math.PI, u: 2.5, w: 0, r: 0, L, B: L * 0.16 };
}

export function msToKn(ms: number): number {
  return ms * 1.94384;
}

export function fmtKst(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function operatorColor(op: string): string {
  const palette: Record<string, string> = {
    HAS: "#e4572e",
    KMD: "#2e86de",
    SKR: "#1b998b",
    NSL: "#f4a261",
    DJS: "#6a4c93",
    DYS: "#8d99ae",
    EAS: "#ff7aa2",
    IAL: "#4f772d",
    TSL: "#c77dff",
    PCL: "#b5651d",
    SIT: "#577590",
    POL: "#43aa8b",
    CKL: "#90be6d",
    WSL: "#f9c74f",
    ESL: "#f8961e",
  };
  if (palette[op]) return palette[op];
  let h = 0;
  for (const c of op) h = (h * 31 + c.charCodeAt(0)) % 360;
  return "hsl(" + h + " 55% 55%)";
}
