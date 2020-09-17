import { DataStream } from "scramjet";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { Worker, Job } from "bullmq";
import os from "os";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { StatisticsType, CalcStatistics, StatisticsUtils } from "./statsWorkerTypes";
import { sql } from "@cryptuoso/postgres";
import { SqlSqlTokenType, QueryResultRowType } from "slonik";
import {
    TradeStats,
    PositionDataForStats,
    isTradeStats,
    ExtendedStatsPositionWithDate,
    ExtendedStatsPositionWithVolume,
    SettingsVolume,
    UserAggrStatsType,
    TradeStatsWithId,
    UserSignalStats
} from "@cryptuoso/trade-statistics";
import { StatsCalcJob, StatsCalcJobType } from "@cryptuoso/stats-calc-events";
import dayjs from "@cryptuoso/dayjs";

export function getCalcFromAndInitStats(stats?: TradeStats, calcAll?: boolean) {
    let calcFrom: string = null;
    let initStats: TradeStats = null;

    if (!calcAll && stats && isTradeStats(stats, false)) {
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

type QueryType = SqlSqlTokenType<QueryResultRowType<any>>;

export type StatisticCalcWorkerServiceConfig = BaseServiceConfig;
export default class StatisticCalcWorkerService extends BaseService {
    private pool: Pool<any>;
    private workers: { [key: string]: Worker };
    private cpus: number;

    maxSingleQueryPosCount = 750;
    defaultChunkSize = 500;

    constructor(config?: StatisticCalcWorkerServiceConfig) {
        super(config);
        try {
            this.cpus = os.cpus().length;
            this.addOnStartHandler(this._onStartService);
            this.addOnStopHandler(this._onStopService);
        } catch (err) {
            this.log.error("Error in StatisticCalcWorkerService constructor", err);
        }
    }

    private async _onStartService(): Promise<void> {
        this.pool = Pool(() => spawn<StatisticsUtils>(new ThreadsWorker("./statsWorker")), {
            name: "statistics-utils"
        });
        this.workers = {
            calcStatistics: new Worker("calcStatistics", async (job: Job) => this.process(job), {
                connection: this.redis,
                concurrency: +process.env.JOBS_CONCURRENCY || this.cpus
            })
        };
        //console.log(this);
    }

    private async _onStopService(): Promise<void> {
        await this.workers.calcStatistics.close();
        await this.pool.terminate();
    }

    async process(job: Job<StatsCalcJob>) {
        const type = job.name as StatsCalcJobType;
        const { calcAll, robotId, userRobotId, userId, exchange, asset } = job.data;

        this.log.info(`Starting job ${job.id}`);

        try {
            if (type === StatsCalcJobType.robot) {
                await this.calcRobot(robotId, calcAll);
            } else if (type === StatsCalcJobType.robotsAggr) {
                await this.calcRobotsAggr(exchange, asset, calcAll);
            } else if (type === StatsCalcJobType.usersRobotsAggr) {
                await this.calcUsersRobotsAggr(exchange, asset, calcAll);
            } else if (type === StatsCalcJobType.userRobot) {
                await this.calcUserRobot(userRobotId, calcAll);
            } else if (type === StatsCalcJobType.userSignal) {
                await this.calcUserSignal(userId, robotId, calcAll);
            } else if (type === StatsCalcJobType.userSignals) {
                await this.calcUserSignals(robotId, calcAll);
            } else if (type === StatsCalcJobType.userSignalsAggr) {
                await this.calcUserSignalsAggr(userId, exchange, asset, calcAll);
            } else if (type === StatsCalcJobType.userRobotAggr) {
                await this.calcUserRobotsAggr(userId, exchange, asset, calcAll);
            } else throw new Error(`Unknown job type ${type}`);

            //await job.moveToCompleted(null, null);
            this.log.info(`Job ${job.id} finished`);
        } catch (err) {
            this.log.error(`Error while processing job ${job.id} (${type})`, err);
            throw err;
        }
    }

    private makeChunksGenerator(query: QueryType, chunkSize: number = this.defaultChunkSize) {
        if (!chunkSize || chunkSize < 1) throw new Error("Argument 'chunkSize' must be positive number.");

        const pg = this.db.pg;

        return async function* () {
            let chunkNum = 0;

            while (true) {
                const chunk: any[] = await pg.any(sql`
                    ${query}
                    LIMIT ${chunkSize} OFFSET ${chunkNum * chunkSize};
                `);

                ++chunkNum;

                if (chunk.length > 0) yield chunk;
                if (chunk.length != chunkSize) break;
            }
        };
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
        if (prevStats && isTradeStats(prevStats, false)) {
            await this.db.pg.query(sql`
                UPDATE ${params.table}
                SET statistics = ${sql.json(stats.statistics)},
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
                    ${sql.json(stats.statistics)},
                    ${stats.lastPositionExitDate},
                    ${stats.lastUpdatedAt},
                    ${sql.json(stats.equity)},
                    ${sql.json(stats.equityAvg)}

                    ${params.addFieldsValues ? sql`, ${params.addFieldsValues}` : sql``}
                );
            `);
        }
    }

    calcStatistics: CalcStatistics = async (
        type: any,
        prevStats: TradeStats,
        positions: any[],
        volumes?: SettingsVolume[]
    ) => {
        return await this.pool.queue(async (utils: StatisticsUtils) =>
            utils.calcStatistics(type, prevStats, positions, volumes)
        );
    };

    async calcRobot(robotId: string, calcAll = false) {
        if (!robotId) throw new Error("robotId must be non-empty string");

        const prevTradeStats: TradeStats = await this.db.pg.maybeOne(sql`
            SELECT rs.*
            FROM robots r
            LEFT JOIN robot_stats rs
                ON r.id = rs.robot_id
            WHERE r.id = ${robotId};
        `);

        if (!prevTradeStats) throw new Error(`The robot doesn't exists (robotId: ${robotId})`);

        const { calcFrom, initStats } = getCalcFromAndInitStats(prevTradeStats, calcAll);

        const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
        const querySelectPart = sql`
            SELECT p.id, p.direction, p.exit_date, p.profit, p.bars_held,
                p.fee, p.entry_price, p.exit_price,
                (
                    SELECT usset.robot_settings -> 'volume'
                    FROM robot_settings usset
                    WHERE usset.robot_id = ${robotId}
                        AND usset.active_from <= p.entry_date
                    ORDER BY usset.active_from DESC
                    LIMIT 1
                )::float AS volume
        `;
        const queryFromAndConditionPart = sql`
            FROM robot_positions p
            WHERE p.robot_id = ${robotId}
                AND p.status = 'closed'
                ${conditionExitDate}
        `;
        const queryCommonPart = sql`
            ${querySelectPart}
            ${queryFromAndConditionPart}
            ORDER BY p.exit_date
        `;

        const positionsCount: number = +(await this.db.pg.oneFirst(sql`
            SELECT COUNT(*)
            ${queryFromAndConditionPart};
        `));

        if (positionsCount == 0) return false;

        const newStats = await DataStream.from(
            this.makeChunksGenerator(
                queryCommonPart,
                positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
            )
        ).reduce(
            async (prevStats: TradeStats, chunk: ExtendedStatsPositionWithVolume[]) =>
                await this.calcStatistics(StatisticsType.CalcByPositionsVolume, prevStats, chunk),
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

    async calcRobotsAggr(exchange?: string, asset?: string, calcAll = false) {
        const prevRobotsAggrStats: TradeStatsWithId = await this.db.pg.maybeOne(sql`
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

        const { calcFrom, initStats } = getCalcFromAndInitStats(prevRobotsAggrStats, calcAll);

        const conditionExchange = !exchange ? sql`` : sql`AND r.exchange = ${exchange}`;
        const conditionAsset = !asset ? sql`` : sql`AND r.asset = ${asset}`;
        const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
        const querySelectPart = sql`
            SELECT p.id, p.direction, p.exit_date, p.profit, p.bars_held,
                p.entry_price, p.exit_price, p.fee,
                (
                    SELECT usset.robot_settings -> 'volume'
                    FROM robot_settings usset
                    WHERE usset.robot_id = p.robot_id
                        AND usset.active_from <= p.entry_date
                    ORDER BY usset.active_from DESC
                    LIMIT 1
                )::float AS volume
        `;
        const queryFromAndConditionPart = sql`
            FROM robot_positions p,
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

        const positionsCount: number = +(await this.db.pg.oneFirst(sql`
            SELECT COUNT(*)
            ${queryFromAndConditionPart};
        `));

        if (positionsCount == 0) return false;

        const newStats = await DataStream.from(
            this.makeChunksGenerator(
                queryCommonPart,
                positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
            )
        ).reduce(
            async (prevStats: TradeStats, chunk: ExtendedStatsPositionWithVolume[]) =>
                await this.calcStatistics(StatisticsType.CalcByPositionsVolume, prevStats, chunk),
            initStats
        );

        await this.upsertStats(
            {
                table: sql`robot_aggr_stats`,
                fieldId: sql`id`,
                id: prevRobotsAggrStats?.id,
                addFields: sql`exchange, asset`,
                addFieldsValues: sql`${!exchange ? null : exchange}, ${!asset ? null : asset}`
            },
            newStats,
            prevRobotsAggrStats
        );

        return true;
    }

    async calcUsersRobotsAggr(exchange?: string, asset?: string, calcAll = false) {
        const prevUsersRobotsAggrtats: TradeStatsWithId = await this.db.pg.maybeOne(sql`
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

        const { calcFrom, initStats } = getCalcFromAndInitStats(prevUsersRobotsAggrtats, calcAll);

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

        const positionsCount: number = +(await this.db.pg.oneFirst(sql`
            SELECT COUNT(*)
            ${queryFromAndConditionPart};
        `));

        if (positionsCount == 0) return false;

        const newStats = await DataStream.from(
            this.makeChunksGenerator(
                queryCommonPart,
                positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
            )
        ).reduce(
            async (prevStats: TradeStats, chunk: PositionDataForStats[]) =>
                await this.calcStatistics(StatisticsType.Simple, prevStats, chunk),
            initStats
        );

        await this.upsertStats(
            {
                table: sql`user_robot_aggr_stats`,
                fieldId: sql`id`,
                id: prevUsersRobotsAggrtats?.id,
                addFields: sql`exchange, asset`,
                addFieldsValues: sql`${!exchange ? null : exchange}, ${!asset ? null : asset}`
            },
            newStats,
            prevUsersRobotsAggrtats
        );

        return true;
    }

    async calcUserSignal(userId: string, robotId: string, calcAll = false) {
        if (!userId || !robotId) throw new Error("userId and robotId must be non-empty string");

        const userSignal: UserSignalStats = await this.db.pg.maybeOne(sql`
            SELECT us.id, us.subscribed_at, us.volume,
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

        const { calcFrom, initStats } = getCalcFromAndInitStats(userSignal, calcAll);

        const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
        const querySelectPart = sql`
            SELECT p.id, p.direction, p.exit_date, p.profit, p.bars_held,
                p.entry_price, p.exit_price, p.fee,
                (
                    SELECT usset.user_signal_settings -> 'volume'
                    FROM user_signal_settings usset
                    WHERE usset.user_signal_id = us.id
                        AND usset.active_from <= p.entry_date
                    ORDER BY usset.active_from DESC
                    LIMIT 1
                )::float AS volume
        `;
        const queryFromAndConditionPart = sql`
            FROM user_signals us,
                robot_positions p
            WHERE us.user_id = ${userId}
                AND us.robot_id = ${robotId}
                AND p.robot_id = us.robot_id
                AND p.status = 'closed'
                AND p.entry_date >= ${userSignal.subscribedAt}
                ${conditionExitDate}
        `;
        const queryCommonPart = sql`
            ${querySelectPart}
            ${queryFromAndConditionPart}
            ORDER BY p.exit_date
        `;

        const positionsCount: number = +(await this.db.pg.oneFirst(sql`
            SELECT COUNT(*)
            ${queryFromAndConditionPart};
        `));

        if (positionsCount == 0) return false;

        const newStats = await DataStream.from(
            this.makeChunksGenerator(
                queryCommonPart,
                positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
            )
        ).reduce(
            async (prevStats: TradeStats, chunk: ExtendedStatsPositionWithVolume[]) =>
                await this.calcStatistics(StatisticsType.CalcByPositionsVolume, prevStats, chunk),
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

        return true;
    }

    private async _calcUserSignalsBySingleQuery(params: {
        queryCommonPart: QueryType;
        userSignals: UserSignalStats[];
        calcAll: boolean;
    }): Promise<{
        [key: string]: {
            newStats: TradeStats;
            signal: UserSignalStats;
        };
    }> {
        const { queryCommonPart, userSignals, calcAll } = params;
        const statsDict: {
            [key: string]: {
                newStats: TradeStats;
                signal: UserSignalStats;
            };
        } = {};

        const allPositions: ExtendedStatsPositionWithDate[] = await this.db.pg.any(sql`
                ${queryCommonPart};
        `);

        for (const userSignal of userSignals) {
            const { calcFrom, initStats } = getCalcFromAndInitStats(userSignal, calcAll);

            const positions: ExtendedStatsPositionWithDate[] = allPositions.filter(
                (pos) => userSignal.subscribedAt <= pos.entryDate && (!calcFrom || calcFrom <= pos.exitDate)
            );

            statsDict[userSignal.id] = {
                newStats: await this.calcStatistics(
                    StatisticsType.CalcByProvidedVolumes,
                    initStats,
                    positions,
                    userSignal.volumes
                ),
                signal: userSignal
            };
        }

        return statsDict;
    }

    private async _calcUserSignalsByChunks(params: {
        queryCommonPart: QueryType;
        userSignals: UserSignalStats[];
        calcAll?: boolean;
        chunkSize?: number;
    }): Promise<{
        [key: string]: {
            newStats: TradeStats;
            signal: UserSignalStats;
        };
    }> {
        const { queryCommonPart, userSignals, calcAll, chunkSize } = params;

        const statsDict: {
            [key: string]: {
                newStats: TradeStats;
                signal: UserSignalStats;
            };
        } = {};
        let statsAcc: {
            signal: UserSignalStats;
            calcFrom: string;
            stats: TradeStats;
            updated: boolean;
        }[] = [];

        userSignals.forEach((us) => {
            const { calcFrom, initStats: stats } = getCalcFromAndInitStats(us, calcAll);
            statsAcc.push({ signal: us, calcFrom, stats, updated: false });
        });

        statsAcc = await DataStream.from(this.makeChunksGenerator(queryCommonPart, chunkSize)).reduce(
            async (signalsAcc: typeof statsAcc, chunk: ExtendedStatsPositionWithDate[]) => {
                const chunkMaxExitDate = chunk[chunk.length - 1].exitDate;
                const chunkMaxEntryDate = dayjs
                    .utc(Math.max(...chunk.map((pos) => dayjs.utc(pos.entryDate).valueOf())))
                    .toISOString();

                for (const signalAcc of signalsAcc) {
                    if (
                        signalAcc.signal.subscribedAt > chunkMaxEntryDate ||
                        (signalAcc.calcFrom && signalAcc.calcFrom > chunkMaxExitDate)
                    )
                        continue;

                    const positions = chunk.filter(
                        (pos) =>
                            signalAcc.signal.subscribedAt <= pos.entryDate &&
                            (!signalAcc.calcFrom || signalAcc.calcFrom <= pos.exitDate)
                    );

                    signalAcc.stats = await this.calcStatistics(
                        StatisticsType.CalcByProvidedVolumes,
                        signalAcc.stats,
                        positions,
                        signalAcc.signal.volumes
                    );

                    signalAcc.updated = true;
                }

                return signalsAcc;
            },
            statsAcc
        );

        statsAcc.forEach((signalAcc) => {
            if (signalAcc.updated)
                statsDict[signalAcc.signal.id] = {
                    newStats: signalAcc.stats,
                    signal: signalAcc.signal
                };
        });

        return statsDict;
    }

    async calcUserSignals(robotId: string, calcAll = false) {
        if (!robotId) throw new Error("robotId must be non-empty string");

        const userSignals: UserSignalStats[] = await this.db.pg.any(sql`
            SELECT us.id, us.subscribed_at,
                uss.statistics,
                uss.last_position_exit_date,
                uss.last_updated_at,
                uss.equity,
                uss.equity_avg,
                ARRAY(
                    SELECT json_build_object(
                        'activeFrom', usset.active_from,
                        'volume', (usset.user_signal_settings -> 'volume')::float
                    )
                    FROM user_signal_settings usset
                    WHERE usset.user_signal_id = us.id
                    ORDER BY usset.active_from ASC
                ) as volumes
            FROM user_signals us
            LEFT JOIN user_signal_stats uss
                ON us.id = uss.user_signal_id
            WHERE us.robot_id = ${robotId};
        `);

        if (userSignals.length == 0) return false; // throw new Error(`Signals doesn't exists (robotId: ${robotId})`);

        const minSubscriptionDate = dayjs
            .utc(Math.min(...userSignals.map((us) => dayjs.utc(us.subscribedAt).valueOf())))
            .toISOString();

        let minExitDate;

        if (!calcAll) {
            const minExitTime = Math.min(
                ...userSignals.map((us) => {
                    if (us.lastPositionExitDate) return dayjs.utc(us.lastPositionExitDate).valueOf();
                    else return Infinity;
                })
            );

            minExitDate = isFinite(minExitTime) ? dayjs.utc(minExitTime).toISOString() : undefined;
        }

        const conditionExitDate = !minExitDate ? sql`` : sql`AND exit_date > ${minExitDate}`;
        const querySelectPart = sql`
            SELECT id, direction, exit_date, profit, bars_held,
                entry_price, exit_price, fee, entry_date
        `;
        const queryFromAndConditionPart = sql`
            FROM robot_positions
            WHERE robot_id = ${robotId}
                AND status = 'closed'
                AND entry_date > ${minSubscriptionDate}
                ${conditionExitDate}
        `;
        const queryCommonPart = sql`
            ${querySelectPart}
            ${queryFromAndConditionPart}
            ORDER BY exit_date
        `;

        const positionsCount: number = +(await this.db.pg.oneFirst(sql`
            SELECT COUNT(*)
            ${queryFromAndConditionPart};
        `));

        if (positionsCount == 0) return false;

        const signalsStats =
            positionsCount > this.maxSingleQueryPosCount
                ? await this._calcUserSignalsByChunks({
                      queryCommonPart,
                      userSignals,
                      calcAll
                  })
                : await this._calcUserSignalsBySingleQuery({
                      queryCommonPart,
                      userSignals,
                      calcAll
                  });

        if (Object.keys(signalsStats).length == 0) return false;

        for (const [signalId, { newStats, signal }] of Object.entries(signalsStats)) {
            await this.upsertStats(
                {
                    table: sql`user_signal_stats`,
                    fieldId: sql`user_signal_id`,
                    id: signalId,
                    addFields: sql`user_signal_id`,
                    addFieldsValues: sql`${signalId}`
                },
                newStats,
                signal
            );
        }

        return true;
    }

    async calcUserSignalsAggr(userId: string, exchange?: string, asset?: string, calcAll = false) {
        if (!userId) throw new Error("userId must be non-empty string");

        const prevUserAggrStats: TradeStatsWithId = await this.db.pg.maybeOne(sql`
            SELECT id,
                statistics,
                last_position_exit_date,
                last_updated_at,
                equity,
                equity_avg
            FROM user_aggr_stats
            WHERE user_id = ${userId}
                AND type = ${UserAggrStatsType.signal}
                AND exchange ${!exchange ? sql`IS NULL` : sql`= ${exchange}`}
                AND asset ${!asset ? sql`IS NULL` : sql`= ${asset}`};
        `);

        const { calcFrom, initStats } = getCalcFromAndInitStats(prevUserAggrStats, calcAll);

        const conditionExchange = !exchange ? sql`` : sql`AND r.exchange = ${exchange}`;
        const conditionAsset = !asset ? sql`` : sql`AND r.asset = ${asset}`;
        const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
        const querySelectPart = sql`
            SELECT p.id, p.direction, p.exit_date, p.profit, p.bars_held,
                p.entry_price, p.exit_price, p.fee,
                (
                    SELECT usset.user_signal_settings -> 'volume'
                    FROM user_signal_settings usset
                    WHERE usset.user_signal_id = us.id
                        AND usset.active_from <= p.entry_date
                    ORDER BY usset.active_from DESC
                    LIMIT 1
                )::float AS volume
        `;

        const queryFromAndConditionPart = sql`
            FROM user_signals us,
                robots r,
                robot_positions p
            WHERE us.user_id = ${userId}
                AND r.id = us.robot_id
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

        const positionsCount: number = +(await this.db.pg.oneFirst(sql`
            SELECT COUNT(*)
            ${queryFromAndConditionPart};
        `));

        if (positionsCount == 0) return false;

        const newStats = await DataStream.from(
            this.makeChunksGenerator(
                queryCommonPart,
                positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
            )
        ).reduce(
            async (prevStats: TradeStats, chunk: ExtendedStatsPositionWithVolume[]) =>
                await this.calcStatistics(StatisticsType.CalcByPositionsVolume, prevStats, chunk),
            initStats
        );

        await this.upsertStats(
            {
                table: sql`user_aggr_stats`,
                fieldId: sql`id`,
                id: prevUserAggrStats?.id,
                addFields: sql`user_id, exchange, asset, type`,
                addFieldsValues: sql`${userId}, ${!exchange ? null : exchange}, ${!asset ? null : asset}, ${
                    UserAggrStatsType.signal
                }`
            },
            newStats,
            prevUserAggrStats
        );

        return true;
    }

    async calcUserRobot(userRobotId: string, calcAll = false) {
        if (!userRobotId) throw new Error("userRobotId must be non-empty string");

        const prevTradeStats: TradeStats = await this.db.pg.maybeOne(sql`
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

        const positionsCount: number = +(await this.db.pg.oneFirst(sql`
            SELECT COUNT(*)
            ${queryFromAndConditionPart};
        `));

        if (positionsCount == 0) return false;

        const newStats = await DataStream.from(
            this.makeChunksGenerator(
                queryCommonPart,
                positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
            )
        ).reduce(
            async (prevStats: TradeStats, chunk: PositionDataForStats[]) =>
                await this.calcStatistics(StatisticsType.Simple, prevStats, chunk),
            initStats
        );

        await this.upsertStats(
            {
                table: sql`user_robot_stats`,
                fieldId: sql`user_robot_id`,
                id: userRobotId
            },
            newStats,
            prevTradeStats
        );

        return true;
    }

    async calcUserRobotsAggr(userId: string, exchange?: string, asset?: string, calcAll = false) {
        if (!userId) throw new Error("userId must be non-empty string");

        const prevUserAggrStats: TradeStatsWithId = await this.db.pg.maybeOne(sql`
            SELECT id,
                statistics,
                last_position_exit_date,
                last_updated_at,
                equity,
                equity_avg
            FROM user_aggr_stats
            WHERE user_id = ${userId}
                AND type = ${UserAggrStatsType.userRobot}
                AND exchange ${!exchange ? sql`IS NULL` : sql`= ${exchange}`}
                AND asset ${!asset ? sql`IS NULL` : sql`= ${asset}`};
        `);

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

        const positionsCount: number = +(await this.db.pg.oneFirst(sql`
            SELECT COUNT(*)
            ${queryFromAndConditionPart};
        `));

        if (positionsCount == 0) return false;

        const newStats = await DataStream.from(
            this.makeChunksGenerator(
                queryCommonPart,
                positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
            )
        ).reduce(
            async (prevStats: TradeStats, chunk: PositionDataForStats[]) =>
                await this.calcStatistics(StatisticsType.Simple, prevStats, chunk),
            initStats
        );

        await this.upsertStats(
            {
                table: sql`user_aggr_stats`,
                fieldId: sql`id`,
                id: prevUserAggrStats?.id,
                addFields: sql`user_id, exchange, asset, type`,
                addFieldsValues: sql`${userId}, ${!exchange ? null : exchange}, ${!asset ? null : asset}, ${
                    UserAggrStatsType.userRobot
                }`
            },
            newStats,
            prevUserAggrStats
        );

        return true;
    }
}
