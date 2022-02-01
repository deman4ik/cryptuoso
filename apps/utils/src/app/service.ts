import {
    createObjectBuffer,
    getUnderlyingArrayBuffer,
    loadObjectBuffer,
    unstable_replaceUnderlyingArrayBuffer
} from "@bnaya/objectbuffer";
import { sleep } from "@cryptuoso/helpers";
import { sql } from "@cryptuoso/postgres";
import { Robot, RobotState, RobotStatus } from "@cryptuoso/robot-state";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { spawn, Pool, Worker as ThreadsWorker, Transfer, TransferDescriptor } from "threads";
import { RobotWorker } from "./worker";

export type UtilsServiceConfig = HTTPServiceConfig;

export interface RobotStateBuffer {
    robotState: {
        state: RobotState;
        candles?: {
            time: number;
            timestamp: string;
            open: number;
            high: number;
            low: number;
            close: number;
        }[];
        positionsToSave?: any[];
        eventsToSend?: any[];
    };
    buffer?: ArrayBuffer;
    locked: boolean;
}

export default class UtilsService extends HTTPService {
    #pool: Pool<any>;
    #robots: {
        [id: string]: Robot;
    } = {};
    constructor(config?: UtilsServiceConfig) {
        super(config);

        try {
            this.addOnStartedHandler(this.onStarted);
        } catch (err) {
            this.log.error("Error while constructing UtilsService", err);
        }
    }

    async onStarted() {
        this.#pool = Pool(() => spawn<RobotWorker>(new ThreadsWorker("./worker")), {
            name: "worker",
            concurrency: 1
        });
        await sleep(2000);
        const response = await this.db.pg.one<RobotState>(sql`
        SELECT r.id, 
               r.exchange, 
               r.asset, 
               r.currency, 
               r.timeframe, 
               r.strategy, 
               json_build_object('strategySettings', rs.strategy_settings,
                                 'robotSettings', rs.robot_settings,
                                 'activeFrom', rs.active_from) as settings,
               r.last_candle, 
               r.state, 
               r.has_alerts, 
               r.status,
               r.started_at, 
               r.stopped_at
        FROM robots r, v_robot_settings rs 
        WHERE rs.robot_id = r.id AND id = '270983c2-0e96-45ba-9234-a97296a3e95b';`);

        const robot = { ...response };
        this.#robots[robot.id] = new Robot(robot);
        //   this.#robots[robot.id].buffer = getUnderlyingArrayBuffer(this.#robots[robot.id].robotState);
        this.log.info("Robot inited!");

        await this.runRobot(robot.id);
        await sleep(1000);
        await this.runRobot(robot.id);
        await sleep(1000);
        await this.runRobot(robot.id);
    }

    async runRobot(robotId: string) {
        try {
            this.log.info("Running robot");
            this.#robots[robotId].status = RobotStatus.started;
            const oBuf = createObjectBuffer<RobotStateBuffer["robotState"]>(1048576, {
                state: this.#robots[robotId].robotState,
                candles: [],
                positionsToSave: []
            });
            const buffer = await this.robotWorker(getUnderlyingArrayBuffer(oBuf));
            const { state: robotState, positionsToSave } = loadObjectBuffer<RobotStateBuffer["robotState"]>(buffer);
            this.#robots[robotId] = new Robot(robotState);

            this.log.debug(`Main - ${this.#robots[robotId].status} - ${JSON.stringify(positionsToSave)}`);

            this.log.info("End running robot");
        } catch (err) {
            this.log.error(`Failed to run robot ${err.message}`);
            this.log.error(err);
            process.exit(1);
        }
    }

    async robotWorker(stateABuf: ArrayBuffer): Promise<any> {
        const result = await this.#pool.queue(async (worker: RobotWorker) => worker.runStrategy(Transfer(stateABuf)));
        return result;
    }
}
