import { DataStream } from "scramjet";
import os from "os";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { RobotPositionState, PositionDataForStats } from "@cryptuoso/robot-state";
import { round } from "@cryptuoso/helpers";
import { calcStatistics } from "./statsWorker";

export default class Service extends BaseService {
    streamsConnectionsCount: number = 0;
    connectionsCount: number = 0;
    cpus: number;
    pool: Pool<any>;

    constructor(config?: BaseServiceConfig) {
        super(config);
        this.cpus = os.cpus().length;
        //this.addOnStartHandler(this.onStartService);
    }

    async onStartService(): Promise<void> {
        /* this.pool = Pool(() => spawn<StatisticUtils>(new ThreadsWorker("./statsWorker")), {
            concurrency: this.cpus,
            name: "statistic-utils"
        }); */
    }

    async calcStatistics(positions: PositionDataForStats[]) {
        /* return this.pool.queue(async (utils: StatisticUtils) =>
            utils.calcStatistics(positions)
        ); */
        return await calcStatistics(positions);
    }

    async calcRobot(robotId: string) {
        const positions: RobotPositionState[] = await this.db.pg.any(this.db.sql`
                SELECT p.*
                FROM robot_positions p,
                    robots r
                WHERE p.robot_id = r.id
                    AND p.status = 'closed'
                    AND r.id = ${robotId}
                ORDER BY p.exit_date;
        `);
        
        /* AND p.exit_date >= r.updated_at */

        //console.warn(positions);

        const { statistics, equity } = await this.calcStatistics(
            positions.map((pos) => ({
            ...pos,
            profit:
                pos.fee && +pos.fee > 0
                ? +round(pos.profit - pos.profit * pos.fee, 6)
                : pos.profit
            }))
        );

        console.log(statistics, equity);

        await this.db.pg.any(this.db.sql`
            UPDATE robots
            SET statistics = ${this.db.sql.json(statistics)},
                equity = ${this.db.sql.json(equity)}
            WHERE id = ${robotId};
        `);
    }

    async tryGetStream() {
        const id = ++this.streamsConnectionsCount;
        await this.db.pg.stream(
            this.db.sql`SELECT * FROM robots LIMIT 5;`,
            (stream) => {
                //console.log(id, " Start stream");
                let cnt = 0;
                stream.on('data', (datum: {row:any}) => {
                    ++cnt;
                    console.log(datum.row);
                });
                stream.on("end", () => {
                    --this.streamsConnectionsCount;
                    //console.log("End ", cnt);
                });
            }
        ).catch(e => {
            console.log(e);
        });

        //console.log(id, " Await ends");
    }

    async tryGetAll() {
        const id = ++this.connectionsCount;
        console.log(id, " Start all");
        const result = await this.db.pg.any(
            this.db.sql`SELECT * FROM robot_positions LIMIT 5;`
        ).catch(e => {
            console.log(e);
            return [];
        });        
        --this.connectionsCount;

        console.log(id, " All ends");
        console.log(result);

        return result;
    }
}
