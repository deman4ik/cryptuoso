import Redis from "ioredis";
import { createLightship } from "lightship";
import { Events, NewEvent } from "./events";
import { CloudEvent as Event } from "cloudevents";
import { ValidationSchema } from "fastest-validator";
import { isArray } from "util";
import { sleep } from "@cryptuoso/helpers";

const serviceJobHandler = jest.fn(async (data) => {
        console.log(data.info);
        if (data.numbers && isArray(data.numbers)) {
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

describe("E2E test", () => {
    class SimpleService {
        #redisClient = new Redis({ port: 6379, host: "127.0.0.1" });
        #lightship = createLightship();
        #events = new Events(this.#redisClient, this.#lightship);
        async doWork() {
            if ((await this.#redisClient.ping()) != "PONG")
                throw new Error("Connection is not established, ending test...");
            // delete data in case there is any
            this.#redisClient.flushall();

            // simulate handling failure
            await this.#redisClient.xgroup("CREATE", "cpz:events:service-job", "group-1", "0", "MKSTREAM");
            this.#events.emit({
                type: "service-job",
                data: {
                    info: "This is supposed to be pending",
                    numbers: [1, 2, 3]
                }
            });
            await this.#redisClient.xread("COUNT", 1, "STREAMS", "cpz:events:service-job", "0");
            await sleep(500);

            // subscribe to events
            this.#events.subscribe({
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
            await this.#events.start();

            //emit some data
            await this.#events.emit({
                type: "service-job",
                data: {
                    info: "This is a job event",
                    numbers: [1, 2, 3, 4, 5]
                }
            });
            await this.#events.emit({
                type: "service-job",
                data: {
                    info: "This is another job event",
                    numbers: [5, 6, 7, 8, 9]
                }
            });
            await this.#events.emit({
                type: "random",
                data: {
                    foo: "bar",
                    bar: { 1: "one", 2: "two", 3: "three" }
                }
            });
            await this.#events.emit({
                type: "common",
                data: { message: "This is a very cool notification" }
            });
        }
    }
    it("Should execute without errors", async () => {
        await new SimpleService().doWork();
        await sleep(1000);
    });
    describe("Checking mocked functions", () => {
        it("Should have called handlers number of times specified", () => {
            expect(serviceJobHandler).toHaveBeenCalledTimes(3);
            expect(randomHandler).toHaveBeenCalledTimes(1);
            expect(commonHandler).toHaveBeenCalledTimes(1);
        });
    });
});
