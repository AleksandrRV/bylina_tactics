import { ActionSlot } from "../action-panel.js";
import { unitPortrait } from "../portraits.js";
import { actionArt } from "../action-art.js";
import { ACTION_SHORTCUTS, shortcutForAction } from "../action-shortcuts.js";
import {
  liberateActionInfo,
  skillActionInfo,
  stanceActionInfo,
  weaponActionInfo,
} from "../action-info.js";
import { useBattleScreen } from "./context.js";

export function BattleBottomPanel() {
  const model = useBattleScreen();
  const {
    t,
    isSpectator,
    outcomePending,
    selected,
    selectedId,
    action,
    busy,
    snapshot,
    viewOwner,
    weapons,
    skills,
    hintPanelKey,
    trainingWeaponAllowed,
    trainingSkillAllowed,
    trainingAllows,
    prologueStanceLock,
    accentWeaponId,
    applyCommand,
    applySelfSkill,
    applyLiberate,
    endTurn,
    setIntent,
    setActionInfo,
    allOwnApSpent,
    liberatable,
    unitNameKey,
  } = model;

  if (isSpectator) {
    return (
      <footer className="battle-bottom spectator-bar">
        <div className="spectator-note" role="status">
          <span className="spectator-eye" aria-hidden="true">
            ◉
          </span>
          {t("net.spectator")}
          <span className="muted"> — {t("net.spectatorBody")}</span>
        </div>
      </footer>
    );
  }

  return (
    <footer className={`battle-bottom${outcomePending ? " is-outcome-pending" : ""}`}>
      <div className="battle-selected">
        {selected ? (
          <div className="sel-row">
            {unitPortrait(selected.configId) ? (
              <img className="sel-face" src={unitPortrait(selected.configId)} alt="" draggable={false} />
            ) : null}
            <div className="sel-info">
              <p className="eyebrow">{t(unitNameKey(selected.configId))}</p>
              <p>{t("battle.hp", { current: selected.hp, max: selected.maxHp })}</p>
              <div className="hp-segs" aria-hidden="true">
                {Array.from({ length: selected.maxHp }, (_, index) => (
                  <i key={index} className={index < selected.hp ? "on" : ""} />
                ))}
              </div>
              <div
                className={`diamonds${hintPanelKey === "ap" ? " hint-pulse" : ""}`}
                aria-label={t("field.ap", { current: selected.ap, max: selected.maxAp })}
              >
                {Array.from({ length: selected.maxAp }, (_, index) => (
                  <span key={index} className={index < selected.ap ? "diamond is-on" : "diamond"} />
                ))}
              </div>
              <div className="status-list" aria-label={t("battle.statuses")}>
                {selected.poison ? (
                  <span className="status-chip poison">
                    {t("status.poison", { turns: selected.poison.turnsLeft })}
                  </span>
                ) : null}
                {selected.panic ? <span className="status-chip panic">{t("status.panic")}</span> : null}
                {selected.immobileTurns ? (
                  <span className="status-chip immobile">{t("status.immobile")}</span>
                ) : null}
                {selected.hidden ? <span className="status-chip hidden">{t("status.hidden")}</span> : null}
                {selected.flying ? <span className="status-chip flying">{t("status.flying")}</span> : null}
                {selected.timedLife !== undefined ? (
                  <span className="status-chip timed">{t("status.timed", { turns: selected.timedLife })}</span>
                ) : null}
                {selected.defending ? (
                  <span className="status-chip defending">{t("status.defending")}</span>
                ) : null}
                {selected.overwatch ? (
                  <span className="status-chip overwatch">{t("status.overwatch")}</span>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <p>{t("battle.empty")}</p>
        )}
      </div>
      <div className="skill-row">
        {(selected?.weaponIds ?? (selected?.weaponId ? [selected.weaponId] : [])).map((weaponId, index) => {
          const weapon = weapons[weaponId];
          const active = action?.type === "weapon" && action.id === weaponId;
          const info = weapon ? weaponActionInfo(weaponId, weapon, t) : null;
          return (
            <ActionSlot
              key={`weapon-${weaponId}`}
              id={weaponId}
              name={t(`weapon.${weaponId}.name`)}
              art={actionArt(weaponId)}
              shortcut={ACTION_SHORTCUTS[index]}
              active={active}
              hinted={hintPanelKey === "weapon" && trainingWeaponAllowed(weaponId)}
              accent={accentWeaponId === weaponId}
              disabled={
                !selected ||
                selected.ap <= 0 ||
                busy ||
                snapshot.activeOwner !== viewOwner ||
                !trainingWeaponAllowed(weaponId) ||
                prologueStanceLock
              }
              onInspect={info ? () => setActionInfo(info) : undefined}
              onPress={() => {
                // Рывок считался под прежнее оружие: при переключении
                // действия снимается — toggleAction возвращает к
                // выбранному бойцу либо вооружает новое действие (0.20.50).
                if (selectedId !== null)
                  setIntent({
                    type: "toggleAction",
                    actorId: selectedId,
                    action: active ? null : { type: "weapon", id: weaponId },
                  });
              }}
            />
          );
        })}
        {(selected?.skillIds ?? []).map((skillId) => {
          const skill = skills[skillId];
          const active = action?.type === "skill" && action.id === skillId;
          const shortcut = selected ? shortcutForAction(selected, "skill", skillId) : undefined;
          const cooldown = selected?.skillCooldowns?.[skillId] ?? 0;
          const uses = selected?.skillUses?.[skillId] ?? 0;
          const usesLeft =
            skill?.maxUsesPerBattle === undefined ? undefined : Math.max(0, skill.maxUsesPerBattle - uses);
          const exhausted = usesLeft === 0;
          const info = skill ? skillActionInfo(skillId, skill, t) : null;
          return (
            <ActionSlot
              key={`skill-${skillId}`}
              id={skillId}
              name={t(`skill.${skillId}.name`)}
              art={actionArt(skillId)}
              shortcut={shortcut}
              active={active}
              hinted={hintPanelKey === "skill" && trainingSkillAllowed(skillId)}
              cooldown={cooldown}
              usesLeft={usesLeft}
              title={
                cooldown > 0
                  ? t("battle.cooldownHint", { turns: cooldown })
                  : exhausted
                    ? t("battle.noUsesHint")
                    : undefined
              }
              disabled={
                !selected ||
                selected.ap < (skill?.apCost ?? 1) ||
                cooldown > 0 ||
                exhausted ||
                busy ||
                snapshot.activeOwner !== viewOwner ||
                !trainingSkillAllowed(skillId) ||
                prologueStanceLock
              }
              onInspect={info ? () => setActionInfo(info) : undefined}
              onPress={() => {
                // Рывок считался под прежнее действие: переключение
                // действия его снимает (0.20.50, через toggleAction).
                // Этап-правка: умение «на себя» с областью (круговой взмах)
                // подтверждается вторым тапом — первый показывает область.
                if (skill?.category === "self") {
                  if ((skill.radius ?? 0) > 0) {
                    const alreadyArmed = action?.type === "skill" && action.id === skillId;
                    if (alreadyArmed) applySelfSkill(skillId);
                    else if (selectedId !== null)
                      setIntent({
                        type: "toggleAction",
                        actorId: selectedId,
                        action: { type: "skill", id: skillId },
                      });
                  } else {
                    applySelfSkill(skillId);
                  }
                } else if (selectedId !== null) {
                  setIntent({
                    type: "toggleAction",
                    actorId: selectedId,
                    action: active ? null : { type: "skill", id: skillId },
                  });
                }
              }}
            />
          );
        })}
        {liberatable ? (
          <ActionSlot
            id="free"
            name={t("battle.free")}
            art={actionArt("free")}
            active={false}
            disabled={
              !selected || selected.ap < 1 || busy || snapshot.activeOwner !== viewOwner || prologueStanceLock
            }
            title={t("battle.freeHint")}
            onInspect={() => setActionInfo(liberateActionInfo(t))}
            onPress={applyLiberate}
          />
        ) : null}
        <ActionSlot
          id="defend"
          name={t("battle.defend")}
          art={actionArt("defend")}
          shortcut="9"
          active={Boolean(selected?.defending)}
          hinted={hintPanelKey === "defend"}
          disabled={
            !selected ||
            selected.ap <= 0 ||
            busy ||
            snapshot.activeOwner !== viewOwner ||
            !trainingAllows("defend")
          }
          title={t("battle.defendHint")}
          onInspect={() => setActionInfo(stanceActionInfo("defend", t))}
          onPress={() => {
            if (selectedId === null) return;
            // Единый путь команд (0.19.2): как и клавиша 9 — через
            // applyCommand (транспорт в состязательном режиме, анимация
            // и продвижение подсказки в обучении).
            applyCommand({ type: "DEFEND", actorId: selectedId });
            setIntent({ type: "cancel" });
          }}
        />
        <ActionSlot
          id="overwatch"
          name={t("battle.overwatch")}
          art={actionArt("overwatch")}
          shortcut="0"
          active={Boolean(selected?.overwatch)}
          hinted={hintPanelKey === "overwatch"}
          disabled={
            !selected ||
            selected.ap <= 0 ||
            busy ||
            snapshot.activeOwner !== viewOwner ||
            !trainingAllows("overwatch") ||
            prologueStanceLock
          }
          title={t("battle.overwatchHint")}
          onInspect={() => setActionInfo(stanceActionInfo("overwatch", t))}
          onPress={() => {
            if (selectedId === null) return;
            // Единый путь команд (0.19.2): как и клавиша 0 — через
            // applyCommand (транспорт в состязательном режиме, анимация
            // и продвижение подсказки в обучении).
            applyCommand({ type: "OVERWATCH", actorId: selectedId });
            setIntent({ type: "cancel" });
          }}
        />
      </div>
      <button
        type="button"
        className={`hud-btn hud-btn-primary end-turn${allOwnApSpent(snapshot.entities, viewOwner) ? " is-ready" : ""}${hintPanelKey === "end_turn" ? " hint-pulse" : ""}`}
        // Принудительная стойка закрывает и «Конец хода» (0.20.45):
        // иначе игрок ушёл бы от засады ценой пропущенного урока.
        disabled={busy || snapshot.activeOwner !== viewOwner || !trainingAllows("endTurn") || prologueStanceLock}
        onClick={() => endTurn()}
      >
        {t("field.endTurn")}
      </button>
    </footer>
  );
}
