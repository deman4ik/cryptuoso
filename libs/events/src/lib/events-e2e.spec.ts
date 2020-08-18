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

const calculatorSumHandler = jest.fn(async (data) => {
        console.log(data.info);

        const sum = data.numbers.reduce((acc: number, n: number) => acc + n, 0);
        if (sum < 10) throw new Error("Sum cannot be less than 10");
        console.log("Sum of numbers is " + sum);
    }),
    calculatorLogHandler = jest.fn(async (data) => {
        console.log("This event will be logged\n" + "The data object is:\n" + JSON.stringify(data));
    }),
    dataSupplierHandler = jest.fn(async ({ foo, bar }) => {
        console.log("foo is " + foo);
        console.log("bar is " + JSON.stringify(bar));
    }),
    messagerHandler = jest.fn(async ({ message }) => {
        console.log(message);
    });

async function doWork(redis: Redis.Redis) {
    const lightship = createLightship();
    const events = new Events(redis, lightship, { blockTimeout: 20, pendingRetryRate: -1, pendingMinIdleTime: 20 });
    async function emitData() {
        await Promise.all([
            //emit some data
            await events.emit({
                type: "calculator.sum",
                data: {
                    info: "This is a job event",
                    numbers: [1, 2, 3, 4, 5]
                }
            }),
            await events.emit({
                type: "calculator.sum",
                data: {
                    info: "This is another job event",
                    numbers: [5, 6, 7, 8, 9]
                }
            }),
            await events.emit({
                type: "data-supplier.emit",
                data: {
                    foo: "bar",
                    bar: { 1: "one", 2: "two", 3: "three" }
                }
            }),
            await events.emit({
                type: "messager",
                data: { message: "This is a very cool message" }
            }),

            // events with invalid data
            await events.emit({
                type: "calculator.sum",
                data: {
                    info: "This is a faulty job event, error is expected",
                    numbers: [0, 0, 0, 0]
                }
            }),
            await events.emit({
                type: "calculator.sum",
                data: { msg: "This message is not expected" }
            })
        ]);
    }
    // delete data in case there is any
    redis.flushall();

    // simulate handling failure
    await redis.xgroup("CREATE", "cpz:events:calculator", "group-1", "0", "MKSTREAM").then(async () => {
        await events.emit({
            type: "calculator.sum",
            data: {
                info: "This event is supposed to be pending",
                numbers: [3, 4, 5]
            }
        });
        await redis.xread("COUNT", 1, "STREAMS", "cpz:events:calculator", "0");
    });

    // subscribe to events
    events.subscribe({
        "calculator.*": {
            group: "group-1",
            handler: calculatorLogHandler
        },
        "calculator.sum": {
            group: "group-1",
            handler: calculatorSumHandler,
            schema: serviceSchema
        },
        "data-supplier.emit": {
            group: "group-2",
            handler: dataSupplierHandler
        },
        messager: {
            unbalanced: true,
            handler: messagerHandler
        }
    });
    // init
    await events.start();

    emitData();

    await events._receivePendingGroupMessagesTick("cpz:events:calculator", "group-1");
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
                    await doWork(redis);
                    await sleep(5000);
                    expect(calculatorSumHandler).toHaveBeenCalledTimes(5);
                    expect(calculatorLogHandler).toHaveBeenCalledTimes(6);
                    expect(dataSupplierHandler).toHaveBeenCalledTimes(1);
                    expect(messagerHandler).toHaveBeenCalledTimes(1);
                    done();
                });
        }).not.toThrowError();
    });
});
