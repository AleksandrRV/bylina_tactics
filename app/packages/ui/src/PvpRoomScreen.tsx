import { useMemo, useState } from "react";
import { createQrDataUrl, createWebRtcChannel, decodeQrImage, decodeSessionCode, encodeSessionCode, type Transport } from "@bylina/net";
import { useServices, useT } from "./context.js";
import { useI18nTick } from "./hooks.js";
import { unitPortrait } from "./portraits.js";

function unitName(unitId: string): string {
  return `unit.${unitId}.name`;
}

function SwordsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 3.5 8 8M3.5 3.5l2.6-1 3 3-1 2.6L3.5 3.5Z" />
      <path d="M16.5 16.5 12 12M16.5 16.5l-2.6 1-3-3 1-2.6 4.6 4.6Z" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 4 6.5 10l6 6" />
    </svg>
  );
}

type RoomTab = "local" | "network";
type Objective = "elimination" | "apple";

/**
 * Комната сбора «Потешных боев» (roadmap 0.14.0–0.16.0):
 * очерёдный выбор бойцов с ограничением N, условие победы (уничтожение либо
 * вынос яблока), поочерёдная игра на одном устройстве, локальная сеть
 * (соперник либо наблюдатель с полным обзором).
 */
export function PvpRoomScreen() {
  useI18nTick();
  const t = useT();
  const { session, content } = useServices();
  const pool = content.pvp.pool;
  const [tab, setTab] = useState<RoomTab>("local");

  return (
    <div className="screen pvp-room-screen">
      <header className="menu-brand">
        <p className="eyebrow">{t("app.subtitle")}</p>
        <h1 className="display-title">{t("menu.pvp")}</h1>
        <p className="muted">{t("pvp.roomHint")}</p>
      </header>

      <div className="pvp-tabs" role="tablist" aria-label={t("pvp.roomHint")}>
        <button type="button" role="tab" aria-selected={tab === "local"} className={`pvp-tab${tab === "local" ? " is-active" : ""}`} onClick={() => setTab("local")}>
          {t("pvp.tabLocal")}
        </button>
        <button type="button" role="tab" aria-selected={tab === "network"} className={`pvp-tab${tab === "network" ? " is-active" : ""}`} onClick={() => setTab("network")}>
          {t("pvp.tabNetwork")}
        </button>
      </div>

      {tab === "local" ? (
        <LocalSetup
          pool={pool}
          onStart={(side1, side2, objective) => session.startPvpBattle(side1, side2, Date.now() >>> 0, { objective })}
        />
      ) : (
        <NetworkSetup
          pool={pool}
          onHostStart={(side1, side2, objective, peerRole, omniscient, transport) =>
            session.startNetPvpBattle({ side1, side2 }, Date.now() >>> 0, transport, { objective, peerRole, omniscient })
          }
          onGuestJoin={(owner, transport) => session.bindGuestNetPvp(owner, transport)}
          onSpectatorJoin={(transport) => session.bindNetSpectator(transport)}
          onOmniscientChange={(value) => session.setNetOmniscient(value)}
        />
      )}

      <nav className="menu-nav">
        <button type="button" className="btn btn-ghost" onClick={() => session.goTo("menu")}>
          <BackIcon />
          {t("common.back")}
        </button>
      </nav>
    </div>
  );
}

/** Очерёдный выбор бойцов (base-design §7, roadmap 0.16.0). */
function Draft({
  pool,
  n,
  picks,
  current,
  onPick,
}: {
  pool: string[];
  n: number;
  picks: { 1: string[]; 2: string[] };
  current: 1 | 2 | null;
  onPick: (unitId: string) => void;
}) {
  const t = useT();
  const selected = new Set([...picks[1], ...picks[2]]);
  const done = current === null && picks[1].length === n && picks[2].length === n;
  return (
    <div className="draft">
      <div className="draft-status">
        <span className={`draft-side is-side1${current === 1 ? " is-current" : ""}${picks[1].length === n ? " is-full" : ""}`}>
          {t("pvp.side1")} · {picks[1].length}/{n}
        </span>
        <span className="draft-vs" aria-hidden="true">⇄</span>
        <span className={`draft-side is-side2${current === 2 ? " is-current" : ""}${picks[2].length === n ? " is-full" : ""}`}>
          {t("pvp.side2")} · {picks[2].length}/{n}
        </span>
      </div>
      {current !== null ? <p className="draft-hint">{t("pvp.draftPick")}</p> : null}
      {done ? <p className="draft-done">{t("pvp.draftDone")}</p> : null}
      <div className="draft-pool">
        {pool.map((unitId) => {
          const face = unitPortrait(unitId);
          const taken = selected.has(unitId);
          return (
            <button
              key={unitId}
              type="button"
              className={`draft-card${taken ? " is-taken" : ""}`}
              disabled={taken || current === null}
              onClick={() => onPick(unitId)}
            >
              {face ? <img className="draft-face" src={face} alt="" draggable={false} /> : <span className="deploy-face-empty" aria-hidden="true" />}
              <span className="draft-name">{t(unitName(unitId))}</span>
              {taken ? <span className="draft-taken-mark" aria-hidden="true">✓</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LocalSetup({
  pool,
  onStart,
}: {
  pool: string[];
  onStart: (side1: string[], side2: string[], objective: Objective) => void;
}) {
  const t = useT();
  const maxN = Math.min(5, Math.floor(pool.length / 2));
  const [objective, setObjective] = useState<Objective>("elimination");
  const [n, setN] = useState<number>(Math.min(3, maxN));
  const [starter] = useState<1 | 2>(() => (Math.random() < 0.5 ? 1 : 2));
  const [picks, setPicks] = useState<{ 1: string[]; 2: string[] }>({ 1: [], 2: [] });
  const [current, setCurrent] = useState<1 | 2 | null>(starter);

  const pick = (unitId: string): void => {
    if (current === null) return;
    if (picks[current].length >= n) return;
    const next = { ...picks, [current]: [...picks[current], unitId] };
    setPicks(next);
    if (next[1].length === n && next[2].length === n) {
      setCurrent(null);
    } else {
      setCurrent(current === 1 ? 2 : 1);
    }
  };

  const reset = (): void => {
    setPicks({ 1: [], 2: [] });
    setCurrent(starter);
  };

  const ready = current === null && picks[1].length === n && picks[2].length === n && n >= 1;

  return (
    <>
      <div className="pvp-options">
        <div className="pvp-option-group" role="radiogroup" aria-label={t("pvp.objectiveLabel")}>
          <span className="pvp-option-title">{t("pvp.objectiveLabel")}</span>
          <button type="button" role="radio" aria-checked={objective === "elimination"} className={`pvp-radio${objective === "elimination" ? " is-on" : ""}`} onClick={() => setObjective("elimination")}>
            {t("pvp.objectiveElimination")}
          </button>
          <button type="button" role="radio" aria-checked={objective === "apple"} className={`pvp-radio${objective === "apple" ? " is-on" : ""}`} onClick={() => setObjective("apple")}>
            {t("pvp.objectiveApple")}
          </button>
        </div>
        <div className="pvp-option-group">
          <span className="pvp-option-title">{t("pvp.nLabel")}</span>
          <div className="pvp-n-select">
            {Array.from({ length: maxN }, (_, i) => i + 1).map((value) => (
              <button key={value} type="button" className={`pvp-n-btn${n === value ? " is-on" : ""}`} onClick={() => { setN(value); reset(); }}>
                {value}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Draft pool={pool} n={n} picks={picks} current={current} onPick={pick} />

      <div className="pvp-arena">
        <SideCard side={1} pool={picks[1]} />
        <div className="pvp-versus" aria-hidden="true">
          <SwordsIcon />
          <span className="pvp-versus-label">{t("pvp.vs")}</span>
        </div>
        <SideCard side={2} pool={picks[2]} />
      </div>

      <div className="pvp-start-row">
        <button type="button" className="btn btn-ghost" onClick={reset}>
          {t("pvp.reset")}
        </button>
        <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => ready && onStart(picks[1], picks[2], objective)}>
          <span>{t("pvp.start")}</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </>
  );
}

function SideCard({ side, pool }: { side: 1 | 2; pool: string[] }) {
  const t = useT();
  return (
    <section className={`pvp-side-card is-side${side}`} aria-label={t(side === 1 ? "pvp.side1" : "pvp.side2")}>
      <h2 className="pvp-side-title">{t(side === 1 ? "pvp.side1" : "pvp.side2")}</h2>
      <div className="pvp-roster">
        {pool.length === 0 ? <p className="muted">{t("pvp.draftEmpty")}</p> : null}
        {pool.map((unitId) => {
          const face = unitPortrait(unitId);
          return (
            <div key={unitId} className="pvp-slot">
              {face ? <img className="pvp-slot-face" src={face} alt="" draggable={false} /> : <span className="deploy-face-empty" aria-hidden="true" />}
              <span className="pvp-slot-name">{t(unitName(unitId))}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NetworkSetup({
  pool,
  onHostStart,
  onGuestJoin,
  onSpectatorJoin,
  onOmniscientChange,
}: {
  pool: string[];
  onHostStart: (side1: string[], side2: string[], objective: Objective, peerRole: "guest" | "spectator", omniscient: boolean, transport: Transport) => void;
  onGuestJoin: (owner: number, transport: Transport) => void;
  onSpectatorJoin: (transport: Transport) => void;
  onOmniscientChange: (value: boolean) => void;
}) {
  const t = useT();
  const [role, setRole] = useState<"host" | "guest">("host");
  const [objective, setObjective] = useState<Objective>("elimination");
  const [peerRole, setPeerRole] = useState<"guest" | "spectator">("guest");
  const [joinRole, setJoinRole] = useState<"guest" | "spectator">("guest");
  const [omniscient, setOmniscient] = useState(false);
  const [code, setCode] = useState<string>("");
  const [peerCode, setPeerCode] = useState<string>("");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const transportRef = useMemo(() => ({ current: null as (Transport & { receiveSignal(data: unknown): void }) | null }), []);
  const qrInputRef = useMemo(() => ({ current: null as HTMLInputElement | null }), []);

  const createChannel = (initiator: boolean): Transport | null => {
    try {
      const channel = createWebRtcChannel({
        initiator,
        onSignal: (signal) => {
          const next = encodeSessionCode(signal);
          setCode(next);
          void createQrDataUrl(next).then(setQr).catch(() => setQr(null));
        },
        receiveSignal: () => undefined,
        onConnect: () => setConnected(true),
        onError: (err) => setError(err.message),
      });
      transportRef.current = channel;
      return channel;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  const applyPeerCode = (): void => {
    try {
      transportRef.current?.receiveSignal(decodeSessionCode(peerCode));
    } catch {
      setError(t("net.badCode"));
    }
  };

  const onQrFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, image.width, image.height);
        const decoded = decodeQrImage(data);
        if (decoded) {
          setPeerCode(decoded);
        } else {
          setError(t("net.noQr"));
        }
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="net-setup">
      <div className="net-role-switch" role="tablist" aria-label={t("pvp.tabNetwork")}>
        <button type="button" role="tab" aria-selected={role === "host"} className={`pvp-tab${role === "host" ? " is-active" : ""}`} onClick={() => { setRole("host"); setConnected(false); setError(null); }}>
          {t("net.host")}
        </button>
        <button type="button" role="tab" aria-selected={role === "guest"} className={`pvp-tab${role === "guest" ? " is-active" : ""}`} onClick={() => { setRole("guest"); setConnected(false); setError(null); }}>
          {t("net.guest")}
        </button>
      </div>

      {role === "host" ? (
        <div className="net-panel">
          <p className="muted">{t("net.hostHint")}</p>
          <div className="pvp-option-group" role="radiogroup" aria-label={t("pvp.objectiveLabel")}>
            <span className="pvp-option-title">{t("pvp.objectiveLabel")}</span>
            <button type="button" role="radio" aria-checked={objective === "elimination"} className={`pvp-radio${objective === "elimination" ? " is-on" : ""}`} onClick={() => setObjective("elimination")}>
              {t("pvp.objectiveElimination")}
            </button>
            <button type="button" role="radio" aria-checked={objective === "apple"} className={`pvp-radio${objective === "apple" ? " is-on" : ""}`} onClick={() => setObjective("apple")}>
              {t("pvp.objectiveApple")}
            </button>
          </div>
          <label className="pvp-check">
            <input type="checkbox" checked={omniscient} onChange={(event) => { setOmniscient(event.target.checked); onOmniscientChange(event.target.checked); }} />
            {t("net.omniscient")}
          </label>
          {!connected ? (
            <button type="button" className="btn btn-primary" onClick={() => { setError(null); createChannel(true); }}>
              {t("net.create")}
            </button>
          ) : null}
          {code ? (
            <div className="net-code-box">
              {qr ? <img className="net-qr" src={qr} alt={t("net.qrAlt")} draggable={false} /> : null}
              <code className="net-code">{code}</code>
              <p className="muted">{t("net.hostWait")}</p>
            </div>
          ) : null}
          {connected ? (
            <>
              <label className="net-input-label" htmlFor="net-peer-code">{t("net.peerCode")}</label>
              <input id="net-peer-code" className="net-input" value={peerCode} onChange={(event) => setPeerCode(event.target.value)} placeholder={t("net.peerCodePlaceholder")} />
              <button type="button" className="btn btn-ghost" onClick={applyPeerCode}>{t("net.apply")}</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => transportRef.current && onHostStart([...pool], [...pool], objective, peerRole, omniscient, transportRef.current)}
                disabled={pool.length === 0}
              >
                {t("net.startBattle")}
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <div className="net-panel">
          <p className="muted">{t("net.guestHint")}</p>
          <label className="net-input-label" htmlFor="net-guest-code">{t("net.enterCode")}</label>
          <input id="net-guest-code" className="net-input" value={peerCode} onChange={(event) => setPeerCode(event.target.value)} placeholder={t("net.enterCodePlaceholder")} />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const input = qrInputRef.current;
              if (input) input.click();
            }}
          >
            {t("net.scanQr")}
          </button>
          <input
            ref={(node) => { qrInputRef.current = node; }}
            type="file"
            accept="image/*"
            className="net-file-input"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onQrFile(file);
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setError(null);
              try {
                const signal = decodeSessionCode(peerCode);
                const channel = createChannel(false);
                if (!channel) return;
                (channel as Transport & { receiveSignal(data: unknown): void }).receiveSignal(signal);
                // Ведомый ждёт партию ведущего; роль выбирает сам участник:
                // соперник управляет стороной 2, наблюдатель команд не шлёт.
                if (joinRole === "spectator") {
                  onSpectatorJoin(channel);
                } else {
                  onGuestJoin(2, channel);
                }
              } catch {
                setError(t("net.badCode"));
              }
            }}
            disabled={!peerCode.trim()}
          >
            {t("net.connect")}
          </button>
          {connected ? <p className="net-connected">{t("net.connected")}</p> : null}
          <div className="pvp-option-group">
            <span className="pvp-option-title">{t("net.peerRole")}</span>
            <button type="button" className={`pvp-radio${joinRole === "guest" ? " is-on" : ""}`} onClick={() => setJoinRole("guest")}>
              {t("net.peerGuest")}
            </button>
            <button type="button" className={`pvp-radio${joinRole === "spectator" ? " is-on" : ""}`} onClick={() => setJoinRole("spectator")}>
              {t("net.peerSpectator")}
            </button>
          </div>
          <p className="muted">{t("net.spectatorJoinHint")}</p>
        </div>
      )}

      {error ? <p className="net-error" role="alert">{error}</p> : null}
    </div>
  );
}
