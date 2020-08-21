import { DataStream } from "scramjet";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { StatisticUtils } from "./statsWorker";
import { sql, pgUtil, pg } from "@cryptuoso/postgres";
import { CommonStats, PositionDataForStats } from "@cryptuoso/trade-statistics";

export type StatisticCalcWorkerServiceConfig = BaseServiceConfig;
export default class StatisticCalcWorkerService extends BaseService {
    pool: Pool<any>;
    pgJS: typeof pg;

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

    async _onStartService(): Promise<void> {
        this.pool = Pool(() => spawn<StatisticUtils>(new ThreadsWorker("./statsWorker")), {
            name: "statistics-utils"
        });
    }

    async _onStopService(): Promise<void> {
        await this.pool.terminate();
    }

    async calcStatistics(prevStats: CommonStats, positions: PositionDataForStats[]): Promise<CommonStats> {
        return await this.pool.queue(async (utils: StatisticUtils) => utils.calcStatistics(prevStats, positions));
    }

    async _calcRobotBySingleQuery(robotId: string, initStats: CommonStats, calcFrom?: string) {
        const condition = !calcFrom ? sql`` : sql`AND exit_date > ${calcFrom}`;
        const positions: PositionDataForStats[] = await this.db.pg.any(sql`
                SELECT id, direction, exit_date, profit, bars_held 
                FROM robot_positions
                WHERE robot_id = ${robotId}
                    AND status = 'closed'
                    ${condition}
                ORDER BY exit_date;
        `);

        //if (!positions.length) return;

        return await this.calcStatistics(initStats, positions);
    }

    async _calcRobotByChunks(
        robotId: string,
        initStats: CommonStats,
        calcFrom?: string,
        chunkSize: number = this.defaultChunkSize
    ) {
        const pg = this.db.pg;

        return await DataStream.from(async function* () {
                let chunkNum = 0;
                const condition = !calcFrom ? sql`` : sql`AND exit_date > ${calcFrom}`;

                while (true) {
                    const chunk: PositionDataForStats[] = await pg.any(sql`
                        SELECT id, direction, exit_date, profit, bars_held 
                        FROM robot_positions
                        WHERE robot_id = ${robotId}
                            AND status = 'closed'
                            ${condition}
                        ORDER BY exit_date
                        LIMIT ${chunkSize} OFFSET ${chunkNum * chunkSize};
                    `);

                    ++chunkNum;
                    yield chunk;

                    if (chunk.length != chunkSize) break;
                }
            })
            .reduce(async (prevStats: CommonStats, chunk: PositionDataForStats[]) => {
                return await this.calcStatistics(prevStats, chunk);
            }, initStats);
    }

    async calcRobot(robotId: string, calcAll: boolean = false) {
        const prevRobotStats: CommonStats = await pg.maybeOne(sql`
            SELECT statistics, equity
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!prevRobotStats) throw new Error("Robot with this id doesn't exists");

        let calcFrom: string;
        let initStats: CommonStats = prevRobotStats;

        if (calcAll || !prevRobotStats.statistics || !prevRobotStats.statistics.lastPositionExitDate) {
            initStats = new CommonStats(null, null);
        } else {
            calcFrom = prevRobotStats.statistics.lastPositionExitDate;
        }

        const condition = !calcFrom ? sql`` : sql`AND exit_date > ${calcFrom}`;
        const positionsCount: number = +(await pg.oneFirst(sql`
            SELECT COUNT(*) 
            FROM robot_positions
            WHERE robot_id = ${robotId}
                AND status = 'closed'
                ${condition};
        `));

        const { statistics, equity } = 
            positionsCount == 0 ?
                initStats :
            positionsCount <= this.maxSingleQueryPosCount ?
                await this._calcRobotBySingleQuery(robotId, initStats, calcFrom) :
                await this._calcRobotByChunks(robotId, initStats, calcFrom)
            ;

        /* await this.db.pg.any(sql`
            UPDATE robots
            SET statistics = ${this.db.sql.json(statistics)},
                equity = ${this.db.sql.json(equity)}
            WHERE id = ${robotId};
        `); */
    }
}
