export interface HouseRulesSectionConfig {
    icon: string;
    title: string;
    credit?: string;
    badge?: string;
    paragraphs: string[];
    bullets?: string[];
}

export interface HouseRulesConfig {
    visible: boolean;
    title: string;
    lastUpdated: string;
    overview: string[];
    sections: HouseRulesSectionConfig[];
}

const DEFAULT_HOUSE_RULES_CONFIG: HouseRulesConfig = {
    visible: false,
    title: "House Rules",
    lastUpdated: "",    
    overview: [],
    sections: [],
};

function isHouseRulesSectionConfig(value: unknown): value is HouseRulesSectionConfig {
    if (!value || typeof value !== "object") {
        return false;
    }

    const section = value as Partial<HouseRulesSectionConfig>;
    return typeof section.icon === "string"
        && typeof section.title === "string"
        && (section.credit === undefined || typeof section.credit === "string")
        && (section.badge === undefined || typeof section.badge === "string")
        && Array.isArray(section.paragraphs)
        && section.paragraphs.every((paragraph) => typeof paragraph === "string")
        && (section.bullets === undefined || (Array.isArray(section.bullets) && section.bullets.every((bullet) => typeof bullet === "string")));
}

export function parseHouseRulesConfig(rawConfig: string): HouseRulesConfig {
    try {
        const config = JSON.parse(rawConfig) as Partial<HouseRulesConfig>;

        if (
            typeof config.visible !== "boolean"
            || typeof config.title !== "string"
            || typeof config.lastUpdated !== "string"
            || !Array.isArray(config.overview)
            || !config.overview.every((paragraph) => typeof paragraph === "string")
            || !Array.isArray(config.sections)
            || !config.sections.every(isHouseRulesSectionConfig)
        ) {
            throw new Error("invalid house rules configuration");
        }

        return config as HouseRulesConfig;
    } catch {
        return DEFAULT_HOUSE_RULES_CONFIG;
    }
}

export function getDefaultHouseRulesConfig(): HouseRulesConfig {
    return DEFAULT_HOUSE_RULES_CONFIG;
}
