import { DataStream } from "scramjet";
/* import os from "os";
import { spawn, Pool, Worker as ThreadsWorker } from "threads"; */
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
//import { RobotPositionState, PositionDataForStats } from "@cryptuoso/robot-state";
import { round } from "@cryptuoso/helpers";
//import { calcStatistics } from "./statsWorker";
import { sql, pgUtil, pg } from "@cryptuoso/postgres";

import { calcStatisticsCumulatively, CommonStats, PositionDataForStats } from "@cryptuoso/trade-statistics";
import dayjs from "dayjs";

export default class StatisticCalcService extends BaseService {
    /* cpus: number;
    pool: Pool<any>; */
    pgJS: typeof pg;

    constructor(config?: BaseServiceConfig) {
        super(config);
        try {
            this.pgJS = pgUtil.createJSPool();
            /* this.cpus = os.cpus().length;
            this.addOnStartHandler(this._onStartService.bind(this)); */
        } catch (err) {
            this.log.error("Error in StatisticCalcService constructor", err);
        }
    }

    /* async _onStartService(): Promise<void> {
        this.pool = Pool(() => spawn<StatisticUtils>(new ThreadsWorker("./statsWorker")), {
            concurrency: this.cpus,
            name: "statistic-utils"
        });
    } */

    async calcStatistics(previousPositionsStatistics: CommonStats, positions: PositionDataForStats[]) {
        /* return this.pool.queue(async (utils: StatisticUtils) =>
            utils.calcStatistics(positions)
        ); */
        return await calcStatisticsCumulatively(
            previousPositionsStatistics,
            // from cpz_platform
            positions.map((pos) => ({
                ...pos,
                profit: pos.fee && +pos.fee > 0 ? +round(pos.profit - pos.profit * pos.fee, 6) : pos.profit
            }))
        );
    }

    async getRobot(robotId: string) {
        const robot = await pg.maybeOne(sql`
            SELECT *
            FROM robots
            WHERE id = ${robotId};
        `);

        return robot;
    }

    async calcRobotBySingleQuery(robotId: string, updateAll: boolean = false) {
        const prevRobotStats: CommonStats = await pg.maybeOne(sql`
            SELECT statistics, equity
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!prevRobotStats) throw new Error("Robot with this id doesn't exists");

        const initStats = updateAll ? new CommonStats(null, null) : prevRobotStats;
        const updateFrom = updateAll ? dayjs(0).toISOString() : prevRobotStats.statistics.lastPositionExitDate;

        const positions: PositionDataForStats[] = await this.db.pg.any(sql`
                SELECT id, direction, exit_date, profit, bars_held 
                FROM robot_positions
                WHERE robot_id = ${robotId}
                    AND status = 'closed'
                    AND exit_date > ${updateFrom}
                ORDER BY exit_date;
        `);

        //AND exit_date >= r.updated_at

        if (!positions.length) return;

        const { statistics, equity } = await this.calcStatistics(initStats, positions);

        /* await this.db.pg.any(sql`
            UPDATE robots
            SET statistics = ${this.db.sql.json(statistics)},
                equity = ${this.db.sql.json(equity)}
            WHERE id = ${robotId};
        `); */
    }

    async calcRobotByChunks(robotId: string, updateAll: boolean = false, chunkSize: number = 500) {
        const prevRobotStats: CommonStats = await this.db.pg.maybeOne(sql`
            SELECT statistics, equity
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!prevRobotStats) throw new Error("Robot with this id doesn't exists");

        const initStats = updateAll ? new CommonStats(null, null) : prevRobotStats;
        const updateFrom = updateAll ? dayjs(0).toISOString() : prevRobotStats.statistics.lastPositionExitDate;

        const pg = this.db.pg;

        await DataStream.from(async function* () {
            let chunkNum = 0;

            while (true) {
                const chunk: PositionDataForStats[] = await pg.any(sql`
                                SELECT id, direction, exit_date, profit, bars_held 
                                FROM robot_positions
                                WHERE robot_id = ${robotId}
                                    AND status = 'closed'
                                    AND exit_date > ${updateFrom}
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
            }, initStats)
            .then(async (res) => {
                if (res == initStats) return;

                const { statistics, equity } = res;
                /* await this.db.pg.any(sql`
                    UPDATE robots
                    SET statistics = ${this.db.sql.json(statistics)},
                        equity = ${this.db.sql.json(equity)}
                    WHERE id = ${robotId};
                `); */
            });
    }

    async calcRobotByChunksWithConnection(robotId: string, updateAll: boolean = false, chunkSize: number = 500) {
        const prevRobotStats: CommonStats = await this.db.pg.maybeOne(sql`
            SELECT statistics, equity
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!prevRobotStats) throw new Error("Robot with this id doesn't exists");

        const initStats = updateAll ? new CommonStats(null, null) : prevRobotStats;
        const updateFrom = updateAll ? dayjs(0).toISOString() : prevRobotStats.statistics.lastPositionExitDate;

        await this.db.pg.connect(async (connection) => {
                await DataStream.from(async function* () {
                    let chunkNum = 0;

                    while (true) {
                        const chunk: PositionDataForStats[] = await connection.any(sql`
                                    SELECT id, direction, exit_date, profit, bars_held 
                                    FROM robot_positions
                                    WHERE robot_id = ${robotId}
                                        AND status = 'closed'
                                        AND exit_date > ${updateFrom}
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
                }, initStats)
                .then(async (res) => {
                    if (res == initStats) return;

                    const { statistics, equity } = res;
                    /* await this.db.pg.any(sql`
                        UPDATE robots
                        SET statistics = ${this.db.sql.json(statistics)},
                            equity = ${this.db.sql.json(equity)}
                        WHERE id = ${robotId};
                    `); */
                });
        });
    }

    async calcRobotByStream(robotId: string, updateAll: boolean = false) {
        const prevRobotStats: CommonStats = await pg.maybeOne(sql`
            SELECT statistics, equity
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!prevRobotStats) throw new Error("Robot with this id doesn't exists");

        const initStats = updateAll ? new CommonStats(null, null) : prevRobotStats;
        const updateFrom = updateAll ? dayjs(0).toISOString() : prevRobotStats.statistics.lastPositionExitDate;

        await this.pgJS.stream(
            sql`
                SELECT id, direction, exit_date, profit, bars_held 
                FROM robot_positions
                WHERE robot_id = ${robotId}
                    AND status = 'closed'
                    AND exit_date > ${updateFrom}
                ORDER BY exit_date;
            `,
            async (stream) => {
                await DataStream.from(stream)
                    .map((datum) => datum.row)
                    .reduce(async (prevStats: CommonStats, pos: PositionDataForStats) => {
                        return await this.calcStatistics(prevStats, [pos]);
                    }, initStats)
                    .then(async (res) => {
                        if (res == initStats) return;

                        const { statistics, equity } = res;
                        /* await this.db.pg.any(sql`
                            UPDATE robots
                            SET statistics = ${this.db.sql.json(statistics)},
                                equity = ${this.db.sql.json(equity)}
                            WHERE id = ${robotId};
                        `); */
                    })
                    .catch((err) => {
                        //console.log("ERRRORRR", err);
                    });
            }
        );
    }

    async checkStreamOrder(robotId: string, updateAll: boolean = false) {
        const prevRobotStats: CommonStats = await pg.maybeOne(sql`
            SELECT statistics, equity
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!prevRobotStats) throw new Error("Robot with this id doesn't exists");

        const updateFrom = updateAll ? dayjs(0).toISOString() : prevRobotStats.statistics.lastPositionExitDate;

        let cnt = 0;
        
        await this.pgJS.stream(
            sql`
                SELECT id, direction, exit_date, profit, bars_held 
                FROM robot_positions
                WHERE robot_id = ${robotId}
                    AND status = 'closed'
                    AND exit_date > ${updateFrom}
                ORDER BY exit_date;
            `,
            async (stream) => {
                await DataStream.from(stream)
                    .map((datum) => datum.row)
                    .reduce(
                        async (acc: any, pos: PositionDataForStats) => {
                            if(cnt < 3) {
                                ++cnt;
                                console.log(pos.exitDate, acc.lastExitDate);
                            }
                            if (dayjs.utc(pos.exitDate).valueOf() <= dayjs.utc(acc.lastExitDate).valueOf()) {
                                //console.log(pos.exitDate, acc.lastExitDate);
                                //console.log(dayjs.utc(pos.exitDate).valueOf(), dayjs.utc(acc.lastExitDate).valueOf());
                                ++acc.wrongCount;
                            }

                            ++acc.allCount;
                            acc.lastExitDate = pos.exitDate;
                            return acc;
                        },
                        { lastExitDate: updateFrom, wrongCount: 0, allCount: 0 }
                    )
                    .then(async (res) => {
                        console.log(res);
                        console.log(dayjs.utc(res.lastExitDate).valueOf());
                    });
            }
        );
    }
    
    async streamAgain() {
        await this.pgJS.stream(
            this.db.sql`SELECT id, direction, exit_date, profit, bars_held
            FROM robot_positions
            WHERE robot_id = '51c90607-6d38-4b7c-81c9-d349886e80b0'                   
            AND status = 'closed'
            AND exit_date > '2020-05-12T23:24:28.493Z'
            ORDER BY exit_date limit 10;`,
            async (stream) => {
                await DataStream.from(stream, { maxParallel: 1 })
                    .map(async (data: { row: any }) => {
                        this.log.info(data.row.exitDate);
                    })
                    .whenEnd();
            }
        );
    }
}
