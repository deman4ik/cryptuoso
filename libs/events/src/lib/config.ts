import { CALC_STATS_PREFIX, StatsCalcRunnerEvents } from "@cryptuoso/stats-calc-events";
import { BASE_REDIS_PREFIX } from "./catalog";
import { DEAD_LETTER_TOPIC } from "./events";

export { BASE_REDIS_PREFIX } from "./catalog";
//export { DEAD_LETTER_TOPIC } from "./events";

interface TopicConfig {
    /** in seconds */
    eventTTL: number;
    /** in seconds */
    consumerIdleTTL: number;
}

function makeTopicsConfigs(...args: any[]) {
    let configs: { [key: string]: TopicConfig } = {};

    for (let i = 0; i < args.length; i += 3) {
        configs[`${BASE_REDIS_PREFIX}${args[i]}`] = {
            eventTTL: args[i + 1],
            consumerIdleTTL: args[i + 2]
        };
    }

    return configs;
}

export const eventsManagementConfig: {
    common: TopicConfig;
    configs: { [key: string]: TopicConfig }
} = {
    common: {
        eventTTL: 7 * 24 * 60 * 60,
        consumerIdleTTL: 7 * 24 * 60 * 60
    } as TopicConfig,
    configs: {
        /* ...makeTopicsConfigs(
            DEAD_LETTER_TOPIC, 100, 200,
            "errors", 100, 200
        ), */
        ...makeTopicsConfigs(
            `${CALC_STATS_PREFIX}.*`, 100, 2000
        )
    }
};