export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante?: number;
  durationMinutes: number;
}

export function normalizeBlindSchedule(levels: BlindLevel[]): BlindLevel[] {
  if (levels.length === 0) {
    throw new Error("Blind schedule must contain at least one level.");
  }

  return [...levels]
    .sort((left, right) => left.level - right.level)
    .map((level) => {
      if (level.smallBlind <= 0 || level.bigBlind <= 0) {
        throw new Error("Blind amounts must be positive integers.");
      }

      if (level.smallBlind >= level.bigBlind) {
        throw new Error("Big blind must be greater than the small blind.");
      }

      if (level.durationMinutes <= 0) {
        throw new Error("Blind level duration must be greater than zero.");
      }

      return {
        ...level,
        ante: level.ante ?? 0,
      };
    });
}

export function getBlindLevelAtElapsedMinutes(levels: BlindLevel[], elapsedMinutes: number): BlindLevel {
  const schedule = normalizeBlindSchedule(levels);
  let elapsed = Math.max(0, elapsedMinutes);

  for (const level of schedule) {
    if (elapsed < level.durationMinutes) {
      return level;
    }

    elapsed -= level.durationMinutes;
  }

  return schedule.at(-1)!;
}
