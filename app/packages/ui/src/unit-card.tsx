/**
 * Портреты бойцов и окно информации о них (0.20.53).
 *
 * Верхняя панель боя — карточки дружины и полоса противников — получила
 * тот же жест, что и кнопки действий: удержение портрета (на мыши —
 * правый клик) открывает окно информации поверх боя. Короткое нажатие
 * работает как прежде: выбор бойца и подводка камеры к противнику.
 *
 * Окно повторяет устройство окна информации о действии: крупный портрет,
 * имя, приглушённое описание из словаря, состояния, параметры из снимка
 * боя и экипировка с умениями из записей контента.
 */

import { useEffect } from "react";
import type { EntityState } from "@bylina/core";
import { useT } from "./context.js";
import { unitPortrait } from "./portraits.js";
import type { UnitInfo } from "./unit-info.js";
import { useLongPress } from "./use-long-press.js";

/** Карточка бойца дружины в верхней панели. */
export interface RosterCardProps {
  entity: EntityState;
  selected: boolean;
  /** Имя из словаря: экран знает язык, карточка — нет. */
  name: string;
  onSelect: () => void;
  /** Открыть окно информации (долгое нажатие, правый клик). */
  onInspect?: () => void;
}

export function RosterCard({ entity, selected, name, onSelect, onInspect }: RosterCardProps) {
  const t = useT();
  const press = useLongPress({ onLongPress: onInspect, onClick: onSelect });
  const face = unitPortrait(entity.configId);
  const classes = ["roster-card", selected ? "is-on" : "", entity.dead ? "is-dead" : ""].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={classes}
      aria-pressed={selected}
      aria-haspopup={onInspect ? "dialog" : undefined}
      title={onInspect ? `${name} · ${t("unit.info.hold")}` : name}
      {...press.handlers}
      onClick={press.onClick}
    >
      {face ? <img className="roster-face" src={face} alt="" draggable={false} /> : null}
      <span className="roster-meta">
        <span className="name">{name}</span>
        <span className="diamonds" aria-label={t("field.ap", { current: entity.ap, max: entity.maxAp })}>
          {Array.from({ length: entity.maxAp }, (_, index) => (
            <i key={index} className={index < entity.ap ? "diamond is-on" : "diamond"} />
          ))}
        </span>
      </span>
    </button>
  );
}

/** Портрет противника в полосе верхней панели. */
export interface EnemyFaceProps {
  configId: string;
  dead: boolean;
  /** Противник в поле зрения дружины прямо сейчас. */
  seen: boolean;
  /** Подпись: имя либо имя с пометкой «вне поля зрения». */
  label: string;
  /** Подвести камеру к противнику (короткое нажатие). */
  onFocus: () => void;
  onInspect?: () => void;
}

export function EnemyFace({ configId, dead, seen, label, onFocus, onInspect }: EnemyFaceProps) {
  const press = useLongPress({ onLongPress: onInspect, onClick: onFocus });
  const face = unitPortrait(configId);
  if (!face) return null;
  const classes = ["enemy-face", dead ? "is-dead" : "", seen ? "" : "is-unseen"].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={classes}
      title={label}
      aria-label={label}
      aria-haspopup={onInspect ? "dialog" : undefined}
      // Портрет кликабелен, только пока противник в поле зрения (0.20.42).
      disabled={!seen || dead}
      {...press.handlers}
      onClick={press.onClick}
    >
      <img src={face} alt="" draggable={false} />
    </button>
  );
}

/**
 * Окно информации о бойце: поверх боя, с затемнением всего остального.
 * Закрывается кнопкой, кликом по фону, клавишей Escape.
 */
export function UnitInfoDialog({ info, onClose }: { info: UnitInfo; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="unit-info-backdrop" role="presentation" onClick={onClose}>
      <div
        className="unit-info"
        role="dialog"
        aria-modal="true"
        aria-label={info.name}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="unit-info-head">
          {info.portrait ? (
            <img className="unit-info-face" src={info.portrait} alt="" draggable={false} />
          ) : (
            <span className="unit-info-face action-art-empty" aria-hidden="true" />
          )}
          <div className="unit-info-title">
            <p className="eyebrow">{info.side}</p>
            <h3>{info.name}</h3>
            {info.dead ? <p className="unit-info-fallen">{t("unit.info.fallen")}</p> : null}
            {info.flavor ? <p className="unit-info-flavor">{info.flavor}</p> : null}
          </div>
        </div>

        {info.states.length > 0 ? (
          <div className="unit-info-states">
            <p className="unit-info-label">{t("unit.info.state")}</p>
            <ul>
              {info.states.map((state) => (
                <li className="unit-info-state" key={state}>
                  {state}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <dl className="unit-info-rows">
          {info.rows.map((row) => (
            <div className="unit-info-row" key={`${row.label}-${row.value}`}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>

        {info.sections.map((section) => (
          <div className="unit-info-section" key={section.id}>
            <p className="unit-info-label">{section.title}</p>
            <ul>
              {section.items.map((item) => (
                <li className="unit-info-item" key={item.id}>
                  <span className="unit-info-item-name">
                    {item.name}
                    {item.current ? <em className="unit-info-item-mark">{t("unit.info.inHands")}</em> : null}
                  </span>
                  <span className="unit-info-item-note">{item.note}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <button type="button" className="hud-btn unit-info-close" onClick={onClose}>
          {t("action.info.close")}
        </button>
      </div>
    </div>
  );
}
