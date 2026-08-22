const DEFAULT_BRAND_NAME = "Poker";

export function getBrandName(): string {
    return process.env.POKER_BRAND_NAME?.trim() || DEFAULT_BRAND_NAME;
}