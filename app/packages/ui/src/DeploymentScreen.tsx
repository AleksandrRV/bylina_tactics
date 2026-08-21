import { useEffect, useMemo, useState } from "react";
import type { ItemConfig } from "@bylina/content";
import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState } from "./hooks.js";
import { unitPortrait } from "./portraits.js";

function unitName(unitId: string): string {
  return `unit.${unitId}.name`;
}

function itemName(itemId: string): string {
  return `item.${itemId}.name`;
}

function itemEffectParts(item: ItemConfig, t: (key: string, vars?: Record<string, string | number>) => string): string[] {
  const parts: string[] = [];
  if (item.weaponId) parts.push(t(`weapon.${item.weaponId}.name`));
  if (item.aimMod) parts.push(`${item.aimMod > 0 ? "+" : ""}${item.aimMod} ${t("item.aim")}`);
  if (item.defenseMod) parts.push(`${item.defenseMod > 0 ? "+" : ""}${item.defenseMod} ${t("item.defense")}`);
  if (item.mobilityMod) parts.push(`${item.mobilityMod > 0 ? "+" : ""}${item.mobilityMod} ${t("item.mobility")}`);
  if (item.maxHpMod) parts.push(`${item.maxHpMod > 0 ? "+" : ""}${item.maxHpMod} ${t("item.maxHp")}`);
  return parts;
}

function RecruitSilhouette() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="32" cy="22" r="9" />
      <path d="M14 54c2-12 9-17 18-17s16 5 18 17" />
    </svg>
  );
}

function SwordsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 3.5 8 8M3.5 3.5l2.6-1 3 3-1 2.6L3.5 3.5Z" />
      <path d="M16.5 16.5 12 12M16.5 16.5l-2.6 1-3-3 1-2.6 4.6 4.6Z" />
    </svg>
  );
}

function GemIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M6 2.5h4l3 3.5-5 7.5L3 6l3-3.5Z" />
      <path d="M3 6h10M8 13.5 6.6 6M8 13.5 9.4 6" />
    </svg>
  );
}

function AnvilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14h12" />
      <path d="M5 14v-3a5 5 0 0 1 10 0v3" />
      <path d="M3 11h14" />
    </svg>
  );
}

export function DeploymentScreen() {
  useI18nTick();
  const t = useT();
  const { session, content } = useServices();
  const { activeMissionId } = useSessionState();
  const campaign = session.getCampaign();
  const mission = activeMissionId ? campaign.getMission(activeMissionId) : undefined;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [equipFor, setEquipFor] = useState<number | null>(null);
  const [, setTick] = useState(0);

  useEffect(
    () =>
      campaign.subscribe(() => {
        setTick((value) => value + 1);
      }),
    [campaign],
  );

  const fighters = useMemo(
    () => campaign.getState().fighters.filter((fighter) => fighter.alive),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaign, activeMissionId],
  );

  const inventory = campaign.getState().inventory;
  const items = campaign.getItems();
  const itemById = useMemo(() => {
    const map = new Map<string, ItemConfig>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const equipTarget = equipFor !== null ? fighters.find((fighter) => fighter.id === equipFor) : undefined;
  const equippedElsewhere = (itemId: string): boolean =>
    fighters.some((fighter) => fighter.id !== equipFor && fighter.equippedItemId === itemId);

  const deployMin = content.campaign.deployMin;
  const deployMax = content.campaign.deployMax;
  const penalty = content.campaign.woundPenalty;
  const count = selected.size;
  const canConfirm = count >= deployMin && count <= deployMax;

  const toggle = (fighterId: number): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(fighterId)) {
        next.delete(fighterId);
      } else if (next.size < deployMax) {
        next.add(fighterId);
      }
      return next;
    });
  };

  return (
    <div className="screen deployment-screen">
      <header className="deployment-head">
        <p className="eyebrow">{t("campaign.mission")} · {activeMissionId ?? ""}</p>
        <h1 className="display-title">{t("deployment.title")}</h1>
        <p className="muted">
          {t("deployment.hint", { min: deployMin, max: deployMax })}
          {mission ? ` — ${t("campaign.type.purge")}` : ""}
        </p>
      </header>

      <div className="deployment-grid" role="list" aria-label={t("deployment.listLabel")}>
        {fighters.map((fighter) => {
          const face = unitPortrait(fighter.unitId);
          const isRecruit = fighter.unitId === content.campaign.recruitUnitId;
          const picked = selected.has(fighter.id);
          const equipped = fighter.equippedItemId ? itemById.get(fighter.equippedItemId) : undefined;
          return (
            <div
              key={fighter.id}
              role="listitem"
              className={`deploy-card${picked ? " is-picked" : ""}${fighter.wounded ? " is-wounded" : ""}`}
              tabIndex={0}
              aria-pressed={picked}
              onClick={() => toggle(fighter.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggle(fighter.id);
                }
              }}
            >
              <span className="deploy-face">
                {face ? (
                  <img src={face} alt="" draggable={false} />
                ) : isRecruit ? (
                  <RecruitSilhouette />
                ) : (
                  <span className="deploy-face-empty" aria-hidden="true" />
                )}
                {fighter.wounded ? <span className="wound-badge" title={t("deployment.woundedHint", { aim: penalty.aim, defense: penalty.defense, mobility: penalty.mobility })} /> : null}
              </span>
              <span className="deploy-meta">
                <span className="deploy-name">{fighter.name}</span>
                <span className="deploy-class">
                  {isRecruit ? t("roster.recruit") : t(unitName(fighter.unitId))}
                </span>
                <span className="deploy-hp">
                  {t("battle.hp", { current: fighter.hp, max: fighter.maxHp })}
                </span>
                {fighter.wounded ? (
                  <span className="deploy-wound-note">{t("deployment.wounded")}</span>
                ) : null}
                {equipped ? (
                  <span className="equip-chip">
                    {equipped.weaponId ? <SwordsIcon /> : <GemIcon />}
                    {t(itemName(equipped.id))}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                className="equip-btn"
                title={t("deployment.equip")}
                aria-label={t("deployment.equipFor", { name: fighter.name })}
                onClick={(event) => {
                  event.stopPropagation();
                  setEquipFor(fighter.id);
                }}
              >
                <AnvilIcon />
              </button>
              <span className="pick-mark" aria-hidden="true">✓</span>
            </div>
          );
        })}
      </div>

      <footer className="deployment-foot">
        <p className="deployment-count" aria-live="polite">
          {t("deployment.count", { current: count, min: deployMin, max: deployMax })}
        </p>
        <div className="deployment-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => session.leaveCampaignMission()}
          >
            {t("deployment.back")}
          </button>
          <button
            type="button"
            className="btn btn-primary deploy-confirm"
            disabled={!canConfirm}
            onClick={() => {
              if (canConfirm) session.confirmDeployment([...selected]);
            }}
          >
            {t("deployment.confirm")}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </footer>

      {equipTarget ? (
        <div className="pause-root" role="presentation">
          <div className="pause-card equip-card" role="dialog" aria-modal="true" aria-labelledby="equip-title">
            <h2 id="equip-title">{t("deployment.equipFor", { name: equipTarget.name })}</h2>
            <p className="muted">{t("deployment.equipHint")}</p>
            <div className="equip-list">
              {inventory.length === 0 ? (
                <p className="muted equip-empty">{t("deployment.equipEmpty")}</p>
              ) : null}
              {inventory.map((itemId) => {
                const item = itemById.get(itemId);
                if (!item) return null;
                const taken = equippedElsewhere(itemId);
                const onSelf = equipTarget.equippedItemId === itemId;
                return (
                  <button
                    key={itemId}
                    type="button"
                    className={`equip-item${onSelf ? " is-on" : ""}${taken ? " is-taken" : ""}`}
                    disabled={taken && !onSelf}
                    onClick={() => {
                      if (!taken || onSelf) campaign.equipItem(equipTarget.id, onSelf ? null : itemId);
                    }}
                  >
                    <span className="equip-item-icon" aria-hidden="true">
                      {item.weaponId ? <SwordsIcon /> : <GemIcon />}
                    </span>
                    <span className="equip-item-meta">
                      <span className="equip-item-name">{t(itemName(itemId))}</span>
                      <span className="equip-item-effects">{itemEffectParts(item, t).join(" · ")}</span>
                    </span>
                    <span className="equip-item-state" aria-hidden="true">
                      {onSelf ? t("deployment.equipOn") : taken ? t("deployment.equipTaken") : t("deployment.equipPut")}
                    </span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="hud-btn hud-btn-primary" onClick={() => setEquipFor(null)}>
              {t("common.close")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
