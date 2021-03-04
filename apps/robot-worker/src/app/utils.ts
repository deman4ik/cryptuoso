import { expose } from "threads/worker";
import { sql, pg } from "@cryptuoso/postgres";
import { RobotPosition, RobotPositionState, RobotStatus } from "@cryptuoso/robot-state";
import { DBCandle, OrderType, Timeframe, ValidTimeframe } from "@cryptuoso/market";
import dayjs from "@cryptuoso/dayjs";
import { sortAsc } from "@cryptuoso/helpers";
import logger from "@cryptuoso/logger";

async function checkAlerts(
    exchange: string,
    asset: string,
    currency: string,
    timeframe: ValidTimeframe
): Promise<{ result: { robotId: string; status: RobotStatus }[]; error: string }> {
    try {
        const robots = await pg.any<{
            robotId: string;
            status: RobotStatus;
            positions: RobotPositionState[];
        }>(sql`
        SELECT r.id as robot_id, 
         r.state->'positions' as positions,
         r.status
         FROM robots r 
         WHERE r.has_alerts = true
         AND r.status = ${RobotStatus.started}
         AND r.exchange = ${exchange}
         AND r.asset = ${asset}
         AND r.currency = ${currency}
         AND r.timeframe = ${timeframe};
        `);

        if (robots && robots.length) {
            const currentTime = Timeframe.getCurrentSince(1, timeframe);
            const candle = await pg.maybeOne<DBCandle>(sql`
        SELECT * 
        FROM ${sql.identifier([`candles${timeframe}`])}
        WHERE exchange = ${exchange}
        AND asset = ${asset}
        AND currency = ${currency}
        AND time = ${currentTime};`);
            if (!candle) {
                if (dayjs.utc().diff(currentTime, "minute") > 20) {
                    const error = `Failed to load ${exchange}-${asset}-${currency}-${timeframe}-${dayjs
                        .utc(currentTime)
                        .toISOString()} current candle`;
                    logger.error(error);
                    return {
                        result: null,
                        error
                    };
                }
                return {
                    result: null,
                    error: null
                };
            }
            const robotsWithTrades = robots
                .filter(({ positions }) => {
                    let nextPrice = null;
                    for (const pos of positions) {
                        for (const key of Object.keys(pos.alerts).sort((a, b) => sortAsc(+a, +b))) {
                            const alert = pos.alerts[key];
                            const { orderType, action, price } = alert;

                            switch (orderType) {
                                case OrderType.stop: {
                                    nextPrice = RobotPosition.checkStop(action, price, candle);
                                    break;
                                }
                                case OrderType.limit: {
                                    nextPrice = RobotPosition.checkLimit(action, price, candle);
                                    break;
                                }
                                case OrderType.market: {
                                    nextPrice = RobotPosition.checkMarket(action, price, candle);
                                    break;
                                }
                                default:
                                    throw new Error(`Unknown order type ${orderType}`);
                            }
                            if (nextPrice) break;
                        }
                        if (nextPrice) break;
                    }
                    if (nextPrice) return true;

                    return false;
                })
                .map(({ robotId, status }) => ({ robotId, status }));
            return { result: robotsWithTrades, error: null };
        }
        return { result: null, error: null };
    } catch (err) {
        logger.error(err);
        return { result: null, error: err.message };
    }
}

const utils = {
    checkAlerts
};

export type Utils = typeof utils;

expose(utils);
