import { useT } from "./context.js";
import { useI18nTick } from "./hooks.js";
import { CAMPAIGN_HINT_PERSONAS, type CampaignHintId } from "./campaign-hints.js";
import { personaPortrait } from "./portraits.js";

/**
 * Карточка туториала «первого раза» кампании (0.20.0, ui-design §4.5):
 * портрет персонажа-рассказчика, имя, заголовок, текст и кнопка «Понятно».
 * `modal` — блокирующая карточка поверх экрана; `banner` — компактная
 * плашка в бою, не блокирующая поле.
 */
export function CampaignHint({
  hintId,
  variant = "modal",
  onClose,
}: {
  hintId: CampaignHintId;
  variant?: "modal" | "banner";
  onClose: () => void;
}) {
  useI18nTick();
  const t = useT();
  const persona = CAMPAIGN_HINT_PERSONAS[hintId];
  const face = personaPortrait(persona);

  const body = (
    <>
      <div className="campaign-hint-body">
        {face ? <img className="campaign-hint-face" src={face} alt="" draggable={false} /> : null}
        <div className="campaign-hint-meta">
          <p className="eyebrow">{t(`campaign.persona.${persona}`)}</p>
          <h2 id={`hint-${hintId}-title`}>{t(`campaign.hints.${hintId}.title`)}</h2>
          <p className="muted">{t(`campaign.hints.${hintId}.text`)}</p>
        </div>
      </div>
      <button type="button" className="hud-btn hud-btn-primary" onClick={onClose}>
        {t("campaign.hints.ok")}
      </button>
    </>
  );

  if (variant === "banner") {
    return (
      <div className="campaign-hint-banner" role="status" aria-live="polite">
        {body}
      </div>
    );
  }

  return (
    <div className="pause-root" role="presentation">
      <div
        className="pause-card campaign-hint-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`hint-${hintId}-title`}
      >
        {body}
      </div>
    </div>
  );
}
