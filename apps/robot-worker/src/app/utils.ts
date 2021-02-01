import { expose } from "threads/worker";
import { sql, pg } from "@cryptuoso/postgres";
import { RobotPosition, RobotStatus } from "@cryptuoso/robot-state";
import { AlertInfo, DBCandle, OrderType, RobotPositionStatus, Timeframe, ValidTimeframe } from "@cryptuoso/market";
import dayjs from "@cryptuoso/dayjs";
import { sortAsc } from "@cryptuoso/helpers";

async function checkAlerts(exchange: string, asset: string, currency: string, timeframe: ValidTimeframe) {
    const positions = await pg.any<{
        robotId: string;
        exchange: string;
        asset: string;
        currency: string;
        status: RobotStatus;
        alerts: { [key: string]: AlertInfo };
        timeframe: ValidTimeframe;
    }>(sql`
    SELECT rp.robot_id, rp.alerts, r.exchange, r.asset, r.currency, r.timeframe, r.status
    FROM robot_positions rp, robots r
    WHERE rp.robot_id = r.id
    AND rp.status in (${RobotPositionStatus.new},${RobotPositionStatus.open})
    AND r.has_alerts = true
    AND rp.alerts is not null AND rp.alerts != '{}'
    AND r.status in (${RobotStatus.started}, ${RobotStatus.starting}, ${RobotStatus.paused})
    AND r.exchange = ${exchange}
    AND r.asset = ${asset}
    and r.currency = ${currency}
    and r.timeframe = ${timeframe};`);

    if (positions && positions.length) {
        const currentTime = Timeframe.getCurrentSince(1, timeframe);
        const candle = await pg.maybeOne<DBCandle>(sql`
        SELECT * 
        FROM ${sql.identifier([`candles${timeframe}`])}
        WHERE exchange = ${exchange}
        AND asset = ${asset}
        AND currency = ${currency}
        AND time = ${currentTime};`);
        if (!candle) {
            if (dayjs.utc(currentTime).diff(dayjs.utc(), "second") > 20)
                this.log.error(
                    `Failed to load ${exchange}-${asset}-${currency}-${timeframe}-${dayjs
                        .utc(currentTime)
                        .toISOString()} current candle`
                );
            return [];
        }
        const robots = positions
            .filter(({ alerts }) => {
                let nextPrice = null;
                for (const key of Object.keys(alerts).sort((a, b) => sortAsc(+a, +b))) {
                    const alert = alerts[key];
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
                if (nextPrice) return true;

                return false;
            })
            .map(({ robotId, status }) => ({ robotId, status }));
        return robots;
    }
    return [];
}

const utils = {
    checkAlerts
};

export type Utils = typeof utils;

expose(utils);
