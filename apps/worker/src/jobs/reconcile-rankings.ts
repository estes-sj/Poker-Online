export interface RankingDelta {
  accountId: string;
  totalProfit: number;
  gamesPlayed: number;
}

export interface ReconciliationSummary {
  scannedAccounts: number;
  updatedAccounts: number;
  generatedAt: string;
}

export class RankingReconciliationJob {
  async run(deltas: RankingDelta[] = []): Promise<ReconciliationSummary> {
    const changedAccounts = deltas.filter((delta) => delta.totalProfit !== 0 || delta.gamesPlayed !== 0);

    return {
      scannedAccounts: deltas.length,
      updatedAccounts: changedAccounts.length,
      generatedAt: new Date().toISOString(),
    };
  }
}
