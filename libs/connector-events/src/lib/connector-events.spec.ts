import { connectorEvents } from "./connector-events";

describe("connectorEvents", () => {
    it("should work", () => {
        expect(connectorEvents()).toEqual("connector-events");
    });
});
