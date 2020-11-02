import { DataStream } from "scramjet";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { Job } from "bullmq";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { StatisticsUtils } from "./statsWorker";
import { sql, QueryType, makeChunksGenerator } from "@cryptuoso/postgres";
import { TradeStats, isTradeStats } from "@cryptuoso/stats-calc";
import { UserAggrStatsTypes } from "@cryptuoso/user-state";
import { StatsCalcJob, StatsCalcJobType } from "@cryptuoso/stats-calc-events";
import { BasePosition } from "@cryptuoso/market";
import Validator, { ValidationSchema, ValidationError } from "fastest-validator";

type UserSignalStats = {
    id: string;
    userId: string;
    robotId: string;
    subscribedAt: string;
} & TradeStats; //TODO: Use user-signal-state types

export function getCalcFromAndInitStats(stats?: TradeStats, calcAll?: boolean) {
    let calcFrom: string = null;
    let initStats: TradeStats = null;

    if (!calcAll && stats && isTradeStats(stats)) {
        initStats = {
            statistics: stats.statistics,
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

    private routes: {
        [K in StatsCalcJobType]?: {
            validate: (params: StatsCalcJob) => true | ValidationError[];
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
            name: "statistics-utils"
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

            if (errors !== true) {
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
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}: ${type}(${JSON.stringify(params)})`, err);
            //await locker.unlock();
            throw err;
        }
    }

    private async upsertStats(
        params: {
            table: QueryType;
            fieldId: QueryType;
            id: string;
            addFields?: QueryType;
            addFieldsValues?: QueryType;
        },
        stats: TradeStats,
        prevStats?: TradeStats
    ): Promise<void> {
        /* console.log(params);
        return; */
        if (params.id && prevStats && isTradeStats(prevStats)) {
            await this.db.pg.query(sql`
                UPDATE ${params.table}
                SET statistics = ${JSON.stringify(stats.statistics)},
                    last_position_exit_date = ${stats.lastPositionExitDate},
                    last_updated_at = ${stats.lastUpdatedAt},
                    equity = ${sql.json(stats.equity)},
                    equity_avg = ${sql.json(stats.equityAvg)}
                WHERE ${params.fieldId} = ${params.id};
            `);
        } else {
            await this.db.pg.query(sql`
                INSERT INTO ${params.table} (
                    statistics,
                    last_position_exit_date,
                    last_updated_at,
                    equity,
                    equity_avg
                    
                    ${params.addFields ? sql`, ${params.addFields}` : sql``}
                ) VALUES (
                    ${JSON.stringify(stats.statistics)},
                    ${stats.lastPositionExitDate},
                    ${stats.lastUpdatedAt},
                    ${sql.json(stats.equity)},
                    ${sql.json(stats.equityAvg)}

                    ${params.addFieldsValues ? sql`, ${params.addFieldsValues}` : sql``}
                );
            `);
        }
    }

    async calcStatistics(prevStats: TradeStats, positions: BasePosition[]) {
        return await this.pool.queue(async (utils: StatisticsUtils) => utils.calcStatistics(prevStats, positions));
    }

    async calcRobot({ robotId, calcAll = false }: { robotId: string; calcAll?: boolean }) {
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
            SELECT id, direction, exit_date, profit, bars_held
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
                fieldId: sql`robot_id`,
                id: robotId,
                addFields: sql`robot_id`,
                addFieldsValues: sql`${robotId}`
            },
            newStats,
            prevTradeStats
        );

        return true;
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
        const prevRobotsAggrStats = await this.db.pg.maybeOne<TradeStatsWithId>(sql`
            SELECT id,
                statistics,
                last_position_exit_date,
                last_updated_at,
                equity,
                equity_avg
            FROM robot_aggr_stats
            WHERE exchange ${!exchange ? sql`IS NULL` : sql`= ${exchange}`}
                AND asset ${!asset ? sql`IS NULL` : sql`= ${asset}`};
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
            SELECT p.id, p.direction, p.exit_date, p.profit, p.bars_held
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
                fieldId: sql`id`,
                id: prevRobotsAggrStats?.id,
                addFields: sql`exchange, asset`,
                addFieldsValues: sql`${exchange}, ${asset}`
            },
            newStats,
            prevRobotsAggrStats
        );

        return true;
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
        const prevUsersRobotsAggrStats = await this.db.pg.maybeOne<TradeStatsWithId>(sql`
            SELECT id,
                statistics,
                last_position_exit_date,
                last_updated_at,
                equity,
                equity_avg
            FROM user_robot_aggr_stats
            WHERE exchange ${!exchange ? sql`IS NULL` : sql`= ${exchange}`}
                AND asset ${!asset ? sql`IS NULL` : sql`= ${asset}`};
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
            SELECT id, direction, exit_date, profit, bars_held
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
                fieldId: sql`id`,
                id: prevUsersRobotsAggrStats?.id,
                addFields: sql`exchange, asset`,
                addFieldsValues: sql`${exchange}, ${asset}`
            },
            newStats,
            prevUsersRobotsAggrStats
        );

        return true;
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
                SELECT id, direction, exit_date, profit, bars_held
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
                    fieldId: sql`user_signal_id`,
                    id: userSignal.id,
                    addFields: sql`user_signal_id`,
                    addFieldsValues: sql`${userSignal.id}`
                },
                newStats,
                userSignal
            );

            await locker.unlock();

            return true;
        } catch (err) {
            await locker.unlock();
            return false;
        }
    }

    async calcUserSignal({ userId, robotId, calcAll = false }: { userId: string; robotId: string; calcAll?: boolean }) {
        const userSignal = await this.db.pg.maybeOne<UserSignalStats>(sql`
            SELECT us.id, us.user_id, us.robot_id, us.subscribed_at,
                uss.statistics,
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
    }

    async calcUserSignals({ robotId, calcAll = false }: { robotId: string; calcAll?: boolean }) {
        const userSignals = await this.db.pg.any<UserSignalStats>(sql`
            SELECT us.id, us.user_id, us.robot_id, us.subscribed_at,
                uss.statistics,
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
            res = res || (await this._calcDownloadedUserSignal(signal, calcAll));
        }

        return res;
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
        const prevUserAggrStats = await this.db.pg.maybeOne<TradeStatsWithId>(sql`
            SELECT id,
                statistics,
                last_position_exit_date,
                last_updated_at,
                equity,
                equity_avg
            FROM user_aggr_stats
            WHERE user_id = ${userId}
                AND type = ${UserAggrStatsTypes.signal}
                AND exchange ${!exchange ? sql`IS NULL` : sql`= ${exchange}`}
                AND asset ${!asset ? sql`IS NULL` : sql`= ${asset}`};
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
            SELECT p.id, p.direction, p.exit_date, p.profit, p.bars_held
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
                fieldId: sql`id`,
                id: prevUserAggrStats?.id,
                addFields: sql`user_id, exchange, asset, type`,
                addFieldsValues: sql`${userId}, ${exchange}, ${asset}, ${UserAggrStatsTypes.signal}`
            },
            newStats,
            prevUserAggrStats
        );

        return true;
    }

    async calcUserRobot({ userRobotId, calcAll = false }: { userRobotId: string; calcAll?: boolean }) {
        const prevTradeStats = await this.db.pg.maybeOne<TradeStats>(sql`
            SELECT urs.statistics,
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
            SELECT id, direction, exit_date, profit, bars_held
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
                fieldId: sql`user_robot_id`,
                id: userRobotId,
                addFields: sql`user_robot_id`,
                addFieldsValues: sql`${userRobotId}`
            },
            newStats,
            prevTradeStats
        );

        return true;
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
        const prevUserAggrStats = await this.db.pg.maybeOne<TradeStatsWithId>(sql`
            SELECT id,
                statistics,
                last_position_exit_date,
                last_updated_at,
                equity,
                equity_avg
            FROM user_aggr_stats
            WHERE user_id = ${userId}
                AND type = ${UserAggrStatsTypes.userRobot}
                AND exchange ${!exchange ? sql`IS NULL` : sql`= ${exchange}`}
                AND asset ${!asset ? sql`IS NULL` : sql`= ${asset}`};
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
            SELECT id, direction, exit_date, profit, bars_held
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
                fieldId: sql`id`,
                id: prevUserAggrStats?.id,
                addFields: sql`user_id, exchange, asset, type`,
                addFieldsValues: sql`${userId}, ${exchange}, ${asset}, ${UserAggrStatsTypes.userRobot}`
            },
            newStats,
            prevUserAggrStats
        );

        return true;
    }
}
