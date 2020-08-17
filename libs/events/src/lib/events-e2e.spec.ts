import Redis from "ioredis";
import { createLightship } from "lightship";
import { Events } from "./events";
import { sleep } from "@cryptuoso/helpers";
import { ValidationSchema } from "fastest-validator";

const commonSchema: ValidationSchema = {
    message: "string"
};

const serviceJobHandler = jest.fn(async (data) => {
        console.log(data.info);
        try {
            console.log("Sum of numbers is " + data.numbers.reduce((acc: number, n: number) => acc + n, 0));
        } catch (err) {
            console.log(err);
        }
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
    const events = new Events(redis, lightship);
    // delete data in case there is any
    redis.flushall();

    // simulate handling failure
    await redis.xgroup("CREATE", "cpz:events:service-job", "group-1", "0", "MKSTREAM");
    await events.emit({
        type: "service-job",
        data: {
            info: "This event is supposed to be pending",
            numbers: [1, 2, 3]
        }
    });
    await redis.xread("COUNT", 1, "STREAMS", "cpz:events:service-job", "0");
    await sleep(500);

    // subscribe to events
    events.subscribe({
        "service-job": {
            group: "group-1",
            handler: serviceJobHandler
        },
        random: {
            group: "group-2",
            handler: randomHandler
        },
        common: {
            unbalanced: true,
            handler: commonHandler,
            schema: commonSchema
        }
    });

    // init
    await events.start();

    //emit some data
    await events.emit({
        type: "service-job",
        data: {
            info: "This is a job event",
            numbers: [1, 2, 3, 4, 5]
        }
    });
    await events.emit({
        type: "service-job",
        data: {
            info: "This is another job event",
            numbers: [5, 6, 7, 8, 9]
        }
    });
    await events.emit({
        type: "random",
        data: {
            foo: "bar",
            bar: { 1: "one", 2: "two", 3: "three" }
        }
    });
    await events.emit({
        type: "common",
        data: { message: "This is a very cool notification" }
    });

    // events with invalid data
    await events.emit({
        type: "service-job",
        data: {
            info: "This is a faulty job event, error is expected",
            foo: {}
        }
    });
    await events.emit({
        type: "common",
        data: { msg: "This notification will not be seen due to validation error :(" }
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
                        await sleep(100);
                        expect(serviceJobHandler).toHaveBeenCalledTimes(4);
                        expect(randomHandler).toHaveBeenCalledTimes(1);
                        expect(commonHandler).toHaveBeenCalledTimes(1);
                        done();
                    });
                });
        }).not.toThrowError();
    });
});
