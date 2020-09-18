import { CALC_STATS_PREFIX, StatsCalcRunnerEvents } from "@cryptuoso/stats-calc-events";
import { BASE_REDIS_PREFIX } from "./catalog";
import { DEAD_LETTER_TOPIC } from "./events";

export { BASE_REDIS_PREFIX } from "./catalog";
//export { DEAD_LETTER_TOPIC } from "./events";

interface TopicConfig {
    fullname: string;
    /** in seconds */
    cacheTime: number;
}

interface ServiceConfig {
    prefix: string;
    topics: TopicConfig[];
}

function makeTopicConfig(fullname: string, cacheTime: number): TopicConfig {
    return { fullname, cacheTime };
};

function makeServiceConfig(prefix: string, topics: TopicConfig[]): ServiceConfig {
    return { prefix, topics };
}

function makeServicesConfigs(sc: { [key: string]: TopicConfig[] }): ServiceConfig[] {
    const config: ServiceConfig[] = [];

    for(const [prefix, topics] of Object.entries(sc))
        config.push(makeServiceConfig(prefix, topics));

    return config;
}

export const eventsManagementConfig: ServiceConfig[] = makeServicesConfigs({
    [`${BASE_REDIS_PREFIX}${DEAD_LETTER_TOPIC}`]: [
        makeTopicConfig(`${BASE_REDIS_PREFIX}${DEAD_LETTER_TOPIC}`, 100)
    ],
    [CALC_STATS_PREFIX]: [
        makeTopicConfig(StatsCalcRunnerEvents.USER_ROBOT, 10),
        makeTopicConfig(StatsCalcRunnerEvents.USER_ROBOTS, 10),
        makeTopicConfig(StatsCalcRunnerEvents.USER_SIGNAL, 10),
        makeTopicConfig(StatsCalcRunnerEvents.USER_SIGNALS, 10)
    ]
});