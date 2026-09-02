/**
 * Маленькие иконки экрана боя (18×18). Вынесены из BattleScreenView.tsx
 * (3 функции), чтобы уменьшить шум в главном файле и упростить
 * переиспользование (например, в карточках подсказок и диалогах).
 */

/** Иконка автопобеды: молния как знак мгновенного разрешения. */
export function AutoWinIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2Z" />
    </svg>
  );
}

/** Иконка-жук: общепринятый символ отладочного режима. */
export function DebugIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2l1.5 2.5M16 2l-1.5 2.5" />
      <ellipse cx="12" cy="14" rx="5" ry="6" />
      <path d="M12 8v12" />
      <path d="M7 12H3M21 12h-4M7.5 17l-3 2.5M16.5 17l3 2.5M7.5 11l-3-2.5M16.5 11l3-2.5" />
      <circle cx="12" cy="7" r="2.5" />
    </svg>
  );
}

/** Иконка выхода из обучения: дверь с выходящей стрелкой. */
export function ExitIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 4H6v16h7" />
      <path d="M16 8l4 4-4 4" />
      <path d="M10 12h9" />
    </svg>
  );
}

