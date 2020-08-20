import Redis from "ioredis";
import { createLightship } from "lightship";
import { Events } from "./events";
import { sleep } from "@cryptuoso/helpers";
import { ValidationSchema } from "fastest-validator";

jest.setTimeout(20000);
const itif = (name: string, condition: () => boolean, cb: Function) => {
    it(name, (done) => {
        if (condition()) {
            cb(done);
        } else {
            console.warn(`[skipped]: ${name}`);
            done();
        }
    });
};
const calcSchema: ValidationSchema = {
    info: "string",
    numbers: { type: "array", items: "number" }
};

describe("E2E test", () => {
    const lightship = createLightship();
    const eventConfig = {
        blockTimeout: 50,
        pendingMinIdleTime: 50,
        pendingRetryRate: 5,
        pendingMaxRetries: 1
    };
    let redis: Redis.Redis;
    describe("Test connection to redis instance", () => {
        it("Should connect and assign a value to redis variable", (done) => {
            redis = new Redis({ port: 6379, host: "127.0.0.1" })
                .on("error", (err) => {
                    console.warn("Connection to redis could not be established.\n" + err);
                    redis.quit();
                    redis = null;
                    done();
                })
                .on("end", () => {
                    console.warn("Error connecting to redis instance.");
                    redis.quit();
                    redis = null;
                    done();
                })
                .on("ready", async () => {
                    done();
                });
        });
    });
    describe("Test Events workflow", () => {
        itif(
            "Should have redis initialized",
            () => redis != null,
            (done: Function) => {
                console.log("Redis is online");
                done();
            }
        );

        const deliverHandler = jest.fn(async ({ foo, bar }) => {
                console.log("foo is " + foo + "\nbar is " + JSON.stringify(bar));
            }),
            messageHandler = jest.fn(async ({ message }) => {
                console.log(message);
            });
        describe("Single subscriber scenario", () => {
            itif(
                "Should subscribe to events and process emitted data",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventConfig);

                    events.subscribe({
                        messager: {
                            unbalanced: true,
                            handler: messageHandler
                        },
                        "data-supplier.deliver": {
                            group: "data-supply",
                            handler: deliverHandler
                        }
                    });

                    await events.start();

                    // wait for events to set all neccesary valiables e.g. last unbalanced id
                    await sleep(200);

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

                    await sleep(200);

                    expect(messageHandler).toHaveBeenCalledTimes(1);
                    expect(deliverHandler).toHaveBeenCalledTimes(1);
                    done();
                }
            );
        });

        const sumHandler = jest.fn(async ({ info, numbers }) => {
                const sum = numbers.reduce((acc: number, n: number) => acc + n, 0);
                console.log(info + "\nSum of numbers is " + sum);
            }),
            sumLogHandler = jest.fn(async (data) => {
                console.log("This event will be logged\n" + "The data object is:\n" + JSON.stringify(data));
            });
        describe("Multiple subscribers scenario", () => {
            itif(
                "Should subscribe to the same stream and process event for each subscription",
                () => redis != null,
                async (done: Function) => {
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

                    await sleep(200);

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
                    await sleep(200);

                    expect(sumHandler).toHaveBeenCalledTimes(2);
                    expect(sumLogHandler).toHaveBeenCalledTimes(2);
                    done();
                }
            );
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
            itif(
                "Should never call the second handler and emit a dead-letter event",
                () => redis != null,
                async (done: Function) => {
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

                    await sleep(200);

                    // error is thrown in the first handler since the result < 10
                    await events.emit({
                        type: "calc.divide",
                        data: {
                            info: "This is a faulty event, error is expected",
                            numbers: [0, 0, 0, 0]
                        }
                    });
                    // the data won't pass validation for the first subscriber
                    await events.emit({
                        type: "calc.divide",
                        data: { msg: "This message is not expected" }
                    });
                    await sleep(200);
                    const deadLetter = await redis.xread("COUNT", 1, "STREAMS", "cpz:events:dead-letter", 0);
                    await sleep(200);

                    expect(deadLetter == null || deadLetter == []).not.toBeTruthy();
                    expect(divideHandler).toHaveBeenCalledTimes(1);
                    expect(divideLogHandler).toHaveBeenCalledTimes(0);
                    done();
                }
            );
        });

        const logHandler = jest.fn(async ({ info }) => {
                console.log(info);
            }),
            unbalancedLogHandler = jest.fn(async (data) => {
                console.log("The data object is:\n" + JSON.stringify(data));
            });
        describe("Subscribing after event is emitted scenario", () => {
            itif(
                "Should subscribe and handle the event",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventConfig);

                    await events.emit({
                        type: "grouplog",
                        data: {
                            info: "This event is supposed to be processed"
                        }
                    });
                    await events.emit({
                        type: "unbalancedlog",
                        data: {
                            info: "This event is supposed to be processed as well"
                        }
                    });

                    events.subscribe({
                        unbalancedlog: {
                            unbalanced: true,
                            handler: unbalancedLogHandler
                        },
                        grouplog: {
                            group: "log",
                            handler: logHandler
                        }
                    });
                    await events.start();

                    await sleep(200);

                    expect(logHandler).toHaveBeenCalledTimes(1);
                    expect(unbalancedLogHandler).toHaveBeenCalledTimes(1);
                    done();
                }
            );
        });
    });
});
