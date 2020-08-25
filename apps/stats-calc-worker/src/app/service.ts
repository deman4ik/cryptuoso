import { DataStream } from "scramjet";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { Worker, Job } from "bullmq";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { StatisticUtils } from "./statsWorker";
import { sql, pgUtil, pg } from "@cryptuoso/postgres";
import { SqlSqlTokenType, QueryResultRowType } from "slonik";
import {
    StatsCalcJob,
    StatsCalcJobType,
    CommonStats,
    PositionDataForStats,
    PositionDirection
} from "@cryptuoso/trade-statistics";
import { UserSignals, UserAggrStatsDB, UserSignalPosition } from "@cryptuoso/user-state";
import { round } from "@cryptuoso/helpers";
import dayjs from "@cryptuoso/dayjs";

function getCalcFromAndInitStats(stats?: CommonStats, calcAll?: boolean) {
    let calcFrom: string;
    let initStats: CommonStats;

    if (calcAll || !stats || !stats.statistics || !stats.statistics.lastPositionExitDate) {
        initStats = new CommonStats(null, null);
    } else {
        initStats = { equity: stats.equity, statistics: stats.statistics };
        calcFrom = stats.statistics.lastPositionExitDate;
    }

    return { calcFrom, initStats };
}

type QueryType = SqlSqlTokenType<QueryResultRowType<any>>;

export type StatisticCalcWorkerServiceConfig = BaseServiceConfig;
export default class StatisticCalcWorkerService extends BaseService {
    private pool: Pool<any>;
    private workers: { [key: string]: Worker };
    private pgJS: typeof pg;

    maxSingleQueryPosCount: number = 750;
    defaultChunkSize: number = 500;

    constructor(config?: StatisticCalcWorkerServiceConfig) {
        super(config);
        try {
            this.pgJS = pgUtil.createJSPool({});
            this.addOnStartHandler(this._onStartService.bind(this));
            this.addOnStopHandler(this._onStopService.bind(this));
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
                connection: this.redis
            })
        };
    }

    private async _onStopService(): Promise<void> {
        await this.workers.calcStatistics.close();
        await this.pool.terminate();
    }

    async process(job: Job) {
        const { type, calcAll, robotId, userRobotId, userId, exchange, asset } = job.data as StatsCalcJob;

        this.log.info(`Starting job ${job.id}`);

        try {
            if (type === StatsCalcJobType.robot) {
                await this.calcRobot(robotId, calcAll);
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
            }
            this.log.info(`Job ${job.id} finished`);
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err);
            throw err;
        }
    }

    private makeChunksGenerator(query: QueryType, chunkSize: number = this.defaultChunkSize) {
        if (chunkSize < 1) throw new Error("Argument 'chunkSize' must be positive number.");

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

    async calcStatistics(prevStats: CommonStats, positions: PositionDataForStats[]): Promise<CommonStats> {
        return await this.pool.queue(async (utils: StatisticUtils) => utils.calcStatistics(prevStats, positions));
    }

    private async _calcRobotStatistics(
        prevStats: CommonStats,
        positions: PositionDataForStats[]
    ): Promise<CommonStats> {
        return await this.calcStatistics(
            prevStats,
            positions.map((pos) => ({
                ...pos,
                profit: pos.fee && +pos.fee > 0 ? +round(pos.profit - pos.profit * pos.fee, 6) : pos.profit
            }))
        );
    }

    private async _calcRobotBySingleQuery(params: { queryCommonPart: QueryType; initStats: CommonStats }) {
        const { queryCommonPart, initStats } = params;

        const positions: PositionDataForStats[] = await this.db.pg.any(sql`
            ${queryCommonPart};
        `);

        //if (!positions.length) return;

        return await this._calcRobotStatistics(initStats, positions);
    }

    private async _calcRobotByChunks(params: {
        initStats: CommonStats;
        queryCommonPart?: QueryType;
        chunkSize?: number;
    }) {
        const { initStats, queryCommonPart, chunkSize } = params;

        return await DataStream.from(this.makeChunksGenerator(queryCommonPart, chunkSize)).reduce(
            async (prevStats: CommonStats, chunk: PositionDataForStats[]) =>
                await this._calcRobotStatistics(prevStats, chunk),
            initStats
        );
    }

    async calcRobot(robotId: string, calcAll: boolean = false) {
        const prevRobotStats: CommonStats = await this.db.pg.maybeOne(sql`
            SELECT statistics, equity
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!prevRobotStats) {
            return; //throw new Error("Robot with this id doesn't exists");
        }

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

        const { statistics, equity } =
            positionsCount <= this.maxSingleQueryPosCount
                ? await this._calcRobotBySingleQuery({ queryCommonPart, initStats })
                : await this._calcRobotByChunks({ queryCommonPart, initStats });

        /* await this.db.pg.any(sql`
            UPDATE robots
            SET statistics = ${this.db.sql.json(statistics)},
                equity = ${this.db.sql.json(equity)}
            WHERE id = ${robotId};
        `); */
    }

    private async _calcUserSignalStatistics(
        prevStats: CommonStats,
        positions: UserSignalPosition[],
        userSignalVolume: number
    ): Promise<CommonStats> {
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

    private async _calcUserSignalBySingleQuery(params: {
        queryCommonPart: QueryType;
        initStats: CommonStats;
        userSignalVolume: number;
    }) {
        const { queryCommonPart, userSignalVolume, initStats } = params;
        const positions: UserSignalPosition[] = await this.db.pg.any(sql`
            ${queryCommonPart};
        `);

        //if (!positions.length) return;

        return await this._calcUserSignalStatistics(initStats, positions, userSignalVolume);
    }

    private async _calcUserSignalByChunks(params: {
        queryCommonPart: QueryType;
        initStats: CommonStats;
        userSignalVolume: number;
        chunkSize?: number;
    }) {
        const { queryCommonPart, userSignalVolume, initStats, chunkSize } = params;

        return await DataStream.from(this.makeChunksGenerator(queryCommonPart, chunkSize)).reduce(
            async (prevStats: CommonStats, chunk: UserSignalPosition[]) =>
                await this._calcUserSignalStatistics(prevStats, chunk, userSignalVolume),
            initStats
        );
    }

    async calcUserSignal(userId: string, robotId: string, calcAll: boolean = false) {
        const userSignal: UserSignals = await this.db.pg.maybeOne(sql`
            SELECT id, subscribe_at, volume, statistics, equity
            FROM user_signals
            WHERE id = ${robotId}
              AND user_id = ${userId};
        `);

        if (!userSignal) {
            return; //throw new Error("The signal doesn't exists");
        }

        const { calcFrom, initStats } = getCalcFromAndInitStats(userSignal, calcAll);

        const conditionExitDate = !calcFrom ? sql`` : sql`AND exit_date > ${calcFrom}`;
        const querySelectPart = sql`
            SELECT id, direction, exit_date, profit,
                   bars_held, entry_price, exit_price, fee
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

        const { statistics, equity } =
            positionsCount <= this.maxSingleQueryPosCount
                ? await this._calcUserSignalBySingleQuery({
                      queryCommonPart,
                      initStats,
                      userSignalVolume: userSignal.volume
                  })
                : await this._calcUserSignalByChunks({
                      queryCommonPart,
                      initStats,
                      userSignalVolume: userSignal.volume
                  });

        /* await this.db.pg.any(sql`
            UPDATE user_signals
            SET statistics = ${this.db.sql.json(statistics)},
                equity = ${this.db.sql.json(equity)}
            WHERE id = ${userSignal.id};
        `); */
    }

    private async _calcUserSignalsBySingleQuery(params: {
        queryCommonPart: QueryType;
        userSignals: UserSignals[];
        calcAll: boolean;
    }): Promise<{ [key: string]: CommonStats }> {
        const { queryCommonPart, userSignals, calcAll } = params;
        const statsDict: { [key: string]: CommonStats } = {};

        const allPositions: UserSignalPosition[] = await this.db.pg.any(sql`
                ${queryCommonPart};
        `);

        for (const userSignal of userSignals) {
            const { calcFrom, initStats } = getCalcFromAndInitStats(userSignal, calcAll);

            const positions: UserSignalPosition[] = allPositions.filter(
                (pos) => userSignal.subscribedAt <= pos.entryDate && (!calcFrom || calcFrom <= pos.exitDate)
            );

            statsDict[userSignal.id] = await this._calcUserSignalStatistics(initStats, positions, userSignal.volume);
        }

        return statsDict;
    }

    private async _calcUserSignalsByChunks(params: {
        queryCommonPart: QueryType;
        userSignals: UserSignals[];
        calcAll?: boolean;
        chunkSize?: number;
    }): Promise<{ [key: string]: CommonStats }> {
        const { queryCommonPart, userSignals, calcAll, chunkSize } = params;

        const statsDict: { [key: string]: CommonStats } = {};
        let statsAcc: {
            signal: UserSignals;
            calcFrom: string;
            stats: CommonStats;
            updated: boolean;
        }[] = [];

        userSignals.forEach((us) => {
            const { calcFrom, initStats: stats } = getCalcFromAndInitStats(us, calcAll);
            statsAcc.push({ signal: us, calcFrom, stats, updated: false });
        });

        statsAcc = await DataStream.from(
            this.makeChunksGenerator(queryCommonPart, chunkSize)
        ).reduce(
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
            },
            statsAcc
        );

        statsAcc.forEach((signalAcc) => {
            if (signalAcc.updated) statsDict[signalAcc.signal.id] = signalAcc.stats;
        });

        return statsDict;
    }

    async calcUserSignals(robotId: string, calcAll: boolean = false) {
        const userSignals: UserSignals[] = await this.db.pg.maybeOne(sql`
            SELECT id, subscribe_at, volume, statistics, equity
            FROM user_signals
            WHERE id = ${robotId};
        `);

        if (!userSignals) {
            return; //throw new Error("The signal doesn't exists");
        }

        const minSubscriptionDate = dayjs
            .utc(Math.min(...userSignals.map((us) => dayjs.utc(us.subscribedAt).valueOf())))
            .toISOString();

        let minExitDate;

        if (!calcAll) {
            const minExitTime = Math.min(
                ...userSignals.map((us) => {
                    if (us.statistics && us.statistics.lastPositionExitDate)
                        return dayjs.utc(us.statistics.lastPositionExitDate).valueOf();
                    else return Infinity;
                })
            );

            minExitDate = isFinite(minExitTime) ? dayjs.utc(minExitTime).toISOString() : undefined;
        }

        const conditionExitDate = !minExitDate ? sql`` : sql`AND exit_date > ${minExitDate}`;
        const querySelectPart = sql`
            SELECT id, direction, exit_date, profit, bars_held,
                   entry_price, exit_price, fee, subscribed_at
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
            positionsCount <= this.maxSingleQueryPosCount
                ? await this._calcUserSignalsBySingleQuery({
                      queryCommonPart,
                      userSignals,
                      calcAll
                  })
                : await this._calcUserSignalsByChunks({
                      queryCommonPart,
                      userSignals,
                      calcAll
                  });

        for (const [signalId, { statistics, equity }] of Object.entries(signalsStats)) {
            /* await this.db.pg.any(sql`
                UPDATE user_signals
                SET statistics = ${this.db.sql.json(statistics)},
                    equity = ${this.db.sql.json(equity)}
                WHERE id = ${signalId};
            `); */
        }
    }

    private async _calcUserSignalsAggrStatistics(
        prevStats: CommonStats,
        positions: UserSignalPosition[]
    ): Promise<CommonStats> {
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

    private async _calcUserSignalsAggrBySingleQuery(params: {
        queryCommonPart: QueryType;
        initStats: CommonStats;
    }): Promise<CommonStats> {
        const { queryCommonPart, initStats } = params;
        
        const positions: UserSignalPosition[] = await this.db.pg.any(sql`
            ${queryCommonPart};
        `);

        return await this._calcUserSignalsAggrStatistics(initStats, positions);
    }

    private async _calcUserSignalsAggrByChunks(params: {
        queryCommonPart: QueryType;
        initStats: CommonStats;
        chunkSize?: number;
    }) {
        const { queryCommonPart, initStats, chunkSize } = params;

        return await DataStream.from(
            this.makeChunksGenerator(queryCommonPart, chunkSize)
        ).reduce(
            async (prevStats: CommonStats, chunk: UserSignalPosition[]) =>
                await this._calcUserSignalsAggrStatistics(prevStats, chunk),
            initStats
        );
    }

    async calcUserSignalsAggr(userId: string, exchange?: string, asset?: string, calcAll: boolean = false) {
        const prevUserAggrStats: UserAggrStatsDB = await this.db.pg.maybeOne(sql`
            SELECT id, statistics, equity
            FROM user_aggr_stats
            WHERE user_id = ${userId}
                AND \`type\` = 'signal'
                AND exchange = ${exchange}
                AND asset = ${asset};
        `);

        const { calcFrom, initStats } = getCalcFromAndInitStats(prevUserAggrStats, calcAll);

        const conditionExchange = !exchange ? sql`` : sql`AND r.exchange = ${exchange}`;
        const conditionAsset = !asset ? sql`` : sql`AND r.asset = ${asset}`;
        const conditionExitDate = !calcFrom ? sql`` : sql`AND exit_date > ${calcFrom}`;
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

        const { statistics, equity } =
            positionsCount <= this.maxSingleQueryPosCount
                ? await this._calcUserSignalsAggrBySingleQuery({ queryCommonPart, initStats })
                : await this._calcUserSignalsAggrByChunks({ queryCommonPart, initStats });

        /* if(prevUserAggrStats) {
            await this.db.pg.any(sql`
                UPDATE user_aggr_stats
                SET statistics = ${this.db.sql.json(statistics)},
                    equity = ${this.db.sql.json(equity)}
                WHERE id = ${prevUserAggrStats.id};
            `);
        } else {
            await this.db.pg.any(sql`
                INSERT INTO user_aggr_stats
                (user_id, exchange, asset, \`type\`, statistics, equity)
                VALUES (
                    ${userId},
                    ${exchange},
                    ${asset},
                    'signal',
                    ${this.db.sql.json(statistics)},
                    ${this.db.sql.json(equity)}
                );
            `);
        } */
    }

    private async _calcUserRobotBySingleQuery(params: {
        queryCommonPart: QueryType;
        initStats: CommonStats;
    }) {
        const { queryCommonPart, initStats } = params;

        const positions: PositionDataForStats[] = await this.db.pg.any(sql`
                ${queryCommonPart};
        `);

        //if (!positions.length) return;

        return await this.calcStatistics(initStats, positions);
    }

    private async _calcUserRobotByChunks(params: {
        queryCommonPart: QueryType;
        initStats: CommonStats;
        chunkSize?: number;
    }) {
        const { queryCommonPart, initStats, chunkSize } = params;

        return await DataStream.from(
            this.makeChunksGenerator(queryCommonPart, chunkSize)
        ).reduce(
            async (prevStats: CommonStats, chunk: PositionDataForStats[]) =>
                await this.calcStatistics(prevStats, chunk),
            initStats
        );
    }

    async calcUserRobot(userRobotId: string, calcAll: boolean = false) {
        const prevRobotStats: CommonStats = await this.db.pg.maybeOne(sql`
            SELECT statistics, equity
            FROM user_robots
            WHERE id = ${userRobotId};
        `);

        if (!prevRobotStats) {
            return; //throw new Error("Robot with this id doesn't exists");
        }

        const { calcFrom, initStats } = getCalcFromAndInitStats(prevRobotStats, calcAll);

        const conditionExitDate = !calcFrom ? sql`` : sql`AND exit_date > ${calcFrom}`;
        const querySelectPart = sql`
            SELECT id, direction, exit_date, profit, bars_held
        `;
        const queryFromAndConditionPart = sql`
            FROM user_positions
            WHERE robot_id = ${userRobotId}
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

        const { statistics, equity } =
            positionsCount <= this.maxSingleQueryPosCount
                ? await this._calcUserRobotBySingleQuery({ queryCommonPart, initStats })
                : await this._calcUserRobotByChunks({ queryCommonPart, initStats });

        /* await this.db.pg.any(sql`
            UPDATE user_robots
            SET statistics = ${this.db.sql.json(statistics)},
                equity = ${this.db.sql.json(equity)}
            WHERE id = ${userRobotId};
        `); */
    }

    private async _calcUserRobotsAggrBySingleQuery(params: {
        queryCommonPart: QueryType;
        initStats: CommonStats;
    }): Promise<CommonStats> {
        const { queryCommonPart, initStats } = params;
        
        const positions: UserSignalPosition[] = await this.db.pg.any(sql`
            ${queryCommonPart};
        `);

        return await this.calcStatistics(initStats, positions);
    }

    private async _calcUserRobotsAggrByChunks(params: {
        queryCommonPart: QueryType;
        initStats: CommonStats;
        chunkSize?: number;
    }) {
        const { queryCommonPart, initStats, chunkSize } = params;

        return await DataStream.from(
            this.makeChunksGenerator(queryCommonPart, chunkSize)
        ).reduce(
            async (prevStats: CommonStats, chunk: UserSignalPosition[]) => await this.calcStatistics(prevStats, chunk),
            initStats
        );
    }

    async calcUserRobotsAggr(userId: string, exchange?: string, asset?: string, calcAll: boolean = false) {
        const prevUserAggrStats: UserAggrStatsDB = await this.db.pg.maybeOne(sql`
            SELECT id, statistics, equity
            FROM user_aggr_stats
            WHERE user_id = ${userId}
                AND \`type\` = 'userRobot'
                AND exchange = ${exchange}
                AND asset = ${asset};
        `);

        const { calcFrom, initStats } = getCalcFromAndInitStats(prevUserAggrStats, calcAll);

        const conditionExchange = !exchange ? sql`` : sql`AND r.exchange = ${exchange}`;
        const conditionAsset = !asset ? sql`` : sql`AND r.asset = ${asset}`;
        const conditionExitDate = !calcFrom ? sql`` : sql`AND exit_date > ${calcFrom}`;
        const querySelectPart = sql`
            SELECT p.id, p.direction, p.exit_date, p.profit, p.bars_held,
                   p.fee, p.entry_price, p.exit_price
        `;
        const queryFromAndConditionPart = sql`
            FROM user_positions p,
                 user_robots r,
                 user_signals us
            WHERE us.user_id = ${userId}
              AND us.robot_id = r.id
              AND p.robot_id = r.id
              AND p.status IN ('closed', 'closedAuto')
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

        const { statistics, equity } =
            positionsCount <= this.maxSingleQueryPosCount
                ? await this._calcUserRobotsAggrBySingleQuery({ queryCommonPart, initStats})
                : await this._calcUserRobotsAggrByChunks({ queryCommonPart, initStats });

        /* if(prevUserAggrStats) {
            await this.db.pg.any(sql`
                UPDATE user_aggr_stats
                SET statistics = ${this.db.sql.json(statistics)},
                    equity = ${this.db.sql.json(equity)}
                WHERE id = ${prevUserAggrStats.id};
            `);
        } else {
            await this.db.pg.any(sql`
                INSERT INTO user_aggr_stats
                (user_id, exchange, asset, \`type\`, statistics, equity)
                VALUES (
                    ${userId},
                    ${exchange},
                    ${asset},
                    'userRobot',
                    ${this.db.sql.json(statistics)},
                    ${this.db.sql.json(equity)}
                );
            `);
        } */
    }

    async printUserAggrStats() {
        console.log(
            await this.db.pg.any(sql`
                SELECT *
                FROM user_aggr_stats
                LIMIT 10;
            `)
        );
    }

    async printRobotPositions() {
        console.log(
            await this.db.pg.any(sql`
                SELECT *
                FROM robot_positions
                LIMIT 10;
            `)
        );
    }
}
