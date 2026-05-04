import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { ClubRole, RankingScope, type Prisma, type PrismaClient } from "@prisma/client";
import XLSX from "xlsx";

import { disconnectPrisma, prisma } from "../../../../packages/db/src/index.js";
import { getRoomCreationAdminConfig } from "../../../../packages/db/src/room-creation-policy.js";
import { hashSecret } from "../runtime/passwords.js";

const CLUB_IMPORT_EMAIL_DOMAIN = "club-import.local";
const DEFAULT_CLUB_NAME = "Flushers";
const DEFAULT_FILE_PATH = "/opt/.poker/Poker Ledger.xlsx";
const DEFAULT_CLUB_SLUG = "flushers";
const HEADER_SCAN_LIMIT = 25;

const NAME_HEADERS = new Set([
  "name",
  "player",
  "playername",
  "member",
  "membername",
  "username",
]);

const PROFIT_HEADERS = new Set([
  "net",
  "netprofit",
  "netresult",
  "profit",
  "total",
  "totalprofit",
  "winnings",
  "winloss",
  "wonlost",
  "result",
  "pnl",
  "plusminus",
]);

const GAMES_HEADERS = new Set([
  "games",
  "gamesplayed",
  "played",
  "hands",
  "sessions",
  "nights",
  "entries",
]);

const BUY_IN_HEADERS = new Set([
  "buyin",
  "buyins",
  "cashin",
  "entry",
  "in",
]);

const CASH_OUT_HEADERS = new Set([
  "cashout",
  "cashouts",
  "payout",
  "out",
  "cash",
  "cashreturned",
]);

const SUMMARY_SHEET_HINTS = ["summary", "leaderboard", "overall", "totals", "standings"];
const FOOTER_LABELS = new Set(["total", "totals", "grandtotal", "overalltotal", "balance"]);

type SheetCell = string | number | boolean | Date | null | undefined;

interface ImportOptions {
  filePath: string;
  clubName: string;
  clubSlug: string;
  ownerAccountId?: string;
  ownerUsername?: string;
  dryRun: boolean;
}

interface ImportedEntry {
  displayName: string;
  totalProfit: number;
  gamesPlayed: number;
}

interface ImportedGameLedgerEntry {
  displayName: string;
  hoursPlayed: string | null;
  totalBuyIn: number;
  cashOut: number;
  netResult: number;
  playerOrder: number;
}

interface ImportedGameLedger {
  sourceKey: string;
  label: string;
  playedAt: Date;
  entries: ImportedGameLedgerEntry[];
}

interface ParsedSheetCandidate {
  sheetName: string;
  mode: "summary" | "ledger";
  entries: ImportedEntry[];
  games: ImportedGameLedger[];
  entryCount: number;
  headerRowIndex: number;
  preferred: boolean;
}

interface SummaryColumns {
  nameIndex: number;
  profitIndex: number;
  gamesIndex?: number;
}

interface LedgerColumns {
  nameIndex: number;
  netIndex?: number;
  buyInIndex?: number;
  cashOutIndex?: number;
}

interface WorkbookParseResult {
  mode: "summary" | "ledger";
  entries: ImportedEntry[];
  games: ImportedGameLedger[];
  diagnostics: string[];
}

interface ClubRecord {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
}

interface ImportSummary {
  club: ClubRecord;
  createdClub: boolean;
  createdUsers: number;
  reusedUsers: number;
  updatedRankings: number;
  importedGames: number;
  parsedEntries: number;
  mode: "summary" | "ledger";
}

async function main(): Promise<void> {
  const options = parseCommandLine(process.argv.slice(2));

  if (!existsSync(options.filePath)) {
    throw new Error(`Workbook not found at ${options.filePath}.`);
  }

  const parseResult = parseWorkbook(options.filePath);

  if (parseResult.entries.length === 0) {
    throw new Error("No importable ledger rows were found in the workbook.");
  }

  printDiagnostics(parseResult, options);

  if (options.dryRun) {
    console.log("Dry run complete. No database changes were written.");
    return;
  }

  const summary = await importWorkbook(parseResult, options, prisma);
  console.log(`Imported ${summary.parsedEntries} leaderboard rows into club '${summary.club.name}' (${summary.club.slug}).`);
  console.log(`Created club: ${summary.createdClub ? "yes" : "no"}`);
  console.log(`Imported members created: ${summary.createdUsers}`);
  console.log(`Imported members reused: ${summary.reusedUsers}`);
  console.log(`Club rankings upserted: ${summary.updatedRankings}`);
  console.log(`Imported game ledgers: ${summary.importedGames}`);
}

function parseCommandLine(argv: string[]): ImportOptions {
  const sanitizedArgs = stripLeadingOptionSentinels(argv);
  const { values } = parseArgs({
    args: sanitizedArgs,
    allowPositionals: false,
    options: {
      file: { type: "string" },
      "club-name": { type: "string" },
      "club-slug": { type: "string" },
      "owner-account-id": { type: "string" },
      "owner-username": { type: "string" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const clubName = values["club-name"]?.trim() || DEFAULT_CLUB_NAME;
  const clubSlug = normalizeClubSlug(values["club-slug"]?.trim() || slugify(clubName) || DEFAULT_CLUB_SLUG);
  const ownerAccountId = values["owner-account-id"]?.trim() || undefined;
  const ownerUsername = values["owner-username"]?.trim() || undefined;

  return {
    filePath: values.file?.trim() || DEFAULT_FILE_PATH,
    clubName,
    clubSlug,
    ownerAccountId,
    ownerUsername,
    dryRun: values["dry-run"] ?? false,
  };
}

function stripLeadingOptionSentinels(argv: string[]): string[] {
  let firstArgumentIndex = 0;

  while (argv[firstArgumentIndex] === "--") {
    firstArgumentIndex += 1;
  }

  return argv.slice(firstArgumentIndex);
}

function printUsage(): void {
  console.log([
    "Usage:",
    "  pnpm --filter @poker/game run import:club-ledger -- --file '/opt/.poker/Poker Ledger.xlsx' --club-name Flushers",
    "",
    "Options:",
    "  --file <path>               Workbook path. Defaults to /opt/.poker/Poker Ledger.xlsx",
    "  --club-name <name>         Club name to create or update. Defaults to Flushers",
    "  --club-slug <slug>         Club slug override. Defaults to a slugified club name",
    "  --owner-account-id <id>    Owner account id when creating a new club",
    "  --owner-username <name>    Owner username when creating a new club",
    "  --dry-run                  Parse and preview without writing Prisma records",
  ].join("\n"));
}

function parseWorkbook(filePath: string): WorkbookParseResult {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const summaryCandidates: ParsedSheetCandidate[] = [];
  const ledgerCandidates: ParsedSheetCandidate[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      continue;
    }

    const rows = XLSX.utils.sheet_to_json<SheetCell[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    const matrixCandidate = parseMatrixLedgerSheet(sheetName, rows);

    if (matrixCandidate) {
      summaryCandidates.push(matrixCandidate);
      continue;
    }

    const summaryCandidate = parseSummarySheet(sheetName, rows);

    if (summaryCandidate) {
      summaryCandidates.push(summaryCandidate);
      continue;
    }

    const ledgerCandidate = parseLedgerSheet(sheetName, rows);

    if (ledgerCandidate) {
      ledgerCandidates.push(ledgerCandidate);
    }
  }

  if (summaryCandidates.length > 0) {
    const chosenCandidate = chooseSummaryCandidate(summaryCandidates);
    return {
      mode: "summary",
      entries: chosenCandidate.entries,
      games: chosenCandidate.games,
      diagnostics: [
        `Using summary sheet '${chosenCandidate.sheetName}' (${chosenCandidate.entryCount} players).`,
        ...summaryCandidates
          .filter((candidate) => candidate.sheetName !== chosenCandidate.sheetName)
          .map((candidate) => `Ignored summary sheet '${candidate.sheetName}' (${candidate.entryCount} players).`),
      ],
    };
  }

  if (ledgerCandidates.length > 0) {
    const mergedEntries = aggregateEntries(
      ledgerCandidates.flatMap((candidate) => candidate.entries),
      "ledger",
    );

    return {
      mode: "ledger",
      entries: mergedEntries,
      games: ledgerCandidates.flatMap((candidate) => candidate.games),
      diagnostics: ledgerCandidates.map(
        (candidate) => `Included ledger sheet '${candidate.sheetName}' (${candidate.entryCount} players).`,
      ),
    };
  }

  throw new Error("Unable to detect a supported ledger layout. Expected player names with either net totals or buy-in/cash-out columns.");
}

function parseMatrixLedgerSheet(sheetName: string, rows: SheetCell[][]): ParsedSheetCandidate | null {
  const headerRowIndex = rows.findIndex((row) => isMatrixLedgerHeaderRow(row ?? []));

  if (headerRowIndex < 0) {
    return null;
  }

  const namesRow = findNearestNonEmptyRow(rows, headerRowIndex - 1);

  if (!namesRow) {
    return null;
  }

  const allTimeRowIndex = rows.findIndex((row, rowIndex) => rowIndex > headerRowIndex && normalizeHeader(normalizeCellString(row?.[0])) === "alltime");

  if (allTimeRowIndex < 0) {
    return null;
  }

  const headerRow = rows[headerRowIndex] ?? [];
  const allTimeRow = rows[allTimeRowIndex] ?? [];
  const playerBlocks: Array<{ startColumnIndex: number; displayName: string }> = [];
  const entries: ImportedEntry[] = [];

  for (let startColumnIndex = 0; startColumnIndex < headerRow.length; startColumnIndex += 1) {
    if (!isMatrixLedgerPlayerBlock(headerRow, startColumnIndex)) {
      continue;
    }

    const rawName = normalizeCellString(namesRow[startColumnIndex]);

    if (!rawName) {
      continue;
    }

    const displayName = normalizeSyntheticClubDisplayName(rawName);
    playerBlocks.push({
      startColumnIndex,
      displayName,
    });

    const totalProfit = parseOptionalWholeNumber(
      allTimeRow[startColumnIndex + 3],
      `All Time result in sheet '${sheetName}' column ${startColumnIndex + 4}`,
    );

    if (totalProfit === null) {
      continue;
    }

    let gamesPlayed = 0;

    for (let rowIndex = headerRowIndex + 1; rowIndex < allTimeRowIndex; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      const dateCell = normalizeCellString(row[0]);

      if (!dateCell) {
        continue;
      }

      const hasSessionData = [row[startColumnIndex], row[startColumnIndex + 1], row[startColumnIndex + 2], row[startColumnIndex + 3]]
        .some((value) => normalizeCellString(value) !== "");

      if (hasSessionData) {
        gamesPlayed += 1;
      }
    }

    entries.push({
      displayName,
      totalProfit,
      gamesPlayed,
    });
  }

  const games: ImportedGameLedger[] = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < allTimeRowIndex; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const label = normalizeCellString(row[0]);
    const playedAt = parseLedgerDate(label);

    if (!label || !playedAt) {
      continue;
    }

    const ledgerEntries: ImportedGameLedgerEntry[] = [];

    for (const [playerOrder, block] of playerBlocks.entries()) {
      const hoursPlayed = normalizeCellString(row[block.startColumnIndex]) || null;
      const totalBuyIn = parseOptionalWholeNumber(
        row[block.startColumnIndex + 1],
        `Buy-in amount in sheet '${sheetName}' row ${rowIndex + 1}`,
      ) ?? 0;
      const cashOut = parseOptionalWholeNumber(
        row[block.startColumnIndex + 2],
        `Cash-out amount in sheet '${sheetName}' row ${rowIndex + 1}`,
      ) ?? 0;
      const explicitNetResult = parseOptionalWholeNumber(
        row[block.startColumnIndex + 3],
        `Net result in sheet '${sheetName}' row ${rowIndex + 1}`,
      );
      const netResult = explicitNetResult ?? (cashOut - totalBuyIn);

      if (hoursPlayed === null && totalBuyIn === 0 && cashOut === 0 && netResult === 0) {
        continue;
      }

      ledgerEntries.push({
        displayName: block.displayName,
        hoursPlayed,
        totalBuyIn,
        cashOut,
        netResult,
        playerOrder,
      });
    }

    if (ledgerEntries.length === 0) {
      continue;
    }

    games.push({
      sourceKey: `${normalizeHeader(sheetName)}:${label}:${rowIndex + 1}`,
      label,
      playedAt,
      entries: ledgerEntries,
    });
  }

  if (entries.length === 0) {
    return null;
  }

  return {
    sheetName,
    mode: "summary",
    entries: aggregateEntries(entries, "summary"),
    games,
    entryCount: entries.length,
    headerRowIndex,
    preferred: true,
  };
}

function parseSummarySheet(sheetName: string, rows: SheetCell[][]): ParsedSheetCandidate | null {
  const detection = findHeaderRow(rows, detectSummaryColumns);

  if (!detection) {
    return null;
  }

  const entries: ImportedEntry[] = [];

  for (let rowIndex = detection.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];

    if (isEmptyRow(row)) {
      continue;
    }

    const rawName = normalizeCellString(row[detection.columns.nameIndex]);

    if (!rawName || isFooterLabel(rawName)) {
      continue;
    }

    const displayName = normalizeSyntheticClubDisplayName(rawName);
    const totalProfit = parseRequiredWholeNumber(
      row[detection.columns.profitIndex],
      `Summary amount in sheet '${sheetName}' row ${rowIndex + 1}`,
    );
    const gamesPlayed = detection.columns.gamesIndex === undefined
      ? 0
      : parseOptionalNonNegativeWholeNumber(
        row[detection.columns.gamesIndex],
        `Games played in sheet '${sheetName}' row ${rowIndex + 1}`,
      ) ?? 0;

    entries.push({
      displayName,
      totalProfit,
      gamesPlayed,
    });
  }

  if (entries.length === 0) {
    return null;
  }

  return {
    sheetName,
    mode: "summary",
    entries: aggregateEntries(entries, "summary"),
    games: [],
    entryCount: entries.length,
    headerRowIndex: detection.rowIndex,
    preferred: isPreferredSummarySheet(sheetName),
  };
}

function parseLedgerSheet(sheetName: string, rows: SheetCell[][]): ParsedSheetCandidate | null {
  const detection = findHeaderRow(rows, detectLedgerColumns);

  if (!detection) {
    return null;
  }

  const entries: ImportedEntry[] = [];

  for (let rowIndex = detection.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];

    if (isEmptyRow(row)) {
      continue;
    }

    const rawName = normalizeCellString(row[detection.columns.nameIndex]);

    if (!rawName || isFooterLabel(rawName)) {
      continue;
    }

    const displayName = normalizeSyntheticClubDisplayName(rawName);
    const explicitNet = detection.columns.netIndex === undefined
      ? null
      : parseOptionalWholeNumber(
        row[detection.columns.netIndex],
        `Net amount in sheet '${sheetName}' row ${rowIndex + 1}`,
      );
    const buyIn = detection.columns.buyInIndex === undefined
      ? 0
      : parseOptionalWholeNumber(
        row[detection.columns.buyInIndex],
        `Buy-in amount in sheet '${sheetName}' row ${rowIndex + 1}`,
      ) ?? 0;
    const cashOut = detection.columns.cashOutIndex === undefined
      ? 0
      : parseOptionalWholeNumber(
        row[detection.columns.cashOutIndex],
        `Cash-out amount in sheet '${sheetName}' row ${rowIndex + 1}`,
      ) ?? 0;

    if (explicitNet === null && buyIn === 0 && cashOut === 0) {
      continue;
    }

    entries.push({
      displayName,
      totalProfit: explicitNet ?? (cashOut - buyIn),
      gamesPlayed: 1,
    });
  }

  if (entries.length === 0) {
    return null;
  }

  return {
    sheetName,
    mode: "ledger",
    entries: aggregateEntries(entries, "ledger"),
    games: [],
    entryCount: entries.length,
    headerRowIndex: detection.rowIndex,
    preferred: false,
  };
}

function findHeaderRow<T>(
  rows: SheetCell[][],
  detectColumns: (normalizedHeaders: string[]) => T | null,
): { rowIndex: number; columns: T } | null {
  const limit = Math.min(rows.length, HEADER_SCAN_LIMIT);

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const headers = (rows[rowIndex] ?? []).map((value) => normalizeHeader(normalizeCellString(value)));
    const columns = detectColumns(headers);

    if (columns) {
      return { rowIndex, columns };
    }
  }

  return null;
}

function findNearestNonEmptyRow(rows: SheetCell[][], startRowIndex: number): SheetCell[] | null {
  for (let rowIndex = startRowIndex; rowIndex >= 0; rowIndex -= 1) {
    const row = rows[rowIndex] ?? [];

    if (!isEmptyRow(row)) {
      return row;
    }
  }

  return null;
}

function isMatrixLedgerHeaderRow(row: SheetCell[]): boolean {
  return normalizeHeader(normalizeCellString(row[0])) === "date"
    && row.some((value, columnIndex) => isMatrixLedgerPlayerBlock(row, columnIndex));
}

function isMatrixLedgerPlayerBlock(row: SheetCell[], startColumnIndex: number): boolean {
  return normalizeHeader(normalizeCellString(row[startColumnIndex])) === "hoursplayed"
    && normalizeHeader(normalizeCellString(row[startColumnIndex + 1])) === "totalbuyin"
    && normalizeHeader(normalizeCellString(row[startColumnIndex + 2])) === "cashout"
    && normalizeHeader(normalizeCellString(row[startColumnIndex + 3])) === "result";
}

function detectSummaryColumns(headers: string[]): SummaryColumns | null {
  const nameIndex = findHeaderIndex(headers, NAME_HEADERS);
  const profitIndex = findHeaderIndex(headers, PROFIT_HEADERS);

  if (nameIndex === undefined || profitIndex === undefined) {
    return null;
  }

  return {
    nameIndex,
    profitIndex,
    gamesIndex: findHeaderIndex(headers, GAMES_HEADERS),
  };
}

function detectLedgerColumns(headers: string[]): LedgerColumns | null {
  const nameIndex = findHeaderIndex(headers, NAME_HEADERS);

  if (nameIndex === undefined) {
    return null;
  }

  const netIndex = findHeaderIndex(headers, PROFIT_HEADERS);
  const buyInIndex = findHeaderIndex(headers, BUY_IN_HEADERS);
  const cashOutIndex = findHeaderIndex(headers, CASH_OUT_HEADERS);

  if (netIndex === undefined && (buyInIndex === undefined || cashOutIndex === undefined)) {
    return null;
  }

  return {
    nameIndex,
    netIndex,
    buyInIndex,
    cashOutIndex,
  };
}

function findHeaderIndex(headers: string[], aliases: Set<string>): number | undefined {
  return headers.findIndex((header) => aliases.has(header)) >= 0
    ? headers.findIndex((header) => aliases.has(header))
    : undefined;
}

function aggregateEntries(entries: ImportedEntry[], mode: "summary" | "ledger"): ImportedEntry[] {
  const aggregated = new Map<string, ImportedEntry>();

  for (const entry of entries) {
    const key = normalizePlayerKey(entry.displayName);
    const existing = aggregated.get(key);

    if (!existing) {
      aggregated.set(key, { ...entry });
      continue;
    }

    existing.totalProfit += entry.totalProfit;
    existing.gamesPlayed += entry.gamesPlayed;

    if (mode === "summary" && entry.displayName.length > existing.displayName.length) {
      existing.displayName = entry.displayName;
    }
  }

  return [...aggregated.values()].sort((left, right) => {
    if (right.totalProfit !== left.totalProfit) {
      return right.totalProfit - left.totalProfit;
    }

    return left.displayName.localeCompare(right.displayName);
  });
}

function chooseSummaryCandidate(candidates: ParsedSheetCandidate[]): ParsedSheetCandidate {
  const chosenCandidate = [...candidates].sort((left, right) => {
    if (left.preferred !== right.preferred) {
      return left.preferred ? -1 : 1;
    }

    if (right.entryCount !== left.entryCount) {
      return right.entryCount - left.entryCount;
    }

    return left.headerRowIndex - right.headerRowIndex;
  })[0];

  if (!chosenCandidate) {
    throw new Error("A summary sheet was expected but none could be selected.");
  }

  return chosenCandidate;
}

function isPreferredSummarySheet(sheetName: string): boolean {
  const normalized = normalizeHeader(sheetName);
  return SUMMARY_SHEET_HINTS.some((hint) => normalized.includes(hint));
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseLedgerDate(value: string): Date | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const parsed = new Date(`${normalized}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeCellString(value: SheetCell): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  return "";
}

function isEmptyRow(row: SheetCell[]): boolean {
  return row.every((value) => normalizeCellString(value) === "");
}

function isFooterLabel(value: string): boolean {
  return FOOTER_LABELS.has(normalizeHeader(value));
}

function parseRequiredWholeNumber(value: SheetCell, label: string): number {
  const parsed = parseOptionalWholeNumber(value, label);

  if (parsed === null) {
    throw new Error(`${label} is required.`);
  }

  return parsed;
}

function parseOptionalWholeNumber(value: SheetCell, label: string): number | null {
  if (typeof value === "number") {
    return normalizeRankingChipValue(value, label);
  }

  const raw = normalizeCellString(value);

  if (!raw) {
    return null;
  }

  const cleaned = raw
    .replace(/^\((.*)\)$/, "-$1")
    .replace(/[$,%\s,]/g, "")
    .replace(/^\+/, "");

  if (!cleaned || cleaned === "-") {
    return null;
  }

  if (!/^[-]?\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`${label} must be a whole number. Received '${raw}'.`);
  }

  return normalizeRankingChipValue(Number(cleaned), label);
}

function parseOptionalNonNegativeWholeNumber(value: SheetCell, label: string): number | null {
  const parsed = parseOptionalWholeNumber(value, label);

  if (parsed === null) {
    return null;
  }

  return normalizeGamesPlayed(parsed, label);
}

async function importWorkbook(
  parseResult: WorkbookParseResult,
  options: ImportOptions,
  database: PrismaClient,
): Promise<ImportSummary> {
  return database.$transaction(async (transaction) => {
    const clubResult = await ensureClub(transaction, options);
    const scopeKey = buildClubScopeKey(clubResult.club.id);
    const importedUsersByKey = new Map<string, { id: string }>();
    let createdUsers = 0;
    let reusedUsers = 0;
    let updatedRankings = 0;

    for (const entry of parseResult.entries) {
      const user = await findOrCreateImportedUser(transaction, clubResult.club, entry.displayName);
      importedUsersByKey.set(normalizePlayerKey(entry.displayName), user.record);

      if (user.created) {
        createdUsers += 1;
      } else {
        reusedUsers += 1;
      }

      await transaction.clubMembership.upsert({
        where: {
          clubId_userId: {
            clubId: clubResult.club.id,
            userId: user.record.id,
          },
        },
        update: membershipUpdatePayload(),
        create: membershipCreatePayload(clubResult.club.id, user.record.id),
      });

      await transaction.userRanking.upsert({
        where: {
          userId_scopeKey: {
            userId: user.record.id,
            scopeKey,
          },
        },
        update: {
          clubId: clubResult.club.id,
          scope: RankingScope.CLUB,
          totalProfit: BigInt(entry.totalProfit),
          gamesPlayed: entry.gamesPlayed,
        },
        create: {
          userId: user.record.id,
          clubId: clubResult.club.id,
          scope: RankingScope.CLUB,
          scopeKey,
          totalProfit: BigInt(entry.totalProfit),
          gamesPlayed: entry.gamesPlayed,
        },
      });

      updatedRankings += 1;
    }

    if (parseResult.games.length > 0) {
      await transaction.clubLedgerGame.deleteMany({
        where: {
          clubId: clubResult.club.id,
          source: "IMPORTED_WORKBOOK",
        },
      });

      for (const game of parseResult.games) {
        const ledgerRows = [];

        for (const entry of game.entries) {
          const playerKey = normalizePlayerKey(entry.displayName);
          let userRecord = importedUsersByKey.get(playerKey);

          if (!userRecord) {
            const user = await findOrCreateImportedUser(transaction, clubResult.club, entry.displayName);
            userRecord = user.record;
            importedUsersByKey.set(playerKey, user.record);

            if (user.created) {
              createdUsers += 1;
            } else {
              reusedUsers += 1;
            }

            await transaction.clubMembership.upsert({
              where: {
                clubId_userId: {
                  clubId: clubResult.club.id,
                  userId: userRecord.id,
                },
              },
              update: membershipUpdatePayload(),
              create: membershipCreatePayload(clubResult.club.id, userRecord.id),
            });
          }

          ledgerRows.push({
            userId: userRecord.id,
            displayName: entry.displayName,
            hoursPlayed: entry.hoursPlayed,
            totalBuyIn: entry.totalBuyIn,
            cashOut: entry.cashOut,
            netResult: entry.netResult,
            playerOrder: entry.playerOrder,
          });
        }

        await transaction.clubLedgerGame.create({
          data: {
            clubId: clubResult.club.id,
            source: "IMPORTED_WORKBOOK",
            sourceKey: game.sourceKey,
            label: game.label,
            playedAt: game.playedAt,
            entries: {
              create: ledgerRows,
            },
          },
        });
      }
    }

    return {
      club: clubResult.club,
      createdClub: clubResult.created,
      createdUsers,
      reusedUsers,
      updatedRankings,
      importedGames: parseResult.games.length,
      parsedEntries: parseResult.entries.length,
      mode: parseResult.mode,
    };
  });
}

function membershipUpdatePayload() {
  return {
    isVisibleInLeaderboard: true,
  };
}

function membershipCreatePayload(clubId: string, userId: string) {
  return {
    clubId,
    userId,
    role: ClubRole.MEMBER,
    canManageRooms: false,
    isVisibleInLeaderboard: true,
  };
}

async function ensureClub(
  transaction: Prisma.TransactionClient,
  options: ImportOptions,
): Promise<{ club: ClubRecord; created: boolean }> {
  const existingBySlug = await transaction.club.findUnique({
    where: { slug: options.clubSlug },
    select: {
      id: true,
      slug: true,
      name: true,
      ownerId: true,
    },
  });

  if (existingBySlug) {
    return { club: existingBySlug, created: false };
  }

  const existingByName = await transaction.club.findFirst({
    where: {
      name: {
        equals: options.clubName,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      ownerId: true,
    },
  });

  if (existingByName) {
    return { club: existingByName, created: false };
  }

  const ownerId = await resolveOwnerAccountId(transaction, options);
  const slug = await allocateClubSlug(transaction, options.clubSlug);
  const createdClub = await transaction.club.create({
    data: {
      slug,
      name: options.clubName,
      ownerId,
      memberships: {
        create: {
          userId: ownerId,
          role: ClubRole.OWNER,
          canManageRooms: true,
          isVisibleInLeaderboard: false,
        },
      },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      ownerId: true,
    },
  });

  return { club: createdClub, created: true };
}

async function resolveOwnerAccountId(transaction: Prisma.TransactionClient, options: ImportOptions): Promise<string> {
  if (options.ownerAccountId) {
    const user = await transaction.user.findUnique({
      where: { id: options.ownerAccountId },
      select: { id: true },
    });

    if (!user) {
      throw new Error(`Owner account '${options.ownerAccountId}' does not exist.`);
    }

    return user.id;
  }

  const configuredOwnerUsername = options.ownerUsername ?? getRoomCreationAdminConfig().adminUsername;

  if (!configuredOwnerUsername) {
    throw new Error("Creating a new club requires --owner-account-id, --owner-username, or ROOM_CREATION_ADMIN_USERNAME.");
  }

  const user = await transaction.user.findFirst({
    where: {
      username: {
        equals: configuredOwnerUsername,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (!user) {
    throw new Error(`Owner username '${configuredOwnerUsername}' does not exist. Start the API once or create that account first.`);
  }

  return user.id;
}

async function allocateClubSlug(transaction: Prisma.TransactionClient, preferredSlug: string): Promise<string> {
  let attempt = 0;

  while (true) {
    const slug = attempt === 0 ? preferredSlug : `${preferredSlug}-${attempt + 1}`;
    const existing = await transaction.club.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!existing) {
      return slug;
    }

    attempt += 1;
  }
}

async function findOrCreateImportedUser(
  transaction: Prisma.TransactionClient,
  club: ClubRecord,
  displayName: string,
): Promise<{ record: { id: string }; created: boolean }> {
  const identity = buildImportedIdentity(club.slug, displayName);
  const existing = await transaction.user.findUnique({
    where: {
      email: identity.email,
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return { record: existing, created: false };
  }

  const created = await transaction.user.create({
    data: {
      email: identity.email,
      username: identity.username,
      passwordHash: hashSecret(identity.email),
    },
    select: {
      id: true,
    },
  });

  return { record: created, created: true };
}

function buildImportedIdentity(clubSlug: string, displayName: string): { email: string; username: string } {
  const normalizedDisplayName = normalizePlayerKey(displayName);
  const digest = createHash("sha256").update(`${clubSlug}:${normalizedDisplayName}`).digest("hex");
  const usernameBase = slugify(displayName) || "player";
  const username = `${clubSlug}-${usernameBase}`.replace(/^-+|-+$/g, "").slice(0, 40);
  const suffix = digest.slice(0, 8);

  return {
    email: `club_import_${clubSlug}_${suffix}@${CLUB_IMPORT_EMAIL_DOMAIN}`,
    username: `${username}-${suffix}`.slice(0, 60),
  };
}

function printDiagnostics(parseResult: WorkbookParseResult, options: ImportOptions): void {
  console.log(`Workbook: ${options.filePath}`);
  console.log(`Club: ${options.clubName} (${options.clubSlug})`);
  console.log(`Detected import mode: ${parseResult.mode}`);

  for (const line of parseResult.diagnostics) {
    console.log(line);
  }

  console.log(`Parsed leaderboard rows: ${parseResult.entries.length}`);
  console.log(`Parsed game ledgers: ${parseResult.games.length}`);
  console.log("Top imported rows:");

  for (const entry of parseResult.entries.slice(0, 10)) {
    console.log(`  ${entry.displayName}: profit ${entry.totalProfit}, games ${entry.gamesPlayed}`);
  }
}

function normalizeSyntheticClubDisplayName(value: string): string {
  const displayName = value.trim();

  if (displayName.length < 2) {
    throw new Error("Imported player name must contain at least 2 characters.");
  }

  return displayName;
}

function normalizeRankingChipValue(value: number, fieldName: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be a whole number.`);
  }

  return value;
}

function normalizeGamesPlayed(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a whole number greater than or equal to zero.`);
  }

  return value;
}

function buildClubScopeKey(clubId: string): string {
  return `club:${clubId}`;
}

function normalizePlayerKey(displayName: string): string {
  return displayName.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeClubSlug(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new Error("Club slug must contain at least one letter or number.");
  }

  return slug;
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown import failure.";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });