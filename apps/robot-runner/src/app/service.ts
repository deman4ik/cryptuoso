import { Job, Queue, Worker } from "bullmq";
import { v4 as uuid } from "uuid";
import { sql } from "slonik";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import {
    RobotRunnerEvents,
    RobotRunnerSchema,
    RobotRunnerCreate,
    RobotRunnerStart,
    RobotRunnerStop
} from "@cryptuoso/robot-events";
import { BacktesterRunnerEvents, BacktesterRunnerStart } from "@cryptuoso/backtester-events";
import { ExwatcherCandle, ExwatcherTick, MarketEvents, MarketSchema } from "@cryptuoso/exwatcher-events";
import { RobotJob, RobotJobType, RobotPosition, RobotStatus } from "@cryptuoso/robot-state";
import { StrategySettings } from "@cryptuoso/robot-settings";
import { equals, robotExchangeName, sortAsc, sortDesc, uniqueElementsBy } from "@cryptuoso/helpers";
import dayjs from "@cryptuoso/dayjs";
import {
    AlertInfo,
    CandleType,
    DBCandle,
    OrderType,
    RobotPositionStatus,
    Timeframe,
    ValidTimeframe
} from "@cryptuoso/market";
export type RobotRunnerServiceConfig = HTTPServiceConfig;

export default class RobotRunnerService extends HTTPService {
    queues: { [key: string]: Queue<any> };
    workers: { [key: string]: Worker };
    constructor(config?: RobotRunnerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                robotCreate: {
                    inputSchema: RobotRunnerSchema[RobotRunnerEvents.CREATE],
                    auth: true,
                    roles: ["manager", "admin"],
                    handler: this.createHTTPHandler
                },
                robotStart: {
                    inputSchema: RobotRunnerSchema[RobotRunnerEvents.START],
                    auth: true,
                    roles: ["manager", "admin"],
                    handler: this.startHTTPHandler
                },
                robotStop: {
                    inputSchema: RobotRunnerSchema[RobotRunnerEvents.STOP],
                    auth: true,
                    roles: ["manager", "admin"],
                    handler: this.stopHTTPHandler
                }
            });

            this.events.subscribe({
                [MarketEvents.CANDLE]: {
                    handler: this.handleNewCandle.bind(this),
                    schema: MarketSchema[MarketEvents.CANDLE]
                },
                [MarketEvents.TICK]: {
                    handler: this.handleNewTick.bind(this),
                    schema: MarketSchema[MarketEvents.TICK]
                }
            });
            this.addOnStartHandler(this.onServiceStart);
            this.addOnStopHandler(this.onServiceStop);
        } catch (err) {
            this.log.error(err, "While consctructing RobotRunnerService");
        }
    }

    async onServiceStart() {
        this.queues = {
            robot: new Queue("robot", { connection: this.redis }),
            alerts: new Queue("alerts", { connection: this.redis })
        };
        this.workers = {
            alerts: new Worker("alerts", async (job: Job) => this.checkAlerts(job), {
                connection: this.redis
            })
        };
        //TODO: robot jobs checker
    }

    async onServiceStop() {
        await this.queues.tick?.close();
        await this.queues.robot?.close();
        await this.workers.alerts?.close();
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

    async queueJob({ robotId, type, data }: RobotJob, status: RobotStatus) {
        await this.db.pg.query(sql`
        INSERT INTO robot_jobs
        (
            robot_id,
            type,
            data
        ) VALUES (
            ${robotId},
            ${type},
            ${JSON.stringify(data) || null}
        )
        ON CONFLICT ON CONSTRAINT robot_jobs_robot_id_type_key 
         DO UPDATE SET updated_at = now(),
         type = excluded.type,
         data = excluded.data
        `);

        if (status === RobotStatus.started) {
            const lastJob = await this.queues.robot.getJob(robotId);
            if (lastJob) {
                const lastJobState = await lastJob.getState();
                if (["unknown", "completed", "failed"].includes(lastJobState)) {
                    try {
                        await lastJob.remove();
                    } catch (e) {
                        this.log.warn(e);
                        return;
                    }
                } else return;
            }
        }

        await this.queues.robot.add("job", null, {
            jobId: robotId,
            removeOnComplete: true,
            removeOnFail: true
        });
    }

    async createHTTPHandler(
        req: {
            body: {
                input: RobotRunnerCreate;
            };
        },
        res: any
    ) {
        const result = await this.create(req.body.input);
        res.send(result);
        res.end();
    }

    async create({ entities }: RobotRunnerCreate): Promise<{ result: string }> {
        //TODO: check market
        const strategiesList: { id: string; code: string }[] = await this.db.pg.many(sql`
        SELECT id, code FROM strategies;
        `);
        const strategies: { [key: string]: string } = {};
        strategiesList.forEach(({ id, code }: { id: string; code: string }) => {
            strategies[id] = code;
        });

        let importedCount = 0;
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
            let mode = mod || "1";
            const robotsExists: {
                id: string;
                mod: string;
                createdAt: string;
                strategySettings: StrategySettings;
            }[] = await this.db.pg.any(sql`
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
                if (haveSameSettings) continue;
                const lastRobot = robotsExists.sort((a, b) =>
                    sortDesc(dayjs.utc(a.createdAt).valueOf(), dayjs.utc(b.createdAt).valueOf())
                )[robotsExists.length - 1];
                const tryNumMod = +lastRobot.mod;
                mode = (tryNumMod && `${tryNumMod + 1}`) || `${lastRobot.mod}-1`;
            }
            const id = uuid();
            await this.db.pg.transaction(async (t) => {
                t.query(sql`
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

                t.query(sql`
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
                  ${dayjs.utc().toISOString()}
              )
              `);
            });

            importedCount += 1;
        }

        return { result: `Created ${importedCount} of ${entities.length} robots` };
    }

    async startHTTPHandler(
        req: {
            body: {
                input: RobotRunnerStart;
            };
        },
        res: any
    ) {
        const result = await this.start(req.body.input);
        res.send(result);
        res.end();
    }

    async start({ robotId, dateFrom }: RobotRunnerStart): Promise<{ result: string }> {
        const {
            status,
            exchange,
            asset,
            currency,
            timeframe,
            strategySettings
        }: {
            status: RobotStatus;
            exchange: string;
            asset: string;
            currency: string;
            timeframe: ValidTimeframe;
            strategySettings: StrategySettings;
        } = await this.db.pg.one(sql`
        SELECT r.status, r.exchange, r.asset, r.currency, r.timeframe, rs.strategy_settings 
        FROM robots r, v_robot_settings rs
        WHERE id = ${robotId};
        `);

        //TODO: check exwatcher
        if (status === RobotStatus.paused) {
            await this.db.pg.query(sql`
            UPDATE robots 
            SET status = ${RobotStatus.started}
            WHERE id = ${robotId};
            `);
        }

        if (status === RobotStatus.started || status === RobotStatus.starting || status === RobotStatus.stopping)
            return { result: status };

        let historyDateFrom;

        const firstCandle: { timestamp: string } = await this.db.pg.maybeOne(sql`
            SELECT timestamp 
            FROM ${sql.identifier([`candles${timeframe}`])}
            WHERE exchange = ${exchange}
              AND asset = ${asset} 
              AND currency = ${currency}
              AND type != ${CandleType.previous}
            ORDER BY time  
            OFFSET ${strategySettings.requiredHistoryMaxBars}
            LIMIT 1;
        `);

        if (firstCandle) historyDateFrom = firstCandle.timestamp;
        else {
            const lastCandle: { timestamp: string } = await this.db.pg.maybeOne(sql`
            SELECT timestamp 
            FROM ${sql.identifier([`candles${timeframe}`])}
            WHERE exchange = ${exchange}
              AND asset = ${asset} 
              AND currency = ${currency}
              AND type != ${CandleType.previous}
            ORDER BY time DESC  
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

    async stopHTTPHandler(
        req: {
            body: {
                input: RobotRunnerStart;
            };
        },
        res: any
    ) {
        const result = await this.stop(req.body.input);
        res.send(result);
        res.end();
    }

    async stop({ robotId }: RobotRunnerStop): Promise<{ result: string }> {
        const status: RobotStatus = await this.db.pg.one(sql`
        SELECT status 
         FROM robots
        WHERE id = ${robotId}
        `);
        if (status === RobotStatus.stopping || status === RobotStatus.stopped) return { result: status };

        return { result: RobotStatus.stopping };
    }

    async handleNewCandle(candle: ExwatcherCandle) {
        try {
            if (candle.type === CandleType.previous) return;
            const { exchange, asset, currency, timeframe, timestamp } = candle;
            const robots: { id: string; status: RobotStatus }[] = await this.db.pg.any(sql`
            SELECT id, status
              FROM robots
             WHERE exchange = ${exchange}
               AND asset = ${asset}
               AND currency = ${currency}
               AND timeframe = ${timeframe} 
               AND status in (${RobotStatus.started}, ${RobotStatus.starting}, ${RobotStatus.paused});
            `);
            this.log.info(
                `New candle ${exchange}.${asset}.${currency}.${timeframe} ${timestamp} required by ${robots.length}`
            );
            await Promise.all(
                robots.map(
                    async ({ id, status }) =>
                        await this.queueJob(
                            {
                                robotId: id,
                                type: RobotJobType.candle,
                                data: candle
                            },
                            status
                        )
                )
            );
        } catch (err) {
            this.log.error("Failed to handle new candle", err);
            throw err;
        }
    }

    async handleNewTick(tick: ExwatcherTick) {
        try {
            const { exchange, asset, currency } = tick;
            const jobId = `${exchange}_${asset}_${currency}`;
            const lastJob = await this.queues.robot.getJob(jobId);
            if (lastJob) {
                const lastJobState = await lastJob.getState();
                if (["unknown", "completed", "failed"].includes(lastJobState)) {
                    try {
                        await lastJob.remove();
                    } catch (e) {
                        this.log.warn(e);
                        return;
                    }
                } else return;
            }
            await this.queues.alerts.add("check", tick, {
                jobId,
                removeOnComplete: true,
                removeOnFail: true
            });
        } catch (err) {
            this.log.error("Failed to handle new tick", err);
            throw err;
        }
    }

    async checkAlerts(job: Job<ExwatcherTick>) {
        try {
            const { exchange, asset, currency } = job.data;
            const allPostions: {
                robotId: string;
                status: RobotStatus;
                alerts: { [key: string]: AlertInfo };
                timeframe: ValidTimeframe;
            }[] = await this.db.pg.any(sql`
            SELECT rp.robot_id, rp.alerts, r.timeframe, r.status
            FROM robot_positions rp, robots r
            WHERE rp.robot_id = r.id
            AND rp.status in (${RobotPositionStatus.new},${RobotPositionStatus.open})
            AND r.exchange = ${exchange}
            AND r.asset = ${asset}
            AND r.currency = ${currency}
            and r.status in (${RobotStatus.started}, ${RobotStatus.starting}, ${RobotStatus.paused});`);

            if (allPostions && Array.isArray(allPostions) && allPostions.length > 0) {
                const timeframes = uniqueElementsBy(
                    allPostions.map((p) => p.timeframe),
                    (a, b) => a === b
                );

                await Promise.all(
                    timeframes.map(async (timeframe) => {
                        const positions = allPostions.filter((pos) => pos.timeframe === timeframe);
                        const candle: DBCandle = await this.db.pg.one(sql`
                            SELECT * 
                            FROM ${sql.identifier([`candles${timeframe}`])}
                            WHERE exchange = ${exchange}
                            AND asset = ${asset}
                            AND currency = ${currency}
                            ORDER BY time DESC
                            LIMIT 1;`);
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

                        await Promise.all(
                            robots.map(async ({ robotId, status }) =>
                                this.queueJob({ robotId, type: RobotJobType.tick, data: job.data }, status)
                            )
                        );
                    })
                );
            }
        } catch (err) {
            this.log.error("Failed to check alerts", err);
        }
    }
}
