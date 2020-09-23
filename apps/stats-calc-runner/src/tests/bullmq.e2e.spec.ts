import { sleep } from '@cryptuoso/helpers';
import Redis from "ioredis";
import RedLock from "redlock";
import { Queue, QueueEvents, Worker, Job } from "bullmq";

jest.setTimeout(30e3);

describe("BullMQ failed events handling e2e test", () => {
    const jobDelay = 1e3;
    const jobHandler = jest.fn(async (job: Job) => {
        await sleep(jobDelay);
        throw new Error(`Error while handle "${job.name}"`);
    });
    const failHandler = jest.fn();
    const NAME = "test-bullmq";
    const REDISCS = process.env.REDISCS || "localhost:6379";

    const workers: Worker[] = [];
    const connections: Redis.Redis[] = [];
    const runners: Queue[] = [];

    const queueEventsArray: QueueEvents[] = [];

    for(let i=0; i<2; ++i) {
        workers.push(new Worker(NAME, jobHandler, { connection: new Redis(REDISCS) }));
    }

    for(let i=0; i<3; ++i) {
        connections[i] = new Redis(REDISCS);
        runners[i] = new Queue(NAME, { connection: connections[i] });

        queueEventsArray[i] = new QueueEvents(NAME, {
            connection: connections[i]
        });

        queueEventsArray[i].on("failed", failHandler);
    }

    const getRandomRunner = () => {
        const index = Math.trunc(runners.length * Math.random());
        return runners[index];
    };

    const redlock = new RedLock([new Redis(REDISCS)], {
        driftFactor: 0.01,
        retryCount: 0
    });
    
    describe("Check count of calls `firstFailHandler` when every calls of `jobHandler` throwing error", () => {
        test("`firstFailHandler` must be called 1 time", async () => {
            const testName = "1st";
            const testData = { foo1: "bar1" };
            const attempts = 5;

            jobHandler.mockClear();

            const firstFailHandler = jest.fn();
    
            const queueEvents = new QueueEvents(NAME, {
                connection: new Redis(REDISCS)
            });
        
            queueEvents.on("failed", firstFailHandler);

            await getRandomRunner().add(testName, testData, {
                removeOnComplete: true,
                removeOnFail: 100,
                attempts
            });

            await sleep(1e3 + attempts * jobDelay);
            
            expect(jobHandler).toHaveBeenCalledTimes(attempts);
            expect(firstFailHandler).toHaveBeenCalledTimes(1);
        });
    });
    
    describe("Check count of calls `failedJobHandler` when > 1 `QueueEvents` instances exists", () => {
        test(`Should call \`failedJobHandler\` ${queueEventsArray.length} times`, async () => {
            const testName = "1st";
            const testData = { foo1: "bar1" };
            const attempts = 5;

            const failedJobHandler = jest.fn();

            jobHandler.mockClear();

            failHandler.mockClear();
            failHandler.mockImplementation(async function (info: any) {
                const job = await getRandomRunner().getJob(info.jobId);

                failedJobHandler(job);
            });

            await getRandomRunner().add(testName, testData, {
                removeOnComplete: true,
                removeOnFail: 100,
                attempts
            });

            await sleep(1e3 + attempts * jobDelay);
            
            expect(jobHandler).toHaveBeenCalledTimes(attempts);
            expect(failHandler).toHaveBeenCalledTimes(queueEventsArray.length);
            expect(failedJobHandler).toHaveBeenCalledTimes(queueEventsArray.length);
        });
    });
    
    describe("Check count of calls `failedJobHandler` when using `redlock` and > 1 `QueueEvents` instances exists", () => {
        test("Should call `failedJobHandler` 1 time", async () => {
            const testName = "2nd";
            const testData = { foo2: "bar2" };
            const attempts = 3;

            let lockingErrorsCount = 0;
            const failedJobHandler = jest.fn();

            jobHandler.mockClear();

            failHandler.mockClear();
            failHandler.mockImplementation(async function (info: any) {
                const jobId: string = info.jobId;

                try {
                    const lock = await redlock.lock(`${NAME}:${jobId}`, 5e3);
                    const job = await getRandomRunner().getJob(info.jobId);

                    failedJobHandler(job);

                    await lock.unlock();
                } catch(err) {
                    ++lockingErrorsCount;
                }
            });

            await getRandomRunner().add(testName, testData, {
                removeOnComplete: true,
                removeOnFail: 100,
                attempts
            });

            await sleep(1e3 + attempts * jobDelay);
            
            expect(jobHandler).toHaveBeenCalledTimes(attempts);
            expect(failHandler).toHaveBeenCalledTimes(queueEventsArray.length);
            expect(lockingErrorsCount).toBe(queueEventsArray.length - 1);
            expect(failedJobHandler).toHaveBeenCalledTimes(1);
        });
    });

    describe("Test method unlock of old lock instance when new one lock the same resource", () => {
        test("Should to throw error during unlocking", async () => {
            const lockName = `lock:${Math.random()}`;
            const lockTime = 5e3;
            const lock1 = await redlock.lock(lockName, lockTime);

            await sleep(2 * lockTime);

            const lock2 = await redlock.lock(lockName, lockTime);

            await expect(lock1.unlock()).rejects.toThrow();
            await expect(lock2.unlock()).resolves.not.toThrow();
        });
    });
});
