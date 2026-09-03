Ниже — максимально подробная проектная инструкция по рефакторингу `app/packages/ui/src/campaign.css`.

Цель:

- уменьшить итоговый `campaign.css` до менее чем **1000 строк**;
- сохранить существующие классы, анимации, media-запросы, `prefers-reduced-motion`, CSS-переменные и визуальное поведение;
- профессионально разнести стили по предметным модулям;
- учесть требования сборки и форматирования:
  - форматирование кода — через Prettier;
  - ширина строки — **120 символов**;
  - линтер не должен отвечать за форматирование;
  - после рефакторинга обязательно выполняется `pnpm format` или эквивалент;
  - CI должен проходить без изменений, если в нём уже есть проверка форматирования, сборки и тестов.
  
---

# 1. Диагностика текущего файла

`app/packages/ui/src/campaign.css` сейчас содержит большое число несвязанных областей:

1. базовый экран кампании;
2. шапку кампании;
3. шкалу Тьмы и ресурсы;
4. карту царства;
5. маркеры миссий;
6. дорогу и перелёт корабля;
7. панель миссии;
8. вкладки корабля;
9. дружину и Горницу;
10. Кузню;
11. снаряжение;
12. экран высадки;
13. PvP и сеть;
14. повторы;
15. обучение;
16. кампейн-подсказки;
17. итог миссии;
18. keyframes;
19. адаптивные правила;
20. `prefers-reduced-motion`.

Для CSS это означает, что один файл стал одновременно:

- файлом темы кампании;
- файлом карты;
- файлом панелей;
- файлом модальных окон;
- файлом анимаций;
- файлом адаптивности.

Это нужно разнести на модули без изменения поведения.

---

# 2. Целевая архитектура

Создаём каталог:

```text
app/packages/ui/src/campaign/
```

Итоговая структура:

```text
app/packages/ui/src/
  campaign.css
  campaign/
    00-screen.css
    01-top.css
    02-darkness-resources.css
    03-map.css
    04-map-markers.css
    05-map-road.css
    06-mission-panel.css
    07-campaign-tabs.css
    08-roster.css
    09-forge.css
    10-equipment.css
    11-deployment.css
    12-pvp.css
    13-net.css
    14-replay.css
    15-training.css
    16-campaign-hints.css
    17-result.css
    18-keyframes.css
    19-responsive.css
    20-reduced-motion.css
```

`campaign.css` остаётся единственной точкой входа.

Это важно, потому что потребители продолжают писать:

```ts
import "./campaign.css";
```

и не знают о разбивке.

---

# 3. Главный принцип рефакторинга

Для CSS особенно важно:

1. **Не менять имена классов.**
2. **Не менять порядок правил без необходимости.**
3. **Не менять специфичность селекторов.**
4. **Не менять имена анимаций.**
5. **Не менять `z-index`, цвета, отступы, размеры.**
6. **Сохранить все комментарии-метки версий**, например `0.11.0`, `0.12.0`, `0.13.0`, если они есть в исходном файле.
7. **Сохранить порядок `@media`-блоков**, особенно если они находятся в конце файла и переопределяют предыдущие правила.
8. **`prefers-reduced-motion` должен остаться в конце**, если он стоит в конце исходного файла.

---

# 4. Требования к форматированию

После переноса каждый CSS-файл нужно прогнать через Prettier.

Пример правильного форматирования:

```css
.campaign-screen {
  max-width: 860px;
}

@media (min-width: 1400px) {
  .campaign-screen {
    max-width: 1100px;
  }
}
```

Правила:

- отступы: 2 пробела;
- каждый селектор и декларация на отдельных строках;
- ширина строки: 120 символов;
- одна пустая строка между правилами;
- точка с запятой обязательна;
- кавычки — как настроит Prettier;
- файл заканчивается переводом строки.

Команда форматирования:

```bash
pnpm exec prettier --write \
  app/packages/ui/src/campaign.css \
  app/packages/ui/src/campaign/*.css
```

Если в проекте есть команда `format`, лучше использовать её:

```bash
pnpm format
```

---

# 5. Пошаговая инструкция

## Шаг 1. Создать каталог модулей

```bash
mkdir -p app/packages/ui/src/campaign
```

## Шаг 2. Сделать резервную копию

На время рефакторинга удобно иметь копию:

```bash
cp app/packages/ui/src/campaign.css app/packages/ui/src/campaign.backup.css
```

После успешного завершения резервную копию удалить.

## Шаг 3. Разметить старый файл секциями

Перед механическим переносом полезно отметить секции комментариями, если их ещё нет:

```css
/* === 00 screen === */
/* === 01 top === */
/* === 02 darkness resources === */
/* === 03 map === */
/* === 04 map markers === */
/* === 05 map road === */
/* === 06 mission panel === */
/* === 07 campaign tabs === */
/* === 08 roster === */
/* === 09 forge === */
/* === 10 equipment === */
/* === 11 deployment === */
/* === 12 pvp === */
/* === 13 net === */
/* === 14 replay === */
/* === 15 training === */
/* === 16 campaign hints === */
/* === 17 result === */
/* === 18 keyframes === */
/* === 19 responsive === */
/* === 20 reduced motion === */
```

Это не обязательно, но снижает риск потери правил.

## Шаг 4. Создать новые файлы

Создать файлы:

```text
app/packages/ui/src/campaign/00-screen.css
app/packages/ui/src/campaign/01-top.css
app/packages/ui/src/campaign/02-darkness-resources.css
app/packages/ui/src/campaign/03-map.css
app/packages/ui/src/campaign/04-map-markers.css
app/packages/ui/src/campaign/05-map-road.css
app/packages/ui/src/campaign/06-mission-panel.css
app/packages/ui/src/campaign/07-campaign-tabs.css
app/packages/ui/src/campaign/08-roster.css
app/packages/ui/src/campaign/09-forge.css
app/packages/ui/src/campaign/10-equipment.css
app/packages/ui/src/campaign/11-deployment.css
app/packages/ui/src/campaign/12-pvp.css
app/packages/ui/src/campaign/13-net.css
app/packages/ui/src/campaign/14-replay.css
app/packages/ui/src/campaign/15-training.css
app/packages/ui/src/campaign/16-campaign-hints.css
app/packages/ui/src/campaign/17-result.css
app/packages/ui/src/campaign/18-keyframes.css
app/packages/ui/src/campaign/19-responsive.css
app/packages/ui/src/campaign/20-reduced-motion.css
```

## Шаг 5. Перенести правила

Переносить строго по одному разделу.

Для каждого файла:

1. Вырезать соответствующий блок из старого `campaign.css`.
2. Вставить в новый файл.
3. Не менять селекторы.
4. Не менять порядок внутри блока.
5. Сохранить комментарии версии.

## Шаг 6. Заменить `campaign.css` на точку входа

После переноса старый `campaign.css` должен стать тонким файлом с `@import`.

## Шаг 7. Проверить порядок импортов

Порядок `@import` должен повторять порядок исходных секций.

Это критично, потому что CSS-правила, идущие позже, могут переопределять более ранние.

## Шаг 8. Прогнать форматирование

```bash
pnpm exec prettier --write \
  app/packages/ui/src/campaign.css \
  app/packages/ui/src/campaign/*.css
```

## Шаг 9. Проверить сборку

```bash
pnpm -F ui build
```

или общую сборку:

```bash
pnpm build
```

## Шаг 10. Проверить тесты

```bash
pnpm -F ui test
```

или:

```bash
pnpm test
```

## Шаг 11. Проверить визуальную регрессию

Если в проекте используются скрипты:

```bash
pnpm screens:capture
pnpm screens:compare
```

либо эквивалент из `operations`.

Особое внимание:

- экран кампании;
- карта корабля;
- маркеры миссий;
- панель миссии;
- вкладки;
- дружина;
- Горница;
- Кузня;
- высадка;
- итог миссии;
- обучение;
- подсказки;
- `prefers-reduced-motion`.

## Шаг 12. Убедиться, что файл меньше 1000 строк

```bash
wc -l app/packages/ui/src/campaign.css
```

Ожидаемый результат: около 30–40 строк.

---

# 6. Полный код итогового файла

## `app/packages/ui/src/campaign.css`

Итоговый файл становится точкой входа.

Ожидаемый размер: **менее 50 строк**.

```css
@import "./campaign/00-screen.css";
@import "./campaign/01-top.css";
@import "./campaign/02-darkness-resources.css";
@import "./campaign/03-map.css";
@import "./campaign/04-map-markers.css";
@import "./campaign/05-map-road.css";
@import "./campaign/06-mission-panel.css";
@import "./campaign/07-campaign-tabs.css";
@import "./campaign/08-roster.css";
@import "./campaign/09-forge.css";
@import "./campaign/10-equipment.css";
@import "./campaign/11-deployment.css";
@import "./campaign/12-pvp.css";
@import "./campaign/13-net.css";
@import "./campaign/14-replay.css";
@import "./campaign/15-training.css";
@import "./campaign/16-campaign-hints.css";
@import "./campaign/17-result.css";
@import "./campaign/18-keyframes.css";
@import "./campaign/19-responsive.css";
@import "./campaign/20-reduced-motion.css";

/**
 * Экран кампании и связанные режимы.
 *
 * Прежде все стили жили в одном файле на несколько тысяч строк.
 * Теперь они разложены по предметным областям в каталоге `campaign/`,
 * а этот файл остаётся единственной точкой входа: потребители по-прежнему
 * пишут `import "./campaign.css"` и не знают о разбивке.
 *
 * Порядок импортов повторяет порядок исходного файла и не должен меняться
 * без отдельной проверки каскада.
 */
```

Важно: если конкретный сборщик требует, чтобы комментарии шли до `@import`, можно перенести комментарий наверх. Для большинства CSS-пайплайнов комментарии допустимы вокруг импортов, но самый безопасный вариант — сначала импорты, затем комментарий.

Альтернативный максимально безопасный вариант:

```css
@import "./campaign/00-screen.css";
@import "./campaign/01-top.css";
@import "./campaign/02-darkness-resources.css";
@import "./campaign/03-map.css";
@import "./campaign/04-map-markers.css";
@import "./campaign/05-map-road.css";
@import "./campaign/06-mission-panel.css";
@import "./campaign/07-campaign-tabs.css";
@import "./campaign/08-roster.css";
@import "./campaign/09-forge.css";
@import "./campaign/10-equipment.css";
@import "./campaign/11-deployment.css";
@import "./campaign/12-pvp.css";
@import "./campaign/13-net.css";
@import "./campaign/14-replay.css";
@import "./campaign/15-training.css";
@import "./campaign/16-campaign-hints.css";
@import "./campaign/17-result.css";
@import "./campaign/18-keyframes.css";
@import "./campaign/19-responsive.css";
@import "./campaign/20-reduced-motion.css";
```

Этот вариант точно не нарушит правило расположения `@import`.

---

# 7. Полный код новых файлов

Дальше идут целевые файлы.

Каждый файл содержит заголовок и тот набор правил, который относится к его предметной области. Если в исходном файле есть дополнительные правила из той же области, они должны быть добавлены в этот же файл без изменения селекторов.

---

## 7.1. `app/packages/ui/src/campaign/00-screen.css`

```css
/* ============================================================
 * 00-screen.css
 * Базовый контейнер экрана кампании.
 * ============================================================ */

.campaign-screen {
  max-width: 860px;
}

@media (min-width: 1400px) {
  .campaign-screen {
    max-width: 1100px;
  }
}
```

Если в старом файле рядом есть другие правила самого верхнего контейнера кампании, они переносятся сюда.

---

## 7.2. `app/packages/ui/src/campaign/01-top.css`

```css
/* ============================================================
 * 01-top.css
 * Шапка экрана кампании: заголовок, выход, общие действия.
 * ============================================================ */

.campaign-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 18px;
  margin-bottom: 14px;
}

.campaign-exit-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid var(--line);
  background: var(--ink-2);
  color: var(--mist);
  font-size: 0.86rem;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.campaign-exit-btn:hover,
.campaign-exit-btn:focus-visible {
  border-color: var(--amber-dim);
  color: var(--amber);
  outline: none;
}

.campaign-title-block {
  flex: 1 1 240px;
  min-width: 0;
}

.campaign-title-block .eyebrow {
  margin-bottom: 2px;
}

.campaign-title-block h1 {
  margin: 0;
  font-family: Palatino, "Palatino Linotype", "Iowan Old Style", serif;
  font-size: clamp(1.5rem, 4vw, 2rem);
  color: #f3ecdc;
  letter-spacing: 0.05em;
}
```

Сюда переносятся все правила, которые относятся к шапке кампании:

- `.campaign-top`;
- `.campaign-exit-btn`;
- `.campaign-title-block`;
- заголовок;
- вспомогательные элементы шапки, если они есть.

---

## 7.3. `app/packages/ui/src/campaign/02-darkness-resources.css`

```css
/* ============================================================
 * 02-darkness-resources.css
 * Тьма и запасы корабля.
 * ============================================================ */

.campaign-darkness {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 300px;
  min-width: 240px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  background: linear-gradient(180deg, var(--ink-2), var(--ink));
}

.campaign-darkness-name {
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: 0.72rem;
  color: var(--amber);
  white-space: nowrap;
}

.campaign-darkness-value {
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 0.95rem;
  color: #f3ecdc;
  white-space: nowrap;
}

.darkness-bar {
  position: relative;
  flex: 1 1 90px;
  height: 10px;
  background: var(--ink-3);
  border: 1px solid var(--line);
  overflow: hidden;
}

.darkness-bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #6b2d3a, #a03a4e);
  transition: width 0.6s ease;
}

.darkness-bar::after {
  content: "";
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    90deg,
    transparent 0 24.5%,
    rgba(213, 207, 192, 0.18) 24.5% 25.5%
  );
  pointer-events: none;
}

.campaign-resources {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.resource {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border: 1px solid var(--line);
  background: var(--ink-2);
  color: var(--mist-dim);
  font-size: 0.82rem;
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}

.resource svg {
  flex: none;
}

.resource.gold svg {
  color: var(--amber);
}

.resource.herbs svg {
  color: #7fa857;
}

.resource.artifacts svg {
  color: #9b6bbf;
}
```

Сюда переносятся все правила шкалы Тьмы и ресурсов.

---

## 7.4. `app/packages/ui/src/campaign/03-map.css`

```css
/* ============================================================
 * 03-map.css
 * Карта царства: подложка, туман, рельеф, общие слои.
 * ============================================================ */

.campaign-map {
  position: relative;
  height: min(56vh, 420px);
  min-height: 300px;
  border: 1px solid var(--line);
  border-radius: 2px;
  background:
    radial-gradient(560px 260px at 28% 18%, rgba(224, 179, 74, 0.05), transparent 70%),
    linear-gradient(160deg, #1a222b, #12161b 85%);
  overflow: hidden;
  isolation: isolate;
}

.campaign-map::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 110% at 50% 40%, transparent 58%, rgba(10, 13, 16, 0.55) 100%);
  pointer-events: none;
  z-index: 2;
}

.map-terrain {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}

.map-fog {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* Если в исходном файле есть дополнительные слои карты,
   они переносятся сюда без изменения порядка. */
```

Сюда переносятся:

- `.campaign-map`;
- `.map-terrain`;
- `.map-fog`;
- фоновые градиенты;
- виньетка карты;
- общие слои карты.

---

## 7.5. `app/packages/ui/src/campaign/04-map-markers.css`

```css
/* ============================================================
 * 04-map-markers.css
 * Маркеры миссий и точек карты.
 * ============================================================ */

.map-marker {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 44px;
  height: 44px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  z-index: 5;
}

.map-marker:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 3px;
  border-radius: 50%;
}

.marker-medallion {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  margin: 7px auto 0;
  border-radius: 50%;
  border: 2px solid #5d6b76;
  background: radial-gradient(circle at 32% 28%, #2a333c, #1b2229);
  color: #8fa1ad;
  font-size: 0.9rem;
  line-height: 1;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.map-marker:hover .marker-medallion,
.map-marker:focus-visible .marker-medallion {
  transform: scale(1.12);
}

.map-marker.is-open .marker-medallion {
  border-color: var(--amber);
  color: var(--amber);
  background: radial-gradient(circle at 32% 28%, #232b33, #181e24);
  color: #8fa1ad;
}

.map-marker.is-locked {
  cursor: default;
}

.map-marker.is-locked .marker-medallion {
  border-color: #46525c;
  background: #14191f;
  color: #46525c;
  filter: blur(0.4px);
}

.map-marker.is-locked:hover .marker-medallion {
  transform: none;
}

.marker-label {
  position: absolute;
  left: 50%;
  bottom: -2px;
  transform: translateX(-50%);
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mist-dim);
  white-space: nowrap;
}

.map-marker.is-open::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid rgba(224, 179, 74, 0.35);
  animation: marker-ring 2.4s ease-out infinite;
  pointer-events: none;
}
```

Сюда переносятся все состояния маркеров:

- открытые;
- закрытые;
- завершённые;
- активные;
- подписи;
- кольца.

---

## 7.6. `app/packages/ui/src/campaign/05-map-road.css`

```css
/* ============================================================
 * 05-map-road.css
 * Дорога кампании и перелёт Летучего Корабля.
 * ============================================================ */

.map-road .road-seg {
  stroke: rgba(224, 179, 74, 0.18);
  stroke-width: 0.55;
  stroke-dasharray: 1.8 2;
  stroke-linecap: round;
  fill: none;
}

.map-road .road-seg-draw {
  stroke: rgba(224, 179, 74, 0.5);
  stroke-width: 1;
  fill: none;
  stroke-linecap: round;
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  animation: road-draw 900ms var(--pop-ease, cubic-bezier(0.2, 0.9, 0.3, 1)) forwards;
}

.map-road .road-seg-glow {
  stroke: rgba(224, 179, 74, 0.09);
  stroke-width: 1.7;
  stroke-linecap: round;
  fill: none;
}

.ship-marker {
  position: absolute;
  transform: translate(-50%, -50%);
  z-index: 6;
}

.ship-marker::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -7px;
  width: 22px;
  height: 4px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  transform: translateX(-50%);
  filter: blur(1px);
}

.ship-glyph {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid var(--mist-dim);
  color: var(--mist);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
}

.ship-glyph svg {
  display: block;
}

.ship-flight-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 6;
}
```

Сюда переносятся:

- сегменты дороги;
- анимация дорисовки дороги;
- свечение дороги;
- маркер корабля;
- перелёт корабля;
- слой перелёта.

---

## 7.7. `app/packages/ui/src/campaign/06-mission-panel.css`

```css
/* ============================================================
 * 06-mission-panel.css
 * Панель выбранной миссии.
 * ============================================================ */

.mission-panel {
  margin-top: 14px;
}

.mission-card {
  position: relative;
  border: 1px solid var(--line);
  border-left: 3px solid var(--amber);
  background: linear-gradient(180deg, var(--ink-2), var(--ink));
  padding: 16px 18px 18px;
  animation: rise var(--pop-duration, 240ms) var(--pop-ease, ease) both;
}

.mission-card.is-done {
  border-left-color: #5d6b76;
}

.mission-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

.mission-type-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--amber-dim);
  border-radius: 50%;
  color: var(--amber);
  background: radial-gradient(circle at 32% 28%, #2c2a20, #1c1a14);
}

.mission-type-icon.is-destroy {
  color: #d97a4a;
  border-color: rgba(217, 122, 74, 0.55);
  background: radial-gradient(circle at 32% 28%, #33241c, #1c1410);
}

.mission-type-icon.is-rescue {
  color: #d96a6a;
  border-color: rgba(217, 106, 106, 0.55);
  background: radial-gradient(circle at 32% 28%, #33201e, #1c1010);
}

.mission-type-icon.is-recon {
  color: #7ab8d9;
  border-color: rgba(122, 184, 217, 0.55);
  background: radial-gradient(circle at 32% 28%, #1e2c33, #10181c);
}

.mission-card.is-destroy {
  border-top-color: rgba(217, 122, 74, 0.5);
}

.mission-card.is-rescue {
  border-top-color: rgba(217, 106, 106, 0.5);
}

.mission-card.is-recon {
  border-top-color: rgba(122, 184, 217, 0.5);
}

.mission-title {
  margin: 0;
  font-family: Palatino, "Palatino Linotype", serif;
  font-size: 1.35rem;
  color: #f3ecdc;
}

.mission-id {
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mist-dim);
}

.mission-status.done {
  display: inline-block;
  margin: 0 0 10px;
  padding: 2px 8px;
  border: 1px solid #5d6b76;
  color: #8fa1ad;
  font-size: 0.74rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.mission-facts {
  margin: 0 0 14px;
}

.fact-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 5px 0;
}

.fact-row dt {
  color: var(--mist-dim);
  min-width: 136px;
  font-size: 0.88rem;
}

.fact-row dd {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.foe-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  background: var(--ink-3);
  padding: 2px 9px;
  font-size: 0.84rem;
  color: #d8d2c2;
}

.foe-chip::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #7fa857;
}

.foe-chip.upyr::before {
  background: #9aa7b0;
}

.foe-chip.kikimora::before {
  background: #6b9b7a;
}

.darkness-growth {
  display: inline-flex;
  gap: 6px;
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 0.84rem;
}

.growth-victory {
  color: #8fae6b;
  border: 1px solid rgba(143, 174, 107, 0.35);
  padding: 1px 8px;
}

.growth-defeat {
  color: #e07a7a;
  border: 1px solid rgba(224, 122, 122, 0.35);
  padding: 1px 8px;
}

.mission-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.campaign-abandon-btn {
  appearance: none;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--mist);
  padding: 11px 18px;
  font-size: 0.9rem;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.campaign-abandon-btn:hover,
.campaign-abandon-btn:focus-visible {
  border-color: #c45c5c;
  color: #d98080;
  outline: none;
}

.mission-active-note {
  margin: 8px 0 0;
  font-size: 0.8rem;
  color: var(--mist);
  opacity: 0.8;
}

.campaign-start-btn {
  appearance: none;
  border: 1px solid var(--amber-dim);
  background: linear-gradient(180deg, #2c2a20, #201d14);
  color: var(--amber);
  padding: 11px 18px;
  font-size: 0.95rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.12s ease;
}

.campaign-start-btn:hover,
.campaign-start-btn:focus-visible {
  border-color: var(--amber);
  background: linear-gradient(180deg, #383420, #2a2618);
  outline: none;
}

.campaign-start-btn:active {
  transform: translateY(1px);
}

.mission-empty {
  border: 1px dashed var(--line);
  background: var(--ink-2);
  padding: 26px 20px;
  text-align: center;
  color: var(--mist-dim);
}

.mission-empty svg {
  display: block;
  margin: 0 auto 10px;
  color: var(--amber-dim);
}
```

Сюда переносятся все правила панели миссии.

---

## 7.8. `app/packages/ui/src/campaign/07-campaign-tabs.css`

```css
/* ============================================================
 * 07-campaign-tabs.css
 * Вкладки служб корабля.
 * ============================================================ */

.campaign-tabs {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.campaign-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 6px;
  background: var(--ink-2);
  border: 1px solid var(--line);
  color: var(--mist-dim);
  font-size: 0.88rem;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.campaign-tab svg {
  color: var(--mist-dim);
}

.campaign-tab:hover:not(:disabled),
.campaign-tab:focus-visible:not(:disabled) {
  border-color: var(--amber-dim);
  color: var(--mist);
}

.campaign-tab:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.tab-note {
  font-size: 0.66rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #5d6b76;
}

.tab-alert {
  position: absolute;
  top: 4px;
  right: 6px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: #a03a4e;
  color: #f3ecdc;
  font-size: 0.68rem;
  line-height: 18px;
  text-align: center;
}

/* Темизация служб корабля */

.campaign-screen.is-tab-map .map-toolbar,
.campaign-screen.is-tab-map .campaign-map,
.campaign-screen.is-tab-map .panel-head h2 {
  border-color: rgba(224, 179, 74, 0.25);
}

.campaign-screen.is-tab-forge .forge-panel,
.campaign-screen.is-tab-forge .panel-head h2 {
  border-color: rgba(201, 122, 74, 0.45);
}

.campaign-screen.is-tab-forge .panel-head h2 {
  color: #d99a6c;
}

.campaign-screen.is-tab-chamber .roster-panel,
.campaign-screen.is-tab-chamber .panel-head h2 {
  border-color: rgba(143, 184, 99, 0.4);
}

.campaign-screen.is-tab-chamber .panel-head h2 {
  color: #a9cc85;
}

.campaign-screen.is-tab-forge .campaign-tab svg,
.campaign-screen.is-tab-chamber .campaign-tab svg {
  transition: color 0.15s ease;
}
```

Сюда переносятся вкладки и их темизация.

---

## 7.9. `app/packages/ui/src/campaign/08-roster.css`

```css
/* ============================================================
 * 08-roster.css
 * Дружина, Горница, ранения, лечение, уровни.
 * ============================================================ */

.roster-panel {
  border: 1px solid var(--line);
  background: var(--ink-2);
  padding: 16px 16px 14px;
  animation: rise var(--pop-duration, 240ms) var(--pop-ease, ease) both;
}

.panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.panel-head h2 {
  margin: 0;
  font-family: Palatino, "Palatino Linotype", serif;
  font-size: 1.3rem;
  color: #f3ecdc;
}

.fighter-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fighter-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  background: linear-gradient(180deg, var(--ink), #171d23);
  transition: border-color 0.15s ease;
}

.fighter-row.is-wounded {
  border-left: 3px solid #a03a4e;
}

.fighter-row.is-fallen {
  border-color: #2a323b;
  opacity: 0.55;
}

.fighter-row.is-fallen .fighter-face {
  filter: grayscale(1);
  background: #10151a;
}

.fighter-face {
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 1px solid var(--line);
  overflow: hidden;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 32% 28%, var(--ink-3), #161c22);
  color: var(--mist-dim);
}

.fighter-face img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fighter-face svg {
  width: 70%;
  height: 70%;
}

.fighter-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1 1 220px;
}

.fighter-name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #f3ecdc;
}

.fallen-tag,
.wounded-tag {
  font-size: 0.66rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 1px 7px;
  border-radius: 2px;
}

.fallen-tag {
  color: #8fa1ad;
  border: 1px solid #46525c;
}

.wounded-tag {
  color: #e8b4bc;
  border: 1px solid rgba(224, 122, 122, 0.45);
  background: rgba(107, 45, 58, 0.25);
}

.fighter-class {
  font-size: 0.76rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--amber);
}

.fighter-hp {
  font-size: 0.8rem;
  color: var(--mist-dim);
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}

.fighter-level {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: none;
}

.level-pips {
  display: flex;
  gap: 3px;
}

.level-pips i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #46525c;
}

.level-pips i.on {
  background: var(--amber);
}

.level-label {
  font-size: 0.68rem;
  color: var(--mist-dim);
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}

.train-btn {
  flex: none;
  padding: 8px 14px;
  font-size: 0.85rem;
}

.heal-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 0.85rem;
  border-color: rgba(127, 168, 87, 0.5);
  color: #a9c88a;
  background: linear-gradient(180deg, #1f2a1d, #171f15);
}

.heal-btn:hover,
.heal-btn:focus-visible {
  border-color: #7fa857;
  color: #cfe3b4;
}

.fighter-ready {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #14181c;
  background: #5d7d44;
  font-size: 0.72rem;
  font-weight: 700;
}

.train-card {
  width: min(100%, 480px);
}

.class-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
  margin: 16px 0;
}

.class-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  appearance: none;
  border: 1px solid var(--line);
  background: var(--ink-3);
  color: var(--mist);
  padding: 12px 8px 10px;
  cursor: pointer;
  font-size: 0.85rem;
  transition:
    border-color 0.15s ease,
    transform 0.12s ease,
    background 0.15s ease;
}

.class-card:hover,
.class-card:focus-visible {
  border-color: var(--amber);
  background: #2c2a20;
  outline: none;
  transform: translateY(-2px);
}

.class-card img {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--line);
}

.class-card .deploy-face-empty {
  width: 56px;
  height: 56px;
  border-radius: 50%;
}

.heal-all-btn {
  margin-left: auto;
}

.fighter-row.is-wounded .fighter-face {
  box-shadow: 0 0 0 1px rgba(160, 58, 78, 0.45);
}
```

Сюда переносятся все правила дружины, Горницы, лечения, уровней и выбора класса.

---

## 7.10. `app/packages/ui/src/campaign/09-forge.css`

```css
/* ============================================================
 * 09-forge.css
 * Кузня.
 * ============================================================ */

.forge-panel {
  border: 1px solid var(--line);
  background: var(--ink-2);
  padding: 16px;
  animation: rise var(--pop-duration, 240ms) var(--pop-ease, ease) both;
}

.forge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.forge-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--line);
  background: linear-gradient(180deg, var(--ink), #171d23);
  transition:
    border-color 0.15s ease,
    transform 0.12s ease,
    box-shadow 0.15s ease;
}

.forge-card:hover {
  border-color: rgba(224, 179, 74, 0.45);
  transform: translateY(-1px);
}

.forge-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid var(--amber-dim);
  color: var(--amber);
  background: radial-gradient(circle at 32% 28%, #2c2a20, #1c1a14);
}

.forge-card.is-crafted .forge-icon {
  border-color: rgba(127, 168, 87, 0.5);
  color: #7fa857;
  background: radial-gradient(circle at 32% 28%, #1e2a1d, #161f15);
}

.forge-name {
  font-weight: 600;
  color: #f3ecdc;
  font-size: 0.95rem;
}

.forge-effects {
  font-size: 0.8rem;
  color: var(--mist-dim);
  min-height: 2.2em;
}

.forge-cost {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.craft-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  appearance: none;
  border: 1px solid var(--amber-dim);
  background: linear-gradient(180deg, #2c2a20, #201d14);
  color: var(--amber);
  padding: 8px 10px;
  font-size: 0.86rem;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.12s ease;
}

.craft-btn:hover:not(:disabled),
.craft-btn:focus-visible:not(:disabled) {
  border-color: var(--amber);
  background: linear-gradient(180deg, #383420, #2a2618);
  outline: none;
}

.craft-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.crafted-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(127, 168, 87, 0.45);
  color: #a9c88a;
  padding: 8px 10px;
  font-size: 0.82rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.forge-note {
  margin: 14px 0 0;
  color: var(--mist-dim);
  font-size: 0.84rem;
}

.forge-card.is-crafted {
  animation: crafted-in 0.45s ease both;
}

.crafted-tag::before {
  content: "✓";
  font-weight: 700;
}
```

Сюда переносятся все правила Кузни.

---

## 7.11. `app/packages/ui/src/campaign/10-equipment.css`

```css
/* ============================================================
 * 10-equipment.css
 * Снаряжение бойцов.
 * ============================================================ */

.equip-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  border: 1px solid rgba(224, 179, 74, 0.4);
  background: rgba(224, 179, 74, 0.08);
  color: var(--amber);
  padding: 1px 8px;
  font-size: 0.74rem;
  border-radius: 2px;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.equip-chip svg {
  flex: none;
}

.equip-btn {
  position: absolute;
  top: 6px;
  right: 34px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  appearance: none;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--ink-3);
  color: var(--mist-dim);
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    transform 0.12s ease;
}

.equip-btn:hover,
.equip-btn:focus-visible {
  border-color: var(--amber);
  color: var(--amber);
  outline: none;
  transform: scale(1.1);
}

.equip-card {
  width: min(100%, 480px);
  max-height: 82vh;
  overflow-y: auto;
}

.equip-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 14px 0;
}

.equip-empty {
  margin: 6px 0;
}

.equip-item {
  display: flex;
  align-items: center;
  gap: 12px;
  appearance: none;
  border: 1px solid var(--line);
  background: var(--ink-3);
  color: var(--mist);
  padding: 10px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.equip-item:hover:not(.is-taken),
.equip-item:focus-visible:not(.is-taken) {
  border-color: var(--amber);
  background: linear-gradient(180deg, #2c2a20, #201d14);
}

.equip-item.is-taken {
  opacity: 0.45;
  cursor: not-allowed;
}

.equip-item-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--amber-dim);
  color: var(--amber);
}

.equip-item-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.equip-item-name {
  font-weight: 600;
  color: #f3ecdc;
}

.equip-item-effects {
  font-size: 0.78rem;
  color: var(--mist-dim);
}

.equip-item-state {
  flex: none;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mist-dim);
}

.equip-item.is-on .equip-item-state {
  color: var(--amber);
}

.equip-unequip {
  width: 100%;
  appearance: none;
  border: 1px dashed rgba(224, 122, 122, 0.5);
  background: rgba(107, 45, 58, 0.18);
  color: #e8b4bc;
  padding: 9px 12px;
  font-size: 0.86rem;
  cursor: pointer;
  margin-bottom: 8px;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.equip-unequip:hover,
.equip-unequip:focus-visible {
  border-color: #e07a7a;
  background: rgba(107, 45, 58, 0.3);
  outline: none;
}

.deploy-card .equip-btn {
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    transform 0.12s ease,
    box-shadow 0.15s ease;
}

.deploy-card .equip-btn:hover,
.deploy-card .equip-btn:focus-visible {
  box-shadow: 0 0 10px rgba(224, 179, 74, 0.35);
}
```

Сюда переносятся все правила снаряжения.

---

## 7.12. `app/packages/ui/src/campaign/11-deployment.css`

```css
/* ============================================================
 * 11-deployment.css
 * Экран формирования высадки.
 * ============================================================ */

.deployment-screen {
  max-width: 720px;
}

@media (min-width: 1400px) {
  .deployment-screen {
    max-width: 960px;
  }
}

.deployment-head {
  margin-bottom: 20px;
}

.deployment-head .display-title {
  font-size: clamp(2rem, 8vw, 2.6rem);
}

.deployment-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

@media (max-width: 480px) {
  .deployment-grid {
    grid-template-columns: 1fr;
  }

  .deploy-card {
    padding: 10px;
    gap: 10px;
  }
}

.deploy-card {
  position: relative;
  display: flex;
  gap: 12px;
  align-items: center;
  appearance: none;
  border: 1px solid var(--line);
  background: linear-gradient(180deg, var(--ink-2), var(--ink));
  color: var(--mist);
  padding: 12px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    transform 0.12s ease,
    box-shadow 0.15s ease,
    background 0.15s ease;
}

.deploy-card:hover,
.deploy-card:focus-visible {
  border-color: var(--amber-dim);
  outline: none;
  transform: translateY(-1px);
}

.deploy-card.is-picked {
  border-color: var(--amber);
  background: linear-gradient(180deg, #2c2a20, #201d14);
  box-shadow:
    0 0 0 1px rgba(224, 179, 74, 0.35),
    0 6px 18px rgba(0, 0, 0, 0.3);
  animation: rise var(--pop-duration, 240ms) var(--pop-ease, ease) both;
}

.deploy-card.is-wounded {
  border-left: 3px solid #a03a4e;
}

.deploy-face {
  position: relative;
  flex: none;
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: radial-gradient(circle at 32% 28%, var(--ink-3), #161c22);
  overflow: visible;
  color: var(--mist-dim);
}

.deploy-face img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.deploy-face-empty {
  width: 100%;
  height: 100%;
  display: block;
}

.deploy-face svg {
  width: 70%;
  height: 70%;
}

.wound-badge {
  position: absolute;
  right: -4px;
  bottom: -2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #a03a4e;
  border: 2px solid #14181c;
  display: grid;
  place-items: center;
}

.wound-badge::after {
  content: "✚";
  color: #f3ecdc;
  font-size: 0.7rem;
  line-height: 1;
}

.deploy-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.deploy-name {
  font-weight: 600;
  color: #f3ecdc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deploy-class {
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--amber);
}

.deploy-hp {
  font-size: 0.8rem;
  color: var(--mist-dim);
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}

.deploy-wound-note {
  font-size: 0.72rem;
  color: #e07a7a;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.pick-mark {
  position: absolute;
  top: 6px;
  right: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  font-size: 0.72rem;
  color: transparent;
  transition:
    color 0.12s ease,
    background 0.12s ease,
    border-color 0.12s ease;
}

.deploy-card.is-picked .pick-mark {
  color: var(--ink);
  background: var(--amber);
  border-color: var(--amber);
}

.deployment-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 18px;
}

.deployment-count {
  margin: 0;
  color: var(--mist-dim);
  font-size: 0.9rem;
}

.deployment-actions {
  display: flex;
  gap: 10px;
  margin-left: auto;
}

.deploy-confirm {
  min-width: 150px;
  justify-content: center;
}

.deploy-confirm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
```

Сюда переносятся все правила экрана высадки.

---

## 7.13. `app/packages/ui/src/campaign/12-pvp.css`

```css
/* ============================================================
 * 12-pvp.css
 * Поочерёдная игра, PvP, драфт.
 * ============================================================ */

.pvp-room-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 28px 20px;
}

.pvp-arena {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  justify-content: center;
}

.pvp-side-card {
  min-width: 260px;
  padding: 16px;
  border: 1px solid rgba(120, 140, 160, 0.28);
  border-radius: 8px;
  background: rgba(12, 16, 12, 0.6);
  animation: pvp-side-in 420ms ease-out both;
}

.pvp-side-card.is-side1 {
  border-top: 3px solid #e0b34a;
  animation-delay: 60ms;
}

.pvp-side-card.is-side2 {
  border-top: 3px solid #6aa9d9;
  animation-delay: 120ms;
}

.is-side1 .pvp-side-title {
  color: var(--amber, #e0b34a);
}

.is-side2 .pvp-side-title {
  color: #6aa9d9;
}

.pvp-roster {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pvp-slot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  transition:
    transform 160ms ease,
    background 160ms ease;
}

.pvp-slot:hover {
  transform: translateX(3px);
  background: rgba(255, 255, 255, 0.07);
}

.pvp-slot-face {
  width: 34px;
  height: 34px;
  border-radius: 4px;
}

.pvp-options {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  justify-content: center;
  width: 100%;
  max-width: 640px;
}

.pvp-option-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pvp-option-title {
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #9aa39a;
}

.pvp-radio {
  padding: 6px 14px;
  border: 1px solid rgba(120, 140, 160, 0.3);
  border-radius: 4px;
  background: rgba(12, 16, 12, 0.55);
  color: #c9c2b2;
  font-size: 0.82rem;
  cursor: pointer;
}

.pvp-check input {
  accent-color: #e0b34a;
}

.draft {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 640px;
}

.draft-status {
  display: flex;
  align-items: center;
  gap: 14px;
}

.draft-side {
  padding: 6px 16px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  transition: all 200ms ease;
}

.draft-side.is-side1 {
  color: var(--amber, #e0b34a);
}

.draft-side.is-side2 {
  color: #6aa9d9;
}

.draft-side.is-current {
  border-color: rgba(224, 179, 74, 0.7);
  box-shadow: 0 0 14px rgba(224, 179, 74, 0.35);
  animation: draft-glow 1.6s ease-in-out infinite;
}

.draft-side.is-full {
  border-color: rgba(120, 190, 130, 0.5);
  color: #8fd89a;
}

.draft-vs {
  color: #8fa1ad;
}

.draft-hint {
  margin: 0;
  color: #c9c2b2;
  font-size: 0.85rem;
}

.draft-done {
  margin: 0;
  color: #8fd89a;
  font-size: 0.9rem;
  animation: net-ok 300ms ease-out;
}

.draft-pool {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
  width: 100%;
}

.draft-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 8px;
  border: 1px solid rgba(120, 140, 160, 0.25);
  border-radius: 8px;
  background: rgba(12, 16, 12, 0.55);
  cursor: pointer;
  transition: all 180ms ease;
}

.draft-card:hover:not(:disabled) {
  transform: translateY(-3px);
  border-color: rgba(224, 179, 74, 0.6);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}

.draft-card:disabled {
  cursor: default;
}

.draft-card.is-taken {
  opacity: 0.4;
  border-style: dashed;
}

.draft-face {
  width: 52px;
  height: 52px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.15);
}

.draft-name {
  font-size: 0.78rem;
  color: #e8e2d4;
  text-align: center;
}

.draft-taken-mark {
  position: absolute;
  top: 6px;
  right: 8px;
  color: #8fd89a;
  font-weight: 700;
}

.pvp-start-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.spectator-bar {
  display: flex;
  align-items: center;
  justify-content: center;
}

.spectator-note {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: #8fa1ad;
  letter-spacing: 0.06em;
}

.spectator-eye {
  color: #6aa9d9;
  animation: eye-blink 2.4s ease-in-out infinite;
}
```

Сюда переносятся все PvP-правила.

---

## 7.14. `app/packages/ui/src/campaign/13-net.css`

```css
/* ============================================================
 * 13-net.css
 * Сетевые панели, коды, подключения, ошибки.
 * ============================================================ */

.pvp-tabs,
.net-role-switch {
  display: flex;
  gap: 8px;
  margin: 6px 0 4px;
}

.pvp-tab {
  padding: 8px 18px;
  border: 1px solid rgba(120, 140, 160, 0.28);
  border-radius: 4px;
  background: rgba(12, 16, 12, 0.55);
  color: #9aa39a;
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: all 180ms ease;
}

.pvp-tab:hover {
  color: #e8e2d4;
  border-color: rgba(224, 179, 74, 0.5);
}

.pvp-tab.is-active {
  color: var(--amber, #e0b34a);
  border-color: rgba(224, 179, 74, 0.65);
  background: rgba(58, 49, 32, 0.5);
  box-shadow: inset 0 -2px 0 rgba(224, 179, 74, 0.7);
}

.net-setup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: 100%;
  max-width: 560px;
}

.net-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 18px;
  border: 1px solid rgba(120, 140, 160, 0.22);
  border-radius: 8px;
  background: rgba(12, 16, 12, 0.5);
  animation: net-panel-in 300ms ease-out;
}

.net-code-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 14px;
  border: 1px dashed rgba(224, 179, 74, 0.45);
  border-radius: 8px;
  background: rgba(224, 179, 74, 0.05);
}

.net-qr {
  width: 160px;
  height: 160px;
  border-radius: 6px;
  image-rendering: pixelated;
  box-shadow: 0 0 24px rgba(224, 179, 74, 0.25);
  animation: qr-in 400ms ease-out;
}

.net-code {
  max-width: 100%;
  word-break: break-all;
  font-family: monospace;
  font-size: 0.72rem;
  color: #e8cf9a;
  background: rgba(0, 0, 0, 0.35);
  padding: 8px 10px;
  border-radius: 4px;
}

.net-input-label {
  align-self: flex-start;
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  color: #9aa39a;
  text-transform: uppercase;
}

.net-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgba(120, 140, 160, 0.3);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.35);
  color: #f3ecdc;
  font-family: monospace;
  font-size: 0.8rem;
  transition: border-color 180ms ease;
}

.net-input:focus {
  outline: none;
  border-color: rgba(224, 179, 74, 0.7);
}

.net-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
}

.net-connected {
  color: #8fd89a;
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  animation: net-ok 300ms ease-out;
}

.net-error {
  color: #e07a6a;
  font-size: 0.85rem;
  border-left: 2px solid #e07a6a;
  padding-left: 10px;
  animation: net-err 240ms ease-out;
}

.net-lost-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
  flex-wrap: wrap;
  justify-content: center;
}
```

Сюда переносятся все сетевые правила.

---

## 7.15. `app/packages/ui/src/campaign/14-replay.css`

```css
/* ============================================================
 * 14-replay.css
 * Повторы.
 * ============================================================ */

.replay-screen {
  gap: 16px;
}

.replay-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 560px;
}

.replay-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 16px;
  border: 1px solid rgba(120, 140, 160, 0.22);
  border-radius: 8px;
  background: rgba(12, 16, 12, 0.55);
  transition:
    border-color 180ms ease,
    transform 180ms ease;
}

.replay-row:hover {
  border-color: rgba(106, 169, 217, 0.5);
  transform: translateX(3px);
}

.replay-meta {
  display
Ниже — максимально подробная проектная инструкция по рефакторингу `app/packages/ui/src/campaign.css`.

Цель:

- уменьшить итоговый `campaign.css` до менее чем **1000 строк**;
- сохранить существующие классы, анимации, media-запросы, `prefers-reduced-motion`, CSS-переменные и визуальное поведение;
- профессионально разнести стили по предметным модулям;
- учесть требования сборки и форматирования:
  - форматирование кода — через Prettier;
  - ширина строки — **120 символов**;
  - линтер не должен отвечать за форматирование;
  - после рефакторинга обязательно выполняется `pnpm format` или эквивалент;
  - CI должен проходить без изменений, если в нём уже есть проверка форматирования, сборки и тестов.

> Важное замечание по приложенным файлам. В приложенных `ci.yml` и `deploy-pages.yml` содержимое отсутствует, поэтому дополнительных ограничений из них не видно. Ниже используются стандартные требования проекта: проверка форматирования, сборка, тесты, визуальная регрессия. Если в реальных файлах есть конкретные команды, их нужно продублировать локально перед отправкой изменений.

---

# 1. Диагностика текущего файла

`app/packages/ui/src/campaign.css` сейчас содержит большое число несвязанных областей:

1. базовый экран кампании;
2. шапку кампании;
3. шкалу Тьмы и ресурсы;
4. карту царства;
5. маркеры миссий;
6. дорогу и перелёт корабля;
7. панель миссии;
8. вкладки корабля;
9. дружину и Горницу;
10. Кузню;
11. снаряжение;
12. экран высадки;
13. PvP и сеть;
14. повторы;
15. обучение;
16. кампейн-подсказки;
17. итог миссии;
18. keyframes;
19. адаптивные правила;
20. `prefers-reduced-motion`.

Для CSS это означает, что один файл стал одновременно:

- файлом темы кампании;
- файлом карты;
- файлом панелей;
- файлом модальных окон;
- файлом анимаций;
- файлом адаптивности.

Это нужно разнести на модули без изменения поведения.

---

# 2. Целевая архитектура

Создаём каталог:

```text
app/packages/ui/src/campaign/
```

Итоговая структура:

```text
app/packages/ui/src/
  campaign.css
  campaign/
    00-screen.css
    01-top.css
    02-darkness-resources.css
    03-map.css
    04-map-markers.css
    05-map-road.css
    06-mission-panel.css
    07-campaign-tabs.css
    08-roster.css
    09-forge.css
    10-equipment.css
    11-deployment.css
    12-pvp.css
    13-net.css
    14-replay.css
    15-training.css
    16-campaign-hints.css
    17-result.css
    18-keyframes.css
    19-responsive.css
    20-reduced-motion.css
```

`campaign.css` остаётся единственной точкой входа.

Это важно, потому что потребители продолжают писать:

```ts
import "./campaign.css";
```

и не знают о разбивке.

---

# 3. Главный принцип рефакторинга

Для CSS особенно важно:

1. **Не менять имена классов.**
2. **Не менять порядок правил без необходимости.**
3. **Не менять специфичность селекторов.**
4. **Не менять имена анимаций.**
5. **Не менять `z-index`, цвета, отступы, размеры.**
6. **Сохранить все комментарии-метки версий**, например `0.11.0`, `0.12.0`, `0.13.0`, если они есть в исходном файле.
7. **Сохранить порядок `@media`-блоков**, особенно если они находятся в конце файла и переопределяют предыдущие правила.
8. **`prefers-reduced-motion` должен остаться в конце**, если он стоит в конце исходного файла.

---

# 4. Требования к форматированию

После переноса каждый CSS-файл нужно прогнать через Prettier.

Пример правильного форматирования:

```css
.campaign-screen {
  max-width: 860px;
}

@media (min-width: 1400px) {
  .campaign-screen {
    max-width: 1100px;
  }
}
```

Правила:

- отступы: 2 пробела;
- каждый селектор и декларация на отдельных строках;
- ширина строки: 120 символов;
- одна пустая строка между правилами;
- точка с запятой обязательна;
- кавычки — как настроит Prettier;
- файл заканчивается переводом строки.

Команда форматирования:

```bash
pnpm exec prettier --write \
  app/packages/ui/src/campaign.css \
  app/packages/ui/src/campaign/*.css
```

Если в проекте есть команда `format`, лучше использовать её:

```bash
pnpm format
```

---

# 5. Пошаговая инструкция

## Шаг 1. Создать каталог модулей

```bash
mkdir -p app/packages/ui/src/campaign
```

## Шаг 2. Сделать резервную копию

На время рефакторинга удобно иметь копию:

```bash
cp app/packages/ui/src/campaign.css app/packages/ui/src/campaign.backup.css
```

После успешного завершения резервную копию удалить.

## Шаг 3. Разметить старый файл секциями

Перед механическим переносом полезно отметить секции комментариями, если их ещё нет:

```css
/* === 00 screen === */
/* === 01 top === */
/* === 02 darkness resources === */
/* === 03 map === */
/* === 04 map markers === */
/* === 05 map road === */
/* === 06 mission panel === */
/* === 07 campaign tabs === */
/* === 08 roster === */
/* === 09 forge === */
/* === 10 equipment === */
/* === 11 deployment === */
/* === 12 pvp === */
/* === 13 net === */
/* === 14 replay === */
/* === 15 training === */
/* === 16 campaign hints === */
/* === 17 result === */
/* === 18 keyframes === */
/* === 19 responsive === */
/* === 20 reduced motion === */
```

Это не обязательно, но снижает риск потери правил.

## Шаг 4. Создать новые файлы

Создать файлы:

```text
app/packages/ui/src/campaign/00-screen.css
app/packages/ui/src/campaign/01-top.css
app/packages/ui/src/campaign/02-darkness-resources.css
app/packages/ui/src/campaign/03-map.css
app/packages/ui/src/campaign/04-map-markers.css
app/packages/ui/src/campaign/05-map-road.css
app/packages/ui/src/campaign/06-mission-panel.css
app/packages/ui/src/campaign/07-campaign-tabs.css
app/packages/ui/src/campaign/08-roster.css
app/packages/ui/src/campaign/09-forge.css
app/packages/ui/src/campaign/10-equipment.css
app/packages/ui/src/campaign/11-deployment.css
app/packages/ui/src/campaign/12-pvp.css
app/packages/ui/src/campaign/13-net.css
app/packages/ui/src/campaign/14-replay.css
app/packages/ui/src/campaign/15-training.css
app/packages/ui/src/campaign/16-campaign-hints.css
app/packages/ui/src/campaign/17-result.css
app/packages/ui/src/campaign/18-keyframes.css
app/packages/ui/src/campaign/19-responsive.css
app/packages/ui/src/campaign/20-reduced-motion.css
```

## Шаг 5. Перенести правила

Переносить строго по одному разделу.

Для каждого файла:

1. Вырезать соответствующий блок из старого `campaign.css`.
2. Вставить в новый файл.
3. Не менять селекторы.
4. Не менять порядок внутри блока.
5. Сохранить комментарии версии.

## Шаг 6. Заменить `campaign.css` на точку входа

После переноса старый `campaign.css` должен стать тонким файлом с `@import`.

## Шаг 7. Проверить порядок импортов

Порядок `@import` должен повторять порядок исходных секций.

Это критично, потому что CSS-правила, идущие позже, могут переопределять более ранние.

## Шаг 8. Прогнать форматирование

```bash
pnpm exec prettier --write \
  app/packages/ui/src/campaign.css \
  app/packages/ui/src/campaign/*.css
```

## Шаг 9. Проверить сборку

```bash
pnpm -F ui build
```

или общую сборку:

```bash
pnpm build
```

## Шаг 10. Проверить тесты

```bash
pnpm -F ui test
```

или:

```bash
pnpm test
```

## Шаг 11. Проверить визуальную регрессию

Если в проекте используются скрипты:

```bash
pnpm screens:capture
pnpm screens:compare
```

либо эквивалент из `operations`.

Особое внимание:

- экран кампании;
- карта корабля;
- маркеры миссий;
- панель миссии;
- вкладки;
- дружина;
- Горница;
- Кузня;
- высадка;
- итог миссии;
- обучение;
- подсказки;
- `prefers-reduced-motion`.

## Шаг 12. Убедиться, что файл меньше 1000 строк

```bash
wc -l app/packages/ui/src/campaign.css
```

Ожидаемый результат: около 30–40 строк.

---

# 6. Полный код итогового файла

## `app/packages/ui/src/campaign.css`

Итоговый файл становится точкой входа.

Ожидаемый размер: **менее 50 строк**.

```css
@import "./campaign/00-screen.css";
@import "./campaign/01-top.css";
@import "./campaign/02-darkness-resources.css";
@import "./campaign/03-map.css";
@import "./campaign/04-map-markers.css";
@import "./campaign/05-map-road.css";
@import "./campaign/06-mission-panel.css";
@import "./campaign/07-campaign-tabs.css";
@import "./campaign/08-roster.css";
@import "./campaign/09-forge.css";
@import "./campaign/10-equipment.css";
@import "./campaign/11-deployment.css";
@import "./campaign/12-pvp.css";
@import "./campaign/13-net.css";
@import "./campaign/14-replay.css";
@import "./campaign/15-training.css";
@import "./campaign/16-campaign-hints.css";
@import "./campaign/17-result.css";
@import "./campaign/18-keyframes.css";
@import "./campaign/19-responsive.css";
@import "./campaign/20-reduced-motion.css";

/**
 * Экран кампании и связанные режимы.
 *
 * Прежде все стили жили в одном файле на несколько тысяч строк.
 * Теперь они разложены по предметным областям в каталоге `campaign/`,
 * а этот файл остаётся единственной точкой входа: потребители по-прежнему
 * пишут `import "./campaign.css"` и не знают о разбивке.
 *
 * Порядок импортов повторяет порядок исходного файла и не должен меняться
 * без отдельной проверки каскада.
 */
```

Важно: если конкретный сборщик требует, чтобы комментарии шли до `@import`, можно перенести комментарий наверх. Для большинства CSS-пайплайнов комментарии допустимы вокруг импортов, но самый безопасный вариант — сначала импорты, затем комментарий.

Альтернативный максимально безопасный вариант:

```css
@import "./campaign/00-screen.css";
@import "./campaign/01-top.css";
@import "./campaign/02-darkness-resources.css";
@import "./campaign/03-map.css";
@import "./campaign/04-map-markers.css";
@import "./campaign/05-map-road.css";
@import "./campaign/06-mission-panel.css";
@import "./campaign/07-campaign-tabs.css";
@import "./campaign/08-roster.css";
@import "./campaign/09-forge.css";
@import "./campaign/10-equipment.css";
@import "./campaign/11-deployment.css";
@import "./campaign/12-pvp.css";
@import "./campaign/13-net.css";
@import "./campaign/14-replay.css";
@import "./campaign/15-training.css";
@import "./campaign/16-campaign-hints.css";
@import "./campaign/17-result.css";
@import "./campaign/18-keyframes.css";
@import "./campaign/19-responsive.css";
@import "./campaign/20-reduced-motion.css";
```

Этот вариант точно не нарушит правило расположения `@import`.

---

# 7. Полный код новых файлов

Дальше идут целевые файлы.

Каждый файл содержит заголовок и тот набор правил, который относится к его предметной области. Если в исходном файле есть дополнительные правила из той же области, они должны быть добавлены в этот же файл без изменения селекторов.

---

## 7.1. `app/packages/ui/src/campaign/00-screen.css`

```css
/* ============================================================
 * 00-screen.css
 * Базовый контейнер экрана кампании.
 * ============================================================ */

.campaign-screen {
  max-width: 860px;
}

@media (min-width: 1400px) {
  .campaign-screen {
    max-width: 1100px;
  }
}
```

Если в старом файле рядом есть другие правила самого верхнего контейнера кампании, они переносятся сюда.

---

## 7.2. `app/packages/ui/src/campaign/01-top.css`

```css
/* ============================================================
 * 01-top.css
 * Шапка экрана кампании: заголовок, выход, общие действия.
 * ============================================================ */

.campaign-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 18px;
  margin-bottom: 14px;
}

.campaign-exit-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid var(--line);
  background: var(--ink-2);
  color: var(--mist);
  font-size: 0.86rem;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.campaign-exit-btn:hover,
.campaign-exit-btn:focus-visible {
  border-color: var(--amber-dim);
  color: var(--amber);
  outline: none;
}

.campaign-title-block {
  flex: 1 1 240px;
  min-width: 0;
}

.campaign-title-block .eyebrow {
  margin-bottom: 2px;
}

.campaign-title-block h1 {
  margin: 0;
  font-family: Palatino, "Palatino Linotype", "Iowan Old Style", serif;
  font-size: clamp(1.5rem, 4vw, 2rem);
  color: #f3ecdc;
  letter-spacing: 0.05em;
}
```

Сюда переносятся все правила, которые относятся к шапке кампании:

- `.campaign-top`;
- `.campaign-exit-btn`;
- `.campaign-title-block`;
- заголовок;
- вспомогательные элементы шапки, если они есть.

---

## 7.3. `app/packages/ui/src/campaign/02-darkness-resources.css`

```css
/* ============================================================
 * 02-darkness-resources.css
 * Тьма и запасы корабля.
 * ============================================================ */

.campaign-darkness {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 300px;
  min-width: 240px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  background: linear-gradient(180deg, var(--ink-2), var(--ink));
}

.campaign-darkness-name {
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: 0.72rem;
  color: var(--amber);
  white-space: nowrap;
}

.campaign-darkness-value {
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 0.95rem;
  color: #f3ecdc;
  white-space: nowrap;
}

.darkness-bar {
  position: relative;
  flex: 1 1 90px;
  height: 10px;
  background: var(--ink-3);
  border: 1px solid var(--line);
  overflow: hidden;
}

.darkness-bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #6b2d3a, #a03a4e);
  transition: width 0.6s ease;
}

.darkness-bar::after {
  content: "";
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    90deg,
    transparent 0 24.5%,
    rgba(213, 207, 192, 0.18) 24.5% 25.5%
  );
  pointer-events: none;
}

.campaign-resources {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.resource {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border: 1px solid var(--line);
  background: var(--ink-2);
  color: var(--mist-dim);
  font-size: 0.82rem;
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}

.resource svg {
  flex: none;
}

.resource.gold svg {
  color: var(--amber);
}

.resource.herbs svg {
  color: #7fa857;
}

.resource.artifacts svg {
  color: #9b6bbf;
}
```

Сюда переносятся все правила шкалы Тьмы и ресурсов.

---

## 7.4. `app/packages/ui/src/campaign/03-map.css`

```css
/* ============================================================
 * 03-map.css
 * Карта царства: подложка, туман, рельеф, общие слои.
 * ============================================================ */

.campaign-map {
  position: relative;
  height: min(56vh, 420px);
  min-height: 300px;
  border: 1px solid var(--line);
  border-radius: 2px;
  background:
    radial-gradient(560px 260px at 28% 18%, rgba(224, 179, 74, 0.05), transparent 70%),
    linear-gradient(160deg, #1a222b, #12161b 85%);
  overflow: hidden;
  isolation: isolate;
}

.campaign-map::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 110% at 50% 40%, transparent 58%, rgba(10, 13, 16, 0.55) 100%);
  pointer-events: none;
  z-index: 2;
}

.map-terrain {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}

.map-fog {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* Если в исходном файле есть дополнительные слои карты,
   они переносятся сюда без изменения порядка. */
```

Сюда переносятся:

- `.campaign-map`;
- `.map-terrain`;
- `.map-fog`;
- фоновые градиенты;
- виньетка карты;
- общие слои карты.

---

## 7.5. `app/packages/ui/src/campaign/04-map-markers.css`

```css
/* ============================================================
 * 04-map-markers.css
 * Маркеры миссий и точек карты.
 * ============================================================ */

.map-marker {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 44px;
  height: 44px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  z-index: 5;
}

.map-marker:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 3px;
  border-radius: 50%;
}

.marker-medallion {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  margin: 7px auto 0;
  border-radius: 50%;
  border: 2px solid #5d6b76;
  background: radial-gradient(circle at 32% 28%, #2a333c, #1b2229);
  color: #8fa1ad;
  font-size: 0.9rem;
  line-height: 1;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.map-marker:hover .marker-medallion,
.map-marker:focus-visible .marker-medallion {
  transform: scale(1.12);
}

.map-marker.is-open .marker-medallion {
  border-color: var(--amber);
  color: var(--amber);
  background: radial-gradient(circle at 32% 28%, #232b33, #181e24);
  color: #8fa1ad;
}

.map-marker.is-locked {
  cursor: default;
}

.map-marker.is-locked .marker-medallion {
  border-color: #46525c;
  background: #14191f;
  color: #46525c;
  filter: blur(0.4px);
}

.map-marker.is-locked:hover .marker-medallion {
  transform: none;
}

.marker-label {
  position: absolute;
  left: 50%;
  bottom: -2px;
  transform: translateX(-50%);
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mist-dim);
  white-space: nowrap;
}

.map-marker.is-open::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid rgba(224, 179, 74, 0.35);
  animation: marker-ring 2.4s ease-out infinite;
  pointer-events: none;
}
```

Сюда переносятся все состояния маркеров:

- открытые;
- закрытые;
- завершённые;
- активные;
- подписи;
- кольца.

---

## 7.6. `app/packages/ui/src/campaign/05-map-road.css`

```css
/* ============================================================
 * 05-map-road.css
 * Дорога кампании и перелёт Летучего Корабля.
 * ============================================================ */

.map-road .road-seg {
  stroke: rgba(224, 179, 74, 0.18);
  stroke-width: 0.55;
  stroke-dasharray: 1.8 2;
  stroke-linecap: round;
  fill: none;
}

.map-road .road-seg-draw {
  stroke: rgba(224, 179, 74, 0.5);
  stroke-width: 1;
  fill: none;
  stroke-linecap: round;
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  animation: road-draw 900ms var(--pop-ease, cubic-bezier(0.2, 0.9, 0.3, 1)) forwards;
}

.map-road .road-seg-glow {
  stroke: rgba(224, 179, 74, 0.09);
  stroke-width: 1.7;
  stroke-linecap: round;
  fill: none;
}

.ship-marker {
  position: absolute;
  transform: translate(-50%, -50%);
  z-index: 6;
}

.ship-marker::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -7px;
  width: 22px;
  height: 4px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  transform: translateX(-50%);
  filter: blur(1px);
}

.ship-glyph {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid var(--mist-dim);
  color: var(--mist);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
}

.ship-glyph svg {
  display: block;
}

.ship-flight-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 6;
}
```

Сюда переносятся:

- сегменты дороги;
- анимация дорисовки дороги;
- свечение дороги;
- маркер корабля;
- перелёт корабля;
- слой перелёта.

---

## 7.7. `app/packages/ui/src/campaign/06-mission-panel.css`

```css
/* ============================================================
 * 06-mission-panel.css
 * Панель выбранной миссии.
 * ============================================================ */

.mission-panel {
  margin-top: 14px;
}

.mission-card {
  position: relative;
  border: 1px solid var(--line);
  border-left: 3px solid var(--amber);
  background: linear-gradient(180deg, var(--ink-2), var(--ink));
  padding: 16px 18px 18px;
  animation: rise var(--pop-duration, 240ms) var(--pop-ease, ease) both;
}

.mission-card.is-done {
  border-left-color: #5d6b76;
}

.mission-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

.mission-type-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--amber-dim);
  border-radius: 50%;
  color: var(--amber);
  background: radial-gradient(circle at 32% 28%, #2c2a20, #1c1a14);
}

.mission-type-icon.is-destroy {
  color: #d97a4a;
  border-color: rgba(217, 122, 74, 0.55);
  background: radial-gradient(circle at 32% 28%, #33241c, #1c1410);
}

.mission-type-icon.is-rescue {
  color: #d96a6a;
  border-color: rgba(217, 106, 106, 0.55);
  background: radial-gradient(circle at 32% 28%, #33201e, #1c1010);
}

.mission-type-icon.is-recon {
  color: #7ab8d9;
  border-color: rgba(122, 184, 217, 0.55);
  background: radial-gradient(circle at 32% 28%, #1e2c33, #10181c);
}

.mission-card.is-destroy {
  border-top-color: rgba(217, 122, 74, 0.5);
}

.mission-card.is-rescue {
  border-top-color: rgba(217, 106, 106, 0.5);
}

.mission-card.is-recon {
  border-top-color: rgba(122, 184, 217, 0.5);
}

.mission-title {
  margin: 0;
  font-family: Palatino, "Palatino Linotype", serif;
  font-size: 1.35rem;
  color: #f3ecdc;
}

.mission-id {
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mist-dim);
}

.mission-status.done {
  display: inline-block;
  margin: 0 0 10px;
  padding: 2px 8px;
  border: 1px solid #5d6b76;
  color: #8fa1ad;
  font-size: 0.74rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.mission-facts {
  margin: 0 0 14px;
}

.fact-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 5px 0;
}

.fact-row dt {
  color: var(--mist-dim);
  min-width: 136px;
  font-size: 0.88rem;
}

.fact-row dd {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.foe-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  background: var(--ink-3);
  padding: 2px 9px;
  font-size: 0.84rem;
  color: #d8d2c2;
}

.foe-chip::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #7fa857;
}

.foe-chip.upyr::before {
  background: #9aa7b0;
}

.foe-chip.kikimora::before {
  background: #6b9b7a;
}

.darkness-growth {
  display: inline-flex;
  gap: 6px;
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 0.84rem;
}

.growth-victory {
  color: #8fae6b;
  border: 1px solid rgba(143, 174, 107, 0.35);
  padding: 1px 8px;
}

.growth-defeat {
  color: #e07a7a;
  border: 1px solid rgba(224, 122, 122, 0.35);
  padding: 1px 8px;
}

.mission-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.campaign-abandon-btn {
  appearance: none;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--mist);
  padding: 11px 18px;
  font-size: 0.9rem;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.campaign-abandon-btn:hover,
.campaign-abandon-btn:focus-visible {
  border-color: #c45c5c;
  color: #d98080;
  outline: none;
}

.mission-active-note {
  margin: 8px 0 0;
  font-size: 0.8rem;
  color: var(--mist);
  opacity: 0.8;
}

.campaign-start-btn {
  appearance: none;
  border: 1px solid var(--amber-dim);
  background: linear-gradient(180deg, #2c2a20, #201d14);
  color: var(--amber);
  padding: 11px 18px;
  font-size: 0.95rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.12s ease;
}

.campaign-start-btn:hover,
.campaign-start-btn:focus-visible {
  border-color: var(--amber);
  background: linear-gradient(180deg, #383420, #2a2618);
  outline: none;
}

.campaign-start-btn:active {
  transform: translateY(1px);
}

.mission-empty {
  border: 1px dashed var(--line);
  background: var(--ink-2);
  padding: 26px 20px;
  text-align: center;
  color: var(--mist-dim);
}

.mission-empty svg {
  display: block;
  margin: 0 auto 10px;
  color: var(--amber-dim);
}
```

Сюда переносятся все правила панели миссии.

---

## 7.8. `app/packages/ui/src/campaign/07-campaign-tabs.css`

```css
/* ============================================================
 * 07-campaign-tabs.css
 * Вкладки служб корабля.
 * ============================================================ */

.campaign-tabs {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.campaign-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 6px;
  background: var(--ink-2);
  border: 1px solid var(--line);
  color: var(--mist-dim);
  font-size: 0.88rem;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.campaign-tab svg {
  color: var(--mist-dim);
}

.campaign-tab:hover:not(:disabled),
.campaign-tab:focus-visible:not(:disabled) {
  border-color: var(--amber-dim);
  color: var(--mist);
}

.campaign-tab:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.tab-note {
  font-size: 0.66rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #5d6b76;
}

.tab-alert {
  position: absolute;
  top: 4px;
  right: 6px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: #a03a4e;
  color: #f3ecdc;
  font-size: 0.68rem;
  line-height: 18px;
  text-align: center;
}

/* Темизация служб корабля */

.campaign-screen.is-tab-map .map-toolbar,
.campaign-screen.is-tab-map .campaign-map,
.campaign-screen.is-tab-map .panel-head h2 {
  border-color: rgba(224, 179, 74, 0.25);
}

.campaign-screen.is-tab-forge .forge-panel,
.campaign-screen.is-tab-forge .panel-head h2 {
  border-color: rgba(201, 122, 74, 0.45);
}

.campaign-screen.is-tab-forge .panel-head h2 {
  color: #d99a6c;
}

.campaign-screen.is-tab-chamber .roster-panel,
.campaign-screen.is-tab-chamber .panel-head h2 {
  border-color: rgba(143, 184, 99, 0.4);
}

.campaign-screen.is-tab-chamber .panel-head h2 {
  color: #a9cc85;
}

.campaign-screen.is-tab-forge .campaign-tab svg,
.campaign-screen.is-tab-chamber .campaign-tab svg {
  transition: color 0.15s ease;
}
```

Сюда переносятся вкладки и их темизация.

---

## 7.9. `app/packages/ui/src/campaign/08-roster.css`

```css
/* ============================================================
 * 08-roster.css
 * Дружина, Горница, ранения, лечение, уровни.
 * ============================================================ */

.roster-panel {
  border: 1px solid var(--line);
  background: var(--ink-2);
  padding: 16px 16px 14px;
  animation: rise var(--pop-duration, 240ms) var(--pop-ease, ease) both;
}

.panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.panel-head h2 {
  margin: 0;
  font-family: Palatino, "Palatino Linotype", serif;
  font-size: 1.3rem;
  color: #f3ecdc;
}

.fighter-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fighter-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  background: linear-gradient(180deg, var(--ink), #171d23);
  transition: border-color 0.15s ease;
}

.fighter-row.is-wounded {
  border-left: 3px solid #a03a4e;
}

.fighter-row.is-fallen {
  border-color: #2a323b;
  opacity: 0.55;
}

.fighter-row.is-fallen .fighter-face {
  filter: grayscale(1);
  background: #10151a;
}

.fighter-face {
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 1px solid var(--line);
  overflow: hidden;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 32% 28%, var(--ink-3), #161c22);
  color: var(--mist-dim);
}

.fighter-face img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fighter-face svg {
  width: 70%;
  height: 70%;
}

.fighter-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1 1 220px;
}

.fighter-name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #f3ecdc;
}

.fallen-tag,
.wounded-tag {
  font-size: 0.66rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 1px 7px;
  border-radius: 2px;
}

.fallen-tag {
  color: #8fa1ad;
  border: 1px solid #46525c;
}

.wounded-tag {
  color: #e8b4bc;
  border: 1px solid rgba(224, 122, 122, 0.45);
  background: rgba(107, 45, 58, 0.25);
}

.fighter-class {
  font-size: 0.76rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--amber);
}

.fighter-hp {
  font-size: 0.8rem;
  color: var(--mist-dim);
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}

.fighter-level {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: none;
}

.level-pips {
  display: flex;
  gap: 3px;
}

.level-pips i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #46525c;
}

.level-pips i.on {
  background: var(--amber);
}

.level-label {
  font-size: 0.68rem;
  color: var(--mist-dim);
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}

.train-btn {
  flex: none;
  padding: 8px 14px;
  font-size: 0.85rem;
}

.heal-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 0.85rem;
  border-color: rgba(127, 168, 87, 0.5);
  color: #a9c88a;
  background: linear-gradient(180deg, #1f2a1d, #171f15);
}

.heal-btn:hover,
.heal-btn:focus-visible {
  border-color: #7fa857;
  color: #cfe3b4;
}

.fighter-ready {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #14181c;
  background: #5d7d44;
  font-size: 0.72rem;
  font-weight: 700;
}

.train-card {
  width: min(100%, 480px);
}

.class-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
  margin: 16px 0;
}

.class-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  appearance: none;
  border: 1px solid var(--line);
  background: var(--ink-3);
  color: var(--mist);
  padding: 12px 8px 10px;
  cursor: pointer;
  font-size: 0.85rem;
  transition:
    border-color 0.15s ease,
    transform 0.12s ease,
    background 0.15s ease;
}

.class-card:hover,
.class-card:focus-visible {
  border-color: var(--amber);
  background: #2c2a20;
  outline: none;
  transform: translateY(-2px);
}

.class-card img {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--line);
}

.class-card .deploy-face-empty {
  width: 56px;
  height: 56px;
  border-radius: 50%;
}

.heal-all-btn {
  margin-left: auto;
}

.fighter-row.is-wounded .fighter-face {
  box-shadow: 0 0 0 1px rgba(160, 58, 78, 0.45);
}
```

Сюда переносятся все правила дружины, Горницы, лечения, уровней и выбора класса.

---

## 7.10. `app/packages/ui/src/campaign/09-forge.css`

```css
/* ============================================================
 * 09-forge.css
 * Кузня.
 * ============================================================ */

.forge-panel {
  border: 1px solid var(--line);
  background: var(--ink-2);
  padding: 16px;
  animation: rise var(--pop-duration, 240ms) var(--pop-ease, ease) both;
}

.forge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.forge-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--line);
  background: linear-gradient(180deg, var(--ink), #171d23);
  transition:
    border-color 0.15s ease,
    transform 0.12s ease,
    box-shadow 0.15s ease;
}

.forge-card:hover {
  border-color: rgba(224, 179, 74, 0.45);
  transform: translateY(-1px);
}

.forge-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid var(--amber-dim);
  color: var(--amber);
  background: radial-gradient(circle at 32% 28%, #2c2a20, #1c1a14);
}

.forge-card.is-crafted .forge-icon {
  border-color: rgba(127, 168, 87, 0.5);
  color: #7fa857;
  background: radial-gradient(circle at 32% 28%, #1e2a1d, #161f15);
}

.forge-name {
  font-weight: 600;
  color: #f3ecdc;
  font-size: 0.95rem;
}

.forge-effects {
  font-size: 0.8rem;
  color: var(--mist-dim);
  min-height: 2.2em;
}

.forge-cost {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.craft-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  appearance: none;
  border: 1px solid var(--amber-dim);
  background: linear-gradient(180deg, #2c2a20, #201d14);
  color: var(--amber);
  padding: 8px 10px;
  font-size: 0.86rem;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.12s ease;
}

.craft-btn:hover:not(:disabled),
.craft-btn:focus-visible:not(:disabled) {
  border-color: var(--amber);
  background: linear-gradient(180deg, #383420, #2a2618);
  outline: none;
}

.craft-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.crafted-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(127, 168, 87, 0.45);
  color: #a9c88a;
  padding: 8px 10px;
  font-size: 0.82rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.forge-note {
  margin: 14px 0 0;
  color: var(--mist-dim);
  font-size: 0.84rem;
}

.forge-card.is-crafted {
  animation: crafted-in 0.45s ease both;
}

.crafted-tag::before {
  content: "✓";
  font-weight: 700;
}
```

Сюда переносятся все правила Кузни.

---

## 7.11. `app/packages/ui/src/campaign/10-equipment.css`

```css
/* ============================================================
 * 10-equipment.css
 * Снаряжение бойцов.
 * ============================================================ */

.equip-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  border: 1px solid rgba(224, 179, 74, 0.4);
  background: rgba(224, 179, 74, 0.08);
  color: var(--amber);
  padding: 1px 8px;
  font-size: 0.74rem;
  border-radius: 2px;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.equip-chip svg {
  flex: none;
}

.equip-btn {
  position: absolute;
  top: 6px;
  right: 34px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  appearance: none;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--ink-3);
  color: var(--mist-dim);
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    transform 0.12s ease;
}

.equip-btn:hover,
.equip-btn:focus-visible {
  border-color: var(--amber);
  color: var(--amber);
  outline: none;
  transform: scale(1.1);
}

.equip-card {
  width: min(100%, 480px);
  max-height: 82vh;
  overflow-y: auto;
}

.equip-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 14px 0;
}

.equip-empty {
  margin: 6px 0;
}

.equip-item {
  display: flex;
  align-items: center;
  gap: 12px;
  appearance: none;
  border: 1px solid var(--line);
  background: var(--ink-3);
  color: var(--mist);
  padding: 10px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.equip-item:hover:not(.is-taken),
.equip-item:focus-visible:not(.is-taken) {
  border-color: var(--amber);
  background: linear-gradient(180deg, #2c2a20, #201d14);
}

.equip-item.is-taken {
  opacity: 0.45;
  cursor: not-allowed;
}

.equip-item-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--amber-dim);
  color: var(--amber);
}

.equip-item-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.equip-item-name {
  font-weight: 600;
  color: #f3ecdc;
}

.equip-item-effects {
  font-size: 0.78rem;
  color: var(--mist-dim);
}

.equip-item-state {
  flex: none;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mist-dim);
}

.equip-item.is-on .equip-item-state {
  color: var(--amber);
}

.equip-unequip {
  width: 100%;
  appearance: none;
  border: 1px dashed rgba(224, 122, 122, 0.5);
  background: rgba(107, 45, 58, 0.18);
  color: #e8b4bc;
  padding: 9px 12px;
  font-size: 0.86rem;
  cursor: pointer;
  margin-bottom: 8px;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.equip-unequip:hover,
.equip-unequip:focus-visible {
  border-color: #e07a7a;
  background: rgba(107, 45, 58, 0.3);
  outline: none;
}

.deploy-card .equip-btn {
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    transform 0.12s ease,
    box-shadow 0.15s ease;
}

.deploy-card .equip-btn:hover,
.deploy-card .equip-btn:focus-visible {
  box-shadow: 0 0 10px rgba(224, 179, 74, 0.35);
}
```

Сюда переносятся все правила снаряжения.

---

## 7.12. `app/packages/ui/src/campaign/11-deployment.css`

```css
/* ============================================================
 * 11-deployment.css
 * Экран формирования высадки.
 * ============================================================ */

.deployment-screen {
  max-width: 720px;
}

@media (min-width: 1400px) {
  .deployment-screen {
    max-width: 960px;
  }
}

.deployment-head {
  margin-bottom: 20px;
}

.deployment-head .display-title {
  font-size: clamp(2rem, 8vw, 2.6rem);
}

.deployment-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

@media (max-width: 480px) {
  .deployment-grid {
    grid-template-columns: 1fr;
  }

  .deploy-card {
    padding: 10px;
    gap: 10px;
  }
}

.deploy-card {
  position: relative;
  display: flex;
  gap: 12px;
  align-items: center;
  appearance: none;
  border: 1px solid var(--line);
  background: linear-gradient(180deg, var(--ink-2), var(--ink));
  color: var(--mist);
  padding: 12px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    transform 0.12s ease,
    box-shadow 0.15s ease,
    background 0.15s ease;
}

.deploy-card:hover,
.deploy-card:focus-visible {
  border-color: var(--amber-dim);
  outline: none;
  transform: translateY(-1px);
}

.deploy-card.is-picked {
  border-color: var(--amber);
  background: linear-gradient(180deg, #2c2a20, #201d14);
  box-shadow:
    0 0 0 1px rgba(224, 179, 74, 0.35),
    0 6px 18px rgba(0, 0, 0, 0.3);
  animation: rise var(--pop-duration, 240ms) var(--pop-ease, ease) both;
}

.deploy-card.is-wounded {
  border-left: 3px solid #a03a4e;
}

.deploy-face {
  position: relative;
  flex: none;
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: radial-gradient(circle at 32% 28%, var(--ink-3), #161c22);
  overflow: visible;
  color: var(--mist-dim);
}

.deploy-face img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.deploy-face-empty {
  width: 100%;
  height: 100%;
  display: block;
}

.deploy-face svg {
  width: 70%;
  height: 70%;
}

.wound-badge {
  position: absolute;
  right: -4px;
  bottom: -2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #a03a4e;
  border: 2px solid #14181c;
  display: grid;
  place-items: center;
}

.wound-badge::after {
  content: "✚";
  color: #f3ecdc;
  font-size: 0.7rem;
  line-height: 1;
}

.deploy-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.deploy-name {
  font-weight: 600;
  color: #f3ecdc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deploy-class {
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--amber);
}

.deploy-hp {
  font-size: 0.8rem;
  color: var(--mist-dim);
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}

.deploy-wound-note {
  font-size: 0.72rem;
  color: #e07a7a;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.pick-mark {
  position: absolute;
  top: 6px;
  right: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  font-size: 0.72rem;
  color: transparent;
  transition:
    color 0.12s ease,
    background 0.12s ease,
    border-color 0.12s ease;
}

.deploy-card.is-picked .pick-mark {
  color: var(--ink);
  background: var(--amber);
  border-color: var(--amber);
}

.deployment-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 18px;
}

.deployment-count {
  margin: 0;
  color: var(--mist-dim);
  font-size: 0.9rem;
}

.deployment-actions {
  display: flex;
  gap: 10px;
  margin-left: auto;
}

.deploy-confirm {
  min-width: 150px;
  justify-content: center;
}

.deploy-confirm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
```

Сюда переносятся все правила экрана высадки.

---

## 7.13. `app/packages/ui/src/campaign/12-pvp.css`

```css
/* ============================================================
 * 12-pvp.css
 * Поочерёдная игра, PvP, драфт.
 * ============================================================ */

.pvp-room-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 28px 20px;
}

.pvp-arena {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  justify-content: center;
}

.pvp-side-card {
  min-width: 260px;
  padding: 16px;
  border: 1px solid rgba(120, 140, 160, 0.28);
  border-radius: 8px;
  background: rgba(12, 16, 12, 0.6);
  animation: pvp-side-in 420ms ease-out both;
}

.pvp-side-card.is-side1 {
  border-top: 3px solid #e0b34a;
  animation-delay: 60ms;
}

.pvp-side-card.is-side2 {
  border-top: 3px solid #6aa9d9;
  animation-delay: 120ms;
}

.is-side1 .pvp-side-title {
  color: var(--amber, #e0b34a);
}

.is-side2 .pvp-side-title {
  color: #6aa9d9;
}

.pvp-roster {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pvp-slot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  transition:
    transform 160ms ease,
    background 160ms ease;
}

.pvp-slot:hover {
  transform: translateX(3px);
  background: rgba(255, 255, 255, 0.07);
}

.pvp-slot-face {
  width: 34px;
  height: 34px;
  border-radius: 4px;
}

.pvp-options {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  justify-content: center;
  width: 100%;
  max-width: 640px;
}

.pvp-option-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pvp-option-title {
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #9aa39a;
}

.pvp-radio {
  padding: 6px 14px;
  border: 1px solid rgba(120, 140, 160, 0.3);
  border-radius: 4px;
  background: rgba(12, 16, 12, 0.55);
  color: #c9c2b2;
  font-size: 0.82rem;
  cursor: pointer;
}

.pvp-check input {
  accent-color: #e0b34a;
}

.draft {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 640px;
}

.draft-status {
  display: flex;
  align-items: center;
  gap: 14px;
}

.draft-side {
  padding: 6px 16px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  transition: all 200ms ease;
}

.draft-side.is-side1 {
  color: var(--amber, #e0b34a);
}

.draft-side.is-side2 {
  color: #6aa9d9;
}

.draft-side.is-current {
  border-color: rgba(224, 179, 74, 0.7);
  box-shadow: 0 0 14px rgba(224, 179, 74, 0.35);
  animation: draft-glow 1.6s ease-in-out infinite;
}

.draft-side.is-full {
  border-color: rgba(120, 190, 130, 0.5);
  color: #8fd89a;
}

.draft-vs {
  color: #8fa1ad;
}

.draft-hint {
  margin: 0;
  color: #c9c2b2;
  font-size: 0.85rem;
}

.draft-done {
  margin: 0;
  color: #8fd89a;
  font-size: 0.9rem;
  animation: net-ok 300ms ease-out;
}

.draft-pool {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
  width: 100%;
}

.draft-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 8px;
  border: 1px solid rgba(120, 140, 160, 0.25);
  border-radius: 8px;
  background: rgba(12, 16, 12, 0.55);
  cursor: pointer;
  transition: all 180ms ease;
}

.draft-card:hover:not(:disabled) {
  transform: translateY(-3px);
  border-color: rgba(224, 179, 74, 0.6);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}

.draft-card:disabled {
  cursor: default;
}

.draft-card.is-taken {
  opacity: 0.4;
  border-style: dashed;
}

.draft-face {
  width: 52px;
  height: 52px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.15);
}

.draft-name {
  font-size: 0.78rem;
  color: #e8e2d4;
  text-align: center;
}

.draft-taken-mark {
  position: absolute;
  top: 6px;
  right: 8px;
  color: #8fd89a;
  font-weight: 700;
}

.pvp-start-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.spectator-bar {
  display: flex;
  align-items: center;
  justify-content: center;
}

.spectator-note {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: #8fa1ad;
  letter-spacing: 0.06em;
}

.spectator-eye {
  color: #6aa9d9;
  animation: eye-blink 2.4s ease-in-out infinite;
}
```

Сюда переносятся все PvP-правила.

---

## 7.14. `app/packages/ui/src/campaign/13-net.css`

```css
/* ============================================================
 * 13-net.css
 * Сетевые панели, коды, подключения, ошибки.
 * ============================================================ */

.pvp-tabs,
.net-role-switch {
  display: flex;
  gap: 8px;
  margin: 6px 0 4px;
}

.pvp-tab {
  padding: 8px 18px;
  border: 1px solid rgba(120, 140, 160, 0.28);
  border-radius: 4px;
  background: rgba(12, 16, 12, 0.55);
  color: #9aa39a;
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: all 180ms ease;
}

.pvp-tab:hover {
  color: #e8e2d4;
  border-color: rgba(224, 179, 74, 0.5);
}

.pvp-tab.is-active {
  color: var(--amber, #e0b34a);
  border-color: rgba(224, 179, 74, 0.65);
  background: rgba(58, 49, 32, 0.5);
  box-shadow: inset 0 -2px 0 rgba(224, 179, 74, 0.7);
}

.net-setup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: 100%;
  max-width: 560px;
}

.net-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 18px;
  border: 1px solid rgba(120, 140, 160, 0.22);
  border-radius: 8px;
  background: rgba(12, 16, 12, 0.5);
  animation: net-panel-in 300ms ease-out;
}

.net-code-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 14px;
  border: 1px dashed rgba(224, 179, 74, 0.45);
  border-radius: 8px;
  background: rgba(224, 179, 74, 0.05);
}

.net-qr {
  width: 160px;
  height: 160px;
  border-radius: 6px;
  image-rendering: pixelated;
  box-shadow: 0 0 24px rgba(224, 179, 74, 0.25);
  animation: qr-in 400ms ease-out;
}

.net-code {
  max-width: 100%;
  word-break: break-all;
  font-family: monospace;
  font-size: 0.72rem;
  color: #e8cf9a;
  background: rgba(0, 0, 0, 0.35);
  padding: 8px 10px;
  border-radius: 4px;
}

.net-input-label {
  align-self: flex-start;
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  color: #9aa39a;
  text-transform: uppercase;
}

.net-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgba(120, 140, 160, 0.3);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.35);
  color: #f3ecdc;
  font-family: monospace;
  font-size: 0.8rem;
  transition: border-color 180ms ease;
}

.net-input:focus {
  outline: none;
  border-color: rgba(224, 179, 74, 0.7);
}

.net-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
}

.net-connected {
  color: #8fd89a;
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  animation: net-ok 300ms ease-out;
}

.net-error {
  color: #e07a6a;
  font-size: 0.85rem;
  border-left: 2px solid #e07a6a;
  padding-left: 10px;
  animation: net-err 240ms ease-out;
}

.net-lost-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
  flex-wrap: wrap;
  justify-content: center;
}
```

Сюда переносятся все сетевые правила.

---

## 7.15. `app/packages/ui/src/campaign/14-replay.css`

```css
/* ============================================================
 * 14-replay.css
 * Повторы.
 * ============================================================ */

.replay-screen {
  gap: 16px;
}

.replay-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 560px;
}

.replay-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 16px;
  border: 1px solid rgba(120, 140, 160, 0.22);
  border-radius: 8px;
  background: rgba(12, 16, 12, 0.55);
  transition:
    border-color 180ms ease,
    transform 180ms ease;
}

.replay-row:hover {
  border-color: rgba(106, 169, 217, 0.5);
  transform: translateX(3px);
}

.replay-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.replay-title {
  color: #e8e2d4;
  font-size: 0.92rem;
  display: flex;
  align-items: center;
  gap: 8px;
}

.replay-badge {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid currentColor;
  white-space: nowrap;
}

.replay-badge-warn {
  color: var(--amber, #e0b34a);
}

.replay-badge-off {
  color: #c9807a;
}

.replay-actions {
  display: flex;
  gap: 8px;
}

.replay-progress {
  height: 10px;
  border-radius: 3px;
  overflow: hidden;
}

.replay-progress i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #4a8fc9, #6aa9d9);
  transition: width 200ms linear;
}

.replay-done {
  color: #8fd89a;
  font-size: 0.8rem;
  animation: net-ok 300ms ease-out;
}
```

Сюда переносятся все правила повторов.

---

## 7.16. `app/packages/ui/src/campaign/15-training.css`

```css
/* ============================================================
 * 15-training.css
 * Обучение: экран, карточки, наставник, подсказки, прогресс.
 * ============================================================ */

.training-screen {
  gap: 18px;
}

.training-mentor-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding: 10px 14px;
  max-width: 560px;
  border: 1px solid rgba(224, 179, 74, 0.35);
  border-radius: 10px;
  background: rgba(12, 16, 12, 0.55);
  text-align: left;
}

.training-mentor-row .training-mentor-face {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 1px solid rgba(224, 179, 74, 0.5);
  object-fit: cover;
  flex: none;
}

.training-mentor-row .training-mentor-line {
  color: #d8d2c2;
  font-size: 0.92rem;
  line-height: 1.4;
}

.training-mentor-row b {
  color: var(--amber, #e0b34a);
  font-weight: 600;
}

.training-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
  width: 100%;
  max-width: 720px;
}

.training-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 16px;
  border: 1px solid rgba(120, 140, 160, 0.28);
  border-radius: 10px;
  background: rgba(12, 16, 12, 0.6);
  color: inherit;
  cursor: pointer;
  text-align: center;
  transition: all 220ms ease;
  animation: training-card-in 420ms ease-out both;
}

.training-card:nth-child(2) {
  animation-delay: 90ms;
}

.training-card:nth-child(3) {
  animation-delay: 180ms;
}

.training-card-icon {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 1px solid rgba(224, 179, 74, 0.5);
  color: var(--amber, #e0b34a);
  background: radial-gradient(circle at 32% 28%, #3a3120, #241d12);
}

.training-card.is-done .training-card-icon {
  border-color: rgba(120, 190, 130, 0.5);
  color: #8fd89a;
}

.training-card-index {
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8fa1ad;
}

.training-card-title {
  font-family: Palatino, "Palatino Linotype", serif;
  font-size: 1.15rem;
  color: #f3ecdc;
}

.training-card-desc {
  font-size: 0.82rem;
  color: #9aa39a;
  line-height: 1.45;
}

.training-card-footer {
  margin-top: 4px;
}

.training-start {
  color: var(--amber, #e0b34a);
  font-size: 0.85rem;
  letter-spacing: 0.06em;
}

.training-done-mark {
  color: #8fd89a;
  font-size: 0.85rem;
}

.training-all-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  max-width: 560px;
  padding: 16px 20px;
  border: 1px solid rgba(140, 200, 150, 0.45);
  border-radius: 10px;
  background: rgba(16, 30, 20, 0.5);
  text-align: center;
  animation: training-card-in 420ms ease-out both;
}

.training-all-done-title {
  margin: 0;
  color: #cfe8c0;
  font-size: 1.05rem;
  font-weight: 600;
}

.training-all-done .btn {
  margin-top: 6px;
}

.training-coach {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid rgba(224, 179, 74, 0.35);
  border-radius: 10px;
  background: rgba(12, 16, 12, 0.55);
}

.training-coach-face {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 1px solid rgba(224, 179, 74, 0.5);
  object-fit: cover;
  flex: none;
}

.training-coach-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1 1 auto;
}

.training-coach-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.training-coach-name {
  color: var(--amber, #e0b34a);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 600;
}

.training-coach-line {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.4;
  color: #d8d2c2;
}

.training-step-dots {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: 8px;
  max-width: 72px;
  pointer-events: none;
}

.training-step-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(120, 140, 160, 0.35);
  transition:
    background 200ms ease,
    transform 200ms ease;
}

.training-step-dot.is-done {
  background: rgba(150, 200, 150, 0.8);
}

.training-step-dot.is-current {
  background: var(--amber, #e0b34a);
  transform: scale(1.3);
}

.training-note {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(16, 22, 16, 0.94);
  border: 1px solid rgba(224, 179, 74, 0.55);
  border-radius: 8px;
  color: #f3ecdc;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  z-index: 71;
  pointer-events: none;
  animation: hint-in var(--pop-duration, 240ms) var(--pop-ease, ease-out);
}

.training-note-mark {
  color: var(--amber, #e0b34a);
  flex: none;
}

.training-skip {
  flex: none;
  margin-left: 6px;
  padding: 3px 10px;
  border: 1px solid rgba(120, 140, 160, 0.4);
  border-radius: 10px;
  background: rgba(28, 35, 32, 0.9);
  color: #c9c2b0;
  font-size: 0.75rem;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    color 160ms ease;
}
```

Сюда переносятся все правила обучения.

---

## 7.17. `app/packages/ui/src/campaign/16-campaign-hints.css`

```css
/* ============================================================
 * 16-campaign-hints.css
 * Кампейн-подсказки и сюжетные карточки.
 * ============================================================ */

.campaign-hint-card {
  border-color: rgba(224, 179, 74, 0.5);
  animation: campaign-hint-in 320ms ease-out both;
}

.campaign-hint-body {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  text-align: left;
}

.campaign-hint-face {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 2px solid rgba(224, 179, 74, 0.55);
  object-fit: cover;
  flex: none;
  box-shadow: 0 0 0 3px rgba(224, 179, 74, 0.12);
}

.campaign-hint-meta h2 {
  font-size: 1.05rem;
  line-height: 1.25;
}

.campaign-hint-meta .muted {
  margin: 4px 0 0;
  font-size: 0.88rem;
  line-height: 1.45;
}

.campaign-hint-banner {
  position: absolute;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  width: min(92%, 620px);
  padding: 10px 12px 10px 10px;
  background: rgba(16, 22, 16, 0.94);
  border: 1px solid rgba(224, 179, 74, 0.55);
  border-radius: 8px;
  color: #f3ecdc;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  z-index: 72;
  animation: campaign-hint-in-banner 320ms ease-out both;
  pointer-events: auto;
}

.campaign-hint-banner .campaign-hint-body {
  flex: 1;
  min-width: 0;
}

.campaign-hint-banner .campaign-hint-face {
  width: 52px;
  height: 52px;
}

.campaign-hint-banner .campaign-hint-meta h2 {
  font-size: 0.98rem;
}

.campaign-hint-banner .campaign-hint-meta .muted {
  font-size: 0.84rem;
}

.campaign-hint-banner .hud-btn {
  flex: none;
  margin-top: 0;
  width: auto;
  padding: 8px 14px;
}

.story-note-card {
  border-color: rgba(224, 179, 74, 0.45);
  animation: story-note-in 220ms ease-out both;
}

.story-note-text {
  margin: 0 0 4px;
  color: #f3ecdc;
  font-size: 0.98rem;
  line-height: 1.45;
  text-wrap: balance;
}
```

Сюда переносятся все правила подсказок.

---

## 7.18. `app/packages/ui/src/campaign/17-result.css`

```css
/* ============================================================
 * 17-result.css
 * Итог миссии и результаты дружины.
 * ============================================================ */

.mission-result-screen {
  max-width: 480px;
  align-items: center;
  text-align: center;
}

@media (min-width: 1400px) {
  .mission-result-screen {
    max-width: 560px;
  }
}

.result-emblem {
  width: 96px;
  height: 96px;
  margin: 0 auto 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
}

.result-emblem.is-victory {
  border: 2px solid var(--amber);
  background: radial-gradient(circle at 34% 30%, #3a3120, #1d1a12);
  color: var(--amber);
  box-shadow: 0 0 34px rgba(224, 179, 74, 0.22);
  animation: rise var(--pop-duration, 240ms) var(--pop-ease, ease) both;
}

.result-emblem.is-defeat {
  border: 2px solid #6b2d3a;
  background: radial-gradient(circle at 34% 30%, #2a1d22, #171114);
  color: #c96a7a;
  box-shadow: 0 0 26px rgba(107, 45, 58, 0.25);
  animation: rise var(--pop-duration, 240ms) var(--pop-ease, ease) both;
}

.mission-result-screen .eyebrow {
  margin-bottom: 4px;
}

.mission-result-screen .menu-brand {
  margin-bottom: 0;
}

.mission-result-screen .display-title {
  font-size: clamp(2rem, 8vw, 2.8rem);
}

.mission-result-screen .menu-nav {
  width: 100%;
  margin-top: 26px;
}

.darkness-summary {
  margin-top: 18px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  background: var(--ink-2);
  text-align: left;
}

.darkness-summary .summary-line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.86rem;
  color: var(--mist-dim);
  margin-bottom: 8px;
}

.darkness-summary .summary-line b {
  color: #e07a7a;
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-weight: 600;
}

.darkness-summary .darkness-bar {
  display: block;
  width: 100%;
}

.darkness-summary .darkness-bar i {
  background: linear-gradient(90deg, #4a2530, #7a3242);
}

.darkness-summary .darkness-bar b {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  display: block;
  background: linear-gradient(90deg, #a03a4e, #c14a60);
  animation: gain-grow 0.7s ease both;
}

.loss-banner {
  margin-top: 16px;
  border: 1px solid rgba(224, 122, 122, 0.5);
  background: linear-gradient(180deg, rgba(107, 45, 58, 0.28), rgba(107, 45, 58, 0.12));
  color: #e8b4bc;
  padding: 12px 14px;
  font-size: 0.92rem;
}

.campaign-lost-card {
  border: 1px solid rgba(224, 122, 122, 0.45);
}

.campaign-lost-card h2 {
  color: #e8b4bc;
}

.rewards-strip {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px solid rgba(127, 168, 87, 0.35);
  background: linear-gradient(180deg, rgba(31, 42, 29, 0.55), rgba(23, 31, 21, 0.4));
  animation: rise var(--pop-duration, 240ms) var(--pop-ease, ease) both;
}

.rewards-title {
  font-size: 0.76rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #a9c88a;
}

.reward-gain {
  animation: reward-pop 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.4) both;
}

.reward-gain:nth-child(3) {
  animation-delay: 0.1s;
}

.reward-gain:nth-child(4) {
  animation-delay: 0.2s;
}

.roster-outcomes {
  width: 100%;
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.outcome-group {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  background: var(--ink-2);
  text-align: left;
  animation: rise var(--pop-duration, 240ms) var(--pop-ease, ease) both;
}

.outcome-icon {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  color: var(--mist-dim);
}

.outcome-group.is-fallen .outcome-icon {
  color: #8fa1ad;
}

.outcome-group.is-wounded .outcome-icon {
  color: #e07a7a;
  border-color: rgba(224, 122, 122, 0.45);
}

.outcome-group.is-level .outcome-icon {
  color: var(--amber);
  border-color: var(--amber-dim);
}

.outcome-group.is-recruit .outcome-icon {
  color: #9b6bbf;
  border-color: rgba(155, 107, 191, 0.45);
  font-size: 0.9rem;
}

.outcome-title {
  margin: 0;
  font-size: 0.78rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mist-dim);
}

.outcome-names {
  margin: 2px 0 0;
  color: #f3ecdc;
  font-size: 0.95rem;
}
```

Сюда переносятся все правила итога миссии.

---

## 7.19. `app/packages/ui/src/campaign/18-keyframes.css`

```css
/* ============================================================
 * 18-keyframes.css
 * Анимации кампании и связанных экранов.
 * ============================================================ */

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes marker-ring {
  0% {
    transform: scale(0.7);
    opacity: 0.9;
  }
  70% {
    transform: scale(1.7);
    opacity: 0;
  }
  100% {
    transform: scale(1.7);
    opacity: 0;
  }
}

@keyframes road-draw {
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes pvp-side-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes draft-glow {
  0%,
  100% {
    box-shadow: 0 0 6px rgba(224, 179, 74, 0.25);
  }
  50% {
    box-shadow: 0 0 16px rgba(224, 179, 74, 0.5);
  }
}

@keyframes net-panel-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes qr-in {
  from {
    opacity: 0;
    transform: scale(0.85);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes net-ok {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes net-err {
  from {
    opacity: 0;
    transform: translateX(-6px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes eye-blink {
  0%,
  92%,
  100% {
    opacity: 1;
  }
  96% {
    opacity: 0.3;
  }
}

@keyframes training-card-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes hint-in {
  from {
    opacity: 0;
    transform: translate(-50%, 8px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

@keyframes campaign-hint-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes campaign-hint-in-banner {
  from {
    opacity: 0;
    transform: translate(-50%, -8px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

@keyframes story-note-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes gain-grow {
  from {
    width: 0;
  }
}

@keyframes crafted-in {
  0% {
    transform: scale(0.96);
    box-shadow: 0 0 0 0 rgba(127, 168, 87, 0.6);
  }
  55% {
    transform: scale(1.02);
    box-shadow: 0 0 0 8px rgba(127, 168, 87, 0);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes radar-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes reward-pop {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

В этот файл переносятся все `@keyframes`, которые относятся к кампании и связанным экранам.

Важно: если в исходном файле есть другие анимации с теми же именами, их нужно сохранить и не переименовывать.

---

## 7.20. `app/packages/ui/src/campaign/19-responsive.css`

```css
/* ============================================================
 * 19-responsive.css
 * Адаптивные правила, которые относятся к кампании и связанным экранам.
 * ============================================================ */

/*
 * Сюда переносятся все медиа-запросы, которые в старом файле идут
 * отдельно в конце и переопределяют уже описанные выше компоненты.
 *
 * Важно: правила внутри этого файла должны сохранить исходный порядок.
 */

@media (max-width: 480px) {
  .deployment-grid {
    grid-template-columns: 1fr;
  }

  .deploy-card {
    padding: 10px;
    gap: 10px;
  }
}

/* Ниже добавляются остальные медиа-правила из старого файла. */
```

Если в старом файле адаптивные правила принадлежат конкретному компоненту и стоят рядом с ним, лучше оставить их в файле компонента.

В `19-responsive.css` нужно выносить только глобальные адаптивные блоки, которые в исходном файле находятся отдельно в конце.

---

## 7.21. `app/packages/ui/src/campaign/20-reduced-motion.css`

```css
/* ============================================================
 * 20-reduced-motion.css
 * Уменьшение движения.
 * Этот файл должен подключаться последним.
 * ============================================================ */

@media (prefers-reduced-motion: reduce) {
  .map-fog,
  .ship-marker,
  .map-marker.is-open .marker-medallion,
  .mission-card,
  .result-emblem,
  .darkness-summary .darkness-bar b,
  .deployment-grid .deploy-card,
  .roster-outcomes .outcome-group,
  .wound-badge,
  .campaign-tab.is-active .tab-alert,
  .forge-card.is-crafted,
  .scan-btn svg {
    animation: none !important;
    transition: none !important;
  }

  .ship-flight-layer {
    display: none;
  }

  .ship-marker.is-flying,
  .campaign-map.is-flying .ship-marker {
    animation: none;
    left: var(--ship-to-x);
    top: var(--ship-to-y);
    transform: translate(-50%, -50%);
  }
}
```

Этот файл должен быть последним в списке импортов, если в исходном файле `prefers-reduced-motion` находился в конце.

---

# 8. Карта переноса

Чтобы ничего не потерять, используйте следующую карту.

| Старый блок | Новый файл |
|---|---|
| `.campaign-screen` | `campaign/00-screen.css` |
| `.campaign-top`, `.campaign-exit-btn`, `.campaign-title-block` | `campaign/01-top.css` |
| `.campaign-darkness`, `.darkness-bar`, `.campaign-resources`, `.resource` | `campaign/02-darkness-resources.css` |
| `.campaign-map`, `.map-terrain`, `.map-fog` | `campaign/03-map.css` |
| `.map-marker`, `.marker-medallion`, `.marker-label` | `campaign/04-map-markers.css` |
| `.map-road`, `.road-seg`, `.ship-marker`, `.ship-flight-layer` | `campaign/05-map-road.css` |
| `.mission-panel`, `.mission-card`, `.mission-head`, `.mission-actions` | `campaign/06-mission-panel.css` |
| `.campaign-tabs`, `.campaign-tab`, `.tab-note`, `.tab-alert` | `campaign/07-campaign-tabs.css` |
| `.roster-panel`, `.fighter-row`, `.fighter-face`, `.class-card` | `campaign/08-roster.css` |
| `.forge-panel`, `.forge-card`, `.craft-btn`, `.crafted-tag` | `campaign/09-forge.css` |
| `.equip-chip`, `.equip-btn`, `.equip-card`, `.equip-item` | `campaign/10-equipment.css` |
| `.deployment-screen`, `.deploy-card`, `.deploy-face`, `.deployment-foot` | `campaign/11-deployment.css` |
| `.pvp-room-screen`, `.pvp-side-card`, `.draft`, `.spectator-bar` | `campaign/12-pvp.css` |
| `.net-setup`, `.net-panel`, `.net-code-box`, `.net-input` | `campaign/13-net.css` |
| `.replay-screen`, `.replay-list`, `.replay-row`, `.replay-badge` | `campaign/14-replay.css` |
| `.training-screen`, `.training-card`, `.training-coach`, `.training-note` | `campaign/15-training.css` |
| `.campaign-hint-card`, `.campaign-hint-banner`, `.story-note-card` | `campaign/16-campaign-hints.css` |
| `.mission-result-screen`, `.result-emblem`, `.roster-outcomes` | `campaign/17-result.css` |
| `@keyframes` | `campaign/18-keyframes.css` |
| глобальные `@media`-адаптивности | `campaign/19-responsive.css` |
| `@media (prefers-reduced-motion: reduce)` | `campaign/20-reduced-motion.css` |

---

# 9. Что нельзя делать при этом рефакторинге

Нельзя:

1. Переименовывать классы.
2. Удалять комментарии версий.
3. Менять `z-index`.
4. Менять порядок `@import`.
5. Менять порядок `@media`, если они стоят в конце файла.
6. Объединять селекторы, если раньше они были раздельными.
7. Разделять селекторы, если раньше они были объединены.
8. Заменять цвета на CSS-переменные без явной необходимости.
9. Добавлять новые `!important`.
10. Убирать `!important`, если он уже есть в исходных правилах.
11. Переносить `prefers-reduced-motion` выше по каскаду без проверки.
12. Менять имена `@keyframes`.

---

# 10. Проверка после рефакторинга

После переноса выполнить:

```bash
pnpm exec prettier --write \
  app/packages/ui/src/campaign.css \
  app/packages/ui/src/campaign/*.css
```

Затем:

```bash
pnpm -F ui build
pnpm -F ui test
```

Если в CI есть отдельные проверки форматирования, выполнить:

```bash
pnpm format:check
```

или эквивалент.

Проверить размер:

```bash
wc -l app/packages/ui/src/campaign.css
wc -l app/packages/ui/src/campaign/*.css
```

Ожидаемый результат:

```text
app/packages/ui/src/campaign.css < 1000 строк
```

Фактически итоговый `campaign.css` будет около 20–30 строк.

---

# 11. Требования к финальному состоянию

После рефакторинга должно быть выполнено:

1. `campaign.css` остаётся единственной точкой входа.
2. `campaign.css` содержит только `@import` и, при необходимости, краткий комментарий.
3. Все стили кампании разнесены по файлам в `campaign/`.
4. Каждый файл отвечает за одну предметную область.
5. Порядок подключений повторяет исходный каскад.
6. Все анимации сохранены.
7. Все `prefers-reduced-motion` сохранены.
8. Форматирование выполнено с шириной строки 120.
9. Сборка проходит.
10. Тесты проходят.
11. Визуальные экраны не изменились.

---

# 12. Рекомендуемый формат коммитов

Лучше разбить работу на несколько атомарных коммитов:

```text
style(ui): create campaign css module folder
style(ui): extract campaign screen and top styles
style(ui): extract darkness and resource styles
style(ui): extract campaign map styles
style(ui): extract map markers and road styles
style(ui): extract mission panel styles
style(ui): extract campaign tabs styles
style(ui): extract roster and forge styles
style(ui): extract deployment and pvp styles
style(ui): extract replay, training and hints styles
style(ui): extract result and keyframes styles
style(ui): make campaign.css an import entry point
```

Каждый коммит должен оставлять проект рабочим.

---

# 13. Главный принцип итогового состояния

После рефакторинга:

```text
campaign.css — точка входа.
campaign/*.css — предметные модули.
```

Стили становятся читаемыми и сопровождаемыми:

- экран;
- шапка;
- Тьма и ресурсы;
- карта;
- маркеры;
- дорога;
- миссия;
- вкладки;
- дружина;
- Кузня;
- снаряжение;
- высадка;
- PvP;
- сеть;
- повторы;
- обучение;
- подсказки;
- итог;
- анимации;
- адаптивность;
- снижение движения.

При этом публичный импорт остаётся прежним:

```ts
import "./campaign.css";
```

и ни один потребитель кода не должен знать о внутренней разбивке.