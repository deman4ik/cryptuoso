import { MailUtil, RATE_LIMIT } from "../lib/mail";
import Redis from "ioredis";
import { sleep } from "@cryptuoso/helpers";

var mockMailGunSend = jest.fn(/* console.log */);

jest.mock(
    "mailgun-js",
    () =>
        function () {
            return {
                messages: () => ({
                    send: mockMailGunSend
                })
            };
        }
);

describe("Mail rate limit test", () => {
    test("Should send no more than RATE_LIMIT letters", async () => {
        const redisConnection = new Redis(6379);
        const mailUtil = new MailUtil(redisConnection);

        for (let i = 0; i < RATE_LIMIT + 50; ++i) {
            /* await  */ mailUtil.send({
                from: "",
                to: "",
                subject: "",
                tags: [""]
            });
        }

        await sleep(1000);

        //console.warn(mockMailGunSend.mock.calls.length);

        expect(mockMailGunSend.mock.calls.length).toBeLessThanOrEqual(RATE_LIMIT);
    });
});
