import Redis from "ioredis";
import { createLightship } from "lightship";
import { Events } from "./events";
import { sleep } from "@cryptuoso/helpers";
import { ValidationSchema } from "fastest-validator";

jest.setTimeout(15000);
const serviceSchema: ValidationSchema = {
    info: "string",
    numbers: { type: "array", items: "number" }
};

const firstServiceJobHandler = jest.fn(async (data) => {
        console.log(data.info);

        const sum = data.numbers.reduce((acc: number, n: number) => acc + n, 0);
        if (sum < 10) throw new Error("Sum cannot be less than 10");
        console.log("Sum of numbers is " + sum);
    }),
    secondServiceJobHandler = jest.fn(async (data) => {
        console.log("This event will be logged\n" + "The data object is:\n" + JSON.stringify(data));
    }),
    randomHandler = jest.fn(async ({ foo, bar }) => {
        console.log("foo is " + foo);
        console.log("bar is " + JSON.stringify(bar));
    }),
    commonHandler = jest.fn(async ({ message }) => {
        console.log(message);
    });

async function doWork(redis: Redis.Redis) {
    const lightship = createLightship();
    const events = new Events(redis, lightship, { blockTimeout: 20, pendingRetryRate: -1, pendingMinIdleTime: 20 });
    // delete data in case there is any
    redis.flushall();

    // simulate handling failure
    await redis.xgroup("CREATE", "cpz:events:service-job", "group-1", "0", "MKSTREAM").then(async () => {
        await events.emit({
            type: "service-job.work",
            data: {
                info: "This event is supposed to be pending",
                numbers: [3, 4, 5]
            }
        });
        await redis.xread("COUNT", 1, "STREAMS", "cpz:events:service-job", "0");
    });

    // subscribe to events
    events.subscribe({
        "service-job.*": {
            group: "group-1",
            handler: secondServiceJobHandler
        },
        "service-job.work": {
            group: "group-1",
            handler: firstServiceJobHandler,
            schema: serviceSchema
        },
        random: {
            group: "group-2",
            handler: randomHandler
        },
        common: {
            unbalanced: true,
            handler: commonHandler
        }
    });
    // init
    await events.start();

    Promise.all([
        //emit some data
        await events.emit({
            type: "service-job.work",
            data: {
                info: "This is a job event",
                numbers: [1, 2, 3, 4, 5]
            }
        }),
        await events.emit({
            type: "service-job.work",
            data: {
                info: "This is another job event",
                numbers: [5, 6, 7, 8, 9]
            }
        }),
        await events.emit({
            type: "random",
            data: {
                foo: "bar",
                bar: { 1: "one", 2: "two", 3: "three" }
            }
        }),
        await events.emit({
            type: "common",
            data: { message: "This is a very cool notification" }
        }),

        // events with invalid data
        await events.emit({
            type: "service-job.work",
            data: {
                info: "This is a faulty job event, error is expected",
                numbers: [0, 0, 0, 0]
            }
        }),
        await events.emit({
            type: "service-job.work",
            data: { msg: "This message is not expected" }
        })
    ]).then(async () => {
        await events._receivePendingGroupMessagesTick("cpz:events:service-job", "group-1");
    });
}
describe("E2E test", () => {
    it("Should execute if connection is established", (done) => {
        expect(() => {
            const redis = new Redis({ port: 6379, host: "127.0.0.1" })
                .on("error", (err) => {
                    console.log("Connection to redis could not be established.\n" + err);
                    done();
                })
                .on("end", () => {
                    console.log("Error connecting to redis instance.");
                    done();
                })
                .on("ready", async () => {
                    await doWork(redis).then(async () => {
                        await sleep(10000);
                        expect(firstServiceJobHandler).toHaveBeenCalledTimes(5);
                        expect(secondServiceJobHandler).toHaveBeenCalledTimes(6);
                        expect(randomHandler).toHaveBeenCalledTimes(1);
                        expect(commonHandler).toHaveBeenCalledTimes(1);
                        done();
                    });
                });
        }).not.toThrowError();
    });
});
