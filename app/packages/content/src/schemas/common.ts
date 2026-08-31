/** Общие проверки полей: идентификатор, длительность, состояние (0.20.56). */

import { z } from "zod";

export const id = z.string().regex(/^[a-z0-9_]+$/);
export const positiveDuration = z.number().int().min(1);
export const statusId = z.enum(["poison", "panic", "immobile", "hidden", "flying", "timed"]);
