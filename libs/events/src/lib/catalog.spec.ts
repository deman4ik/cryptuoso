import { EventsCatalog, Event } from "./catalog";
//import util from "util";
//util.inspect(obj, false, null, true)

let catalog: EventsCatalog;
// eslint-disable-next-line
const handler = async (event: Event | any): Promise<void> => {};
process.env.SERVICE = "importer";
describe("Test 'EventsCatalog'", () => {
    beforeEach(() => {
        catalog = new EventsCatalog();
    });
    describe("Test 'add'", () => {
        it("Should add grouped event handler", () => {
            catalog.add({
                "importer.start": {
                    handler,
                    passFullEvent: true
                }
            });

            const events = catalog.grouped;
            expect(events).toHaveProperty("cpz:events:importer");
            expect(events["cpz:events:importer"]).toHaveProperty("importer");
            expect(Object.keys(events["cpz:events:importer"]["importer"].subs)).toStrictEqual([
                "com.cryptuoso.importer.start"
            ]);
            expect(events["cpz:events:importer"]["importer"].subs["com.cryptuoso.importer.start"]).toHaveProperty(
                "handler"
            );
            expect(events["cpz:events:importer"]["importer"].subs["com.cryptuoso.importer.start"]).toHaveProperty(
                "validate"
            );
            expect(
                events["cpz:events:importer"]["importer"].subs["com.cryptuoso.importer.start"].passFullEvent
            ).toBeTruthy();
            expect(typeof events["cpz:events:importer"]["importer"].subs["com.cryptuoso.importer.start"].handler).toBe(
                "function"
            );
            expect(typeof events["cpz:events:importer"]["importer"].subs["com.cryptuoso.importer.start"].validate).toBe(
                "function"
            );
        });
        it("Should add unbalanced event handler", () => {
            catalog.add({
                "importer.start": {
                    unbalanced: true,
                    handler
                }
            });
            const events = catalog.unbalanced;
            expect(events).toHaveProperty("cpz:events:importer");
            expect(Object.keys(events["cpz:events:importer"].subs)).toStrictEqual(["com.cryptuoso.importer.start"]);
            expect(events["cpz:events:importer"].subs["com.cryptuoso.importer.start"]).toHaveProperty("handler");
            expect(events["cpz:events:importer"].subs["com.cryptuoso.importer.start"]).toHaveProperty("validate");
            expect(typeof events["cpz:events:importer"].subs["com.cryptuoso.importer.start"].handler).toBe("function");
            expect(typeof events["cpz:events:importer"].subs["com.cryptuoso.importer.start"].validate).toBe("function");
        });
        it("Should add event schema", () => {
            catalog.add({
                "importer.start": {
                    unbalanced: true,
                    handler,
                    schema: {
                        foo: "string"
                    }
                }
            });

            const events = catalog.unbalanced;
            expect(typeof events["cpz:events:importer"].subs["com.cryptuoso.importer.start"].validate).toBe("function");
        });
    });
    describe("Test get 'groups'", () => {
        it("Should returns groups list with topics", () => {
            catalog.add({
                "importer.start": {
                    handler
                },
                "importer.finished": {
                    handler
                },
                "trades.new": {
                    handler
                },
                "importer.stop": {
                    handler,
                    group: "newGroup"
                }
            });
            expect(catalog.groups).toStrictEqual([
                { topic: "cpz:events:importer", group: "importer" },
                { topic: "cpz:events:importer", group: "newGroup" },
                { topic: "cpz:events:trades", group: "importer" }
            ]);
        });
    });
    describe("Test get 'unbalancedTopics'", () => {
        it("Should return unbalanced topics list", () => {
            catalog.add({
                "importer.start": {
                    unbalanced: true,
                    handler
                },
                "importer.finished": {
                    unbalanced: true,
                    handler
                },
                "trades.new": {
                    unbalanced: true,
                    handler
                },
                "importer.stop": {
                    unbalanced: true,
                    handler
                }
            });
            expect(catalog.unbalancedTopics).toStrictEqual(["cpz:events:importer", "cpz:events:trades"]);
        });
    });
    describe("Test 'getGroupHandlers'", () => {
        it("Should return group handlers for event type", () => {
            catalog.add({
                "importer.start": {
                    handler
                },
                "importer.finished": {
                    handler
                },
                "trades.new": {
                    handler
                },
                "importer.stop": {
                    handler,
                    group: "newGroup"
                }
            });
            expect(
                catalog.getGroupHandlers("cpz:events:importer", "importer", "com.cryptuoso.importer.start").length
            ).toBe(1);
        });
    });
    describe("Test get 'getUnbalancedHandlers'", () => {
        it("Should return unbalanced topics list", () => {
            catalog.add({
                "importer.start": {
                    unbalanced: true,
                    handler
                },
                "importer.finished": {
                    unbalanced: true,
                    handler
                },
                "trades.new": {
                    unbalanced: true,
                    handler
                },
                "importer.stop": {
                    unbalanced: true,
                    handler
                }
            });
            expect(catalog.getUnbalancedHandlers("cpz:events:importer", "com.cryptuoso.importer.start").length).toBe(1);
        });
    });

    describe("Test '_match'", () => {
        it("Should correctly compare two strings", () => {
            expect(catalog._match("1.2.3", "1.2.3")).toBe(true);
            expect(catalog._match("a.b.c.d", "a.b.c.d")).toBe(true);
            expect(catalog._match("aa.bb.cc", "aa.bb.cc")).toBe(true);

            expect(catalog._match("a1c", "a?c")).toBe(true);
            expect(catalog._match("a2c", "a?c")).toBe(true);
            expect(catalog._match("a3c", "a?c")).toBe(true);
            expect(catalog._match("ac", "a?c")).toBe(false);

            expect(catalog._match("aa.1b.c", "aa.?b.*")).toBe(true);
            expect(catalog._match("aa.2b.cc", "aa.?b.*")).toBe(true);
            expect(catalog._match("aa.3b.ccc", "aa.?b.*")).toBe(true);
            expect(catalog._match("aa.4b.cccc", "aa.?b.*")).toBe(true);
            expect(catalog._match("aa.5b.ccccc", "aa.?b.*")).toBe(true);
            expect(catalog._match("aa.5b.ccccc.d", "aa.?b.*")).toBe(false);

            expect(catalog._match("aa.bb.cc", "aa.bb.*")).toBe(true);
            expect(catalog._match("aa.bb.cc", "*.bb.*")).toBe(true);
            expect(catalog._match("bb.cc", "bb.*")).toBe(true);
            expect(catalog._match("dd", "*")).toBe(true);

            expect(catalog._match("abcd", "*d")).toBe(true);
            expect(catalog._match("abcd", "*d*")).toBe(true);
            expect(catalog._match("abcd", "*a*")).toBe(true);
            expect(catalog._match("abcd", "a*")).toBe(true);

            // --- DOUBLE STARS CASES ---

            expect(catalog._match("aa.bb.cc", "aa.*")).toBe(false);
            expect(catalog._match("aa.bb.cc", "a*")).toBe(false);
            expect(catalog._match("bb.cc", "*")).toBe(false);

            expect(catalog._match("aa.bb.cc.dd", "*.bb.*")).toBe(false);
            expect(catalog._match("aa.bb.cc.dd", "*.cc.*")).toBe(false);

            expect(catalog._match("aa.bb.cc.dd", "*bb*")).toBe(false);
            expect(catalog._match("aa.bb.cc.dd", "*cc*")).toBe(false);

            expect(catalog._match("aa.bb.cc.dd", "*b*")).toBe(false);
            expect(catalog._match("aa.bb.cc.dd", "*c*")).toBe(false);

            expect(catalog._match("aa.bb.cc.dd", "**.bb.**")).toBe(true);
            expect(catalog._match("aa.bb.cc.dd", "**.cc.**")).toBe(true);

            expect(catalog._match("aa.bb.cc.dd", "**aa**")).toBe(true);
            expect(catalog._match("aa.bb.cc.dd", "**bb**")).toBe(true);
            expect(catalog._match("aa.bb.cc.dd", "**cc**")).toBe(true);
            expect(catalog._match("aa.bb.cc.dd", "**dd**")).toBe(true);

            expect(catalog._match("aa.bb.cc.dd", "**b**")).toBe(true);
            expect(catalog._match("aa.bb.cc.dd", "**c**")).toBe(true);

            expect(catalog._match("aa.bb.cc", "aa.**")).toBe(true);
            expect(catalog._match("aa.bb.cc", "**.cc")).toBe(true);

            expect(catalog._match("bb.cc", "**")).toBe(true);
            expect(catalog._match("b", "**")).toBe(true);
        });
    });

    describe("Test getting unbalanced handlers for pattern event types", () => {
        it("Should return expected event handlers", () => {
            catalog.add({
                "common.*": {
                    unbalanced: true,
                    handler
                },
                "common.private": {
                    unbalanced: true,
                    handler
                },
                "common.**e": {
                    unbalanced: true,
                    handler
                },
                "common.???": {
                    unbalanced: true,
                    handler
                }
            });

            expect(catalog.getUnbalancedHandlers("cpz:events:common", "com.cryptuoso.common.all").length).toBe(2);
            expect(catalog.getUnbalancedHandlers("cpz:events:common", "com.cryptuoso.common.private").length).toBe(3);
            expect(catalog.getUnbalancedHandlers("cpz:events:common", "com.cryptuoso.common.failure").length).toBe(2);
            expect(catalog.getUnbalancedHandlers("cpz:events:common", "com.cryptuoso.common.log").length).toBe(2);
        });
    });

    describe("Test getting group handlers for pattern event types", () => {
        it("Should return expected event handlers", () => {
            catalog.add({
                "importer.*": {
                    handler,
                    group: "importer"
                },
                "importer.finished": {
                    handler,
                    group: "importer"
                },
                "importer.s????": {
                    handler,
                    group: "importer"
                },
                "importer.s**": {
                    handler,
                    group: "importer"
                }
            });

            expect(
                catalog.getGroupHandlers("cpz:events:importer", "importer", "com.cryptuoso.importer.start").length
            ).toBe(3);
            expect(
                catalog.getGroupHandlers("cpz:events:importer", "importer", "com.cryptuoso.importer.finished").length
            ).toBe(2);
            expect(
                catalog.getGroupHandlers("cpz:events:importer", "importer", "com.cryptuoso.importer.stop").length
            ).toBe(2);
            expect(
                catalog.getGroupHandlers("cpz:events:importer", "importer", "com.cryptuoso.importer.cancel").length
            ).toBe(1);
        });
    });
});
