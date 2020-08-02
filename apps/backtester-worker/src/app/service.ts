import { DataStream } from "scramjet";
import { Worker, Job } from "bullmq";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { BaseError } from "@cryptuoso/errors";
import { BacktesterState, Backtester } from "@cryptuoso/backtester-state";

export type BacktesterWorkerServiceConfig = BaseServiceConfig;

export default class BacktesterWorkerService extends BaseService {
    abort: { [key: string]: boolean } = {};
    constructor(config?: BacktesterWorkerServiceConfig) {
        super(config);
        try {
            /*  this.events.subscribe({
                [BacktesterWorkerEvents.PAUSE]: {
                    handler: this.pause.bind(this),
                    schema: BacktesterWorkerSchema[BacktesterWorkerEvents.PAUSE],
                    unbalanced: true
                }
            });*/
        } catch (err) {
            this.log.error("Error in BacktesterWorkerService constructor", err);
        }
    }

    /*pause({ id }: BacktesterWorkerPause): void {
        this.abort[id] = true;
    }*/

    async process(job: Job<BacktesterState, BacktesterState>): Promise<BacktesterState> {
        try {
            const backtester = new Backtester(job.data);
            backtester.start();
            this.log.info(`Backtester #${backtester.id} - Starting`);

            backtester.finish(this.abort[backtester.id]);
            if (this.abort[backtester.id]) delete this.abort[backtester.id];
            this.log.info(`Backtester #${backtester.id} is ${backtester.status}!`);
            job.update(backtester.state);
            if (backtester.isFailed) {
                /*await this.events.emit<BacktesterWorkerFailed>({
                    type: BacktesterWorkerEvents.FAILED,
                    data: {
                        id: backtester.id,
                        error: backtester.error
                    }
                }); */
                throw new BaseError(backtester.error, { backtesterId: backtester.id });
            }
            if (backtester.isFinished)
                /* await this.events.emit<BacktesterWorkerFinished>({
                    type: BacktesterWorkerEvents.FINISHED,
                    data: {
                        id: backtester.id
                    }
                });*/
                return backtester.state;
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err);
            throw err;
        }
    }
}
