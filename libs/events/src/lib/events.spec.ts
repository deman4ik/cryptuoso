import Redis from "ioredis";
import { createLightship } from "lightship";
import { Events } from "./events";
import { CloudEvent as Event } from "cloudevents";
import { ValidationSchema } from "fastest-validator";

jest.mock("uuid", () => ({ v4: () => "id123" }));

const mockLightshipType = {
    isServerShuttingDown: () => false,
    createBeacon: jest.fn(() => ({ die: jest.fn() }))
};

jest.mock("lightship", () => ({
    LightshipType: jest.fn(() => mockLightshipType),
    createLightship: jest.fn(() => mockLightshipType)
}));

const mockXgroup = jest.fn(),
    mockXread = jest.fn(() => [
        "cpz:events:importer",
        [
            ["1293846129342-0", ["key1", "123", "key2", "foo", "key3", "bar"]],
            ["1293846129345-0", ["key1", "456", "key2", "bar", "key3", "tar"]]
        ]
    ]),
    mockXreadGroup = jest.fn(),
    mockXpending = jest.fn(),
    mockXclaim = jest.fn(),
    mockXack = jest.fn(),
    mockXadd = jest.fn();

function RedisConstructor() {
    return {
        duplicate: () => RedisConstructor(),
        xgroup: mockXgroup,
        xread: mockXread,
        xreadgroup: mockXreadGroup,
        xpending: mockXpending,
        xclaim: mockXclaim,
        xack: mockXack,
        xadd: mockXadd
    };
}
jest.mock("ioredis", () => () => RedisConstructor());

const mockCatalogAdd = jest.fn(),
    mockCatalogHandler = jest.fn(),
    mockCatalogValidate = jest.fn(() => true);
jest.mock("./catalog", () => ({
    EventsCatalog: jest.fn(() => ({
        groups: [{ topic: "cpz:events:importer", group: "importer" }],
        unbalancedTopics: ["cpz:events:trades"],
        getGroupHandlers: () => ({
            "cpz:events:importer": {
                subs: {
                    "com.cryptuoso.importer.start": {
                        handler: mockCatalogHandler,
                        validate: mockCatalogValidate
                    }
                }
            }
        }),
        getUnbalancedHandlers: () => ({
            "cpz:events:importer": {
                subs: {
                    "com.cryptuoso.importer.start": {
                        handler: mockCatalogHandler,
                        validate: mockCatalogValidate
                    }
                }
            }
        }),
        add: mockCatalogAdd
    }))
}));

describe("Test 'Events' module", () => {
    describe("Unit tests", () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        const redisClient = Redis();
        const lightship = createLightship();
        const events = new Events(redisClient, lightship);

        describe("Testing data transformation utils", () => {
            describe("Testing '_parseObjectResponse' method", () => {
                it("Should parse single redis message to object", () => {
                    const msg = ["key1", "123", "key2", "foo", "key3", "bar"];
                    const res = events._parseObjectResponse(msg);

                    expect(res).toStrictEqual({ key1: 123, key2: "foo", key3: "bar" });

                    const emptyRes = events._parseObjectResponse([]);
                    expect(emptyRes).toStrictEqual({});
                });
            });

            describe("Testing '_parseMessageResponse' method", () => {
                it("Should parse message array to object", () => {
                    const array: [string, string[]][] = [
                        ["message_1", ["key1", "123", "key2", "foo", "key3", "bar"]],
                        ["message_2", ["key1", "456", "key2", "bar", "key3", "tar"]],
                        ["message_3", ["key1", "789", "key2", "tar", "key3", "foo"]]
                    ];
                    const res = events._parseMessageResponse(array);
                    expect(res).toStrictEqual([
                        { msgId: "message_1", data: { key1: 123, key2: "foo", key3: "bar" } },
                        { msgId: "message_2", data: { key1: 456, key2: "bar", key3: "tar" } },
                        { msgId: "message_3", data: { key1: 789, key2: "tar", key3: "foo" } }
                    ]);
                    const emptyRes = events._parseMessageResponse([]);
                    expect(emptyRes).toStrictEqual([]);
                });
            });

            describe("Testing '_parseStreamResponse' method", () => {
                it("Should parse response of xread command to object", () => {
                    const array: [string, [string, string[]][]][] = [
                        [
                            "stream1",
                            [
                                ["1293846129342-0", ["key1", "123", "key2", "foo", "key3", "bar"]],
                                ["1293846129345-0", ["key1", "456", "key2", "bar", "key3", "tar"]]
                            ]
                        ],
                        [
                            "stream2",
                            [
                                ["1293846129421-0", ["name", "John", "lastName", "Doe", "age", "44"]],
                                ["1293846130030-0", ["name", "Steve", "lastName", "Jobs", "age", "65"]]
                            ]
                        ]
                    ];
                    const res = events._parseStreamResponse(array);

                    expect(res).toStrictEqual({
                        stream1: [
                            { msgId: "1293846129342-0", data: { key1: 123, key2: "foo", key3: "bar" } },
                            { msgId: "1293846129345-0", data: { key1: 456, key2: "bar", key3: "tar" } }
                        ],
                        stream2: [
                            { msgId: "1293846129421-0", data: { name: "John", lastName: "Doe", age: 44 } },
                            { msgId: "1293846130030-0", data: { name: "Steve", lastName: "Jobs", age: 65 } }
                        ]
                    });
                });
            });

            describe("Testing '_parsePendingResponse' method", () => {
                describe("Input is not empty", () => {
                    it("Should parse an array of pending messages to object", () => {
                        const arr = [
                            ["1256984818136-0", "consumer-1", "196415", "1"],
                            ["1256984818136-1", "consumer-2", "150952", "2"],
                            ["1256984818136-2", "consumer-3", "689124", "2"]
                        ];
                        const res = events._parsePendingResponse(arr);
                        expect(res).toStrictEqual([
                            { msgId: "1256984818136-0", consumer: "consumer-1", idleSeconds: 196, retries: 1 },
                            { msgId: "1256984818136-1", consumer: "consumer-2", idleSeconds: 151, retries: 2 },
                            { msgId: "1256984818136-2", consumer: "consumer-3", idleSeconds: 689, retries: 2 }
                        ]);
                    });
                });
                describe("Input is empty", () => {
                    expect(events._parsePendingResponse([])).toStrictEqual([]);
                });
            });

            describe("Testing '_parseEvents' method", () => {
                describe("Passing valid arguments", () => {
                    it("Should return object with values of Event type", () => {
                        const eventArr: { msgId: string; data: { [key: string]: any } }[] = [
                            {
                                msgId: "1293846129342-0",
                                data: { event: { type: "com.cryptuoso.foo", source: "events.cryptuoso.com" } }
                            },
                            {
                                msgId: "1293846129344-0",
                                data: { event: { type: "com.cryptuoso.bar", source: "events.cryptuoso.com" } }
                            }
                        ];
                        const res = events._parseEvents(eventArr);
                        for (const key of Object.keys(res)) {
                            expect(res[key]).toBeInstanceOf(Event);
                        }
                    });
                });
            });

            describe("Testing 'subscribe' method", () => {
                it("Should call #catalog.add once with the event provided", () => {
                    const evt: {
                        [key: string]: {
                            group?: string;
                            unbalanced?: boolean;
                            handler: (event: Event) => Promise<void>;
                            schema?: ValidationSchema<any>;
                        };
                    } = {
                        "foo.bar.tar": {
                            group: "group1",
                            handler: (event: Event) => new Promise(() => console.log(JSON.stringify(event)))
                        }
                    };
                    events.subscribe(evt);

                    expect(mockCatalogAdd).toHaveBeenCalledWith(evt);
                    expect(mockCatalogAdd).toHaveBeenCalledTimes(1);
                });
            });

            describe("Testing 'start' method", () => {
                const topic = "cpz:events:importer",
                    group = "importer";
                it("Should call all redis read functions", () => {
                    events.start();
                    expect(mockXgroup).toHaveBeenCalledTimes(1);
                    expect(mockXreadGroup).toHaveBeenCalledTimes(1);
                    expect(mockXpending).toHaveBeenCalledTimes(1);
                    expect(mockXread).toHaveBeenCalledTimes(1);
                });
            });
        });
    });
});
