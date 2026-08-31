/**
 * Кнопки действий и окно информации о них (0.20.46).
 *
 * Кнопка стала квадратной миниатюрой: образ наверху, название мелко под
 * ним. Активность обозначает подсветка самой кнопки — прежде перед
 * названием стоял кружок-радиомаркер, дублировавший состояние, которое
 * и так читается рамкой и свечением.
 *
 * Долгое нажатие (или правый клик — тот же жест для мыши) открывает окно
 * информации поверх боя: название, крупный образ, приглушённая
 * нарративная строка и числа из боевых данных — стоимость в очках
 * действия, дальность, урон, конец хода.
 */

import { useEffect } from "react";
import { useT } from "./context.js";
import type { ActionInfo } from "./action-info.js";
// Долгое нажатие (0.20.53) живёт в общем хуке: тот же жест нужен и
// портретам бойцов в верхней панели.
import { useLongPress } from "./use-long-press.js";

export interface ActionSlotProps {
  /** Идентификатор оружия, умения или служебного действия. */
  id: string;
  name: string;
  art?: string | undefined;
  /** Горячая клавиша: «1» для оружия, «9» — стойка, «0» — дозор. */
  shortcut?: string | undefined;
  active?: boolean;
  disabled?: boolean;
  /** Пульсация по указанию обучения или принудительной стойке (ui-design §4.5). */
  hinted?: boolean;
  /** Янтарный акцент: кадр миссии называет это действие светом. */
  accent?: boolean;
  /** Остаток перезарядки в ходах; 0 — умение готово. */
  cooldown?: number;
  /** Остаток применений за бой; `undefined` — премена нет. */
  usesLeft?: number;
  title?: string | undefined;
  /** Содержимое окна информации; без него долгое нажатие ничего не открывает. */
  /** Открыть окно информации (долгое нажатие, правый клик). */
  onInspect?: () => void;
  onPress: () => void;
}

export function ActionSlot({
  id,
  name,
  art,
  shortcut,
  active = false,
  disabled = false,
  hinted = false,
  accent = false,
  cooldown = 0,
  usesLeft,
  title,
  onInspect,
  onPress,
}: ActionSlotProps) {
  const t = useT();
  const press = useLongPress({ onLongPress: onInspect, onClick: onPress });

  const classes = [
    "hud-btn",
    "skill-slot",
    active ? "is-active" : "",
    cooldown > 0 ? "is-cooldown" : "",
    usesLeft === 0 ? "is-exhausted" : "",
    hinted ? "hint-pulse" : "",
    accent ? "action-accent" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const state = usesLeft === 0 ? "exhausted" : cooldown > 0 ? "cooldown" : active ? "active" : "inactive";

  return (
    <button
      type="button"
      className={classes}
      data-action-id={id}
      data-action-state={state}
      aria-pressed={active}
      aria-haspopup={onInspect ? "dialog" : undefined}
      disabled={disabled}
      title={title ?? (onInspect ? t("action.hold") : undefined)}
      // Правый клик — тот же жест для мыши — обрабатывает сам хук.
      {...press.handlers}
      // Долгое нажатие уже открыло окно: выбирать действие не надо.
      onClick={press.onClick}
    >
      {shortcut ? <kbd>{shortcut}</kbd> : null}
      {art ? (
        <img className="action-art" src={art} alt="" draggable={false} />
      ) : (
        <span className="action-art action-art-empty" aria-hidden="true" />
      )}
      <span className="action-name">{name}</span>
      {cooldown > 0 ? (
        <span className="skill-resource cooldown">{t("battle.cooldownShort", { turns: cooldown })}</span>
      ) : null}
      {usesLeft !== undefined ? (
        <span className="skill-resource uses">{t("battle.usesShort", { uses: usesLeft })}</span>
      ) : null}
    </button>
  );
}

/**
 * Окно информации о действии: поверх боя, с затемнением всего остального.
 * Закрывается кнопкой, кликом по фону, клавишей Escape.
 */
export function ActionInfoDialog({ info, onClose }: { info: ActionInfo; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="action-info-backdrop" role="presentation" onClick={onClose}>
      <div
        className="action-info"
        role="dialog"
        aria-modal="true"
        aria-label={info.name}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="action-info-head">
          {info.art ? (
            <img className="action-info-art" src={info.art} alt="" draggable={false} />
          ) : (
            <span className="action-info-art action-art-empty" aria-hidden="true" />
          )}
          <div className="action-info-title">
            <h3>{info.name}</h3>
            {info.flavor ? <p className="action-info-flavor">{info.flavor}</p> : null}
          </div>
        </div>
        <dl className="action-info-rows">
          {info.rows.map((row) => (
            <div className="action-info-row" key={`${row.label}-${row.value}`}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="hud-btn action-info-close" onClick={onClose}>
          {t("action.info.close")}
        </button>
      </div>
    </div>
  );
}
