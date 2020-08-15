import Redis from "ioredis";
import { createLightship } from "lightship";
import { Events } from "./events";
import { sleep } from "@cryptuoso/helpers";
const serviceJobHandler = jest.fn(async (data) => {
        console.log(data.info);
        if (data.numbers) {
            console.log("Sum of numbers is " + data.numbers.reduce((acc: number, n: number) => acc + n, 0));
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
            info: "This job event is supposed to be pending",
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
            handler: commonHandler
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
}
describe("E2E test", () => {
    it("Should execute if connection is established", (done) => {
        const redis = new Redis({ port: 6379, host: "127.0.0.1" })
            .on("end", () => {
                console.log("Connection to redis could not be established, ending test...");
                done();
            })
            .on("ready", async () => {
                await doWork(redis).then(async () => {
                    await sleep(100);
                    expect(serviceJobHandler).toHaveBeenCalledTimes(3);
                    expect(randomHandler).toHaveBeenCalledTimes(1);
                    expect(commonHandler).toHaveBeenCalledTimes(1);
                    done();
                });
            });
    });
});
