import Redis from "ioredis";
import { createLightship } from "lightship";
import { Events } from "./events";
import { sleep } from "@cryptuoso/helpers";
import { ValidationSchema } from "fastest-validator";

jest.setTimeout(15000);
const calcSchema: ValidationSchema = {
    info: "string",
    numbers: { type: "array", items: "number" }
};

describe("E2E test", () => {
    const lightship = createLightship();
    const eventConfig = {
        blockTimeout: 20,
        pendingRetryRate: -1,
        pendingMinIdleTime: 20
    };
    let redis: Redis.Redis;
    describe("Test connection to redis instance", () => {
        it("Should connect and assign a value to redis variable", (done) => {
            redis = new Redis({ port: 6379, host: "127.0.0.1" })
                .on("error", (err) => {
                    console.log("Connection to redis could not be established.\n" + err);
                    done();
                })
                .on("end", () => {
                    console.log("Error connecting to redis instance.");
                    done();
                })
                .on("ready", async () => {
                    await redis.flushall();
                    done();
                });
        });
    });
    describe("Test Events workflow", () => {
        it("Should have redis initialized", () => {
            expect(redis).not.toBe(null);
        });

        const dataSupplierHandler = jest.fn(async ({ foo, bar }) => {
                console.log("foo is " + foo + "\nbar is " + JSON.stringify(bar));
            }),
            messagerHandler = jest.fn(async ({ message }) => {
                console.log(message);
            });
        describe("Single subscriber scenario", () => {
            it("Should subscribe to events and process emitted data", async () => {
                const events = new Events(redis, lightship, eventConfig);

                events.subscribe({
                    "data-supplier.deliver": {
                        group: "data-supply",
                        handler: dataSupplierHandler
                    },
                    messager: {
                        unbalanced: true,
                        handler: messagerHandler
                    }
                });

                await events.start();

                await events.emit({
                    type: "messager",
                    data: { message: "This is a very cool message" }
                });
                await events.emit({
                    type: "data-supplier.deliver",
                    data: {
                        foo: "bar",
                        bar: { 1: "one", 2: "two", 3: "three" }
                    }
                });

                await sleep(1000);

                expect(dataSupplierHandler).toHaveBeenCalledTimes(1);
                expect(messagerHandler).toHaveBeenCalledTimes(1);
            });
        });

        const sumHandler = jest.fn(async ({ info, numbers }) => {
                console.log(info);
                const sum = numbers.reduce((acc: number, n: number) => acc + n, 0);
                console.log("Sum of numbers is " + sum);
            }),
            sumLogHandler = jest.fn(async (data) => {
                console.log("This event will be logged\n" + "The data object is:\n" + JSON.stringify(data));
            });
        describe("Multiple subscribers scenario", () => {
            it("Should subscribe to the same stream and process event for each subscription", async () => {
                const events = new Events(redis, lightship, eventConfig);

                events.subscribe({
                    "calc.sum": {
                        group: "calc-sum",
                        handler: sumHandler,
                        schema: calcSchema
                    },
                    "calc.*": {
                        group: "calc-sum",
                        handler: sumLogHandler
                    }
                });
                await events.start();

                await events.emit({
                    type: "calc.sum",
                    data: {
                        info: "Calculate a sum",
                        numbers: [1, 2, 3, 4, 5]
                    }
                });
                await events.emit({
                    type: "calc.sum",
                    data: {
                        info: "Calculate another sum",
                        numbers: [5, 6, 7, 8, 9]
                    }
                });
                await sleep(1000);

                expect(sumHandler).toHaveBeenCalledTimes(2);
                expect(sumLogHandler).toHaveBeenCalledTimes(2);
            });
        });

        const multiplyHandler = jest.fn(async ({ info, numbers }) => {
                console.log(info);
                const res = numbers.reduce((acc: number, n: number) => acc * n, 1);
                console.log("Result of multiplication is " + res);
            }),
            multiplyLogHandler = jest.fn(async (data) => {
                console.log("This event will be logged\n" + "The data object is:\n" + JSON.stringify(data));
            });
        describe("Simple handling of pending event scenario", () => {
            it("Should create pending event and process it through subscribers", async () => {
                const events = new Events(redis, lightship, eventConfig);

                await redis.xgroup("CREATE", "cpz:events:calc.multiply", "calc-multiply", "0", "MKSTREAM");

                await events.emit({
                    type: "calc.multiply",
                    data: {
                        info: "This event is supposed to be pending",
                        numbers: [1, 2, 3]
                    }
                });
                await redis.xread("COUNT", 1, "STREAMS", "cpz:events:calc.multiply", "0");

                await sleep(100);

                events.subscribe({
                    "calc.multiply": {
                        group: "calc-multiply",
                        handler: multiplyHandler
                    },
                    "calc.*": {
                        group: "calc-multiply",
                        handler: multiplyLogHandler
                    }
                });
                await events.start();

                await sleep(1000);

                expect(multiplyHandler).toHaveBeenCalledTimes(1);
                expect(multiplyLogHandler).toHaveBeenCalledTimes(1);
            });
        });

        const divideHandler = jest.fn(async ({ info, numbers }) => {
                console.log(info);
                const res = numbers.reduce((acc: number, n: number) => acc / n, 1);
                if (res == Infinity) throw new Error("Invalid operation");
                console.log("Result of division is " + res);
            }),
            divideLogHandler = jest.fn(async (data) => {
                console.log("This event will be logged\n" + "The data object is:\n" + JSON.stringify(data));
            });
        describe("Handling pending event with errors in one of the subs", () => {
            it("Should never call the second handler", async () => {
                const events = new Events(redis, lightship, eventConfig);

                events.subscribe({
                    "calc.divide": {
                        group: "calc-divide",
                        handler: divideHandler,
                        schema: calcSchema
                    },
                    "calc.*": {
                        group: "calc-divide",
                        handler: divideLogHandler
                    }
                });
                await events.start();

                // the handler throws error if sum of numbers is < 10
                await events.emit({
                    type: "calc.divide",
                    data: {
                        info: "This is a faulty event, error is expected",
                        numbers: [0, 0, 0, 0]
                    }
                });
                // the data doesn't pass validation for the first subscriber
                await events.emit({
                    type: "calc.divide",
                    data: { msg: "This message is not expected" }
                });
                await sleep(1000);

                expect(divideHandler).toHaveBeenCalledTimes(1);
                expect(divideLogHandler).toHaveBeenCalledTimes(0);

                await events._receivePendingGroupMessagesTick("calc.divide", "calc-divide");

                await sleep(1000);
            });
        });
    });
});
