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
    ROBOT_WORKER_TOPIC
} from "@cryptuoso/robot-events";
import { BacktesterRunnerEvents, BacktesterRunnerStart } from "@cryptuoso/backtester-events";
import { Queues, RobotJob, RobotJobType, RobotRunnerJobType, RobotStatus } from "@cryptuoso/robot-state";
import { StrategySettings } from "@cryptuoso/robot-settings";
import { equals, robotExchangeName, sortDesc, uniqueElementsBy } from "@cryptuoso/helpers";
import dayjs from "@cryptuoso/dayjs";
import { CandleType, DBCandle, Timeframe, ValidTimeframe } from "@cryptuoso/market";
import { BaseServiceError, BaseServiceEvents, Event } from "@cryptuoso/events";
import { UserRoles } from "@cryptuoso/user-state";
export type RobotRunnerServiceConfig = HTTPServiceConfig;

export default class RobotRunnerService extends HTTPService {
    #robotJobRetries = 3;
    constructor(config?: RobotRunnerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                robotCreate: {
                    inputSchema: RobotRunnerSchema[RobotRunnerEvents.CREATE],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.createHTTPHandler
                },
                robotStart: {
                    inputSchema: RobotRunnerSchema[RobotRunnerEvents.START],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.startHTTPHandler
                },
                robotStop: {
                    inputSchema: RobotRunnerSchema[RobotRunnerEvents.STOP],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.stopHTTPHandler
                }
            });

            this.events.subscribe({
                [`${ROBOT_WORKER_TOPIC}.*`]: {
                    passFullEvent: true,
                    handler: this.handleRobotWorkerEvents.bind(this)
                }
            });

            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error("Error while constructing RobotRunnerService", err);
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
            removeOnComplete: 1,
            removeOnFail: 10
        });
        await this.addJob(Queues.robotRunner, RobotRunnerJobType.newCandles, null, {
            jobId: RobotRunnerJobType.newCandles,
            repeat: {
                cron: "0 */5 * * * *"
            },
            removeOnComplete: 1,
            removeOnFail: 10
        });

        await this.addJob(Queues.robotRunner, RobotRunnerJobType.idleRobotJobs, null, {
            jobId: RobotRunnerJobType.idleRobotJobs,
            repeat: {
                cron: "*/30 * * * * *"
            },
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

    async queueRobotJob(robotId: string) {
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
        if (status === RobotStatus.started) await this.queueRobotJob(robotId);
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
                this.log.debug(haveSameSettings);
                if (haveSameSettings) continue;
                const lastRobot = [...robotsExists].sort((a, b) => sortDesc(+a.mod, +b.mod))[0];
                this.log.debug(lastRobot?.mod);
                const tryNumMod = +lastRobot?.mod;
                mode = (tryNumMod && `${tryNumMod + 1}`) || `${lastRobot.mod}-1`;
                this.log.debug(mode);
            }
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
        const { status } = await this.db.pg.one<{ status: RobotStatus }>(sql`
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
                await this.scheduleAlerts();
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
        return { result: "ok" };
    }

    async scheduleAlerts() {
        try {
            const entities = await this.db.pg.any<{
                exchange: string;
                asset: string;
                currency: string;
                timeframe: ValidTimeframe;
            }>(sql`
            SELECT distinct r.exchange, r.asset, r.currency, r.timeframe
            FROM robots r
            WHERE r.has_alerts = true
            AND r.status = ${RobotStatus.started};`);

            if (entities && Array.isArray(entities) && entities.length > 0) {
                await Promise.all(
                    entities.map(async ({ exchange, asset, currency, timeframe }) => {
                        await this.addJob(
                            Queues.robot,
                            "checkAlerts",
                            { exchange, asset, currency, timeframe },
                            {
                                jobId: `${exchange}.${asset}.${currency}.${timeframe}`,
                                removeOnComplete: true,
                                removeOnFail: 100
                            }
                        );
                    })
                );
            }
        } catch (err) {
            this.log.error("Failed to schedule alerts check", err);
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
                            FROM candles
                            WHERE exchange = ${exchange}
                            AND asset = ${asset}
                            AND currency = ${currency}
                            AND timeframe = ${timeframe}
                            AND timestamp = ${dayjs.utc(prevTime).toISOString()};`);

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
        SELECT distinct rj.robot_id 
        FROM robot_jobs rj, robots r
        WHERE rj.robot_id = r.id 
        AND r.status = ${RobotStatus.started}
        AND (rj.retries is null OR rj.retries < ${this.#robotJobRetries})
        AND rj.updated_at < ${dayjs.utc().add(-1, "minute").toISOString()}
        `);

            if (robotsWithJobs && Array.isArray(robotsWithJobs) && robotsWithJobs.length) {
                await Promise.all(robotsWithJobs.map(async ({ robotId }) => this.queueRobotJob(robotId)));
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
}
