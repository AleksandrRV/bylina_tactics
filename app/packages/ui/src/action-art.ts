/**
 * Образы действий и умений (0.20.46).
 *
 * Иконки лежат в public приложения (`apps/game-pwa/public/actions`) —
 * рядом с портретами, тем же способом: карта имён файлов плюс функция,
 * отдающая абсолютный URL от baseURI документа. Кнопка действия стала
 * квадратной миниатюрой: образ наверху, название мелко под ним.
 *
 * Записи без собственного образа (отладочное оружие, редкие умения)
 * берут образ близкого действия; неизвестный идентификатор образа не
 * получает — кнопка рисует рамку-заглушку с названием.
 */

const ACTION_FILES: Record<string, string> = {
  /* Оружие */
  bow: "bow.jpg",
  branch: "branch.jpg",
  claws: "claws.jpg",
  mace: "mace.jpg",
  needle: "needle.jpg",
  pishchal: "pishchal.jpg",
  sling: "sling.jpg",
  strike: "strike.jpg",
  sword: "sword.jpg",
  // Оружие бестиария пролога.
  teeth: "teeth.jpg",
  spit: "spit.jpg",
  club: "club.jpg",
  // Отладочные записи повторяют образ исходного оружия: отдельной
  // иконки «лук для отладки» игра не обещает.
  bow_debug: "bow.jpg",
  sword_debug: "sword.jpg",
  /* Действия без записи в бестиарии: стойка и дозор. */
  defend: "defend.jpg",
  overwatch: "overwatch.jpg",
  // Освобождение (INTERACT): образ эвакуации — спасение и вывод к свету.
  free: "evacuate.jpg",
  /* Умения */
  aimed_eye: "aimed_eye.jpg",
  breach: "breach.jpg",
  circular_sweep: "circular_sweep.jpg",
  cleanse: "cleanse.jpg",
  create_illusion: "create_illusion.jpg",
  // Двойной выстрел (0.21.30): образ лука — умение стреляет им же.
  double_shot: "bow.jpg",
  evacuate: "evacuate.jpg",
  heal: "heal.jpg",
  panic: "panic.jpg",
  poison_needles: "poison_needles.jpg",
  raise_skeleton: "raise_skeleton.jpg",
  roots: "roots.jpg",
  shield_bash: "shield_bash.jpg",
  summon_forest_beast: "summon_forest_beast.jpg",
  teleport_ally: "teleport_ally.jpg",
  whistle: "whistle.jpg",
};

/** Имя файла образа действия (без пути) или `undefined`, если образа нет. */
export function actionArtFile(id: string): string | undefined {
  return ACTION_FILES[id];
}

/** Абсолютный URL образа действия, устойчивый к нестандартному base приложения. */
export function actionArt(id: string): string | undefined {
  const file = actionArtFile(id);
  if (!file) return undefined;
  if (typeof document === "undefined") return `actions/${file}`;
  return new URL(`actions/${file}`, document.baseURI).href;
}

/** Список действий, у которых есть собственный образ (для тестов полноты). */
export function knownActionArtIds(): string[] {
  return Object.keys(ACTION_FILES).sort();
}
