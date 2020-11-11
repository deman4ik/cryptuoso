import { Job } from "bullmq";
import { v4 as uuid } from "uuid";
import { sql } from "slonik";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import {
    RobotRunnerEvents,
    RobotRunnerSchema,
    RobotRunnerCreate,
    RobotRunnerStart,
    RobotRunnerStop,
    RobotWorkerEvents,
    ROBOT_WORKER_TOPIC,
    SignalEvents,
    SignalSchema,
    Signal
} from "@cryptuoso/robot-events";
import { BacktesterRunnerEvents, BacktesterRunnerStart } from "@cryptuoso/backtester-events";
import { Queues, RobotJob, RobotJobType, RobotPosition, RobotRunnerJobType, RobotStatus } from "@cryptuoso/robot-state";
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
import { Event } from "@cryptuoso/events";
export type RobotRunnerServiceConfig = HTTPServiceConfig;

export default class RobotRunnerService extends HTTPService {
    #robotJobRetries = 3;
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
                [`${ROBOT_WORKER_TOPIC}.*`]: {
                    passFullEvent: true,
                    handler: this.handleRobotWorkerEvents.bind(this)
                },
                [SignalEvents.ALERT]: {
                    handler: this.handleSignalEvents.bind(this),
                    schema: SignalSchema[SignalEvents.ALERT]
                },
                [SignalEvents.TRADE]: {
                    handler: this.handleSignalEvents.bind(this),
                    schema: SignalSchema[SignalEvents.TRADE]
                }
            });

            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error(err, "While constructing RobotRunnerService");
        }
    }

    async onServiceStart() {
        this.createQueue(Queues.robot);

        this.createQueue(Queues.robotRunner);
        this.createWorker(Queues.robotRunner, this.process);
        await this.addJob(Queues.robotRunner, RobotRunnerJobType.alerts, null, {
            jobId: RobotRunnerJobType.alerts,
            repeat: {
                every: 1000
            },
            removeOnComplete: true,
            removeOnFail: 100
        });
        await this.addJob(Queues.robotRunner, RobotRunnerJobType.newCandles, null, {
            jobId: RobotRunnerJobType.newCandles,
            repeat: {
                cron: "0 */5 * * * *"
            },
            removeOnComplete: true,
            removeOnFail: 100
        });

        await this.addJob(Queues.robotRunner, RobotRunnerJobType.idleRobotJobs, null, {
            jobId: RobotRunnerJobType.idleRobotJobs,
            repeat: {
                cron: "*/30 * * * * *"
            },
            removeOnComplete: true,
            removeOnFail: 100
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

    async checkAndQueueRobotJob(robotId: string) {
        const lastJob = await this.queues[Queues.robot].instance.getJob(robotId);
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

        await this.addJob(
            Queues.robot,
            "job",
            { robotId },
            {
                jobId: robotId,
                removeOnComplete: true,
                removeOnFail: 100
            }
        );
    }

    async addRobotJob({ robotId, type, data }: RobotJob, status: RobotStatus) {
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
         data = excluded.data,
         retries = null,
         error = null;
        `);
        if (status === RobotStatus.started) await this.checkAndQueueRobotJob(robotId);
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
        const strategiesList = await this.db.pg.many<{ id: string; code: string }>(sql`
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
                if (haveSameSettings) continue;
                const lastRobot = [...robotsExists].sort((a, b) =>
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

        const firstCandle = await this.db.pg.maybeOne<{ timestamp: string }>(sql`
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
            const lastCandle = await this.db.pg.maybeOne<{ timestamp: string }>(sql`
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
        await this.addRobotJob({ robotId, type: RobotJobType.stop, data: { robotId } }, status);
        return { result: RobotStatus.stopping };
    }

    async process(job: Job) {
        switch (job.name) {
            case RobotRunnerJobType.alerts:
                await this.checkAlerts();
                break;
            case RobotRunnerJobType.newCandles:
                await this.handleNewCandles();
                break;
            case RobotRunnerJobType.idleRobotJobs:
                await this.checkIdleRobotJobs();
                break;
            default:
                this.log.error(`Unknow job ${job.name}`);
        }
    }

    async checkAlerts() {
        try {
            const entities = await this.db.pg.any<{
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
            AND r.status in (${RobotStatus.started}, ${RobotStatus.starting}, ${RobotStatus.paused});`);

            if (entities && Array.isArray(entities) && entities.length > 0) {
                const markets = uniqueElementsBy(
                    entities.map(({ exchange, asset, currency, timeframe }) => ({
                        exchange,
                        asset,
                        currency,
                        timeframe
                    })),
                    (a, b) =>
                        a.exchange === b.exchange &&
                        a.asset === b.asset &&
                        a.currency === b.currency &&
                        a.timeframe === b.timeframe
                );

                await Promise.all(
                    markets.map(async ({ exchange, asset, currency, timeframe }) => {
                        const positions = entities.filter(
                            (e) =>
                                e.exchange === exchange &&
                                e.asset === asset &&
                                e.currency === currency &&
                                e.timeframe === timeframe
                        );
                        const currentTime = Timeframe.getCurrentSince(1, timeframe);
                        const candle = await this.db.pg.maybeOne<DBCandle>(sql`
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
                            return;
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

                        await Promise.all(
                            robots.map(async ({ robotId, status }) =>
                                this.addRobotJob({ robotId, type: RobotJobType.tick }, status)
                            )
                        );
                    })
                );
            }
        } catch (err) {
            this.log.error("Failed to check alerts", err);
        }
    }

    async handleNewCandles() {
        try {
            const currentDate = dayjs.utc().startOf("minute").toISOString();
            this.log.debug(`handleNewCandles ${currentDate}`);
            const currentTimeframes = Timeframe.timeframesByDate(currentDate);

            if (currentTimeframes.length) {
                this.log.info(`Handling new ${currentTimeframes.join(", ")} candles`);
                const robots = await this.db.pg.any<{
                    id: string;
                    status: RobotStatus;
                    exchange: string;
                    asset: string;
                    currency: string;
                    timeframe: ValidTimeframe;
                }>(sql`
                SELECT id, status, exchange, asset, currency, timeframe 
                  FROM robots
                 WHERE timeframe in (${sql.join(currentTimeframes, sql`, `)}) 
                   AND status in (${RobotStatus.started}, ${RobotStatus.starting}, ${RobotStatus.paused})
                `);
                if (!robots || !robots.length) return;
                await Promise.all(
                    currentTimeframes.map(async (timeframe) => {
                        const robotsInTimeframe = robots.filter((r) => r.timeframe === timeframe);
                        if (!robotsInTimeframe.length) return;
                        const markets = uniqueElementsBy(
                            robotsInTimeframe.map(({ exchange, asset, currency, timeframe }) => ({
                                exchange,
                                asset,
                                currency,
                                timeframe
                            })),
                            (a, b) =>
                                a.exchange === b.exchange &&
                                a.asset === b.asset &&
                                a.currency === b.currency &&
                                a.timeframe === b.timeframe
                        );
                        await Promise.all(
                            markets.map(async ({ exchange, asset, currency, timeframe }) => {
                                const prevTime = Timeframe.getPrevSince(currentDate, timeframe);
                                const candle = await this.db.pg.maybeOne<DBCandle>(sql`
                            SELECT * 
                            FROM ${sql.identifier([`candles${timeframe}`])}
                            WHERE exchange = ${exchange}
                            AND asset = ${asset}
                            AND currency = ${currency}
                            AND time = ${prevTime};`);

                                if (!candle) {
                                    this.log.error(
                                        `Failed to load ${exchange}-${asset}-${currency}-${timeframe}-${dayjs
                                            .utc(prevTime)
                                            .toISOString()} candle`
                                    );
                                    //TODO: send error event
                                    return;
                                }

                                const robotsToSend = robotsInTimeframe.filter(
                                    (r) =>
                                        r.exchange === exchange &&
                                        r.asset === asset &&
                                        r.currency === currency &&
                                        r.timeframe === timeframe
                                );
                                this.log.info(
                                    `New candle ${exchange}.${asset}.${currency}.${timeframe} ${dayjs
                                        .utc(prevTime)
                                        .toISOString()} required by ${robotsToSend.length}`
                                );
                                await Promise.all(
                                    robotsToSend.map(async ({ id, status }) =>
                                        this.addRobotJob(
                                            {
                                                robotId: id,
                                                type: RobotJobType.candle,
                                                data: { ...candle, timeframe }
                                            },
                                            status
                                        )
                                    )
                                );
                            })
                        );
                    })
                );
            }
        } catch (error) {
            this.log.error("Failed to handle new candle", error);
        }
    }

    async checkIdleRobotJobs() {
        try {
            const robotsWithJobs = await this.db.pg.any<{ robotId: string }>(sql`
        SELECT distinct robot_id 
        FROM robot_jobs rj, robots r
        WHERE rj.robot_id = r.id 
        AND r.status = ${RobotStatus.started}
        AND (rj.retries is null OR rj.retries < ${this.#robotJobRetries})
        AND rj.updated_at < ${dayjs.utc().add(-1, "minute").toISOString()}
        `);

            if (robotsWithJobs && Array.isArray(robotsWithJobs) && robotsWithJobs.length) {
                await Promise.all(robotsWithJobs.map(async ({ robotId }) => this.checkAndQueueRobotJob(robotId)));
            }
        } catch (err) {
            this.log.error("Failed to idle robot jobs", err);
        }
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

    async handleSignalEvents(event: Signal) {
        const {
            id,
            robotId,
            action,
            orderType,
            price,
            type,
            positionId,
            positionPrefix,
            positionCode,
            positionParentId,
            candleTimestamp,
            timestamp
        } = event;
        this.log.info(`Robot's #${robotId} ${type} event`, JSON.stringify(event));
        await this.db.pg.query(sql`
            INSERT INTO robot_signals
            (id, robot_id, action, order_type, price, type, position_id,
            position_prefix, position_code, position_parent_id,
            candle_timestamp,timestamp)
            VALUES (${id}, ${robotId}, ${action}, ${orderType}, ${price || null}, ${type},
            ${positionId}, ${positionPrefix}, ${positionCode}, ${positionParentId || null}, ${candleTimestamp},
            ${timestamp})
        `);
    }
}
