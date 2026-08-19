export const CORE_VERSION = "0.1.0";

/**
 * Пустое тактическое ядро выпуска 0.1.0.
 * Правила сетки и боя появляются в версии 0.2.0.
 * Пакет не обращается к DOM, сети и интерфейсу.
 */
export interface TacticsKernel {
  readonly version: string;
}

export function createTacticsKernel(): TacticsKernel {
  return { version: CORE_VERSION };
}
