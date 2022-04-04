import { v4 as uuid } from "uuid";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import {
    RobotRunnerEvents,
    RobotRunnerSchema,
    RobotRunnerCreate,
    RobotRunnerStart,
    RobotRunnerStop,
    RobotWorkerEvents,
    ROBOT_WORKER_TOPIC,
    RobotRunnerStatus,
    getRobotStatusEventName,
    RobotRunnerMarketsCheck,
    getMarketsCheckEventName,
    getRobotsCheckEventName,
    RobotRunnerRobotsCheck,
    RobotServiceSubcribe,
    getRobotSubscribeEventName
} from "@cryptuoso/robot-events";
import { ExwatcherAddMarket } from "@cryptuoso/exwatcher-events";
import { BacktesterRunnerEvents, BacktesterRunnerStart } from "@cryptuoso/backtester-events";
import { RobotStatus } from "@cryptuoso/robot-state";
import { StrategySettings } from "@cryptuoso/robot-settings";
import { equals, robotExchangeName, sleep, sortDesc } from "@cryptuoso/helpers";
import dayjs from "@cryptuoso/dayjs";
import { CandleType, Timeframe, ValidTimeframe } from "@cryptuoso/market";
import { BaseServiceError, BaseServiceEvents, Event } from "@cryptuoso/events";
import { UserRoles } from "@cryptuoso/user-state";
import { PublicConnector } from "@cryptuoso/ccxt-public";
import { sql } from "@cryptuoso/postgres";

export type RobotRunnerServiceConfig = HTTPServiceConfig;

export default class RobotRunnerService extends HTTPService {
    connector: PublicConnector;
    constructor(config?: RobotRunnerServiceConfig) {
        super(config);
        this.connector = new PublicConnector();
        try {
            this.createRoutes({
                robotCreate: {
                    inputSchema: RobotRunnerSchema[RobotRunnerEvents.CREATE],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.create.bind(this))
                },
                robotStart: {
                    inputSchema: RobotRunnerSchema[RobotRunnerEvents.START],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.start.bind(this))
                },
                robotStop: {
                    inputSchema: RobotRunnerSchema[RobotRunnerEvents.STOP],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.stop.bind(this))
                },
                robotsCheck: {
                    inputSchema: RobotRunnerSchema[RobotRunnerEvents.ROBOTS_CHECK],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.robotsCheck.bind(this))
                },
                marketsCheck: {
                    inputSchema: RobotRunnerSchema[RobotRunnerEvents.MARKETS_CHECK],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.marketsCheck.bind(this))
                },
                addMarket: {
                    inputSchema: {
                        exchange: "string",
                        asset: "string",
                        currency: "string",
                        available: { type: "number", integer: true, optional: true }
                    },
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.addMarket.bind(this))
                },
                updateMarkets: {
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.updateMarkets.bind(this))
                },
                addSubscription: {
                    inputSchema: {
                        exchange: "string",
                        asset: "string",
                        currency: "string"
                    },
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.addSubscription.bind(this))
                }
            });

            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error("Error while constructing RobotRunnerService", err);
        }
    }

    async onServiceStart() {
        this.events.subscribe({
            [`${ROBOT_WORKER_TOPIC}.*`]: {
                passFullEvent: true,
                handler: this.handleRobotWorkerEvents.bind(this)
            }
        });
        const queueKey = this.name;

        this.createQueue(queueKey);

        this.createWorker(queueKey, this.updateMarkets);

        await this.connector.initAllConnectors(true);
        await this.addJob(queueKey, "updateMarkets", null, {
            repeat: {
                cron: "0 0 */12 * * *"
            },
            attempts: 3,
            backoff: { type: "exponential", delay: 60000 },
            removeOnComplete: 1,
            removeOnFail: 10
        });
    }

    #createRobotCode = (
        exchange: string,
        asset: string,
        currency: string,
        timeframe: number,
        strategy: string,
        mod: string
    ) => `${strategy}_${mod}_${robotExchangeName(exchange, "_")}_${asset}_${currency}_${Timeframe.toString(timeframe)}`;

    #createRobotName = (
        exchange: string,
        asset: string,
        currency: string,
        timeframe: number,
        strategy: string,
        mod: string
    ) => `${strategy}-${mod} ${robotExchangeName(exchange)} ${asset}/${currency} ${Timeframe.toString(timeframe)}`;

    async create({ entities }: RobotRunnerCreate): Promise<{ result: string }> {
        const strategiesList = await this.db.pg.many<{ id: string; code: string }>(sql`
        SELECT id, code FROM strategies;
        `);
        const strategies: { [key: string]: string } = {};
        strategiesList.forEach(({ id, code }: { id: string; code: string }) => {
            strategies[id] = code;
        });

        let importedCount = 0;
        const errors = [];
        for (const {
            exchange,
            asset,
            currency,
            timeframe,
            strategy,
            mod,
            available,
            signals,
            trading,
            strategySettings,
            robotSettings
        } of entities) {
            try {
                const market = await this.db.pg.maybeOne(sql`
            SELECT available from markets 
            where exchange = ${exchange} 
            and asset = ${asset}
            and currency = ${currency};
            `);
                if (!market) throw new Error(`Market ${exchange} ${asset}/${currency} not exists!`);
                let mode = mod || "1";
                const robotsExists = await this.db.pg.any<{
                    id: string;
                    mod: string;
                    createdAt: string;
                    strategySettings: StrategySettings;
                }>(sql`
            SELECT r.id, r.mod, r.created_at, rs.strategy_settings 
            FROM robots r, v_robot_settings rs 
            WHERE rs.robot_id = r.id 
             AND r.exchange = ${exchange}
             AND r.asset = ${asset}
             AND r.currency = ${currency}
             AND r.timeframe = ${timeframe}
             and r.strategy = ${strategy}
            ORDER BY r.created_at DESC
            `);

                if (robotsExists && Array.isArray(robotsExists) && robotsExists.length > 0) {
                    const haveSameSettings = robotsExists.find((r) => equals(strategySettings, r.strategySettings));

                    if (haveSameSettings) throw new Error(`Robot exists!`);
                    const lastRobot = [...robotsExists].sort((a, b) => sortDesc(+a.mod, +b.mod))[0];

                    const tryNumMod = +lastRobot?.mod;
                    mode = (tryNumMod && `${tryNumMod + 1}`) || `${lastRobot.mod}-1`;
                }
                //TODO: check strategy settings
                const id = uuid();
                await this.db.pg.transaction(async (t) => {
                    await t.query(sql`
                INSERT INTO robots (
                    id,
                    code, 
                    name, 
                    exchange, 
                    asset, 
                    currency, 
                    timeframe, 
                    strategy, 
                    mod, 
                    available, 
                    signals, 
                    trading
                ) 
                VALUES (
                    ${id},
                    ${this.#createRobotCode(exchange, asset, currency, timeframe, strategies[strategy], mode)},
                    ${this.#createRobotName(exchange, asset, currency, timeframe, strategies[strategy], mode)},
                    ${exchange},
                    ${asset},
                    ${currency},
                    ${timeframe},
                    ${strategy},
                    ${mode},
                    ${available},
                    ${signals},
                    ${trading}
                );`);

                    await t.query(sql`
              INSERT INTO robot_settings (
                  robot_id,
                  strategy_settings,
                  robot_settings,
                  active_from
              ) 
              VALUES (
                  ${id},
                  ${JSON.stringify(strategySettings)},
                  ${JSON.stringify(robotSettings)},
                  ${dayjs.utc("01.01.2016").toISOString()}
              )
              `);
                });

                importedCount += 1;
            } catch (error) {
                this.log.error(error);
                errors.push(error.message);
                continue;
            }
        }

        return {
            result: `Created ${importedCount} of ${entities.length} robots. ${
                errors.length ? JSON.stringify(errors) : ""
            }`
        };
    }

    async start({ robotId, dateFrom }: RobotRunnerStart): Promise<{ result: string }> {
        const { status, exchange, asset, currency, timeframe, strategySettings } = await this.db.pg.one<{
            status: RobotStatus;
            exchange: string;
            asset: string;
            currency: string;
            timeframe: ValidTimeframe;
            strategySettings: StrategySettings;
        }>(sql`
        SELECT r.status, r.exchange, r.asset, r.currency, r.timeframe, rs.strategy_settings 
        FROM robots r, v_robot_settings rs
        WHERE rs.robot_id = r.id
          AND r.id = ${robotId};
        `);

        //TODO: check exwatcher

        if (status === RobotStatus.started || status === RobotStatus.starting || status === RobotStatus.stopping)
            return { result: status };

        let historyDateFrom;

        const firstCandle = await this.db.pg.maybeOne<{ timestamp: string }>(sql`
            SELECT timestamp 
            FROM candles
            WHERE exchange = ${exchange}
              AND asset = ${asset} 
              AND currency = ${currency}
              AND timeframe = ${timeframe}
              AND type != ${CandleType.previous}
            ORDER BY timestamp  
            OFFSET ${strategySettings.requiredHistoryMaxBars}
            LIMIT 1;
        `);

        if (firstCandle) historyDateFrom = firstCandle.timestamp;
        else {
            const lastCandle = await this.db.pg.maybeOne<{ timestamp: string }>(sql`
            SELECT timestamp 
            FROM candles
            WHERE exchange = ${exchange}
              AND asset = ${asset} 
              AND currency = ${currency}
              AND timeframe = ${timeframe}
              AND type != ${CandleType.previous}
            ORDER BY timestamp DESC  
            LIMIT 1;
        `);
            historyDateFrom = lastCandle.timestamp;
        }

        if (dateFrom)
            historyDateFrom =
                dayjs.utc(historyDateFrom).valueOf() > dayjs.utc(dateFrom).valueOf() ? historyDateFrom : dateFrom;

        historyDateFrom =
            (dayjs.utc(historyDateFrom).valueOf() < dayjs.utc("2017-01-01T00:00:00.000Z").valueOf() &&
                dayjs.utc("2017-01-01T00:00:00.000Z").toISOString()) ||
            historyDateFrom;

        const dateTo = dayjs.utc(Timeframe.getPrevSince(dayjs.utc().toISOString(), timeframe)).toISOString();

        await this.db.pg.query(sql`
        UPDATE robots 
        SET status = ${RobotStatus.starting}
        WHERE id = ${robotId};
        `);

        await this.events.emit<BacktesterRunnerStart>({
            type: BacktesterRunnerEvents.START,
            data: {
                id: robotId,
                robotId,
                dateFrom: historyDateFrom,
                dateTo,
                settings: {
                    populateHistory: true
                }
            }
        });

        return { result: RobotStatus.starting };
    }

    async stop({ robotId }: RobotRunnerStop): Promise<{ result: string }> {
        const { status, exchange } = await this.db.pg.one<{ status: RobotStatus; exchange: string }>(sql`
        SELECT status, exchange 
         FROM robots
        WHERE id = ${robotId}
        `);
        if (status === RobotStatus.stopping || status === RobotStatus.stopped) return { result: status };
        await this.events.emit<RobotRunnerStatus>({
            type: getRobotStatusEventName(exchange),
            data: {
                robotId,
                status: "stop"
            }
        });
        return { result: RobotStatus.stopping };
    }

    async marketsCheck({ exchange }: RobotRunnerMarketsCheck) {
        await this.events.emit({
            type: getMarketsCheckEventName(exchange),
            data: {
                exchange
            }
        });
    }

    async robotsCheck({ exchange }: RobotRunnerRobotsCheck) {
        await this.events.emit({
            type: getRobotsCheckEventName(exchange),
            data: {
                exchange
            }
        });
    }

    #saveRobotHistory = async (robotId: string, type: string, data: { [key: string]: any }) =>
        this.db.pg.query(sql`
            INSERT INTO robot_history
            (robot_id, type, data) 
            VALUES (${robotId}, ${type}, ${JSON.stringify(data) || null})
        `);

    #saveRobotLog = async (robotId: string, data: { [key: string]: any }) =>
        this.db.pg.query(sql`INSERT INTO robot_logs (robot_id, data) 
        VALUES (${robotId}, ${JSON.stringify(data) || null})`);

    async handleRobotWorkerEvents(event: Event) {
        const { robotId } = event.data as { robotId: string };
        if (!robotId) {
            await this.events.emit<BaseServiceError>({
                type: BaseServiceEvents.ERROR,
                data: {
                    service: this.name,
                    error: "robotId required in robot worker events",
                    event
                }
            });
            return;
        }
        const type = event.type.replace("com.cryptuoso.", "");
        const historyType = type.replace(`${ROBOT_WORKER_TOPIC}.`, "");
        this.log.info(`Robot's #${robotId} ${historyType} event`, JSON.stringify(event.data));
        switch (type) {
            case (RobotWorkerEvents.STARTING,
            RobotWorkerEvents.STARTED,
            RobotWorkerEvents.STOPPED,
            RobotWorkerEvents.PAUSED,
            RobotWorkerEvents.ERROR): {
                await this.#saveRobotHistory(robotId, historyType, event.data);
                break;
            }
            case RobotWorkerEvents.LOG: {
                await this.#saveRobotLog(robotId, event.data);
                break;
            }
        }
    }

    async updateMarkets() {
        try {
            while (!this.connector.isInited()) {
                this.log.info("Waiting for connectors to Initialize...");
                await sleep(5000);
            }
            const markets = await this.db.pg.any<{ exchange: string; asset: string; currency: string }>(
                sql`SELECT exchange, asset, currency FROM markets where available >= 5;`
            );
            this.log.info(`Updating ${markets.length} markets`);
            const errors: { exchange: string; asset: string; currency: string; error: string }[] = [];
            for (const market of markets) {
                try {
                    await this.updateMarket(market);
                } catch (error) {
                    this.log.error(
                        `Failed to update market ${market.exchange}.${market.asset}.${market.currency}`,
                        error
                    );
                    errors.push({ ...market, error: error.message });
                }
            }
            if (errors.length > 0) {
                await this.events.emit<BaseServiceError>({
                    type: BaseServiceEvents.ERROR,
                    data: {
                        service: this.name,
                        error: `Failed to update ${errors.length} markets of ${markets.length}`,
                        data: errors
                    }
                });
                throw new Error(`Failed to update ${errors.length} markets of ${markets.length}`);
            }
            await this.db.pg.query(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_exchange_info;`);
            await this.db.pg.query(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_portfolio_limits;`);
            this.log.info(`Updated ${markets.length} markets!`);
        } catch (error) {
            this.log.error("Failed to update markets", error);
            throw error;
        }
    }

    async updateMarket({
        exchange,
        asset,
        currency,
        available = 15
    }: {
        exchange: string;
        asset: string;
        currency: string;
        available?: number;
    }) {
        this.log.debug(`Updating ${exchange}.${asset}.${currency} market...`);
        const { precision, limits, feeRate, loadFrom, info } = await this.connector.getMarket(
            exchange,
            asset,
            currency
        );
        await this.db.pg.query(sql`INSERT INTO markets (
                exchange, asset, currency, precision, limits, fee_rate, load_from, available, info )
                VALUES (
                    ${exchange},
                    ${asset},
                    ${currency},
                    ${JSON.stringify(precision)},
                    ${JSON.stringify(limits)},
                    ${feeRate},
                    ${loadFrom || null},
                    ${available},
                    ${JSON.stringify(info)}
                )
                ON CONFLICT ON CONSTRAINT markets_exchange_asset_currency_key
                DO UPDATE SET precision = excluded.precision, 
                limits = excluded.limits,
                fee_rate = excluded.fee_rate,
                load_from = excluded.load_from,
                info = excluded.info;
            `);
        this.log.debug(`${exchange}.${asset}.${currency} market updated!`);
    }

    async addMarket({
        exchange,
        asset,
        currency,
        available
    }: {
        exchange: string;
        asset: string;
        currency: string;
        available?: number;
    }) {
        try {
            const assetExists = await this.db.pg.maybeOne(sql`
            SELECT code from assets where code = ${asset};
            `);
            if (!assetExists)
                await this.db.pg.query(sql`
            INSERT INTO assets (code,name) VALUES (${asset},${asset});
            `);
            const currencyExists = await this.db.pg.maybeOne(sql`
             SELECT code from currencies where code = ${currency};
             `);
            if (!currencyExists)
                await this.db.pg.query(sql`
             INSERT INTO currencies (code,name) VALUES (${currency},${currency});
             `);
            const marketExists = await this.db.pg.maybeOne(sql`
            SELECT asset from markets where exchange = ${exchange}
            AND asset = ${asset}
            and currency = ${currency};
            `);
            if (!marketExists) await this.updateMarket({ exchange, asset, currency, available: available || 0 });
            return { result: "OK" };
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }

    async addSubscription({ exchange, asset, currency }: { exchange: string; asset: string; currency: string }) {
        await this.events.emit<RobotServiceSubcribe>({
            type: getRobotSubscribeEventName(exchange),
            data: {
                asset,
                currency
            }
        });
    }
}
