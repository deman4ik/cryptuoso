import { DataStream } from "scramjet";
/* import os from "os";
import { spawn, Pool, Worker as ThreadsWorker } from "threads"; */
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
//import { RobotPositionState, PositionDataForStats } from "@cryptuoso/robot-state";
import { round } from "@cryptuoso/helpers";
//import { calcStatistics } from "./statsWorker";
import { sql, pgUtil, pg } from "@cryptuoso/postgres";

import { calcStatisticsCumulatively, CommonStats, PositionDataForStats } from "@cryptuoso/trade-statistics";

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

    async calcRobotBySingleQuery(robotId: string) {
        const prevRobotStats: CommonStats = await pg.maybeOne(sql`
            SELECT statistics, equity
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!prevRobotStats) throw new Error("Robot with this id doesn't exists");

        const positions: PositionDataForStats[] = await this.db.pg.any(sql`
                SELECT *
                FROM robot_positions
                WHERE robot_id = ${robotId}
                    AND status = 'closed'
                ORDER BY exit_date;
        `);

        //AND exit_date >= r.updated_at

        const { statistics, equity } = await this.calcStatistics(new CommonStats(null, null), positions);

        await this.db.pg.any(sql`
            UPDATE robots
            SET statistics = ${this.db.sql.json(statistics)},
                equity = ${this.db.sql.json(equity)}
            WHERE id = ${robotId};
        `);
    }

    async calcRobotByChunks(robotId: string, partSize: number = 500) {
        const pg = this.db.pg;
        const prevRobotStats: CommonStats = await pg.maybeOne(sql`
            SELECT statistics, equity
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!prevRobotStats) throw new Error("Robot with this id doesn't exists");

        await DataStream.from(async function* () {
            let partNum = 0;

            while (true) {
                const part: PositionDataForStats[] = await pg.any(sql`
                        SELECT *
                        FROM robot_positions
                        WHERE robot_id = ${robotId}
                            AND status = 'closed'
                        ORDER BY exit_date
                        LIMIT ${partSize} OFFSET ${partNum * partSize};
                    `);

                ++partNum;
                yield part;

                if (part.length != partSize) break;
            }
        })
            .reduce(async (prevStats: CommonStats, chunk: PositionDataForStats[]) => {
                return await this.calcStatistics(prevStats, chunk);
            }, new CommonStats(null, null))
            .then(async (res) => {
                const { statistics, equity } = res;
                await this.db.pg.any(sql`
                    UPDATE robots
                    SET statistics = ${this.db.sql.json(statistics)},
                        equity = ${this.db.sql.json(equity)}
                    WHERE id = ${robotId};
                `);
            });
    }

    async calcRobotByStream(robotId: string) {
        const prevRobotStats: CommonStats = await pg.maybeOne(sql`
            SELECT statistics, equity
            FROM robots
            WHERE id = ${robotId};
        `);

        if (!prevRobotStats) throw new Error("Robot with this id doesn't exists");

        await this.pgJS.stream(
            sql`
                SELECT *
                FROM robot_positions
                WHERE robot_id = ${robotId}
                    AND status = 'closed'
                ORDER BY exit_date;
            `,
            async (stream) => {
                await DataStream.from(stream)
                    .map((datum) => datum.row)
                    .reduce(async (prevStats: CommonStats, pos: PositionDataForStats) => {
                        return await this.calcStatistics(prevStats, [pos]);
                    }, new CommonStats(null, null))
                    .then(async (res) => {
                        const { statistics, equity } = res;
                        await this.db.pg.any(sql`
                            UPDATE robots
                            SET statistics = ${this.db.sql.json(statistics)},
                                equity = ${this.db.sql.json(equity)}
                            WHERE id = ${robotId};
                        `);
                    });
            }
        );
    }
}
