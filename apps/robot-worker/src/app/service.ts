import { Job } from "bullmq";
import { spawn, Pool, Worker as ThreadsWorker } from "threads";
import { Queues } from "@cryptuoso/robot-state";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";

import { RobotWorker } from "./worker";

export type RobotWorkerServiceConfig = BaseServiceConfig;

export default class RobotWorkerService extends BaseService {
    private pool: Pool<any>;

    constructor(config?: RobotWorkerServiceConfig) {
        super(config);
        try {
            this.addOnStartHandler(this.onServiceStart);
            this.addOnStopHandler(this.onServiceStop);
            //TODO: Reload code event
        } catch (err) {
            this.log.error("Error while constructing RobotWorkerService", err);
        }
    }

    async onServiceStart(): Promise<void> {
        this.log.debug("Creating pool");
        this.pool = Pool(() => spawn<RobotWorker>(new ThreadsWorker("./worker")), {
            name: "worker",
            concurrency: this.workerConcurrency
        });

        this.log.debug(`Creating queue ${Queues.robot}`);
        this.createQueue(Queues.alerts);
        this.log.debug(`Creating worker ${Queues.robot}`);
        this.createWorker(Queues.robot, this.processRobot);
    }

    async onServiceStop(): Promise<void> {
        await this.pool.terminate();
    }

    async processRobot(job: Job) {
        this.log.debug(`Processing job ${job.name} #${job.id}`);
        switch (job.name) {
            case "job":
                await this.robotJob(job);
                break;
            case "checkAlerts": //TODO: deprecate
                break;
            default:
                this.log.error(`Unknow job ${job.name}`);
                this.log.error(job);
                break;
        }
        this.log.debug(`Finished processing ${job.name} #${job.id}`);
        return { result: "ok" };
    }

    async robotWorker(robotId: string) {
        return await this.pool.queue(async (worker: RobotWorker) => worker.process(robotId));
    }

    async robotJob(job: Job) {
        const beacon = this.lightship.createBeacon();
        try {
            await this.robotWorker(job.id);
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err);
            throw err;
        } finally {
            await beacon.die();
        }
    }
}
