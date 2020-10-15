import { Worker, Job } from "bullmq";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";

export type RobotWorkerServiceConfig = BaseServiceConfig;

export default class RobotWorkerService extends BaseService {
    workers: { [key: string]: Worker };
    constructor(config?: RobotWorkerServiceConfig) {
        super(config);
        try {
            this.addOnStartHandler(this.onServiceStart);
            this.addOnStopHandler(this.onServiceStop);
        } catch (err) {
            this.log.error(err, "While consctructing RobotWorkerService");
        }
    }

    async onServiceStart(): Promise<void> {
        this.workers = {
            robot: new Worker("robot", async (job: Job) => this.process(job), {
                connection: this.redis
            })
        };
    }

    async onServiceStop(): Promise<void> {
        await this.workers.robot?.close();
    }

    async process(job: Job) {
        const beacon = this.lightship.createBeacon();
        try {
            await beacon.die();
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err);
            throw err;
        }
    }
}
