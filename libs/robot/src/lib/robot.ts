import { round, sleep, sortAsc } from "@cryptuoso/helpers";
import { Candle, DBCandle, ValidTimeframe } from "@cryptuoso/market";
import { sql } from "@cryptuoso/postgres";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { spawn, Pool, Worker as ThreadsWorker, Transfer, TransferDescriptor } from "threads";
import { RobotWorker } from "./worker";
import { RobotState } from "@cryptuoso/robot-state";
import logger, { Tracer } from "@cryptuoso/logger";
import { createObjectBuffer, getUnderlyingArrayBuffer, loadObjectBuffer } from "@bnaya/objectbuffer";
import sizeof from "object-sizeof";

export interface RobotBaseServiceConfig extends HTTPServiceConfig {
    exchange: string;
}

export class RobotBaseService extends HTTPService {
    #exchange: string;
    #pool: Pool<any>;
    constructor(config: RobotBaseServiceConfig) {
        super(config);
        this.#exchange = config.exchange;

        this.addOnStartHandler(this.onServiceStart);
        this.addOnStartedHandler(this.onServiceStarted);
        this.addOnStopHandler(this.onServiceStop);
    }

    async onServiceStart() {
        this.#pool = Pool(() => spawn<RobotWorker>(new ThreadsWorker("./worker")), {
            name: "worker",
            concurrency: 10 || this.workerConcurrency
        });
        await sleep(5000);
    }

    async onServiceStarted() {
        try {
            const robotState = await this.#getRobotState("df0f7f1a-5408-46f1-907d-fe493ced899d");
            const candles = await this.#loadHistoryCandles(
                robotState.exchange,
                robotState.asset,
                robotState.currency,
                robotState.timeframe,
                300
            );

            const data = { state: robotState, candles };
            const dataSize = sizeof(data) * 8;
            this.log.debug(dataSize);

            const dataOBuff = createObjectBuffer(dataSize, data);

            let dataABuff: ArrayBuffer = getUnderlyingArrayBuffer(dataOBuff);

            const tracer = new Tracer();

            const runJobTransfer = tracer.start("Transfer");

            dataABuff = await this.robotWorker(dataABuff);

            const newStateTransfer = loadObjectBuffer(dataABuff);
            this.log.warn(newStateTransfer.state.status);
            newStateTransfer.state.status = "new one";

            dataABuff = await this.robotWorker(dataABuff);

            const newStateTransferNew = loadObjectBuffer(dataABuff);
            this.log.warn(newStateTransferNew.state.status);

            tracer.end(runJobTransfer);

            this.log.info(tracer.state);
        } catch (err) {
            this.log.error("Main thread error");
            this.log.error(err);
        }
    }

    async onServiceStop() {
        await this.#pool.terminate();
    }

    #getRobotState = async (robotId: string): Promise<RobotState> => {
        try {
            return await this.db.pg.one<RobotState>(sql`
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
            WHERE rs.robot_id = r.id AND id = ${robotId};`);
        } catch (err) {
            this.log.error("Failed to load robot state", err);
            throw err;
        }
    };

    #loadHistoryCandles = async (
        exchange: string,
        asset: string,
        currency: string,
        timeframe: ValidTimeframe,
        limit: number
    ): Promise<Candle[]> => {
        try {
            const requiredCandles = await this.db.pg.many<DBCandle>(sql`
        SELECT time, timestamp, open, high, low, close
        FROM candles
        WHERE exchange = ${exchange}
          AND asset = ${asset}
          AND currency = ${currency}
          AND timeframe = ${timeframe}
        ORDER BY timestamp DESC
        LIMIT ${limit};`);
            return [...requiredCandles]
                .sort((a, b) => sortAsc(a.time, b.time))
                .slice(-limit)
                .map((candle: DBCandle) => ({ ...candle, id: candle.id }));
        } catch (err) {
            this.log.error("Failed to load history candles", err);
            throw err;
        }
    };

    async robotWorker(stateABuf: ArrayBuffer): Promise<any> {
        return await this.#pool.queue(async (worker: RobotWorker) => worker.process(Transfer(stateABuf)));
    }
}
