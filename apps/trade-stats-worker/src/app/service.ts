import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { Job } from "bullmq";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import { StatsWorker } from "./worker";
import { TradeStatsWorkerErrorEvent, TradeStatsWorkerEvents } from "@cryptuoso/trade-stats-events";
import { TradeStatsJob } from "@cryptuoso/trade-stats";
import dayjs from "@cryptuoso/dayjs";

export type StatisticCalcWorkerServiceConfig = BaseServiceConfig;

export default class StatisticCalcWorkerService extends BaseService {
    private pool: Pool<any>;

    constructor(config?: StatisticCalcWorkerServiceConfig) {
        super(config);

        try {
            this.addOnStartHandler(this.onServiceStart);
            this.addOnStopHandler(this.onServiceStop);
        } catch (err) {
            this.log.error("Error in StatisticCalcWorkerService constructor", err);
        }
    }

    private async onServiceStart(): Promise<void> {
        this.pool = Pool(() => spawn<StatsWorker>(new ThreadsWorker("./worker")), {
            name: "stats-calc-worker",
            concurrency: +this.workerConcurrency
        });
        this.createWorker("stats-calc", this.process);
    }

    private async onServiceStop(): Promise<void> {
        await this.pool.terminate();
    }

    async process(job: Job<TradeStatsJob>) {
        try {
            this.log.info(`Starting job ${job.id}`);

            await this.pool.queue(async (worker: StatsWorker) => worker.process(job.data));

            this.log.info(`Job ${job.id} finished`);
            return { result: "ok" };
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err);
            this.log.debug(job.data);
            await this.events.emit<TradeStatsWorkerErrorEvent>({
                type: TradeStatsWorkerEvents.ERROR,
                data: {
                    job: job.data,
                    timestamp: dayjs.utc().toISOString(),
                    error: err.message
                }
            });
            throw err;
        }
    }
}
