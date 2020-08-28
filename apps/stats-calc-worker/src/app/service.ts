import { DataStream } from "scramjet";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { Worker, Job } from "bullmq";
import os from "os";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { StatisticUtils } from "./statsWorker";
import { sql } from "@cryptuoso/postgres";
import { SqlSqlTokenType, QueryResultRowType } from "slonik";
import {
    RobotStats,
    PositionDataForStats,
    PositionDirection,
    isRobotStats
} from "@cryptuoso/trade-statistics";
import { StatsCalcJob, StatsCalcJobType } from "@cryptuoso/stats-calc-events";
import {
    UserSignalPosition,
    RobotStatsWithExists,
    UserSignalsWithExists,
    UserAggrStatsWithExists
} from "@cryptuoso/user-state";
import { round } from "@cryptuoso/helpers";
import dayjs from "@cryptuoso/dayjs";

function getCalcFromAndInitStats(stats?: RobotStatsWithExists, calcAll?: boolean) {
    let calcFrom: string;
    let initStats: RobotStats = null;

    if (!calcAll && stats && stats.statsExists && isRobotStats(stats, false)) {
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

    maxSingleQueryPosCount: number = 750;
    defaultChunkSize: number = 500;

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
        this.pool = Pool(() => spawn<StatisticUtils>(new ThreadsWorker("./statsWorker")), {
            name: "statistics-utils"
        });
        this.workers = {
            calcStatistics: new Worker("calcStatistics", async (job: Job) => this.process(job), {
                connection: this.redis,
                concurrency: process.env.production ? this.cpus : 3
            })
        };
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
            } else if (type === StatsCalcJobType.userRobot) {
                await this.calcUserRobot(userRobotId, calcAll);
            } else if (type === StatsCalcJobType.userSignal) {
                await this.calcUserSignal(userId, robotId, calcAll);
            } else if (type === StatsCalcJobType.userSignals) {
                await this.calcUserSignalsWithExists(robotId, calcAll);
            } else if (type === StatsCalcJobType.userSignalsAggr) {
                await this.calcUserSignalsWithExistsAggr(userId, exchange, asset, calcAll);
            } else if (type === StatsCalcJobType.userRobotAggr) {
                await this.calcUserRobotsAggr(userId, exchange, asset, calcAll);
            }
            //await job.moveToCompleted(null, null);
            this.log.info(`Job ${job.id} finished`);
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err);
            throw err;
        }
    }

    private makeChunksGenerator(query: QueryType, chunkSize: number = this.defaultChunkSize) {
        if (!chunkSize || chunkSize < 1)
            throw new Error("Argument 'chunkSize' must be positive number.");

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
            table: QueryType,
            fieldId: QueryType,
            id: string,
            addFields?: QueryType,
            addFieldsValues?: QueryType
        },
        stats: RobotStats,
        prevStats?: RobotStatsWithExists
    ): Promise<void> {
        console.log(params);
        //return;
        if (prevStats && prevStats.statsExists) {
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

    async calcStatistics(prevStats: RobotStats, positions: PositionDataForStats[]): Promise<RobotStats> {
        return await this.pool.queue(async (utils: StatisticUtils) => utils.calcStatistics(prevStats, positions));
    }

    private async _calcRobotStatistics(
        prevStats: RobotStats,
        positions: PositionDataForStats[]
    ): Promise<RobotStats> {
        return await this.calcStatistics(
            prevStats,
            positions.map((pos) => ({
                ...pos,
                profit: pos.fee && +pos.fee > 0 ? +round(pos.profit - pos.profit * pos.fee, 6) : pos.profit
            }))
        );
    }

    async calcRobot(robotId: string, calcAll: boolean = false) {
        const prevRobotStats: RobotStatsWithExists = await this.db.pg.maybeOne(sql`
            SELECT rs.robot_id as "stats_exists",
                   rs.*
            FROM robots r
            LEFT JOIN robot_stats rs
                ON r.id = rs.robot_id
            WHERE r.id = ${robotId};
        `);

        if(!prevRobotStats)
            return;

        const { calcFrom, initStats } = getCalcFromAndInitStats(prevRobotStats, calcAll);

        const conditionExitDate = !calcFrom ? sql`` : sql`AND exit_date > ${calcFrom}`;
        const querySelectPart = sql`
            SELECT id, direction, exit_date, profit, bars_held, fee
        `;
        const queryFromAndConditionPart = sql`
            FROM robot_positions
            WHERE robot_id = ${robotId}
                AND status = 'closed'
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

        if (positionsCount == 0) return;

        const newStats = await DataStream.from(
            this.makeChunksGenerator(
                queryCommonPart,
                positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
            )
        ).reduce(
            async (prevStats: RobotStats, chunk: PositionDataForStats[]) =>
                await this._calcRobotStatistics(prevStats, chunk),
            initStats
        );

        if (prevRobotStats) {
            return; //throw new Error("Robot with this id doesn't exists");
        } else {

        }

        await this.upsertStats(
            {
                table: sql`robot_stats`,
                fieldId: sql`robot_id`,
                id: robotId,
                addFields: sql`robot_id`,
                addFieldsValues: sql`${robotId}`,
            },
            newStats,
            prevRobotStats
        )
    }

    private async _calcUserSignalStatistics(
        prevStats: RobotStats,
        positions: UserSignalPosition[],
        userSignalVolume: number
    ): Promise<RobotStats> {
        return await this.calcStatistics(
            prevStats,
            positions.map((pos) => {
                let profit: number = 0;
                if (pos.direction === PositionDirection.long) {
                    profit = +round((pos.exitPrice - pos.entryPrice) * userSignalVolume, 6);
                } else {
                    profit = +round((pos.entryPrice - pos.exitPrice) * userSignalVolume, 6);
                }
                profit = pos.fee && +pos.fee > 0 ? +round(profit - profit * pos.fee, 6) : profit;
                return {
                    ...pos,
                    volume: userSignalVolume,
                    profit
                };
            })
        );
    }

    async calcUserSignal(userId: string, robotId: string, calcAll: boolean = false) {
        const userSignal: UserSignalsWithExists = await this.db.pg.maybeOne(sql`
            SELECT us.id, us.subscribed_at, us.volume,
                   uss.user_signal_id as "stats_exists",
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

        if(!userSignal)
            return;

        const { calcFrom, initStats } = getCalcFromAndInitStats(userSignal, calcAll);

        const conditionExitDate = !calcFrom ? sql`` : sql`AND exit_date > ${calcFrom}`;
        const querySelectPart = sql`
            SELECT id, direction, exit_date, profit, bars_held,
                   entry_price, exit_price, fee
        `;
        const queryFromAndConditionPart = sql`
            FROM robot_positions
            WHERE robot_id = ${robotId}
                AND status = 'closed'
                AND entry_date >= ${userSignal.subscribedAt}
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

        if (positionsCount == 0) return;

        const newStats = await DataStream.from(
            this.makeChunksGenerator(
                queryCommonPart,
                positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
            )
        ).reduce(
            async (prevStats: RobotStats, chunk: UserSignalPosition[]) =>
                await this._calcUserSignalStatistics(prevStats, chunk, userSignal.volume),
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
    }

    private async _calcUserSignalsWithExistsBySingleQuery(params: {
        queryCommonPart: QueryType;
        userSignals: UserSignalsWithExists[];
        calcAll: boolean;
    }): Promise<{
        [key: string]: {
            newStats: RobotStats,
            signal: UserSignalsWithExists
        }
    }> {
        const { queryCommonPart, userSignals, calcAll } = params;
        const statsDict: {
            [key: string]: {
                newStats: RobotStats,
                signal: UserSignalsWithExists
            }
        } = {};

        const allPositions: UserSignalPosition[] = await this.db.pg.any(sql`
                ${queryCommonPart};
        `);

        for (const userSignal of userSignals) {
            const { calcFrom, initStats } = getCalcFromAndInitStats(userSignal, calcAll);

            const positions: UserSignalPosition[] = allPositions.filter(
                (pos) => userSignal.subscribedAt <= pos.entryDate && (!calcFrom || calcFrom <= pos.exitDate)
            );

            statsDict[userSignal.id] = {
                newStats: await this._calcUserSignalStatistics(initStats, positions, userSignal.volume),
                signal: userSignal
            };
        }

        return statsDict;
    }

    private async _calcUserSignalsWithExistsByChunks(params: {
        queryCommonPart: QueryType;
        userSignals: UserSignalsWithExists[];
        calcAll?: boolean;
        chunkSize?: number;
    }): Promise<{
        [key: string]: {
            newStats: RobotStats,
            signal: UserSignalsWithExists
        }
    }> {
        const { queryCommonPart, userSignals, calcAll, chunkSize } = params;

        const statsDict: {
            [key: string]: {
                newStats: RobotStats,
                signal: UserSignalsWithExists
            }
        } = {};
        let statsAcc: {
            signal: UserSignalsWithExists;
            calcFrom: string;
            stats: RobotStats;
            updated: boolean;
        }[] = [];

        userSignals.forEach((us) => {
            const { calcFrom, initStats: stats } = getCalcFromAndInitStats(us, calcAll);
            statsAcc.push({ signal: us, calcFrom, stats, updated: false });
        });

        statsAcc = await DataStream.from(this.makeChunksGenerator(queryCommonPart, chunkSize)).reduce(
            async (signalsAcc: typeof statsAcc, chunk: UserSignalPosition[]) => {
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

                    signalAcc.stats = await this._calcUserSignalStatistics(
                        signalAcc.stats,
                        positions,
                        signalAcc.signal.volume
                    );

                    signalAcc.updated = true;
                }

                return signalsAcc;
            },
            statsAcc
        );

        statsAcc.forEach((signalAcc) => {
            if (signalAcc.updated) statsDict[signalAcc.signal.id] = {
                newStats: signalAcc.stats,
                signal: signalAcc.signal
            };
        });

        return statsDict;
    }

    async calcUserSignalsWithExists(robotId: string, calcAll: boolean = false) {
        const userSignals: UserSignalsWithExists[] = await this.db.pg.any(sql`
            SELECT us.id, us.subscribed_at, us.volume,
                   uss.user_signal_id as "stats_exists",
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

        if (userSignals.length == 0)
            return; //throw new Error("No signals");

        const minSubscriptionDate = dayjs
            .utc(Math.min(...userSignals.map((us) => dayjs.utc(us.subscribedAt).valueOf())))
            .toISOString();

        let minExitDate;

        if (!calcAll) {
            const minExitTime = Math.min(
                ...userSignals.map((us) => {
                    if (us.lastPositionExitDate)
                        return dayjs.utc(us.lastPositionExitDate).valueOf();
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

        if (positionsCount == 0) return;

        const signalsStats =
            positionsCount > this.maxSingleQueryPosCount
                ? await this._calcUserSignalsWithExistsByChunks({
                    queryCommonPart,
                    userSignals,
                    calcAll
                })
                : await this._calcUserSignalsWithExistsBySingleQuery({
                    queryCommonPart,
                    userSignals,
                    calcAll
                });

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
    }

    private async _calcUserSignalsWithExistsAggrStatistics(
        prevStats: RobotStats,
        positions: UserSignalPosition[]
    ): Promise<RobotStats> {
        return await this.calcStatistics(
            prevStats,
            positions.map((pos) => {
                let profit: number = 0;
                if (pos.direction === PositionDirection.long) {
                    profit = +round((pos.exitPrice - pos.entryPrice) * pos.userSignalVolume, 6);
                } else {
                    profit = +round((pos.entryPrice - pos.exitPrice) * pos.userSignalVolume, 6);
                }
                profit = pos.fee && +pos.fee > 0 ? +round(profit - profit * pos.fee, 6) : profit;
                return {
                    ...pos,
                    volume: pos.userSignalVolume,
                    profit
                };
            })
        );
    }

    async calcUserSignalsWithExistsAggr(userId: string, exchange?: string, asset?: string, calcAll: boolean = false) {
        const prevUserAggrStats: UserAggrStatsWithExists = await this.db.pg.maybeOne(sql`
            SELECT id as "stats_exists",
                   id,
                   statistics,
                   last_position_exit_date,
                   last_updated_at,
                   equity,
                   equity_avg
            FROM user_aggr_stats
            WHERE user_id = ${userId}
                AND type = 'signal'
                AND exchange = ${exchange || null}
                AND asset = ${asset || null};
        `);

        if (!prevUserAggrStats)
            return;

        const { calcFrom, initStats } = getCalcFromAndInitStats(prevUserAggrStats, calcAll);

        const conditionExchange = !exchange ? sql`` : sql`AND r.exchange = ${exchange}`;
        const conditionAsset = !asset ? sql`` : sql`AND r.asset = ${asset}`;
        const conditionExitDate = !calcFrom ? sql`` : sql`AND p.exit_date > ${calcFrom}`;
        const querySelectPart = sql`
            SELECT p.id, p.direction, p.exit_date, p.profit, p.bars_held,
                   p.entry_price, p.exit_price, p.fee,
                   us.volume AS user_signal_volume
        `;
        const queryFromAndConditionPart = sql`
            FROM robot_positions p,
                 robots r,
                 user_signals us
            WHERE us.user_id = ${userId}
             AND us.robot_id = r.id
             AND p.robot_id = r.id
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

        if (positionsCount == 0) return;

        const newStats = await DataStream.from(
            this.makeChunksGenerator(
                queryCommonPart,
                positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
            )
        ).reduce(
            async (prevStats: RobotStats, chunk: UserSignalPosition[]) =>
                await this._calcUserSignalsWithExistsAggrStatistics(prevStats, chunk),
            initStats
        );

        await this.upsertStats(
            {
                table: sql`user_aggr_stats`,
                fieldId: sql`id`,
                id: prevUserAggrStats?.id,
                addFields: sql`user_id, exchange, asset, type`,
                addFieldsValues: sql`${userId}, ${exchange || null}, ${asset || null}, 'signal'`
            },
            newStats,
            prevUserAggrStats
        );
    }

    async calcUserRobot(userRobotId: string, calcAll: boolean = false) {
        const prevRobotStats: RobotStatsWithExists = await this.db.pg.maybeOne(sql`
            SELECT urs.user_robot_id as "stats_exists",
                urs.statistics,
                urs.last_position_exit_date,
                urs.last_updated_at,
                urs.equity,
                urs.equity_avg
            FROM user_robots ur
            LEFT JOIN user_robot_stats urs
                ON ur.id = urs.user_robot_id
            WHERE ur.id = ${userRobotId};
        `);

        if (!prevRobotStats)
            return;

        const { calcFrom, initStats } = getCalcFromAndInitStats(prevRobotStats, calcAll);

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

        if (positionsCount == 0) return;

        const newStats = await DataStream.from(
            this.makeChunksGenerator(
                queryCommonPart,
                positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
            )
        ).reduce(
            async (prevStats: RobotStats, chunk: PositionDataForStats[]) =>
                await this.calcStatistics(prevStats, chunk),
            initStats
        );

        await this.upsertStats(
            {
                table: sql`user_robot_stats`,
                fieldId: sql`user_robot_id`,
                id: userRobotId
            },
            newStats,
            prevRobotStats
        );
    }

    async calcUserRobotsAggr(userId: string, exchange?: string, asset?: string, calcAll: boolean = false) {
        const prevUserAggrStats: UserAggrStatsWithExists = await this.db.pg.maybeOne(sql`
            SELECT id as "stats_exists",
                   id,
                   statistics,
                   last_position_exit_date,
                   last_updated_at,
                   equity,
                   equity_avg
            FROM user_aggr_stats
            WHERE user_id = ${userId}
                AND type = 'userRobot'
                AND exchange = ${exchange || null}
                AND asset = ${asset || null};
        `);

        if (!prevUserAggrStats)
            return;

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

        if (positionsCount == 0) return;

        const newStats = await DataStream.from(
            this.makeChunksGenerator(
                queryCommonPart,
                positionsCount > this.maxSingleQueryPosCount ? this.defaultChunkSize : positionsCount
            )
        ).reduce(
            async (prevStats: RobotStats, chunk: UserSignalPosition[]) => await this.calcStatistics(prevStats, chunk),
            initStats
        );

        await this.upsertStats(
            {
                table: sql`user_aggr_stats`,
                fieldId: sql`id`,
                id: prevUserAggrStats?.id,
                addFields: sql`user_id, exchange, asset, type`,
                addFieldsValues: sql`${userId}, ${exchange || null}, ${asset || null}, 'userRobot'`
            },
            newStats,
            prevUserAggrStats
        );
    }
}
