import type { TalentChoice } from "@bylina/session";
import { actionArt } from "./action-art.js";
import { useServices, useT } from "./context.js";

/**
 * Окно выбора таланта (0.21.30, campaign.md §4.1): боец выше порога класса
 * получает на каждый уровень ровно два варианта — активное умение либо
 * пассивную способность. Показывается там же, где окно выбора класса:
 * на карте кампании (после миссии песочницы) и на экране победы пролога.
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Название таланта: активное — имя умения, пассивное — своя строка. */
export function talentName(talent: TalentChoice["options"][number], t: Translate): string {
  return talent.skillId ? t(`skill.${talent.skillId}.name`) : t(`talent.${talent.id}.name`);
}

/** Описание таланта: активное — короткая справка умения, пассивное — перечень прибавок. */
export function talentDescription(talent: TalentChoice["options"][number], t: Translate): string {
  if (talent.skillId) return t(`skill.${talent.skillId}.flavor`);
  const passive = talent.passive;
  if (!passive) return "";
  const parts: string[] = [];
  const signed = (value: number): string => `${value > 0 ? "+" : ""}${value}`;
  if (passive.maxHpMod) parts.push(`${signed(passive.maxHpMod)} ${t("item.maxHp")}`);
  if (passive.aimMod) parts.push(`${signed(passive.aimMod)} ${t("item.aim")}`);
  if (passive.defenseMod) parts.push(`${signed(passive.defenseMod)} ${t("item.defense")}`);
  if (passive.mobilityMod) parts.push(`${signed(passive.mobilityMod)} ${t("item.mobility")}`);
  if (passive.autoDefend) parts.push(t("talent.autoDefend"));
  return parts.join(", ");
}

/** Образ таланта: у активного — образ умения, у пассивного — щит стойки либо удар. */
function talentArt(talent: TalentChoice["options"][number]): string | undefined {
  if (talent.skillId) return actionArt(talent.skillId);
  if (talent.passive?.autoDefend) return actionArt("defend");
  return actionArt("strike");
}

export function TalentChoiceDialog({
  choice,
  fighterName,
  onChosen,
  inline = false,
}: {
  choice: TalentChoice;
  fighterName: string;
  onChosen?: () => void;
  /** Встроенный режим (экран победы): без затемнения, в потоке экрана. */
  inline?: boolean;
}) {
  const t = useT();
  const { session } = useServices();
  const rootStyle = inline ? { position: "static" as const, background: "transparent" } : undefined;
  return (
    <div className="pause-root" role="presentation" style={rootStyle}>
      <div
        className="pause-card train-card talent-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="talent-title"
        style={inline ? { boxShadow: "none" } : undefined}
      >
        <h2 id="talent-title">{t("talent.title", { name: fighterName, level: choice.level })}</h2>
        <p className="muted">{t("talent.hint")}</p>
        <div className="class-grid talent-grid">
          {choice.options.map((talent) => {
            const art = talentArt(talent);
            return (
              <button
                key={talent.id}
                type="button"
                className="class-card talent-option"
                data-talent-id={talent.id}
                onClick={() => {
                  if (session.getCampaign().chooseTalent(choice.fighterId, choice.level, talent.id)) onChosen?.();
                }}
              >
                {art ? (
                  <img src={art} alt="" draggable={false} />
                ) : (
                  <span className="deploy-face-empty" aria-hidden="true" />
                )}
                <span className="talent-name">{talentName(talent, t)}</span>
                <span className="talent-kind">{t(talent.skillId ? "talent.kindActive" : "talent.kindPassive")}</span>
                <span className="talent-desc">{talentDescription(talent, t)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
