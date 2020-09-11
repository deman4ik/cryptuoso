import "jest-extended";
import Redis from "ioredis";
import { createLightship } from "lightship";
import { Events, EventsConfig } from "./events";
import { sleep } from "@cryptuoso/helpers";
import { ValidationSchema } from "fastest-validator";
import { BASE_REDIS_PREFIX } from "./catalog";

//TODO: one service for all tests
const SERVICES = {
    deadLetter: "test-dead-letter",
    calc: "test-calc",
    faultyGroupLog: "test-faulty-group-log",
    faultyGroupLog2: "test-faulty-group-log2",
    unbalancedLog: "test-unbalanced-log",
    groupLog: "test-group-log",
    messager: "test-messager",
    groupMessager: "test-group-messager"
};
jest.mock("tslog");
jest.setTimeout(40000);
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
    const eventsConfig: EventsConfig = {
        deadLetterTopic: SERVICES.deadLetter,
        blockTimeout: 50,
        pendingMinIdleTime: 50,
        pendingRetryRate: -1,
        pendingMaxRetries: 1 // emit a dead-letter on firts pending handling failure
    };
    let redis: Redis.Redis;

    describe("Test Events workflow", () => {
        beforeAll((done) => {
            redis = new Redis({ port: 6379, host: "127.0.0.1" })
                .on("error", (err) => {
                    console.warn("Connection to redis could not be established.\n" + err);
                    redis?.quit();
                    redis = null;
                    done();
                })
                .on("end", () => {
                    console.warn("Error connecting to redis instance.");
                    redis?.quit();
                    redis = null;
                    done();
                })
                .on("ready", async () => {
                    for (const service of Object.values(SERVICES)) {
                        await redis.del(`${BASE_REDIS_PREFIX}:${service}`);
                    }

                    done();
                });
        });

        const findDeadLetter = async (type: string) => {
            const arr = await redis.xread("COUNT", 100, "STREAMS", `${BASE_REDIS_PREFIX}:${SERVICES.deadLetter}`, "0");
            if (arr != [] && arr != null)
                return arr[0][1].filter((item) => {
                    const eventType = JSON.parse(item[1][7]).type;
                    return (
                        eventType ===
                        `${BASE_REDIS_PREFIX}:${SERVICES.deadLetter}.` +
                            type.split(".").slice(-type.split(".").length).join(".")
                    );
                });
            return [];
        };

        const unbalancedMessageHandler = jest.fn(async ({ message }) => {
            //console.log(message);
        });
        describe("Single unbalanced subscriber scenario", () => {
            itif(
                "Should subscribe to event and process emitted data",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    events.subscribe({
                        [SERVICES.messager]: {
                            unbalanced: true,
                            handler: unbalancedMessageHandler
                        }
                    });

                    await events.start();
                    // wait for events to set all neccesary valiables e.g. last unbalanced id
                    await sleep(3000);

                    await events.emit({
                        type: SERVICES.messager,
                        data: { message: "This is a very cool message" }
                    });
                    await sleep(3000);

                    expect(unbalancedMessageHandler).toHaveBeenCalledTimes(1);
                    done();
                }
            );
        });

        const groupMessageHandler = jest.fn(async ({ foo, bar }) => {
            //console.log("foo is " + foo + "\nbar is " + JSON.stringify(bar));
        });
        describe("Single group subscriber scenario", () => {
            itif(
                "Should subscribe to event and process emitted data",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    events.subscribe({
                        [SERVICES.groupMessager]: {
                            group: "test-data-supply",
                            handler: groupMessageHandler
                        }
                    });

                    await events.start();

                    await sleep(3000);

                    await events.emit({
                        type: SERVICES.groupMessager,
                        data: {
                            foo: "bar",
                            bar: { 1: "one", 2: "two", 3: "three" }
                        }
                    });
                    await sleep(3000);

                    expect(groupMessageHandler).toHaveBeenCalledTimes(1);

                    done();
                }
            );
        });

        const unbalancedLogHandler = jest.fn(async (data) => {
            //console.log("The data object is:\n" + JSON.stringify(data));
        });
        describe("Subscribing after unbalanced event is emitted scenario", () => {
            itif(
                "Should subscribe and handle the event",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    await events.emit({
                        type: SERVICES.unbalancedLog,
                        data: {
                            info: "This event is not to be processed"
                        }
                    });

                    events.subscribe({
                        [SERVICES.unbalancedLog]: {
                            unbalanced: true,
                            handler: unbalancedLogHandler
                        }
                    });
                    await events.start();
                    await sleep(3000);

                    expect(unbalancedLogHandler).not.toHaveBeenCalled();
                    done();
                }
            );
        });

        const groupLogHandler = jest.fn(async ({ info }) => {
            //console.log(info);
        });
        describe("Subscribing after event is emitted scenario", () => {
            itif(
                "Should subscribe and handle the event",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    await events.emit({
                        type: SERVICES.groupLog,
                        data: {
                            info: "This event is supposed to be processed"
                        }
                    });
                    await sleep(5000);

                    events.subscribe({
                        [SERVICES.groupLog]: {
                            group: SERVICES.groupLog,
                            handler: groupLogHandler
                        }
                    });
                    await events.start();
                    await sleep(5000);

                    expect(groupLogHandler).toHaveBeenCalledTimes(1);

                    done();
                }
            );
        });

        const faultyHandler = jest.fn((data) => {
            throw new Error("Cannot process the data:\n" + data);
        });
        describe("Error in a group event handler scenario", () => {
            itif(
                "Should call the handler two times",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    events.subscribe({
                        [SERVICES.faultyGroupLog]: {
                            group: "test-error-group",
                            handler: faultyHandler
                        }
                    });
                    await events.start();
                    await sleep(3000);

                    await events.emit({
                        type: SERVICES.faultyGroupLog,
                        data: {
                            foo: "bar"
                        }
                    });
                    await sleep(3000);

                    expect(faultyHandler).toHaveBeenCalledTimes(2);

                    done();
                }
            );
        });

        describe("Error in a group event handler scenario", () => {
            itif(
                "Should emit a dead-letter",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    events.subscribe({
                        [SERVICES.faultyGroupLog2]: {
                            group: "test-error-group-2",
                            handler: faultyHandler
                        }
                    });
                    await events.start();
                    await sleep(3000);

                    await events.emit({
                        type: SERVICES.faultyGroupLog2,
                        data: {
                            foo: "bar"
                        }
                    });
                    await sleep(3000);

                    await events._receivePendingGroupMessagesTick(
                        `${BASE_REDIS_PREFIX}:${SERVICES.faultyGroupLog2}`,
                        "test-error-group-2"
                    );
                    await sleep(3000);

                    const letters = await findDeadLetter(SERVICES.faultyGroupLog2);

                    expect(letters.length).toBe(1);
                    done();
                }
            );
        });

        const sumHandler = jest.fn(async ({ info, numbers }) => {
                const sum = numbers.reduce((acc: number, n: number) => acc + n, 0);
                //console.log(info + "\nSum of numbers is " + sum);
            }),
            sumLogHandler = jest.fn(async (data) => {
                //console.log("This event will be logged\n" + "The data object is:\n" + JSON.stringify(data));
            });
        describe("Multiple subscribers scenario", () => {
            itif(
                "Should subscribe to the same stream and process event for each subscription",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    events.subscribe({
                        [`${SERVICES.calc}.sum`]: {
                            group: `${SERVICES.calc}-sum`,
                            handler: sumHandler,
                            schema: calcSchema
                        },
                        [`${SERVICES.calc}.*`]: {
                            group: `${SERVICES.calc}-sum`,
                            handler: sumLogHandler
                        }
                    });
                    await events.start();
                    await sleep(3000);

                    await events.emit({
                        type: `${SERVICES.calc}.sum`,
                        data: {
                            info: "Calculate a sum",
                            numbers: [1, 2, 3, 4, 5]
                        }
                    });
                    await sleep(3000);

                    expect(sumHandler).toHaveBeenCalledTimes(1);
                    expect(sumLogHandler).toHaveBeenCalledTimes(1);

                    expect(sumLogHandler).toHaveBeenCalledAfter(sumHandler);
                    done();
                }
            );
        });

        const divideHandler = jest.fn(async () => {
                throw new Error("This error is expected");
            }),
            divideLogHandler = jest.fn(async (data) => {
                //console.log("This event will be logged\n" + "The data object is:\n" + JSON.stringify(data));
            });
        describe("Handling pending event with handling error in one of the subs", () => {
            itif(
                "Should call only firts handler once per start() and _receive[...]",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    events.subscribe({
                        [`${SERVICES.calc}.divide`]: {
                            group: `${SERVICES.calc}-divide`,
                            handler: divideHandler
                        },
                        [`${SERVICES.calc}.*`]: {
                            group: `${SERVICES.calc}-divide`,
                            handler: divideLogHandler
                        }
                    });
                    await events.start();
                    await sleep(3000);

                    await events.emit({
                        type: `${SERVICES.calc}.divide`,
                        data: {
                            info: "This is a faulty event, error is expected"
                        }
                    });
                    await sleep(3000);

                    expect(divideHandler).toHaveBeenCalledTimes(2);
                    expect(divideLogHandler).toHaveBeenCalledTimes(0);

                    done();
                }
            );
        });

        const groupSubstractHandler = jest.fn(async () => {
            console.error("This should not have been called");
        });
        describe("Handling group event with validation error", () => {
            itif(
                "Should emit a dead-letter event",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    events.subscribe({
                        [`${SERVICES.calc}.group-substract`]: {
                            group: `${SERVICES.calc}-substract"`,
                            handler: groupSubstractHandler,
                            schema: calcSchema
                        }
                    });
                    await events.start();

                    await sleep(3000);

                    await events.emit({
                        type: `${SERVICES.calc}.group-substract`,
                        data: { msg: "This message is not expected" }
                    });
                    await sleep(3000);

                    const deadLetters = await findDeadLetter(`${SERVICES.calc}.group-substract`);
                    await sleep(3000);

                    expect(deadLetters.length).toBe(1);
                    expect(groupSubstractHandler).not.toHaveBeenCalled();
                    done();
                }
            );
        });

        const unbalancedSubstractHandler = jest.fn(async () => {
            console.error("This should not have been called");
        });
        describe("Handling unbalanced event with validation error", () => {
            itif(
                "Should emit a dead-letter event",
                () => redis != null,
                async (done: Function) => {
                    const events = new Events(redis, lightship, eventsConfig);

                    events.subscribe({
                        [`${SERVICES.calc}.unbalanced-substract`]: {
                            unbalanced: true,
                            handler: unbalancedSubstractHandler,
                            schema: calcSchema
                        }
                    });
                    await events.start();

                    await sleep(3000);

                    await events.emit({
                        type: `${SERVICES.calc}.unbalanced-substract`,
                        data: { msg: "This message is not expected" }
                    });
                    await sleep(3000);

                    const deadLetters = await findDeadLetter(`${SERVICES.calc}.unbalanced-substract`);
                    await sleep(3000);

                    expect(deadLetters.length).toBe(1);
                    expect(unbalancedSubstractHandler).not.toHaveBeenCalled();

                    done();
                }
            );
        });
    });
});
