import { readFile } from "node:fs/promises";

import { getDefaultHouseRulesConfig, parseHouseRulesConfig, type HouseRulesConfig } from "./house-rules-config";

const DEFAULT_HOUSE_RULES_CONFIG_PATH = "/app/config/house-rules.json";

export async function loadHouseRulesConfig(): Promise<HouseRulesConfig> {
    const path = process.env.HOUSE_RULES_CONFIG_PATH ?? DEFAULT_HOUSE_RULES_CONFIG_PATH;

    try {
        return parseHouseRulesConfig(await readFile(path, "utf8"));
    } catch {
        return getDefaultHouseRulesConfig();
    }
}