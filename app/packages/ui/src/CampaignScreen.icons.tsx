/**
 * Геометрические иконки экрана кампании (0.20.x, этап 4.3): плоский стиль,
 * читаются без панели. Вынесены из CampaignScreen.tsx, чтобы уменьшить
 * размер главного файла (с 1189 строк) и упростить переиспользование
 * (например, в карточках результатов и подсказках).
 *
 * Все иконки - функциональные компоненты без пропсов, кроме MissionTypeIcon
 * (выбирает иконку по типу миссии) и LevelPips (принимает уровень).
 */

import type { MissionConfig } from "@bylina/content";

/* ---------- Иконки ресурсов (14x14) ---------- */

export function CoinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6.2" />
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2" />
    </svg>
  );
}

export function HerbIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M8 14V6" />
      <path d="M8 7c-2.4 0-3.6-1.6-3.4-3.8 2.3-.2 3.7 1 3.4 3.8Z" />
      <path d="M8 9.5c2.4 0 3.6-1.6 3.4-3.8-2.3-.2-3.7 1-3.4 3.8Z" />
      <path d="M8 12c-1.9 0-2.8-1.2-2.6-2.9 1.7-.2 2.8.8 2.6 2.9Z" />
    </svg>
  );
}

export function GemIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M6 2.5h4l3 3.5-5 7.5L3 6l3-3.5Z" />
      <path d="M3 6h10M8 13.5 6.6 6M8 13.5 9.4 6" />
    </svg>
  );
}

export function CrossIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M8 2.5v11M2.5 8h11" />
    </svg>
  );
}

/* ---------- Иконки служб и действий (18-22) ---------- */

export function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M10 2.5 16 5v5c0 3.6-2.4 6.2-6 7.5C6.4 16.2 4 13.6 4 10V5l6-2.5Z" />
      <path d="M7 10h6" />
    </svg>
  );
}

export function HammerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 10.5 3 16l1.5 1.5 5.5-5.5" />
      <path d="m10 9 4.6-4.6a2.4 2.4 0 0 1 3.4 3.4L13.4 12.4 10 9Z" />
      <path d="M13 4.5 15.5 7" />
    </svg>
  );
}

export function ChamberIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 4.5h12M4 15.5h12" />
      <path d="M10 2v4M10 14v4" />
      <path d="M7 10h6" />
    </svg>
  );
}

export function SwordsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 3.5 8 8M3.5 3.5l2.6-1 3 3-1 2.6L3.5 3.5Z" />
      <path d="M16.5 16.5 12 12M16.5 16.5l-2.6 1-3-3 1-2.6 4.6 4.6Z" />
      <path d="M6 14 3.5 16.5 8 17l3-3" />
    </svg>
  );
}

export function IdolIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2.5h8" />
      <path d="M7 2.5v3.5M13 2.5v3.5" />
      <path d="M5.5 6h9l-.8 9.5h-7.4L5.5 6Z" />
      <circle cx="10" cy="9.5" r="1.4" />
      <path d="M8.6 12.5h2.8M10 12.5v1.8" />
    </svg>
  );
}

export function RescueIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.5 15 4.5v4.6c0 3.4-2.2 6-5 7.4-2.8-1.4-5-4-5-7.4V4.5l5-2Z" />
      <path d="M10 6.5v4M8 8.5h4" />
    </svg>
  );
}

export function ReconIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 10c2-4.5 4.5-6.5 7.5-6.5s5.5 2 7.5 6.5c-2 4.5-4.5 6.5-7.5 6.5S4.5 14.5 2.5 10Z" />
      <circle cx="10" cy="10" r="2.2" />
      <path d="M10 7.8v-2M12.2 10h2M10 12.2v2M7.8 10h-2" />
    </svg>
  );
}

export function ShipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13.5h14l-1.8 3H4.8L3 13.5Z" />
      <path d="M10 3v10" />
      <path d="M10 3.5c2.8.8 3.6 2.6 3.4 5H10V3.5Z" />
      <path d="M6.5 9.5 5 6.8M13.5 9.5 15 6.8" />
    </svg>
  );
}

export function CompassIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <circle cx="11" cy="11" r="9" />
      <path d="m14.8 7.2-1.7 5-5 1.7 1.7-5 5-1.7Z" />
    </svg>
  );
}

export function RadarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="10" cy="10" r="8" strokeDasharray="4 2.6" />
      <path d="M10 10 16 4" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function AnvilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14h12" />
      <path d="M5 14v-3a5 5 0 0 1 10 0v3" />
      <path d="M3 11h14M10 6V4.2M7 4.2h6" />
    </svg>
  );
}

/* ---------- Силуэт и шкала ---------- */

export function RecruitSilhouette() {
  return (
    <svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="32" cy="22" r="9" />
      <path d="M14 54c2-12 9-17 18-17s16 5 18 17" />
    </svg>
  );
}

export function LevelPips({ level }: { level: number }) {
  return (
    <span className="level-pips" aria-hidden="true">
      {Array.from({ length: Math.min(level, 5) }, (_, index) => (
        <i key={index} className={index < level ? "on" : ""} />
      ))}
    </span>
  );
}

/* ---------- Селектор по типу миссии ---------- */

/** Иконка типа миссии (0.20.x, этап 4.3): смысл точки читается без панели. */
export function MissionTypeIcon({ type }: { type: MissionConfig["type"] }) {
  if (type === "destroy") return <IdolIcon />;
  if (type === "rescue") return <RescueIcon />;
  if (type === "recon") return <ReconIcon />;
  return <SwordsIcon />;
}
