import { useBattleScreen } from "./context.js";

export function BattleAimCard() {
  const model = useBattleScreen();
  const { t, hit, aimCardPos } = model;

  if (!hit) return null;

  return (
    <div
      className={`aim-card${aimCardPos ? " is-floating" : ""}`}
      style={aimCardPos ? { left: `${aimCardPos.x}%`, top: `${aimCardPos.y}%` } : undefined}
    >
      <div className="aim-header">
        <span className={`aim-chance${hit.available ? "" : " blocked"}`}>
          {hit.available
            ? hit.chance === undefined
              ? t("combat.available")
              : `${hit.chance}%`
            : t("combat.unavailable")}
        </span>
        {hit.available && hit.coverTarget ? (
          // Атака по существу укрытия: попадание не испытывается,
          // укрытие разрушается (§10.4 math) — числа урона не показываются.
          <span className="aim-dmg cover-destroy">{t("combat.destroyCover")}</span>
        ) : hit.available && hit.dmgMin !== undefined && hit.dmgMax !== undefined ? (
          <span className="aim-dmg">{t("combat.dmg", { dmg: `${hit.dmgMin}-${hit.dmgMax}` })}</span>
        ) : null}
        {hit.breakdown ? (
          <button
            type="button"
            className="aim-copy-btn"
            title={t("combat.copyBreakdown")}
            onClick={() => {
              const b = hit.breakdown!;
              const lines = [
                `╠══ ${t("combat.bdTotal")}: ${b.finalChance}% ══╣`,
                `${t("combat.bdBaseAim")}: +${b.baseAim}`,
                b.weaponMod !== 0
                  ? `${t("combat.bdWeaponMod")}: ${b.weaponMod > 0 ? "+" : ""}${b.weaponMod}`
                  : null,
                b.heightAim !== 0
                  ? `${t("combat.bdHeight")}: ${b.heightAim > 0 ? "+" : ""}${b.heightAim}`
                  : null,
                b.targetDefense > 0 ? `${t("combat.bdDefense")}: −${b.targetDefense}` : null,
                b.stanceDefense > 0 ? `${t("combat.bdDefend")}: −${b.stanceDefense}` : null,
                b.coverPenalty > 0 ? `${t("combat.bdCover")}: −${b.coverPenalty}` : null,
                b.rangePenalty > 0 ? `${t("combat.bdRange")}: −${b.rangePenalty}` : null,
                b.coverDetails.length > 0 ? "" : null,
                b.coverDetails.length > 0 ? t("combat.bdObstacleList") : null,
                ...b.coverDetails.map((d) => `  ${t(d.label)}`),
              ].filter(Boolean);
              navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        ) : null}
      </div>
      {hit.breakdown ? (
        <div className="breakdown-detail">
          <span className="bd-item pos">
            {t("combat.bdBaseAim")}: +{hit.breakdown.baseAim}
          </span>
          {hit.breakdown.weaponMod !== 0 ? (
            <span className={`bd-item${hit.breakdown.weaponMod > 0 ? " pos" : " neg"}`}>
              {t("combat.bdWeaponMod")}: {hit.breakdown.weaponMod > 0 ? "+" : ""}
              {hit.breakdown.weaponMod}
            </span>
          ) : null}
          {hit.breakdown.heightAim !== 0 ? (
            <span className={`bd-item${hit.breakdown.heightAim > 0 ? " pos" : " neg"}`}>
              {t("combat.bdHeight")}: {hit.breakdown.heightAim > 0 ? "+" : ""}
              {hit.breakdown.heightAim}
            </span>
          ) : null}
          {hit.breakdown.targetDefense > 0 ? (
            <span className="bd-item neg">
              {t("combat.bdDefense")}: −{hit.breakdown.targetDefense}
            </span>
          ) : null}
          {hit.breakdown.stanceDefense > 0 ? (
            <span className="bd-item neg">
              {t("combat.bdDefend")}: −{hit.breakdown.stanceDefense}
            </span>
          ) : null}
          {hit.breakdown.coverPenalty > 0 ? (
            <span className="bd-item neg">
              {t("combat.bdCover")}: −{hit.breakdown.coverPenalty}
            </span>
          ) : null}
          {hit.breakdown.rangePenalty > 0 ? (
            <span className="bd-item neg">
              {t("combat.bdRange")}: −{hit.breakdown.rangePenalty}
            </span>
          ) : null}
          {hit.breakdown.coverDetails.length > 0 ? (
            <div className="bd-details">
              <span className="bd-details-title">{t("combat.bdObstacleList")}</span>
              {hit.breakdown.coverDetails.map((d, i) => (
                <span key={i} className="bd-obs">
                  {t(d.label)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {!hit.available && hit.reason === "NO_LOS" && hit.breakCell ? (
        <div className="bd-details">
          <span className="bd-obs">
            {t("combat.blocked.NO_LOS")}: ({hit.breakCell.x},{hit.breakCell.y}) z={hit.breakCell.z}
          </span>
        </div>
      ) : null}
    </div>
  );
}
