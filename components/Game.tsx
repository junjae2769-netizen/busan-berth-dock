"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BerthFeed, BerthRecord } from "@/lib/types";
import {
  BERTHS,
  QUAY_BOTTOM,
  QUAY_TOP,
  SIM_SPEED,
  WORLD,
  berthOf,
  buildSnapshot,
  checkCollision,
  checkDock,
  fmtKst,
  msToKn,
  operatorColor,
  placeDocked,
  sameVoyage,
  spawnShip,
  stepShip,
  type Berth,
  type DockCheck,
  type DockedShip,
  type Ship,
} from "@/lib/game";

type Phase = "loading" | "ready" | "playing" | "docked" | "failed";

interface Result {
  score: number;
  time: number;
  bumps: number;
  gap: number;
  centerOffset: number;
  reason?: string;
}

interface Keys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  q: boolean;
  e: boolean;
}

const REFRESH_MS = 5 * 60 * 1000;
const HOLD_SEC = 2.0; // 접안 조건을 이 시간(게임초) 유지하면 성공
const BEST_KEY = "busan-berth-dock:best";

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [feed, setFeed] = useState<BerthFeed | null>(null);
  const [pendingFeed, setPendingFeed] = useState<BerthFeed | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [mission, setMission] = useState<BerthRecord | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [result, setResult] = useState<Result | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [hud, setHud] = useState({ kn: 0, rudder: 0, bow: 0, dist: 0, time: 0, bumps: 0, throttle: 0 });
  const [dock, setDock] = useState<DockCheck | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [keysUi, setKeysUi] = useState<Keys>({ up: false, down: false, left: false, right: false, q: false, e: false });

  // 게임 루프에서 쓰는 가변 상태 (리렌더 없이)
  const shipRef = useRef<Ship | null>(null);
  const dockedRef = useRef<DockedShip[]>([]);
  const berthRef = useRef<Berth | null>(null);
  const keysRef = useRef<Keys>({ up: false, down: false, left: false, right: false, q: false, e: false });
  const cmdRef = useRef({ throttle: 0, rudder: 0, bow: 0 });
  const phaseRef = useRef<Phase>("loading");
  const timeRef = useRef(0);
  const bumpsRef = useRef(0);
  const holdRef = useRef(0);
  const flashRef = useRef(0);
  const lastRef = useRef<number | null>(null);
  const missionRef = useRef<BerthRecord | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    missionRef.current = mission;
  }, [mission]);

  /* ───── 데이터 가져오기 ───── */
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/berths", { cache: "no-store" });
      const data = (await res.json()) as BerthFeed;
      if (phaseRef.current === "playing") setPendingFeed(data);
      else setFeed(data);
    } catch {
      /* 네트워크 실패 시 기존 데이터 유지 */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    try {
      const b = localStorage.getItem(BEST_KEY);
      if (b) setBest(parseInt(b, 10));
    } catch {
      /* ignore */
    }
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, [load]);

  // 플레이가 끝나면 대기 중인 새 데이터 적용
  useEffect(() => {
    if (phase !== "playing" && pendingFeed) {
      setFeed(pendingFeed);
      setPendingFeed(null);
      showToast("BPT 선석배정 최신 데이터 반영");
    }
  }, [phase, pendingFeed]);

  const snapshot = useMemo(() => (feed ? buildSnapshot(feed.records, new Date(now)) : null), [feed, now]);

  const playable = useMemo(
    () => (snapshot ? snapshot.upcoming.filter((r) => berthOf(r.terminal, r.berth)) : []),
    [snapshot],
  );

  // 기본 미션: 가장 먼저 들어올 배
  useEffect(() => {
    if (!snapshot) return;
    setMission((cur) => {
      if (cur && playable.some((r) => sameVoyage(r, cur))) return cur;
      return playable[0] ?? null;
    });
    setPhase((p) => (p === "loading" ? "ready" : p));
  }, [snapshot, playable]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }

  /* ───── 라운드 준비 ───── */
  const setupRound = useCallback(
    (rec: BerthRecord) => {
      if (!snapshot) return;
      const berth = berthOf(rec.terminal, rec.berth);
      if (!berth) return;
      berthRef.current = berth;
      // 목표 선석에 있는 선행선은 출항한 것으로 가정하고 치운다
      const docked = placeDocked(snapshot.alongside, rec).filter(
        (d) => !(d.rec.terminal === berth.terminal && d.rec.berth === berth.id),
      );
      dockedRef.current = docked;
      shipRef.current = spawnShip(rec);
      cmdRef.current = { throttle: 0.4, rudder: 0, bow: 0 };
      timeRef.current = 0;
      bumpsRef.current = 0;
      holdRef.current = 0;
      flashRef.current = 0;
      lastRef.current = null;
      setResult(null);
      setDock(null);
    },
    [snapshot],
  );

  const start = useCallback(() => {
    if (!mission) return;
    setupRound(mission);
    setPhase("playing");
  }, [mission, setupRound]);

  const chooseMission = useCallback(
    (rec: BerthRecord) => {
      setMission(rec);
      setupRound(rec);
      setPhase("playing");
    },
    [setupRound],
  );

  // 준비 화면에서도 선석 상황을 그리기 위해 미션이 정해지면 배치만 해 둔다
  useEffect(() => {
    if (mission && phase === "ready") setupRound(mission);
  }, [mission, phase, setupRound]);

  /* ───── 키보드 ───── */
  useEffect(() => {
    const map: Record<string, keyof Keys> = {
      ArrowUp: "up",
      KeyW: "up",
      ArrowDown: "down",
      KeyS: "down",
      ArrowLeft: "left",
      KeyA: "left",
      ArrowRight: "right",
      KeyD: "right",
      KeyQ: "q",
      KeyE: "e",
    };
    const onDown = (ev: KeyboardEvent) => {
      if (ev.repeat) return;
      const k = map[ev.code];
      if (k) {
        keysRef.current[k] = true;
        setKeysUi({ ...keysRef.current });
        ev.preventDefault();
        return;
      }
      if (ev.code === "Space") {
        cmdRef.current.throttle = 0;
        ev.preventDefault();
      } else if (ev.code === "KeyR") {
        if (missionRef.current) chooseMission(missionRef.current);
      } else if (ev.code === "Enter") {
        if (phaseRef.current !== "playing" && missionRef.current) chooseMission(missionRef.current);
      }
    };
    const onUp = (ev: KeyboardEvent) => {
      const k = map[ev.code];
      if (k) {
        keysRef.current[k] = false;
        setKeysUi({ ...keysRef.current });
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [chooseMission]);

  const pressKey = (k: keyof Keys, on: boolean) => {
    keysRef.current[k] = on;
    setKeysUi({ ...keysRef.current });
  };

  /* ───── 라운드 종료 ───── */
  const finish = useCallback((ok: boolean, reason?: string) => {
    const ship = shipRef.current;
    const berth = berthRef.current;
    const t = timeRef.current;
    const bumps = bumpsRef.current;
    let gap = 0;
    let centerOffset = 0;
    if (ship && berth) {
      const d = checkDock(ship, berth, missionRef.current?.side ?? "");
      gap = d.gap;
      centerOffset = d.centerOffset;
    }
    let score = 0;
    if (ok) {
      score = Math.round(
        Math.max(0, 1000 - t * 1.5 - bumps * 120 + Math.max(0, 100 - centerOffset) + (gap < 6 ? 50 : 0)),
      );
    }
    setResult({ score, time: t, bumps, gap, centerOffset, reason });
    setPhase(ok ? "docked" : "failed");
    if (ok) {
      setBest((b) => {
        const nb = b === null ? score : Math.max(b, score);
        try {
          localStorage.setItem(BEST_KEY, String(nb));
        } catch {
          /* ignore */
        }
        return nb;
      });
    }
  }, []);

  /* ───── 게임 루프 + 렌더 ───── */
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let hudTick = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = stage.getBoundingClientRect();
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(stage);

    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      const last = lastRef.current ?? ts;
      lastRef.current = ts;
      const realDt = Math.min(0.05, (ts - last) / 1000);
      const dt = realDt * SIM_SPEED;

      if (phaseRef.current === "playing" && shipRef.current && berthRef.current) {
        update(dt, realDt);
      }
      draw(ctx, canvas);

      hudTick += realDt;
      if (hudTick > 0.1) {
        hudTick = 0;
        const s = shipRef.current;
        const b = berthRef.current;
        if (s && b) {
          const cx = (b.x0 + b.x1) / 2;
          const cy = b.quayY - b.landDir * (s.B / 2 + 4);
          setHud({
            kn: msToKn(s.u),
            rudder: cmdRef.current.rudder,
            bow: cmdRef.current.bow,
            throttle: cmdRef.current.throttle,
            dist: Math.hypot(s.x - cx, s.y - cy),
            time: timeRef.current,
            bumps: bumpsRef.current,
          });
          setDock(checkDock(s, b, missionRef.current?.side ?? ""));
        }
      }
    };

    const update = (dt: number, realDt: number) => {
      const s = shipRef.current!;
      const b = berthRef.current!;
      const k = keysRef.current;
      const c = cmdRef.current;

      // 명령 보간: 스로틀은 누르는 동안 서서히, 타는 빠르게, 스러스터는 즉시
      if (k.up) c.throttle = Math.min(1, c.throttle + 0.9 * realDt);
      if (k.down) c.throttle = Math.max(-1, c.throttle - 0.9 * realDt);
      const rudTarget = k.left ? -1 : k.right ? 1 : 0;
      c.rudder += (rudTarget - c.rudder) * Math.min(1, 4 * realDt);
      if (Math.abs(c.rudder) < 0.02 && rudTarget === 0) c.rudder = 0;
      c.bow = k.q ? -1 : k.e ? 1 : 0;

      const prev = { ...s };
      const steps = 2;
      for (let i = 0; i < steps; i++) stepShip(s, c, dt / steps);
      timeRef.current += dt;

      const col = checkCollision(s, dockedRef.current);
      if (col.kind !== "none") {
        const speed = Math.hypot(s.u, s.w);
        if (col.kind === "boundary") {
          Object.assign(s, prev);
          s.u *= 0.2;
          s.w = 0;
          s.r = 0;
        } else {
          bumpsRef.current += 1;
          flashRef.current = 0.6;
          Object.assign(s, prev);
          if (speed > 2.0) {
            const what = col.kind === "ship" ? `${col.with?.rec.vessel} 와 충돌` : "안벽 충돌";
            finish(false, `${what} (접촉 속력 ${msToKn(speed).toFixed(1)} kn)`);
            return;
          }
          s.u *= -0.3;
          s.w *= -0.3;
          s.r *= 0.2;
        }
      }

      const d = checkDock(s, b, missionRef.current?.side ?? "");
      if (d.ready) {
        holdRef.current += dt;
        if (holdRef.current >= HOLD_SEC) {
          finish(true);
          return;
        }
      } else {
        holdRef.current = 0;
      }
      if (flashRef.current > 0) flashRef.current -= realDt;
    };

    const draw = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
      const W = canvas.width;
      const H = canvas.height;
      const sc = Math.min(W / WORLD.w, H / WORLD.h);
      const ox = (W - WORLD.w * sc) / 2;
      const oy = (H - WORLD.h * sc) / 2;
      const X = (x: number) => ox + x * sc;
      const Y = (y: number) => oy + y * sc;
      const dpr = W / canvas.getBoundingClientRect().width || 1;
      const fpx = (px: number) => px * dpr;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#071523";
      ctx.fillRect(0, 0, W, H);

      // 수역
      const g = ctx.createLinearGradient(0, Y(QUAY_TOP), 0, Y(QUAY_BOTTOM));
      g.addColorStop(0, "#0e3a5c");
      g.addColorStop(0.5, "#0b4a73");
      g.addColorStop(1, "#0e3a5c");
      ctx.fillStyle = g;
      ctx.fillRect(X(0), Y(QUAY_TOP), WORLD.w * sc, (QUAY_BOTTOM - QUAY_TOP) * sc);

      // 잔물결
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = fpx(1);
      const t = performance.now() / 1000;
      for (let y = QUAY_TOP + 60; y < QUAY_BOTTOM; y += 80) {
        ctx.beginPath();
        for (let x = 0; x <= WORLD.w; x += 40) {
          const yy = y + Math.sin(x / 90 + t * 0.8 + y) * 6;
          if (x === 0) ctx.moveTo(X(x), Y(yy));
          else ctx.lineTo(X(x), Y(yy));
        }
        ctx.stroke();
      }

      // 육지(안벽 뒤 야드)
      ctx.fillStyle = "#2d3b49";
      ctx.fillRect(X(0), Y(0), WORLD.w * sc, QUAY_TOP * sc);
      ctx.fillRect(X(0), Y(QUAY_BOTTOM), WORLD.w * sc, (WORLD.h - QUAY_BOTTOM) * sc);
      // 안벽 콘크리트 선
      ctx.fillStyle = "#8d9aa8";
      ctx.fillRect(X(0), Y(QUAY_TOP - 6), WORLD.w * sc, 6 * sc);
      ctx.fillRect(X(0), Y(QUAY_BOTTOM), WORLD.w * sc, 6 * sc);

      // 외해 입구 표시 (오른쪽)
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(X(WORLD.w - 140), Y(QUAY_TOP), 140 * sc, (QUAY_BOTTOM - QUAY_TOP) * sc);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = `${fpx(12)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("외해 →", X(WORLD.w - 70), Y(600));

      // 선석 구획과 라벨, 크레인
      const target = berthRef.current;
      const mis = missionRef.current;
      for (const b of BERTHS) {
        const isTarget = target && b.id === target.id && b.terminal === target.terminal;
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = fpx(1);
        ctx.beginPath();
        const yA = b.landDir < 0 ? 0 : QUAY_BOTTOM;
        const yB = b.landDir < 0 ? QUAY_TOP : WORLD.h;
        ctx.moveTo(X(b.x0), Y(yA));
        ctx.lineTo(X(b.x0), Y(yB));
        ctx.moveTo(X(b.x1), Y(yA));
        ctx.lineTo(X(b.x1), Y(yB));
        ctx.stroke();

        // 크레인 (장식)
        ctx.fillStyle = "#c9d3dd";
        const craneY = b.landDir < 0 ? QUAY_TOP - 40 : QUAY_BOTTOM + 12;
        for (let i = 0; i < 2; i++) {
          const cx = b.x0 + (b.x1 - b.x0) * (0.3 + 0.4 * i);
          ctx.fillRect(X(cx - 14), Y(craneY), 28 * sc, 28 * sc);
          ctx.fillRect(X(cx - 2), Y(b.landDir < 0 ? QUAY_TOP - 70 : QUAY_BOTTOM + 40), 4 * sc, 30 * sc);
        }

        // 라벨
        ctx.fillStyle = isTarget ? "#ffb703" : "rgba(255,255,255,0.75)";
        ctx.font = `${fpx(isTarget ? 14 : 12)}px sans-serif`;
        ctx.textAlign = "center";
        const ly = b.landDir < 0 ? 110 : QUAY_BOTTOM + 110;
        ctx.fillText(`${b.terminal} ${b.id}`, X((b.x0 + b.x1) / 2), Y(ly));

        if (isTarget) {
          // 목표 선석 하이라이트
          ctx.save();
          ctx.setLineDash([fpx(8), fpx(6)]);
          ctx.strokeStyle = "#ffb703";
          ctx.lineWidth = fpx(2);
          const hy = b.landDir < 0 ? QUAY_TOP : QUAY_BOTTOM - 70;
          ctx.strokeRect(X(b.x0), Y(hy), (b.x1 - b.x0) * sc, 70 * sc);
          ctx.restore();
          ctx.fillStyle = "rgba(255,183,3,0.85)";
          ctx.font = `${fpx(11)}px sans-serif`;
          const sideTxt = mis?.side === "P" ? "좌현(P) 접안" : mis?.side === "S" ? "우현(S) 접안" : "접안";
          ctx.fillText(`목표 · ${sideTxt}`, X((b.x0 + b.x1) / 2), Y(b.landDir < 0 ? QUAY_TOP + 90 : QUAY_BOTTOM - 80));
        }
      }

      // 접안 중 선박
      for (const d of dockedRef.current) {
        drawShip(ctx, X(d.x), Y(d.y), d.h, d.L, d.B, sc, operatorColor(d.rec.operator), false);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = `${fpx(10)}px sans-serif`;
        ctx.textAlign = "center";
        const ly = d.y + (d.y < 600 ? d.B / 2 + 18 : -(d.B / 2 + 10));
        ctx.fillText(d.rec.vessel, X(d.x), Y(ly));
      }

      // 플레이어 선박
      const s = shipRef.current;
      if (s) {
        const col = mis ? operatorColor(mis.operator) : "#e4572e";
        drawShip(ctx, X(s.x), Y(s.y), s.h, s.L, s.B, sc, col, true, mis?.side ?? "");
        // 선수 방향선
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = fpx(1);
        ctx.beginPath();
        ctx.moveTo(X(s.x), Y(s.y));
        ctx.lineTo(X(s.x + Math.cos(s.h) * (s.L / 2 + 60)), Y(s.y + Math.sin(s.h) * (s.L / 2 + 60)));
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${fpx(11)}px sans-serif`;
        ctx.textAlign = "center";
        if (mis) ctx.fillText(mis.vessel, X(s.x), Y(s.y + s.B / 2 + 22));

        // 접안 유지 게이지
        if (holdRef.current > 0 && phaseRef.current === "playing") {
          const p = Math.min(1, holdRef.current / HOLD_SEC);
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.fillRect(X(s.x - 60), Y(s.y - s.B / 2 - 30), 120 * sc, 10 * sc);
          ctx.fillStyle = "#2ec4b6";
          ctx.fillRect(X(s.x - 60), Y(s.y - s.B / 2 - 30), 120 * sc * p, 10 * sc);
        }
      }

      // 충돌 플래시
      if (flashRef.current > 0) {
        ctx.fillStyle = `rgba(255,80,80,${Math.min(0.35, flashRef.current * 0.5)})`;
        ctx.fillRect(0, 0, W, H);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [finish]);

  /* ───── 파생 표시값 ───── */
  const targetBerth = mission ? berthOf(mission.terminal, mission.berth) : undefined;
  const removedAtTarget =
    snapshot && targetBerth
      ? snapshot.alongside.filter((r) => r.terminal === targetBerth.terminal && r.berth === targetBerth.id)
      : [];
  const sideLabel = (s: string) => (s === "S" ? "우현(S)" : s === "P" ? "좌현(P)" : "미정");

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          신선대·감만 접안 게임
          <small>BPT 선석배정 현황 실시간 반영</small>
        </h1>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {feed && (
            <span className={`chip ${feed.source}`} title={feed.error ?? ""}>
              <span className="dot" />
              {feed.source === "live" ? "BPT 실시간" : "샘플 데이터"} · {fmtKst(feed.fetchedAt)} 수신
            </span>
          )}
          {pendingFeed && <span className="chip">새 데이터 대기</span>}
          {best !== null && <span className="chip">최고 {best}점</span>}
        </div>
      </header>

      <div className="main">
        <div className="stage" ref={stageRef}>
          <canvas ref={canvasRef} />

          <div className="hud">
            <div className="tile">
              속력
              <b>
                {hud.kn >= 0 ? "" : "−"}
                {Math.abs(hud.kn).toFixed(1)} kn
              </b>
            </div>
            <div className="tile">
              엔진
              <b>{Math.round(hud.throttle * 100)}%</b>
            </div>
            <div className="tile">
              타각
              <b>
                {hud.rudder < -0.05 ? "좌" : hud.rudder > 0.05 ? "우" : "중앙"} {Math.round(Math.abs(hud.rudder) * 35)}°
              </b>
            </div>
            <div className="tile">
              선석까지
              <b>{Math.round(hud.dist)} m</b>
            </div>
            <div className="tile">
              경과
              <b>{Math.floor(hud.time / 60)}:{String(Math.floor(hud.time % 60)).padStart(2, "0")}</b>
            </div>
            <div className={`tile ${hud.bumps > 0 ? "bad" : ""}`}>
              접촉
              <b>{hud.bumps}회</b>
            </div>
            {dock && phase === "playing" && (
              <>
                <div className={`tile ${dock.inBerth ? "ok" : ""}`}>
                  선석범위
                  <b>{dock.inBerth ? "OK" : "밖"}</b>
                </div>
                <div className={`tile ${dock.headingErrDeg <= 7 ? "ok" : ""}`}>
                  평행
                  <b>{Math.round(dock.headingErrDeg)}°</b>
                </div>
                <div className={`tile ${dock.sideOk ? "ok" : "bad"}`}>
                  접안현
                  <b>{dock.sideOk ? "OK" : "반대"}</b>
                </div>
                <div className={`tile ${dock.gap <= 14 ? "ok" : ""}`}>
                  안벽간격
                  <b>{Math.round(dock.gap)} m</b>
                </div>
                <div className={`tile ${dock.slow ? "ok" : ""}`}>
                  속력조건
                  <b>{dock.slow ? "OK" : "감속"}</b>
                </div>
              </>
            )}
          </div>

          {toast && (
            <div style={{ position: "absolute", top: 10, right: 10 }} className="chip live">
              {toast}
            </div>
          )}

          {phase === "loading" && (
            <div className="banner">
              <div className="card">
                <h2>선석배정 현황 불러오는 중…</h2>
                <p>BPT 정보조회서비스에서 신선대·감만 배정표를 읽고 있습니다.</p>
              </div>
            </div>
          )}

          {phase === "ready" && mission && targetBerth && (
            <div className="banner">
              <div className="card">
                <h2>{mission.vessel}</h2>
                <p>
                  {mission.voyage} · {mission.operator} · 항로 {mission.route || "-"}
                  <br />
                  ETA {fmtKst(mission.eta)} · 양하 {mission.discharge} / 선적 {mission.load}
                </p>
                <p>
                  목표: <b style={{ color: "var(--accent)" }}>{targetBerth.terminal} {targetBerth.id}번 선석</b>,{" "}
                  {sideLabel(mission.side)} 접안
                </p>
                {removedAtTarget.length > 0 && (
                  <p style={{ fontSize: 12 }}>
                    선행선 {removedAtTarget.map((r) => r.vessel).join(", ")} 은(는) 출항한 것으로 가정합니다.
                  </p>
                )}
                <p style={{ fontSize: 12 }}>
                  오른쪽 외해에서 들어옵니다. 안벽과 평행하게, 요구된 현측으로, 1 kn 아래로 붙이면 성공.
                </p>
                <button className="btn primary" onClick={start}>
                  입항 시작 (Enter)
                </button>
              </div>
            </div>
          )}

          {phase === "ready" && !mission && snapshot && (
            <div className="banner">
              <div className="card">
                <h2>입항 예정 선박이 없습니다</h2>
                <p>지금은 접안 중인 선박만 있습니다. 데이터가 갱신되면 자동으로 미션이 생깁니다.</p>
              </div>
            </div>
          )}

          {(phase === "docked" || phase === "failed") && result && mission && (
            <div className="banner">
              <div className="card">
                <h2>{phase === "docked" ? "접안 완료! 라인 잡았습니다" : "접안 실패"}</h2>
                {phase === "docked" ? (
                  <>
                    <div className="score">{result.score}점</div>
                    <p>
                      소요 {Math.floor(result.time / 60)}분 {Math.floor(result.time % 60)}초 · 접촉 {result.bumps}회 ·
                      안벽간격 {Math.round(result.gap)} m · 중앙 오차 {Math.round(result.centerOffset)} m
                    </p>
                  </>
                ) : (
                  <p style={{ color: "var(--warn)" }}>{result.reason}</p>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                  <button className="btn primary" onClick={() => chooseMission(mission)}>
                    다시 (R)
                  </button>
                  {playable.length > 1 && (
                    <button
                      className="btn"
                      onClick={() => {
                        const i = playable.findIndex((r) => sameVoyage(r, mission));
                        chooseMission(playable[(i + 1) % playable.length]);
                      }}
                    >
                      다음 입항선
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="touch">
            <div className="pad left">
              <button
                className={keysUi.q ? "on" : ""}
                onPointerDown={() => pressKey("q", true)}
                onPointerUp={() => pressKey("q", false)}
                onPointerCancel={() => pressKey("q", false)}
                onPointerLeave={() => pressKey("q", false)}
              >
                ◁<small>스러스터</small>
              </button>
              <button
                className={keysUi.up ? "on" : ""}
                onPointerDown={() => pressKey("up", true)}
                onPointerUp={() => pressKey("up", false)}
                onPointerCancel={() => pressKey("up", false)}
                onPointerLeave={() => pressKey("up", false)}
              >
                ▲<small>전진</small>
              </button>
              <button
                className={keysUi.e ? "on" : ""}
                onPointerDown={() => pressKey("e", true)}
                onPointerUp={() => pressKey("e", false)}
                onPointerCancel={() => pressKey("e", false)}
                onPointerLeave={() => pressKey("e", false)}
              >
                ▷<small>스러스터</small>
              </button>
              <button onPointerDown={() => (cmdRef.current.throttle = 0)}>
                ■<small>정지</small>
              </button>
              <button
                className={keysUi.down ? "on" : ""}
                onPointerDown={() => pressKey("down", true)}
                onPointerUp={() => pressKey("down", false)}
                onPointerCancel={() => pressKey("down", false)}
                onPointerLeave={() => pressKey("down", false)}
              >
                ▼<small>후진</small>
              </button>
              <button onPointerDown={() => mission && chooseMission(mission)}>
                ↻<small>다시</small>
              </button>
            </div>
            <div className="pad right">
              <button
                className={keysUi.left ? "on" : ""}
                onPointerDown={() => pressKey("left", true)}
                onPointerUp={() => pressKey("left", false)}
                onPointerCancel={() => pressKey("left", false)}
                onPointerLeave={() => pressKey("left", false)}
              >
                ◀<small>좌타</small>
              </button>
              <button
                className={keysUi.right ? "on" : ""}
                onPointerDown={() => pressKey("right", true)}
                onPointerUp={() => pressKey("right", false)}
                onPointerCancel={() => pressKey("right", false)}
                onPointerLeave={() => pressKey("right", false)}
              >
                ▶<small>우타</small>
              </button>
            </div>
          </div>
        </div>

        <aside className="side">
          <div className="panel mission">
            <h3>미션 · 다음 입항선</h3>
            {mission && targetBerth ? (
              <>
                <div className="name">{mission.vessel}</div>
                <div className="meta">
                  {mission.voyage} · 선사 {mission.operator} · 항로 {mission.route || "-"}
                  <br />
                  ETA {fmtKst(mission.eta)} · ETD {fmtKst(mission.etd)}
                  <br />
                  양하 {mission.discharge} · 선적 {mission.load}
                  {mission.quarantine ? " · 검역" : ""}
                </div>
                <div className="target">
                  목표 <b>{targetBerth.terminal} {targetBerth.id}번</b> · {sideLabel(mission.side)} 접안
                </div>
              </>
            ) : (
              <div className="meta">입항 예정 선박 없음</div>
            )}
          </div>

          <div className="panel">
            <h3>지금 접안 중 ({snapshot?.alongside.length ?? 0}척)</h3>
            <div className="list">
              {snapshot?.alongside.map((r) => (
                <div key={r.terminal + r.voyage + r.berth} className={`row ${r.operator === "HAS" ? "heunga" : ""}`}>
                  <div className="berth">
                    {r.berth}
                    <small>{r.terminal}</small>
                  </div>
                  <div className="vessel">
                    {r.vessel}
                    <small>
                      {r.voyage} · {r.operator} · {r.route}
                    </small>
                  </div>
                  <div className="time">
                    출항
                    <b>{fmtKst(r.etd)}</b>
                  </div>
                </div>
              ))}
              {snapshot && snapshot.alongside.length === 0 && <div className="legend">접안 중인 선박 없음</div>}
            </div>
          </div>

          <div className="panel">
            <h3>입항 예정 ({playable.length}척)</h3>
            <div className="list">
              {playable.map((r) => (
                <div key={r.terminal + r.voyage + r.berth} className={`row ${r.operator === "HAS" ? "heunga" : ""}`}>
                  <div className="berth">
                    {r.berth}
                    <small>{r.terminal}</small>
                  </div>
                  <div className="vessel">
                    {r.vessel}
                    <small>
                      {r.voyage} · {r.operator} · {sideLabel(r.side)}
                    </small>
                  </div>
                  <div className="time">
                    <button onClick={() => chooseMission(r)}>이 배로</button>
                    <b>{fmtKst(r.eta)}</b>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel legend">
            <h3>조작</h3>
            <kbd>↑</kbd>/<kbd>W</kbd> 엔진 올림 · <kbd>↓</kbd>/<kbd>S</kbd> 엔진 내림(후진) · <kbd>Space</kbd> 엔진 정지
            <br />
            <kbd>←</kbd>/<kbd>A</kbd> 좌타 · <kbd>→</kbd>/<kbd>D</kbd> 우타
            <br />
            <kbd>Q</kbd>/<kbd>E</kbd> 바우스러스터 (선수를 좌/우로 밀기)
            <br />
            <kbd>R</kbd> 다시 · <kbd>Enter</kbd> 시작
            <br />
            배는 관성이 큽니다. 선석 300 m 전부터 엔진을 끄고 타와 스러스터로만 붙이세요.
          </div>
        </aside>
      </div>

      <div className="footer-note">
        선박명·항차·선석·접안현·ETA/ETD는 부산항터미널(BPT) 정보조회서비스 「선석배정 현황(T)」을 5분마다 읽어 반영합니다.
        선박 길이는 제원 데이터가 없어 양하·선적 물량으로 추정한 값이며, 선석 배치도는 게임용으로 단순화했습니다.
      </div>
    </div>
  );
}

/** 선체 그리기 (화면 좌표, 회전 포함) */
function drawShip(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  h: number,
  L: number,
  B: number,
  sc: number,
  color: string,
  player: boolean,
  side: "S" | "P" | "" = "",
) {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(h);
  ctx.scale(sc, sc);
  const hl = L / 2;
  const hb = B / 2;
  // 선체
  ctx.beginPath();
  ctx.moveTo(hl, 0);
  ctx.lineTo(hl - L * 0.18, -hb);
  ctx.lineTo(-hl, -hb);
  ctx.lineTo(-hl, hb);
  ctx.lineTo(hl - L * 0.18, hb);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = player ? 3 / sc : 1.5 / sc;
  ctx.strokeStyle = player ? "#fff" : "rgba(0,0,0,0.5)";
  ctx.stroke();
  // 갑판 컨테이너 줄
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  const rows = 3;
  for (let i = 0; i < rows; i++) {
    const y = -hb + (B / (rows + 1)) * (i + 1) - 1.5;
    ctx.fillRect(-hl + L * 0.15, y, L * 0.6, 3);
  }
  // 선교(선미 쪽)
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(-hl + L * 0.05, -hb * 0.6, L * 0.08, B * 1.2 * 0.5);
  // 우현/좌현 표시 (플레이어)
  if (player && side) {
    ctx.fillStyle = "#ffb703";
    ctx.font = `${Math.max(10, B * 0.55)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // 우현(S)은 선수 기준 오른쪽 = 로컬 +y
    const y = side === "S" ? hb * 0.55 : -hb * 0.55;
    ctx.fillText(side, 0, y);
  }
  ctx.restore();
}
