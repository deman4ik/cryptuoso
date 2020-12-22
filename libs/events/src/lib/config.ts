import { STATS_CALC_TOPIC /*, StatsCalcRunnerEvents */ } from "@cryptuoso/stats-calc-events";
import { ALERT_TOPIC, SIGNAL_TOPIC } from "@cryptuoso/robot-events";
import { BASE_REDIS_PREFIX } from "./catalog";
import { DEAD_LETTER_TOPIC } from "./events";

export { BASE_REDIS_PREFIX } from "./catalog";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

class TopicConfig {
    constructor(public eventTTL: number = WEEK, public consumerIdleTTL: number = DAY) {}
}

interface TopicConfigs {
    [key: string]: TopicConfig;
}

function modifyConfigEventsNames(configs: TopicConfigs) {
    const modified: TopicConfigs = {};

    for (const [stream, config] of Object.entries(configs)) {
        modified[`${BASE_REDIS_PREFIX}${stream}`] = config;
    }

    return modified;
}

export const eventsManagementConfig: {
    common: TopicConfig;
    configs: TopicConfigs;
} = {
    common: new TopicConfig(),
    configs: {
        ...modifyConfigEventsNames({
            [DEAD_LETTER_TOPIC]: new TopicConfig(DAY, HOUR),
            [`${STATS_CALC_TOPIC}.*`]: new TopicConfig(DAY, HOUR),
            [`${ALERT_TOPIC}.*`]: new TopicConfig(DAY, HOUR),
            [`${SIGNAL_TOPIC}.*`]: new TopicConfig(DAY, HOUR)
        })
    }
};
