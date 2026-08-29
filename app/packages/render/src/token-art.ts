/**
 * Иллюстрации фишек (0.20.37): Микула-мужик, лесная крыса, палка, рекрут.
 *
 * Вынесены из field-renderer.ts, потому что это самостоятельный слой: здесь
 * нет ни PixiJS-контейнеров, ни состояния поля — только примитивы Graphics и
 * палитра. Благодаря этому art покрывается юнит-тестами на чистом Node.
 */
import type { Graphics } from "pixi.js";
import { EXTRACT_SPARK, HOME_AMBER } from "./palette.js";
import type { EntityState } from "@bylina/core";

/**
 * Контекст рисования фишки. Помимо графики и центра, функция получает саму
 * сущность (иллюстрация зависит от экипировки) и нейтральную фазу пульсаций:
 * при системной настройке «уменьшить движение» фаза замирает, поэтому art не
 * обращается к `performance.now()` напрямую.
 */
export interface TokenCtx {
  g: Graphics;
  cx: number;
  cy: number;
  entity: EntityState;
  motionNow: number;
}

/* ---------- М1 пролога: Микула-мужик, лесная крыса, палка (0.20.37) ----------
 *
 * Иллюстративные цвета персонажей и предметов живут внутри функций рисования —
 * так же, как у остальных классов (см. примечание в palette.ts: в справочник
 * выносятся только семантические величины). Пульсации берут фазу из
 * `motionNow`, а не из `performance.now()`, — иначе они не гаснут при
 * системной настройке «уменьшить движение».
 */

/** Раскладка Микулы-крестьянина (М1–М2 пролога). */
const MIKULA_ART = {
  shirt: 0x9a8a63,
  shirtDark: 0x6f6242,
  sash: 0xa83232,
  skin: 0xd7a878,
  beard: 0x6a4a2e,
  hair: 0x4a3520,
  bast: 0x8a7040,
  club: 0x5c4028,
  clubDark: 0x3d2b1f,
} as const;

/**
 * Микула-мужик: холщовая рубаха с кушаком, онучи и лапти, борода.
 * До подбора палки руки пусты и поза собраннее; после — в руке дубина.
 */
function drawMikulaPeasant({ g, cx, cy, entity }: TokenCtx): void {
  const armed = entity.weaponIds?.includes("club") || entity.weaponId === "club";

  // Лапти и онучи.
  g.rect(cx - 6, cy + 9, 4.5, 3).fill(MIKULA_ART.bast);
  g.rect(cx + 1.5, cy + 9, 4.5, 3).fill(MIKULA_ART.bast);
  g.rect(cx - 6, cy + 11.4, 12, 1).fill(0x5c4a28);

  // Холщовая рубаха до колен.
  g.poly([cx - 6.5, cy + 3, cx + 6.5, cy + 3, cx + 8, cy + 10, cx - 8, cy + 10]).fill(MIKULA_ART.shirt);
  g.poly([cx - 8, cy + 10, cx + 8, cy + 10, cx + 6.5, cy + 12, cx - 6.5, cy + 12]).fill(MIKULA_ART.shirtDark);
  // Кушак.
  g.rect(cx - 7, cy + 5, 14, 2).fill(MIKULA_ART.sash);

  // Руки: пустые ладони либо хват на дубине.
  if (armed) {
    g.poly([cx + 5, cy + 3, cx + 9, cy + 4, cx + 10, cy - 1, cx + 6.5, cy - 1]).fill(MIKULA_ART.skin);
  } else {
    g.circle(cx - 7, cy + 6, 2).fill(MIKULA_ART.skin);
    g.circle(cx + 7, cy + 6, 2).fill(MIKULA_ART.skin);
  }

  // Голова, борода, волосы.
  g.circle(cx, cy - 3, 6.5).fill(MIKULA_ART.skin);
  g.ellipse(cx, cy - 0.6, 5, 4).fill(MIKULA_ART.beard);
  g.ellipse(cx, cy - 7.5, 7, 3.6).fill(MIKULA_ART.hair);
  g.circle(cx - 2.2, cy - 4, 0.9).fill(0x2a1d12);
  g.circle(cx + 2.2, cy - 4, 0.9).fill(0x2a1d12);

  // Дубина: суковатая ветвь с утолщением на конце.
  if (armed) {
    g.moveTo(cx + 9, cy + 3).lineTo(cx + 16, cy - 8).stroke({ width: 3.4, color: MIKULA_ART.club, cap: "round" });
    g.ellipse(cx + 16.5, cy - 8.5, 3, 2.6).fill(MIKULA_ART.clubDark);
    g.circle(cx + 13.5, cy - 4, 1.1).fill(MIKULA_ART.clubDark);
    g.circle(cx + 11, cy + 0.6, 0.9).fill(MIKULA_ART.clubDark);
  }
}

/** Раскладка лесной крысы — первый противник пролога (М1). */
const RAT_ART = {
  body: 0x4a4038,
  bodyLight: 0x5d5248,
  belly: 0x6b6155,
  ear: 0xc4807f,
  eye: 0xff5a3c,
  tail: 0xbf8783,
  nose: 0x241a14,
  claw: 0xb87373,
} as const;

/**
 * Лесная крыса: клиновидная морда, уши, длинный хвост, горящие глаза.
 * Габарит намеренно меньше бойца — «мелкость» твари читается по силуэту.
 */
function drawForestRat({ g, cx, cy }: TokenCtx): void {
  // Хвост — изгиб за корпусом, задаёт направление движения.
  g.moveTo(cx - 8, cy + 5)
    .quadraticCurveTo(cx - 15, cy + 9, cx - 17, cy + 1)
    .stroke({ width: 2, color: RAT_ART.tail, cap: "round" });

  // Задние лапы.
  g.ellipse(cx - 5, cy + 8, 3, 1.8).fill(RAT_ART.body);
  g.ellipse(cx + 3, cy + 8, 3, 1.8).fill(RAT_ART.body);
  for (const dx of [-5, 3]) {
    g.circle(cx + dx - 1.4, cy + 9.4, 0.7).fill(RAT_ART.claw);
    g.circle(cx + dx + 1.4, cy + 9.4, 0.7).fill(RAT_ART.claw);
  }

  // Корпус: вытянутый овал со светлой спиной.
  g.ellipse(cx - 1, cy + 3, 10, 6.6).fill(RAT_ART.body);
  g.ellipse(cx - 1.5, cy + 1.6, 7.5, 4).fill(RAT_ART.bodyLight);
  g.ellipse(cx - 1, cy + 6.6, 6.5, 2.6).fill(RAT_ART.belly);

  // Клиновидная морда.
  g.poly([cx + 2, cy - 2.6, cx + 14, cy + 1.6, cx + 2, cy + 6]).fill(RAT_ART.bodyLight);
  g.poly([cx + 2, cy + 1.6, cx + 14, cy + 1.6, cx + 2, cy + 6]).fill(RAT_ART.body);
  g.circle(cx + 14, cy + 1.6, 1.5).fill(RAT_ART.nose);

  // Уши: внешнее тёмное, внутреннее розовое.
  for (const [dx, dy, r] of [[-0.5, -5.4, 3.4], [4.2, -4.2, 2.9]] as const) {
    g.ellipse(cx + dx, cy + dy, r, r * 1.25).fill(RAT_ART.body);
    g.ellipse(cx + dx, cy + dy, r * 0.55, r * 0.8).fill(RAT_ART.ear);
  }

  // Горящие глаза Нави с белым бликом.
  g.circle(cx + 6.4, cy - 0.2, 1.5).fill(RAT_ART.eye);
  g.circle(cx + 6.7, cy - 0.6, 0.5).fill(0xffe8d8);
  g.circle(cx + 3.4, cy + 0.8, 1.1).fill(RAT_ART.eye);

  // Усы и резцы.
  g.moveTo(cx + 11, cy + 2.6).lineTo(cx + 16.5, cy + 1).stroke({ width: 0.6, color: 0xcbbcae, alpha: 0.75 });
  g.moveTo(cx + 11, cy + 3.6).lineTo(cx + 16, cy + 5).stroke({ width: 0.6, color: 0xcbbcae, alpha: 0.75 });
  g.rect(cx + 11.6, cy + 3.4, 1.6, 2).fill(0xf0e6d2);
}

/** Раскладка палки-хвороста: подбираемый предмет лежит на земле. */
const STICK_ART = {
  wood: 0x6b5030,
  woodDark: 0x46331e,
  knot: 0x2f2114,
} as const;

/**
 * Палка (хворост): суковатая ветвь в траве. Мягкий янтарный ореол —
 * единственный семантический цвет (акцент действия из palette.ts),
 * пульсирует нейтральной фазой, поэтому гаснет при уменьшении движения.
 */
function drawStick({ g, cx, cy, motionNow }: TokenCtx): void {
  const pulse = 0.5 + Math.sin(motionNow * 0.004) * 0.5;

  // Ореол интереса и тень на земле.
  g.ellipse(cx, cy + 3, 14 + pulse * 2.5, 8 + pulse * 1.5).fill({ color: HOME_AMBER, alpha: 0.1 + pulse * 0.07 });
  g.ellipse(cx, cy + 4, 11, 4.5).fill({ color: 0x000000, alpha: 0.3 });

  // Ветвь с обломанными сучьями.
  g.moveTo(cx - 10, cy + 4).lineTo(cx + 9, cy - 3.5).stroke({ width: 3.6, color: STICK_ART.wood, cap: "round" });
  g.moveTo(cx - 1.5, cy + 0.6).lineTo(cx + 1, cy + 5).stroke({ width: 2.2, color: STICK_ART.woodDark, cap: "round" });
  g.moveTo(cx - 6, cy + 2).lineTo(cx - 4.5, cy - 1.5).stroke({ width: 1.8, color: STICK_ART.woodDark, cap: "round" });
  g.circle(cx + 8.6, cy - 3.4, 2.2).fill(STICK_ART.knot);
  g.circle(cx - 3.5, cy - 1.8, 1.2).fill(STICK_ART.knot);

  // Искорки по орбите: предмет читается как подбираемый.
  for (let i = 0; i < 3; i += 1) {
    const angle = motionNow * 0.0015 + (i * Math.PI * 2) / 3;
    const dist = 8 + Math.sin(motionNow * 0.002 + i) * 2.5;
    g.circle(cx + Math.cos(angle) * dist, cy - 2 + Math.sin(angle) * dist * 0.5, 1).fill({
      color: EXTRACT_SPARK,
      alpha: 0.35 + pulse * 0.45,
    });
  }
}


/** Раскладка рекрута (0.20.43): холстина, шапка, рогатина. */
const RECRUIT_LOOK = {
  shirt: 0x8e9a63,
  shirtDark: 0x697345,
  sash: 0x7a4a2a,
  skin: 0xd9b183,
  cap: 0x5b4a34,
  hair: 0x3f3222,
  boot: 0x4a3a24,
  shaft: 0x8a6a3e,
  blade: 0xc2c9d0,
} as const;

/**
 * Рекрут: холщовая рубаха с кушаком, шапка, рогатина в руке. Без доспеха и
 * шлема — силуэт беднее богатырского: сразу видно, что перед нами мужик с
 * палкой, которой колют. Тот же образ несёт Федот в М2 пролога (0.20.43):
 * спасаемый крестьянин читается как крестьянин, а не как круглая заглушка.
 */
function drawRecruit({ g, cx, cy }: TokenCtx): void {
  // Рогатина стоит за фигурой: древко от земли к правому плечу.
  g.moveTo(cx + 6.5, cy + 11)
    .lineTo(cx + 12.5, cy - 11)
    .stroke({ width: 2.6, color: RECRUIT_LOOK.shaft, cap: "round" });

  // Сапоги.
  g.rect(cx - 6, cy + 9, 4.6, 3).fill(RECRUIT_LOOK.boot);
  g.rect(cx + 1.4, cy + 9, 4.6, 3).fill(RECRUIT_LOOK.boot);

  // Холщовая рубаха до колен с тёмным подолом.
  g.poly([cx - 6, cy + 2, cx + 6, cy + 2, cx + 7.5, cy + 10, cx - 7.5, cy + 10]).fill(RECRUIT_LOOK.shirt);
  g.poly([cx - 7.5, cy + 10, cx + 7.5, cy + 10, cx + 6, cy + 12, cx - 6, cy + 12]).fill(RECRUIT_LOOK.shirtDark);
  // Кушак.
  g.rect(cx - 6.5, cy + 4.5, 13, 2).fill(RECRUIT_LOOK.sash);

  // Левая рука вдоль тела, правая — в хвате на древке.
  g.circle(cx - 6.5, cy + 6, 2).fill(RECRUIT_LOOK.skin);
  g.poly([cx + 4.5, cy + 3, cx + 8, cy + 4.5, cx + 8.5, cy, cx + 5, cy]).fill(RECRUIT_LOOK.skin);

  // Голова, волосы, шапка с мягким отворотом.
  g.circle(cx, cy - 3.5, 6).fill(RECRUIT_LOOK.skin);
  g.ellipse(cx, cy - 5.5, 6.4, 3.4).fill(RECRUIT_LOOK.hair);
  g.ellipse(cx, cy - 8, 6.8, 3.6).fill(RECRUIT_LOOK.cap);
  g.ellipse(cx, cy - 6.4, 7.2, 1.8).fill(RECRUIT_LOOK.hair);
  g.circle(cx - 2.1, cy - 3.6, 0.9).fill(0x2a1d12);
  g.circle(cx + 2.1, cy - 3.6, 0.9).fill(0x2a1d12);

  // Лопасть рогатины: листовидный наконечник с перекрестием.
  g.poly([cx + 12.5, cy - 11.5, cx + 15.8, cy - 5.5, cx + 13.4, cy - 4.4, cx + 11.2, cy - 5.8]).fill(RECRUIT_LOOK.blade);
  g.rect(cx + 9.6, cy - 5.2, 6.4, 1.4).fill(RECRUIT_LOOK.shaft);
}

/** Иллюстрации этой миссии: ключ — запись бестиария или предмета. */
export const M1_ART: Partial<Record<string, (ctx: TokenCtx) => void>> = {
  mikula_peasant: drawMikulaPeasant,
  forest_rat: drawForestRat,
  stick: drawStick,
};

/**
 * Образ рекрута (0.20.43): одна иллюстрация на две записи — самого рекрута
 * (Сенька, пополнение дружины) и Федота-крестьянина из М2 пролога. Прежде
 * на карте Федот не имел иллюстрации вовсе и рисовался кругом-заглушкой.
 */
export const RECRUIT_ART: Partial<Record<string, (ctx: TokenCtx) => void>> = {
  recruit: drawRecruit,
  fedot_stranded: drawRecruit,
};
