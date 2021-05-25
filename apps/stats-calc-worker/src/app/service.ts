import { DataStream } from "scramjet";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { Job } from "bullmq";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { StatisticsUtils } from "./statsWorker";
import { sql, QueryType, makeChunksGenerator } from "@cryptuoso/postgres";
import { checkTradeStats, TradeStats } from "@cryptuoso/stats-calc";
import { UserAggrStatsTypes } from "@cryptuoso/user-state";
import {
    StatsCalcJob,
    StatsCalcJobType,
    StatsCalcWorkerErrorEvent,
    StatsCalcWorkerEvents
} from "@cryptuoso/stats-calc-events";
import { BasePosition } from "@cryptuoso/market";
import Validator, { ValidationSchema, SyncCheckFunction, AsyncCheckFunction } from "fastest-validator";
import dayjs from "dayjs";

type UserSignalStats = {
    id: string;
    userId: string;
    robotId: string;
    subscribedAt: string;
} & TradeStats; //TODO: Use user-signal-state types

export function getCalcFromAndInitStats(stats?: TradeStats, calcAll?: boolean) {
    let calcFrom: string = null;
    let initStats: TradeStats = null;

    if (!calcAll && stats && checkTradeStats(stats) === true) {
        initStats = {
            statistics: stats.statistics,
            firstPositionEntryDate: stats.firstPositionEntryDate,
            lastPositionExitDate: stats.lastPositionExitDate,
            lastUpdatedAt: stats.lastUpdatedAt,
            equity: stats.equity,
            equityAvg: stats.equityAvg
        };
        calcFrom = stats.lastPositionExitDate;
    }

    return { calcFrom, initStats };
}

interface TradeStatsWithId extends TradeStats {
    id: string;
}

export interface StatisticCalcWorkerServiceConfig extends BaseServiceConfig {
    maxSingleQueryPosCount?: number;
    defaultChunkSize?: number;
}

export default class StatisticCalcWorkerService extends BaseService {
    private pool: Pool<any>;
    private dummy = "-";
    private routes: {
        [K in StatsCalcJobType]?: {
            validate: SyncCheckFunction | AsyncCheckFunction;
            handler: (params: StatsCalcJob) => Promise<boolean>;
        };
    } = {};

    maxSingleQueryPosCount: number;
    defaultChunkSize: number;

    makeChunksGenerator: (query: QueryType, chunkSize?: number) => () => AsyncGenerator<any[], void, unknown>;

    constructor(config?: StatisticCalcWorkerServiceConfig) {
        super(config);

        try {
            this.maxSingleQueryPosCount = config?.maxSingleQueryPosCount || 750;
            this.defaultChunkSize = config?.defaultChunkSize || 500;

            this.makeChunksGenerator = makeChunksGenerator.bind(undefined, this.db.pg);
            this.addOnStartHandler(this._onServiceStart);
            this.addOnStopHandler(this._onServiceStop);

            const assetOrExchangeSchema = {
                type: "string",
                default: null as string,
                optional: true
            };

            const withAssetExchangeSchema = {
                exchange: assetOrExchangeSchema,
                asset: assetOrExchangeSchema
            };

            this.makeHandlers({
                [StatsCalcJobType.robot]: {
                    schema: {
                        robotId: "uuid"
                    },
                    handler: this.calcRobot.bind(this)
                },
                [StatsCalcJobType.robotsAggr]: {
                    schema: withAssetExchangeSchema,
                    handler: this.calcRobotsAggr.bind(this)
                },
                [StatsCalcJobType.usersRobotsAggr]: {
                    schema: withAssetExchangeSchema,
                    handler: this.calcUsersRobotsAggr.bind(this)
                },
                [StatsCalcJobType.userRobot]: {
                    schema: {
                        userRobotId: "uuid"
                    },
                    handler: this.calcUserRobot.bind(this)
                },
                [StatsCalcJobType.userSignal]: {
                    schema: {
                        userId: "uuid",
                        robotId: "uuid"
                    },
                    handler: this.calcUserSignal.bind(this)
                },
                [StatsCalcJobType.userSignals]: {
                    schema: {
                        robotId: "uuid"
                    },
                    handler: this.calcUserSignals.bind(this)
                },
                [StatsCalcJobType.userSignalsAggr]: {
                    schema: {
                        userId: "uuid",
                        ...withAssetExchangeSchema
                    },
                    handler: this.calcUserSignalsAggr.bind(this)
                },
                [StatsCalcJobType.userRobotAggr]: {
                    schema: {
                        userId: "uuid",
                        ...withAssetExchangeSchema
                    },
                    handler: this.calcUserRobotsAggr.bind(this)
                }
            });
        } catch (err) {
            this.log.error("Error in StatisticCalcWorkerService constructor", err);
        }
    }

    private async makeHandlers(
        handlers: {
            [K in StatsCalcJobType]?: {
                schema: ValidationSchema;
                handler: (params: StatsCalcJob) => Promise<boolean>;
            };
        }
    ) {
        const v = new Validator();

        for (const [name, { schema, handler }] of Object.entries(handlers)) {
            this.routes[name as StatsCalcJobType] = {
                validate: v.compile({
                    ...schema,
                    calcAll: {
                        type: "boolean",
                        optional: true
                    },
                    $$strict: true
                }),
                handler
            };
        }
    }

    private async _onServiceStart(): Promise<void> {
        this.pool = Pool(() => spawn<StatisticsUtils>(new ThreadsWorker("./statsWorker")), {
            name: "statistics-utils",
            concurrency: 10
        });
        this.createWorker("calcStatistics", this.process);
    }

    private async _onServiceStop(): Promise<void> {
        await this.pool.terminate();
    }

    async process(job: Job<StatsCalcJob>) {
        const type = job.name as StatsCalcJobType;
        const params = job.data as StatsCalcJob;

        this.log.info(`Starting job ${job.id}`);

        //const locker = this.makeLocker(null, 5000);

        try {
            const route = this.routes[type];

            if (!route) throw new Error(`Unknown job type ${type}`);

            const errors = route.validate(params);

            if (errors !== true && Array.isArray(errors)) {
                throw new Error(`Bad params: ${errors.map((e) => e.message).join("\n")}`);
            }

            /* try {
                const paramsKeyPart = Object.keys(params)
                    .filter((prop) => prop != "calcAll")
                    .sort()
                    .map((prop: keyof StatsCalcJob) => params[prop])
                    .join(",");
                //console.log(paramsKeyPart);
                await locker.lock(`lock:${this.name}:${type}(${paramsKeyPart})`);
            } catch (err) {
                //this.log.info(`Can't create lock for job ${job.id}`);
                return;
            } */

            await route.handler(params);

            //await locker.unlock();
            this.log.info(`Job ${job.id} finished`);
            return { result: "ok" };
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}: ${type}(${JSON.stringify(params)})`, err);
            //await locker.unlock();
            throw err;
        }
    }

    private async upsertStats(
        params: {
            table: QueryType;
            constraint: QueryType;
            addFields?: QueryType;
            addFieldsValues?: QueryType;
        },
        stats: TradeStats
    ): Promise<void> {
        await this.db.pg.query(sql`
                INSERT INTO ${params.table} (
                    statistics,
                    first_position_entry_date,
                    last_position_exit_date,
                    last_updated_at,
                    equity,
                    equity_avg          
                    ${params.addFields ? sql`, ${params.addFields}` : sql``}
                ) VALUES (
                    ${JSON.stringify(stats.statistics)},
                    ${stats.firstPositionEntryDate},
                    ${stats.lastPositionExitDate},
                    ${stats.lastUpdatedAt},
                    ${JSON.stringify(stats.equity)},
                    ${JSON.stringify(stats.equityAvg)}
                    ${params.addFieldsValues ? sql`, ${params.addFieldsValues}` : sql``}
                ) ON CONFLICT ON CONSTRAINT ${params.constraint}
                DO UPDATE SET statistics = excluded.statistics,
                    first_position_entry_date = excluded.first_position_entry_date,
                    last_position_exit_date = excluded.last_position_exit_date,
                    last_updated_at = excluded.last_updated_at,
                    equity = excluded.equity,
                    equity_avg = excluded.equity_avg;
            `);
    }

    async calcStatistics(prevStats: TradeStats, positions: BasePosition[]) {
        return await this.pool.queue(async (utils: StatisticsUtils) => utils.calcStatistics(prevStats, positions));
    }

    async calcRobot({ robotId, calcAll = false }: { robotId: string; calcAll?: boolean }) {
        try {
            const prevTradeStats = await this.db.pg.maybeOne<TradeStats>(sql`
            SELECT rs.*
            FROM robots r
            LEFT JOIN robot_stats rs
                ON r.id = rs.robot_id
            WHERE r.id = ${robotId};
        `);

            if (!prevTradeStats) throw new Error(`The robot doesn't exists (robotId: ${robotId})`);

            const { calcFrom, initStats } = getCalcFromAndInitStats(prevTradeStats, calcAll);

            const conditionExitDate = !calcFrom ? sql`` : sql`AND exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT id, direction, entry_date, exit_date, profit, bars_held
        `;
            const queryFromAndConditionPart = sql`
            FROM v_robot_positions
            WHERE robot_id = ${robotId}
                AND status = 'closed'
                ${conditionExitDate}
        `;
            const queryCommonPart = sql`
            ${querySelectPart}
            ${queryFromAndConditionPart}
            ORDER BY exit_date
        `;

            const positionsCount = await this.db.pg.oneFirst<number>(sql`
            SELECT COUNT(1)
            ${queryFromAndConditionPart};
        `);

            if (positionsCount == 0) return false;

            const newStats = await DataStream.from(
                this.makeChunksGenerator(
                    queryCommonPart,
                    positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
                )
            ).reduce(
                async (prevStats: TradeStats, chunk: BasePosition[]) => await this.calcStatistics(prevStats, chunk),
                initStats
            );

            await this.upsertStats(
                {
                    table: sql`robot_stats`,
                    constraint: sql`robots_stats_pkey`,
                    addFields: sql`robot_id`,
                    addFieldsValues: sql`${robotId}`
                },
                newStats
            );

            return true;
        } catch (err) {
            this.log.error("Failed to calcRobot stats", err);
            this.log.debug({
                method: "calcRobot",
                robotId,
                calcAll,
                timestamp: dayjs.utc().toISOString(),
                error: err.message
            });
            await this.events.emit<StatsCalcWorkerErrorEvent>({
                type: StatsCalcWorkerEvents.ERROR,
                data: {
                    method: "calcRobot",
                    robotId,
                    calcAll,
                    timestamp: dayjs.utc().toISOString(),
                    error: err.message
                }
            });
            throw err;
        }
    }

    async calcRobotsAggr({
        exchange = null,
        asset = null,
        calcAll = false
    }: {
        exchange?: string;
        asset?: string;
        calcAll?: boolean;
    }) {
        try {
            const exchangeCondition = exchange || this.dummy;
            const assetCondition = asset || this.dummy;
            const prevRobotsAggrStats = await this.db.pg.maybeOne<TradeStatsWithId>(sql`
            SELECT id,
                statistics,
                first_position_entry_date,
                last_position_exit_date,
                last_updated_at,
                equity,
                equity_avg
            FROM robot_aggr_stats
            WHERE exchange = ${exchangeCondition}
              AND asset = ${assetCondition};
        `);

            if (prevRobotsAggrStats) {
                let WHERE = sql``;

                if (exchange && asset) {
                    WHERE = sql`WHERE exchange = ${exchange} AND asset = ${asset}`;
                } else if (exchange) {
                    WHERE = sql`WHERE exchange = ${exchange}`;
                } else if (asset) {
                    WHERE = sql`WHERE asset = ${asset}`;
                }

                const countOfRobots = await this.db.pg.oneFirst<number>(sql`
                SELECT COUNT(1)
                FROM robots
                ${WHERE};
            `);

                if (countOfRobots === 0) {
                    await this.db.pg.query(sql`
                    DELETE
                    FROM robot_aggr_stats
                    WHERE id = ${prevRobotsAggrStats.id};
                `);

                    return false;
                }
            }

            const { calcFrom, initStats } = getCalcFromAndInitStats(prevRobotsAggrStats, calcAll);

            const conditionExchange = !exchange ? sql`` : sql`AND r.exchange = ${exchange}`;
            const conditionAsset = !asset ? sql`` : sql`AND r.asset = ${asset}`;
            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.exit_date, p.profit, p.bars_held
        `;
            const queryFromAndConditionPart = sql`
            FROM v_robot_positions p,
                robots r
            WHERE r.id = p.robot_id
            ${conditionExchange}
            ${conditionAsset}
            AND p.status = 'closed'
            ${conditionExitDate}
        `;
            const queryCommonPart = sql`
            ${querySelectPart}
            ${queryFromAndConditionPart}
            ORDER BY p.exit_date
        `;

            const positionsCount = await this.db.pg.oneFirst<number>(sql`
            SELECT COUNT(1)
            ${queryFromAndConditionPart};
        `);

            if (positionsCount == 0) return false;

            const newStats = await DataStream.from(
                this.makeChunksGenerator(
                    queryCommonPart,
                    positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
                )
            ).reduce(
                async (prevStats: TradeStats, chunk: BasePosition[]) => await this.calcStatistics(prevStats, chunk),
                initStats
            );

            await this.upsertStats(
                {
                    table: sql`robot_aggr_stats`,
                    constraint: sql`robot_aggr_stats_exchange_asset_key`,
                    addFields: sql`exchange, asset`,
                    addFieldsValues: sql`${exchangeCondition}, ${assetCondition}`
                },
                newStats
            );

            return true;
        } catch (err) {
            this.log.error("Failed to calcRobotsAggr stats", err);
            this.log.debug({
                method: "calcRobotsAggr",
                exchange,
                asset,
                calcAll,
                timestamp: dayjs.utc().toISOString(),
                error: err.message
            });
            await this.events.emit<StatsCalcWorkerErrorEvent>({
                type: StatsCalcWorkerEvents.ERROR,
                data: {
                    method: "calcRobotsAggr",
                    exchange,
                    asset,
                    calcAll,
                    timestamp: dayjs.utc().toISOString(),
                    error: err.message
                }
            });
            throw err;
        }
    }

    async calcUsersRobotsAggr({
        exchange = null,
        asset = null,
        calcAll = false
    }: {
        exchange?: string;
        asset?: string;
        calcAll?: boolean;
    }) {
        try {
            const exchangeCondition = exchange || this.dummy;
            const assetCondition = asset || this.dummy;
            const prevUsersRobotsAggrStats = await this.db.pg.maybeOne<TradeStatsWithId>(sql`
            SELECT id,
                statistics,
                first_position_entry_date,
                last_position_exit_date,
                last_updated_at,
                equity,
                equity_avg
            FROM user_robot_aggr_stats
            WHERE exchange = ${exchangeCondition}
                AND asset = ${assetCondition};
        `);

            if (prevUsersRobotsAggrStats) {
                const countOfUsersRobots = await this.db.pg.oneFirst<number>(sql`
                SELECT COUNT(1)
                FROM user_robots ur,
                    robots r
                WHERE r.id = ur.robot_id
                    ${!exchange ? sql`` : sql`AND r.exchange = ${exchange}`}
                    ${!asset ? sql`` : sql`AND r.asset = ${asset}`};
            `);

                if (countOfUsersRobots === 0) {
                    await this.db.pg.query(sql`
                    DELETE
                    FROM user_robot_aggr_stats
                    WHERE id = ${prevUsersRobotsAggrStats.id};
                `);

                    return false;
                }
            }

            const { calcFrom, initStats } = getCalcFromAndInitStats(prevUsersRobotsAggrStats, calcAll);

            const conditionExchange = !exchange ? sql`` : sql`AND exchange = ${exchange}`;
            const conditionAsset = !asset ? sql`` : sql`AND asset = ${asset}`;
            const conditionExitDate = !calcFrom ? sql`` : sql`AND exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT id, direction, entry_date, exit_date, profit, bars_held
        `;
            const queryFromAndConditionPart = sql`
            FROM user_positions
            WHERE status IN ('closed', 'closedAuto')
            ${conditionExchange}
            ${conditionAsset}
            ${conditionExitDate}
        `;
            const queryCommonPart = sql`
            ${querySelectPart}
            ${queryFromAndConditionPart}
            ORDER BY exit_date
        `;

            const positionsCount = await this.db.pg.oneFirst<number>(sql`
            SELECT COUNT(1)
            ${queryFromAndConditionPart};
        `);

            if (positionsCount == 0) return false;

            const newStats = await DataStream.from(
                this.makeChunksGenerator(
                    queryCommonPart,
                    positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
                )
            ).reduce(
                async (prevStats: TradeStats, chunk: BasePosition[]) => await this.calcStatistics(prevStats, chunk),
                initStats
            );

            await this.upsertStats(
                {
                    table: sql`user_robot_aggr_stats`,
                    constraint: sql`user_robot_aggr_stats_exchange_asset_key`,
                    addFields: sql`exchange, asset`,
                    addFieldsValues: sql`${exchangeCondition}, ${assetCondition}`
                },
                newStats
            );

            return true;
        } catch (err) {
            this.log.error("Failed to calcUsersRobotsAggr stats", err);
            this.log.debug({
                method: "calcUsersRobotsAggr",
                exchange,
                asset,
                calcAll,
                timestamp: dayjs.utc().toISOString(),
                error: err.message
            });
            await this.events.emit<StatsCalcWorkerErrorEvent>({
                type: StatsCalcWorkerEvents.ERROR,
                data: {
                    method: "calcUsersRobotsAggr",
                    exchange,
                    asset,
                    calcAll,
                    timestamp: dayjs.utc().toISOString(),
                    error: err.message
                }
            });
            throw err;
        }
    }

    private async _calcDownloadedUserSignal(userSignal: UserSignalStats, calcAll = false) {
        const locker = this.makeLocker(
            `lock:stats-calc-worker:_innerUserSignal(${userSignal.userId}, ${userSignal.robotId})`,
            5000
        );

        try {
            await locker.lock();

            const { calcFrom, initStats } = getCalcFromAndInitStats(userSignal, calcAll);

            const conditionExitDate = !calcFrom ? sql`` : sql`AND exit_date > ${calcFrom}`;
            const querySelectPart = sql`
                SELECT id, direction, entry_date, exit_date, profit, bars_held
            `;
            const queryFromAndConditionPart = sql`
                FROM v_user_signal_positions
                WHERE user_id = ${userSignal.userId}
                    AND robot_id = ${userSignal.robotId}
                    AND status = 'closed'
                    AND entry_date >= ${userSignal.subscribedAt}
                    ${conditionExitDate}
            `;
            const queryCommonPart = sql`
                ${querySelectPart}
                ${queryFromAndConditionPart}
                ORDER BY exit_date
            `;

            const positionsCount = await this.db.pg.oneFirst<number>(sql`
                SELECT COUNT(1)
                ${queryFromAndConditionPart};
            `);

            if (positionsCount == 0) {
                await locker.unlock();
                return false;
            }

            const newStats = await DataStream.from(
                this.makeChunksGenerator(
                    queryCommonPart,
                    positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
                )
            ).reduce(
                async (prevStats: TradeStats, chunk: BasePosition[]) => await this.calcStatistics(prevStats, chunk),
                initStats
            );

            await this.upsertStats(
                {
                    table: sql`user_signal_stats`,
                    constraint: sql`user_signals_stats_pkey`,
                    addFields: sql`user_signal_id`,
                    addFieldsValues: sql`${userSignal.id}`
                },
                newStats
            );

            await locker.unlock();

            return true;
        } catch (err) {
            this.log.error("Failed to _calcDownloadedUserSignal", err);
            await locker.unlock();
            throw err;
        }
    }

    async calcUserSignal({ userId, robotId, calcAll = false }: { userId: string; robotId: string; calcAll?: boolean }) {
        try {
            const userSignal = await this.db.pg.maybeOne<UserSignalStats>(sql`
            SELECT us.id, us.user_id, us.robot_id, us.subscribed_at,
                uss.statistics,
                uss.first_position_entry_date,
                uss.last_position_exit_date,
                uss.last_updated_at,
                uss.equity,
                uss.equity_avg
            FROM user_signals us
            LEFT JOIN user_signal_stats uss
                ON us.id = uss.user_signal_id
            WHERE us.robot_id = ${robotId}
            AND us.user_id = ${userId};
        `);

            if (!userSignal) throw new Error(`The signal doesn't exists (userId: ${userId}, robotId: ${robotId})`);

            return await this._calcDownloadedUserSignal(userSignal, calcAll);
        } catch (err) {
            this.log.error("Failed to calcUserSignal stats", err);
            this.log.debug({
                method: "calcUserSignal",
                userId,
                robotId,
                calcAll,
                timestamp: dayjs.utc().toISOString(),
                error: err.message
            });
            await this.events.emit<StatsCalcWorkerErrorEvent>({
                type: StatsCalcWorkerEvents.ERROR,
                data: {
                    method: "calcUserSignal",
                    userId,
                    robotId,
                    calcAll,
                    timestamp: dayjs.utc().toISOString(),
                    error: err.message
                }
            });
            throw err;
        }
    }

    async calcUserSignals({ robotId, calcAll = false }: { robotId: string; calcAll?: boolean }) {
        try {
            const userSignals = await this.db.pg.any<UserSignalStats>(sql`
            SELECT us.id, 
                us.user_id, 
                us.robot_id, 
                us.subscribed_at,
                uss.statistics,
                uss.first_position_entry_date,
                uss.last_position_exit_date,
                uss.last_updated_at,
                uss.equity,
                uss.equity_avg
            FROM user_signals us
            LEFT JOIN user_signal_stats uss
                ON us.id = uss.user_signal_id
            WHERE us.robot_id = ${robotId};
        `);

            if (userSignals.length == 0) return false; // throw new Error(`Signals doesn't exists (robotId: ${robotId})`);

            let res = false;

            for (const signal of userSignals) {
                const result = await this._calcDownloadedUserSignal(signal, calcAll);
                res = res || result;
            }

            return res;
        } catch (err) {
            this.log.error("Failed to calcUserSignal stats", err);
            this.log.debug({
                method: "calcUserSignal",
                robotId,
                calcAll,
                timestamp: dayjs.utc().toISOString(),
                error: err.message
            });
            await this.events.emit<StatsCalcWorkerErrorEvent>({
                type: StatsCalcWorkerEvents.ERROR,
                data: {
                    method: "calcUserSignal",
                    robotId,
                    calcAll,
                    timestamp: dayjs.utc().toISOString(),
                    error: err.message
                }
            });
            throw err;
        }
    }

    async calcUserSignalsAggr({
        userId,
        exchange = null,
        asset = null,
        calcAll = false
    }: {
        userId: string;
        exchange?: string;
        asset?: string;
        calcAll?: boolean;
    }) {
        try {
            const exchangeCondition = exchange || this.dummy;
            const assetCondition = asset || this.dummy;
            const prevUserAggrStats = await this.db.pg.maybeOne<TradeStatsWithId>(sql`
            SELECT id,
                statistics,
                first_position_entry_date,
                last_position_exit_date,
                last_updated_at,
                equity,
                equity_avg
            FROM user_aggr_stats
            WHERE user_id = ${userId}
                AND type = ${UserAggrStatsTypes.signal}
                AND exchange = ${exchangeCondition}
                AND asset = ${assetCondition};
        `);

            if (prevUserAggrStats) {
                const countOfSignals = await this.db.pg.oneFirst<number>(sql`
                SELECT COUNT(1)
                FROM user_signals us,
                    robots r
                WHERE us.user_id = ${userId}
                    AND r.id = us.robot_id
                    ${!exchange ? sql`` : sql`AND r.exchange = ${exchange}`}
                    ${!asset ? sql`` : sql`AND r.asset = ${asset}`};
            `);

                if (countOfSignals === 0) {
                    await this.db.pg.query(sql`
                    DELETE
                    FROM user_aggr_stats
                    WHERE id = ${prevUserAggrStats.id};
                `);

                    return false;
                }
            }

            const { calcFrom, initStats } = getCalcFromAndInitStats(prevUserAggrStats, calcAll);

            const conditionExchange = !exchange ? sql`` : sql`AND r.exchange = ${exchange}`;
            const conditionAsset = !asset ? sql`` : sql`AND r.asset = ${asset}`;
            const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT p.id, p.direction, p.entry_date, p.exit_date, p.profit, p.bars_held
        `;

            const queryFromAndConditionPart = sql`
            FROM user_signals us,
                robots r,
                v_user_signal_positions p
            WHERE us.user_id = ${userId}
                AND r.id = us.robot_id
                AND p.user_id = us.user_id
                AND p.robot_id = us.robot_id
                AND p.status = 'closed'
                AND p.entry_date >= us.subscribed_at
            ${conditionExchange}
            ${conditionAsset}
            ${conditionExitDate}
        `;
            const queryCommonPart = sql`
            ${querySelectPart}
            ${queryFromAndConditionPart}
            ORDER BY p.exit_date
        `;

            const positionsCount = await this.db.pg.oneFirst<number>(sql`
            SELECT COUNT(1)
            ${queryFromAndConditionPart};
        `);

            if (positionsCount == 0) return false;

            const newStats = await DataStream.from(
                this.makeChunksGenerator(
                    queryCommonPart,
                    positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
                )
            ).reduce(
                async (prevStats: TradeStats, chunk: BasePosition[]) => await this.calcStatistics(prevStats, chunk),
                initStats
            );

            await this.upsertStats(
                {
                    table: sql`user_aggr_stats`,
                    constraint: sql`user_aggr_stats_user_id_exchange_asset_type_key`,
                    addFields: sql`user_id, exchange, asset, type`,
                    addFieldsValues: sql`${userId}, ${exchangeCondition}, ${assetCondition}, ${UserAggrStatsTypes.signal}`
                },
                newStats
            );

            return true;
        } catch (err) {
            this.log.error("Failed to calcUserSignalsAggr stats", err);
            this.log.debug({
                method: "calcUserSignalsAggr",
                userId,
                exchange,
                asset,
                calcAll,
                timestamp: dayjs.utc().toISOString(),
                error: err.message
            });
            await this.events.emit<StatsCalcWorkerErrorEvent>({
                type: StatsCalcWorkerEvents.ERROR,
                data: {
                    method: "calcUserSignalsAggr",
                    userId,
                    exchange,
                    asset,
                    calcAll,
                    timestamp: dayjs.utc().toISOString(),
                    error: err.message
                }
            });
            throw err;
        }
    }

    async calcUserRobot({ userRobotId, calcAll = false }: { userRobotId: string; calcAll?: boolean }) {
        try {
            const prevTradeStats = await this.db.pg.maybeOne<TradeStats>(sql`
            SELECT urs.statistics,
                urs.first_position_entry_date,
                urs.last_position_exit_date,
                urs.last_updated_at,
                urs.equity,
                urs.equity_avg
            FROM user_robots ur
            LEFT JOIN user_robot_stats urs
                ON ur.id = urs.user_robot_id
            WHERE ur.id = ${userRobotId};
        `);
            if (!prevTradeStats) throw new Error(`User robot doesn't exists (userRobotId: ${userRobotId})`);

            const { calcFrom, initStats } = getCalcFromAndInitStats(prevTradeStats, calcAll);

            const conditionExitDate = !calcFrom ? sql`` : sql`AND exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT id, direction, entry_date, exit_date, profit, bars_held
        `;
            const queryFromAndConditionPart = sql`
            FROM user_positions
            WHERE user_robot_id = ${userRobotId}
            AND status IN ('closed', 'closedAuto')
            ${conditionExitDate}
        `;
            const queryCommonPart = sql`
            ${querySelectPart}
            ${queryFromAndConditionPart}
            ORDER BY exit_date
        `;

            const positionsCount = await this.db.pg.oneFirst<number>(sql`
            SELECT COUNT(1)
            ${queryFromAndConditionPart};
        `);

            if (positionsCount == 0) return false;

            const newStats = await DataStream.from(
                this.makeChunksGenerator(
                    queryCommonPart,
                    positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
                )
            ).reduce(
                async (prevStats: TradeStats, chunk: BasePosition[]) => await this.calcStatistics(prevStats, chunk),
                initStats
            );

            await this.upsertStats(
                {
                    table: sql`user_robot_stats`,
                    constraint: sql`user_robot_stats_pkey`,
                    addFields: sql`user_robot_id`,
                    addFieldsValues: sql`${userRobotId}`
                },
                newStats
            );

            return true;
        } catch (err) {
            this.log.error("Failed to calcUserRobot stats", err);
            this.log.debug({
                method: "calcUserRobot",
                userRobotId,
                calcAll,
                timestamp: dayjs.utc().toISOString(),
                error: err.message
            });
            await this.events.emit<StatsCalcWorkerErrorEvent>({
                type: StatsCalcWorkerEvents.ERROR,
                data: {
                    method: "calcUserRobot",
                    userRobotId,
                    calcAll,
                    timestamp: dayjs.utc().toISOString(),
                    error: err.message
                }
            });
            throw err;
        }
    }

    async calcUserRobotsAggr({
        userId,
        exchange = null,
        asset = null,
        calcAll = false
    }: {
        userId: string;
        exchange?: string;
        asset?: string;
        calcAll?: boolean;
    }) {
        try {
            const exchangeCondition = exchange || this.dummy;
            const assetCondition = asset || this.dummy;
            const prevUserAggrStats = await this.db.pg.maybeOne<TradeStatsWithId>(sql`
            SELECT id,
                statistics,
                first_position_entry_date,
                last_position_exit_date,
                last_updated_at,
                equity,
                equity_avg
            FROM user_aggr_stats
            WHERE user_id = ${userId}
                AND type = ${UserAggrStatsTypes.userRobot}
                AND exchange = ${exchangeCondition}
                AND asset = ${assetCondition};
        `);

            if (prevUserAggrStats) {
                const countOfUserRobots = await this.db.pg.oneFirst<number>(sql`
                SELECT COUNT(1)
                FROM user_robots ur,
                    robots r
                WHERE ur.user_id = ${userId}
                    AND r.id = ur.robot_id
                    ${!exchange ? sql`` : sql`AND r.exchange = ${exchange}`}
                    ${!asset ? sql`` : sql`AND r.asset = ${asset}`};
            `);

                if (countOfUserRobots === 0) {
                    await this.db.pg.query(sql`
                    DELETE
                    FROM user_aggr_stats
                    WHERE id = ${prevUserAggrStats.id};
                `);

                    return false;
                }
            }

            const { calcFrom, initStats } = getCalcFromAndInitStats(prevUserAggrStats, calcAll);

            const conditionExchange = !exchange ? sql`` : sql`AND exchange = ${exchange}`;
            const conditionAsset = !asset ? sql`` : sql`AND asset = ${asset}`;
            const conditionExitDate = !calcFrom ? sql`` : sql`AND exit_date > ${calcFrom}`;
            const querySelectPart = sql`
            SELECT id, direction, entry_date, exit_date, profit, bars_held
        `;
            const queryFromAndConditionPart = sql`
            FROM user_positions p
            WHERE user_id = ${userId}
            AND status IN ('closed', 'closedAuto')
            ${conditionExchange}
            ${conditionAsset}
            ${conditionExitDate}
        `;
            const queryCommonPart = sql`
            ${querySelectPart}
            ${queryFromAndConditionPart}
            ORDER BY p.exit_date
        `;

            const positionsCount = await this.db.pg.oneFirst<number>(sql`
            SELECT COUNT(1)
            ${queryFromAndConditionPart};
        `);

            if (positionsCount == 0) return false;

            const newStats = await DataStream.from(
                this.makeChunksGenerator(
                    queryCommonPart,
                    positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
                )
            ).reduce(
                async (prevStats: TradeStats, chunk: BasePosition[]) => await this.calcStatistics(prevStats, chunk),
                initStats
            );

            await this.upsertStats(
                {
                    table: sql`user_aggr_stats`,
                    constraint: sql`user_aggr_stats_user_id_exchange_asset_type_key`,
                    addFields: sql`user_id, exchange, asset, type`,
                    addFieldsValues: sql`${userId}, ${exchangeCondition}, ${assetCondition}, ${UserAggrStatsTypes.userRobot}`
                },
                newStats
            );

            return true;
        } catch (err) {
            this.log.error("Failed to calcUserRobotsAggr stats", err);
            this.log.debug({
                method: "calcUserRobotsAggr",
                userId,
                exchange,
                asset,
                calcAll,
                timestamp: dayjs.utc().toISOString(),
                error: err.message
            });
            await this.events.emit<StatsCalcWorkerErrorEvent>({
                type: StatsCalcWorkerEvents.ERROR,
                data: {
                    method: "calcUserRobotsAggr",
                    userId,
                    exchange,
                    asset,
                    calcAll,
                    timestamp: dayjs.utc().toISOString(),
                    error: err.message
                }
            });
            throw err;
        }
    }
}
