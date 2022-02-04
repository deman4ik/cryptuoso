import { sleep } from "@cryptuoso/helpers";
import { DBCandle, Timeframe } from "@cryptuoso/market";
import { sql } from "@cryptuoso/postgres";
import { Robot, RobotState, RobotStatus } from "@cryptuoso/robot-state";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { spawn, Pool, Worker as ThreadsWorker, Transfer, TransferDescriptor } from "threads";
import { RobotStateBuffer, RobotWorker } from "./worker";
import { Tracer } from "@cryptuoso/logger";

export type UtilsServiceConfig = HTTPServiceConfig;

export default class UtilsService extends HTTPService {
    #pool: Pool<any>;
    #robots: {
        [id: string]: Robot;
    } = {};
    #candles: {
        [asset: string]: {
            [timeframe: number]: DBCandle[];
        };
    } = {};
    constructor(config?: UtilsServiceConfig) {
        super(config);

        try {
            //this.addOnStartHandler(this.onStart);
            //  this.addOnStartedHandler(this.onStarted);
        } catch (err) {
            this.log.error("Error while constructing UtilsService", err);
        }
    }

    async onStart() {
        this.#pool = await Pool(
            async () => await spawn<RobotWorker>(new ThreadsWorker("./worker"), { timeout: 60000 }),
            {
                name: "worker",
                concurrency: 10,
                size: 10
            }
        );
        await sleep(5000);
    }

    async onStarted() {
        const robots = await this.db.pg.many<RobotState>(sql`
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
            WHERE rs.robot_id = r.id AND r.exchange = 'binance_futures' and r.status = 'started';`);

        this.log.info(`Loaded ${robots.length} robots`);

        const markets = await this.db.pg.many<RobotState>(sql`
            SELECT distinct
            r.asset, r.timeframe
            FROM robots r
            WHERE r.exchange = 'binance_futures' and r.status = 'started';`);

        this.log.info(`Loaded ${markets.length} markets`);

        for (const { asset, timeframe } of markets) {
            const requiredCandles = await this.db.pg.many<DBCandle>(sql`
                SELECT time, timestamp, open, high, low, close
                FROM candles
                WHERE exchange = 'binance_futures'
                AND asset = ${asset}
                AND currency = 'USDT'
                AND timeframe = ${timeframe}
                AND timestamp <= ${dayjs
                    .utc(Timeframe.getPrevSince(dayjs.utc().toISOString(), timeframe))
                    .toISOString()}
                ORDER BY timestamp DESC
                LIMIT 300;`);

            if (!this.#candles[asset]) this.#candles[asset] = {};
            const firstCandle = requiredCandles[0];
            const newTime = dayjs.utc().add(1, "day").startOf("day");
            this.#candles[asset][timeframe] = [
                ...requiredCandles,
                { ...firstCandle, time: newTime.valueOf(), timestamp: newTime.toISOString() }
            ].map((c) => ({ ...c, timeframe }));
        }

        this.log.info(`Loaded candles`);

        const tracer = new Tracer();
        const trace = tracer.start("All jobs");
        await Promise.all(
            robots.map(async (robot) => {
                this.#robots[robot.id] = new Robot(robot);

                await this.runRobot(robot.id);
            })
        );
        tracer.end(trace);
        await sleep(1000);
        this.log.warn(tracer.state);
        //   this.#robots[robot.id].buffer = getUnderlyingArrayBuffer(this.#robots[robot.id].robotState);
        //  this.log.info("Robot inited!");
    }

    async runRobot(robotId: string) {
        try {
            this.log.info(`Running robot ${robotId}`);
            this.#robots[robotId].status = RobotStatus.started;
            const { asset, timeframe } = this.#robots[robotId].robotState;

            /*  const oBuf = createObjectBuffer(
                524288,
                {
                    state: this.#robots[robotId].robotState,
                    candles: this.#candles[asset][timeframe]
                }
                /*    {
                    arrayAdditionalAllocation: 0,
                    hashMapLoadFactor: 0.75,
                    hashMapMinInitialCapacity: 8
                },
                "shared" */
            /*);
           
            const buffer = await this.robotWorker(getUnderlyingArrayBuffer(oBuf)); */
            //const { state: robotState, positionsToSave } = loadObjectBuffer<RobotStateBuffer>(buffer);
            const data = {
                state: this.#robots[robotId].robotState,
                candles: this.#candles[asset][timeframe]
            };
            const { state: robotState, positionsToSave } = await this.#pool.queue(async (worker: RobotWorker) =>
                worker.runStrategy(data)
            );
            this.#robots[robotId] = new Robot(robotState);

            this.log.debug(`Main - ${this.#robots[robotId].status} - ${JSON.stringify(positionsToSave)}`);

            this.log.info(`End running robot ${robotId}`);
        } catch (err) {
            this.log.error(`Failed to run robot ${err.message}`);
            this.log.error(err);
            process.exit(1);
        }
    }

    /*async robotWorker(stateABuf: ArrayBuffer): Promise<any> {
        return await this.#pool.queue(async (worker: RobotWorker) => worker.runStrategy(Transfer(stateABuf)));
    }*/
}
