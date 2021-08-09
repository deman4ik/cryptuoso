import {
    BACKTESTER_RUNNER_TOPIC,
    IN_BACKTESTER_WORKER_TOPIC,
    OUT_BACKTESTER_WORKER_TOPIC
} from "@cryptuoso/backtester-events";
import { OUR_STATS_CALC_TOPIC, STATS_CALC_TOPIC } from "@cryptuoso/stats-calc-events";
import { ALERT_TOPIC, ROBOT_RUNNER_TOPIC, ROBOT_WORKER_TOPIC, SIGNAL_TOPIC } from "@cryptuoso/robot-events";
import { BASE_REDIS_PREFIX, BASE_SERVICE_TOPIC, DEAD_LETTER_TOPIC } from "@cryptuoso/events";
import { CONNECTOR_RUNNER_TOPIC, CONNECTOR_WORKER_TOPIC } from "@cryptuoso/connector-events";
import { EXCHANGES, IN_EXWATCHER_TOPIC, OUT_EXWATCHER_TOPIC } from "@cryptuoso/exwatcher-events";
import { IMPORTER_RUNNER_TOPIC, IN_IMPORTER_WORKER_TOPIC, OUT_IMPORTER_WORKER_TOPIC } from "@cryptuoso/importer-events";
import { USER_ROBOT_RUNNER_TOPIC, USER_ROBOT_WORKER_TOPIC, USER_TRADE_TOPIC } from "@cryptuoso/user-robot-events";
import { IN_USER_SUB_TOPIC, OUT_USER_SUB_TOPIC } from "@cryptuoso/user-sub-events";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
//const DAY = 24 * HOUR;
//const WEEK = 7 * DAY;

class TopicConfig {
    constructor(public eventTTL: number = HOUR, public consumerIdleTTL: number = HOUR) {}
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

const ExwatcherTopics = Object.values(EXCHANGES)
    .map((ex) => `${IN_EXWATCHER_TOPIC}-${ex}.*`)
    .reduce((p, v) => ({ ...p, [v]: new TopicConfig() }), {});

export const eventsManagementConfig: {
    common: TopicConfig;
    configs: TopicConfigs;
} = {
    common: new TopicConfig(),
    configs: {
        ...modifyConfigEventsNames({
            [`${DEAD_LETTER_TOPIC}.*`]: new TopicConfig(),
            [`${BACKTESTER_RUNNER_TOPIC}.*`]: new TopicConfig(),
            [`${IN_BACKTESTER_WORKER_TOPIC}.*`]: new TopicConfig(),
            [`${OUT_BACKTESTER_WORKER_TOPIC}.*`]: new TopicConfig(),
            [`${CONNECTOR_RUNNER_TOPIC}.*`]: new TopicConfig(),
            [`${CONNECTOR_WORKER_TOPIC}.*`]: new TopicConfig(),
            ...ExwatcherTopics,
            [`${OUT_EXWATCHER_TOPIC}.*`]: new TopicConfig(),
            [`${IMPORTER_RUNNER_TOPIC}.*`]: new TopicConfig(),
            [`${IN_IMPORTER_WORKER_TOPIC}.*`]: new TopicConfig(),
            [`${OUT_IMPORTER_WORKER_TOPIC}.*`]: new TopicConfig(),
            [`${ROBOT_RUNNER_TOPIC}.*`]: new TopicConfig(),
            [`${ROBOT_WORKER_TOPIC}.*`]: new TopicConfig(),
            [`${ALERT_TOPIC}.*`]: new TopicConfig(),
            [`${SIGNAL_TOPIC}.*`]: new TopicConfig(),
            [`${BASE_SERVICE_TOPIC}.*`]: new TopicConfig(),
            [`${STATS_CALC_TOPIC}.*`]: new TopicConfig(),
            [`${OUR_STATS_CALC_TOPIC}.*`]: new TopicConfig(),
            [`${USER_ROBOT_RUNNER_TOPIC}.*`]: new TopicConfig(),
            [`${USER_ROBOT_WORKER_TOPIC}.*`]: new TopicConfig(),
            [`${USER_TRADE_TOPIC}.*`]: new TopicConfig(),
            [`${IN_USER_SUB_TOPIC}.*`]: new TopicConfig(),
            [`${OUT_USER_SUB_TOPIC}.*`]: new TopicConfig()
        })
    }
};
