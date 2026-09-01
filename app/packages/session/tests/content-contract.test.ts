/**
 * День 14 (0.21.13, Major-9): контрактные проверки на этапе компиляции —
 * zod-схемы контента и типы ядра не должны расходиться молча.
 *
 * Сценарии обученного противника описаны в контенте (слой 1) и проверяются
 * zod при загрузке, а исполняет их ядро (слой 2) по своим типам. Раньше
 * поле могло появиться в схеме, но не в типе (или наоборот), и расход
 * обнаруживался бы только в бою. Здесь типы сверяются двусторонней
 * присваиваемостью: лишнее поле в одной из сторон, сдвиг опциональности или
 * расхождение строкового перечисления — ошибка компиляции, а не молчаливый
 * сдвиг поведения.
 *
 * Тест живёт в пакете сессии: его тесты уже импортируют все слои
 * (пролог, QA), а ограничения dependency-cruiser распространяются на src.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { TrainingEnemyAction, TrainingEnemyScript } from "@bylina/core";
import { trainingEnemyActionSchema, trainingEnemyScriptSchema } from "@bylina/content";

type ActionFromSchema = z.infer<typeof trainingEnemyActionSchema>;
type ScriptFromSchema = z.infer<typeof trainingEnemyScriptSchema>;

describe("контракт схемы контента и типов ядра (обучение)", () => {
  it("TrainingEnemyAction: поля, опциональность и перечисления совпадают со схемой", () => {
    // Двусторонняя присваиваемость: схема → ядро (исполняется распарсенное
    // контент-значение) и ядро → схема (у типа ядра нет полей, о которых
    // схема не знает). Любое расхождение — ошибка компиляции на этих строках.
    const schemaToCore: (value: ActionFromSchema) => TrainingEnemyAction = (value) => value;
    const coreToSchema: (value: TrainingEnemyAction) => ActionFromSchema = (value) => value;
    expect(typeof schemaToCore === "function" && typeof coreToSchema === "function").toBe(true);
  });

  it("TrainingEnemyScript: распарсенный схемой сценарий валиден для ядра", () => {
    // Схема требует priority/actions (контент обязан их задать), тип ядра
    // читает их через `?? []`. Значение со схемы всегда проходит в ядро…
    const schemaToCore: (value: ScriptFromSchema) => TrainingEnemyScript = (value) => value;
    // …а поля, которые ядро ждёт опциональными, присутствуют в схеме.
    const coreFieldsCovered: (
      value: ScriptFromSchema,
    ) => Required<Pick<TrainingEnemyScript, "priority" | "actions">> = (value) => value;
    expect(typeof schemaToCore === "function" && typeof coreFieldsCovered === "function").toBe(true);
  });

  it("перечисления kind/onlyIf включают все ветки, исполняемые ядром", () => {
    // «Дальние» значения union: воскрешение по трупу и маркер конца хода.
    const action: ActionFromSchema = { kind: "resurrect", unitId: "nava", corpseUnitId: "rat", onlyIf: "corpseExists" };
    const endTurn: ActionFromSchema = { kind: "endTurn" };
    const coreView: TrainingEnemyAction = action;
    const coreEndTurn: TrainingEnemyAction = endTurn;
    expect(coreView.kind).toBe("resurrect");
    expect(coreEndTurn.kind).toBe("endTurn");
  });
});
