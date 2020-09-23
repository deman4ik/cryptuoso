import { STATS_CALC_PREFIX, StatsCalcRunnerEvents } from "@cryptuoso/stats-calc-events";
import { BASE_REDIS_PREFIX } from "./catalog";
import { DEAD_LETTER_TOPIC } from "./events";

export { BASE_REDIS_PREFIX } from "./catalog";

class TopicConfig {
    constructor(
        public eventTTL: number = 7 * 24 * 60 * 60,
        public consumerIdleTTL: number = 7 * 24 * 60 * 60
    ) {}
}

interface TopicConfigs {
    [key: string]: TopicConfig
}

function modifyConfigEventsNames(configs: TopicConfigs) {
    const modified: TopicConfigs = {};

    for(const [event, config] of Object.entries(configs))
        modified[`${BASE_REDIS_PREFIX}${event}`] = config;

    return modified;
}

export const eventsManagementConfig: {
    common: TopicConfig;
    configs: TopicConfigs;
} = {
    common: new TopicConfig(),
    configs: {
        ...modifyConfigEventsNames({
            [DEAD_LETTER_TOPIC]: new TopicConfig(100, 200),
            "errors": new TopicConfig(100, 200),
            [`${STATS_CALC_PREFIX}.*`]: new TopicConfig(100, 2000)
        })
    }
};
