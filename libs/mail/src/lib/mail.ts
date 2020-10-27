import { COVER_TEMPLATE_TYPES, SendProps, SubscribeProps } from "./types";
import Mailgun from "mailgun-js";
import Redis from "ioredis";
import logger from "@cryptuoso/logger";
import { sleep } from "@cryptuoso/helpers";

export interface MailUtilConfig {
    apiKey: string;
    domain: string;
    host?: string;
}

function makeMailGunConnection() {
    let config;
    if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
        config = {
            apiKey: process.env.MAILGUN_API_KEY,
            domain: process.env.MAILGUN_DOMAIN,
            host: "api.eu.mailgun.net"
        };
    } else {
        config = { apiKey: "none", domain: "none" };
        logger.warn("MailGun connection runs in TEST mode.");
    }

    return new Mailgun(config);
}

export enum MailGunEventTypes {
    OPENED = "OPENED",
    UNSUBSCRIBED = "UNSUBSCRIBED",
    DELIVERED = "DELIVERED"
}

export interface MailGunEventData {
    event: MailGunEventTypes;
    /** MailGun message id */
    id?: string;
    /** email */
    recipient?: string;
    // TODO: list field for "unsubscribe event"
}

export function makeMailgunWebhookValidator() {
    const mailgun = makeMailGunConnection();

    return function (body: any) {
        if (!body?.signature || !body["event-data"]) return false;

        const s = body.signature;

        return mailgun.validateWebhook(s.timestamp, s.token, s.signature);
    };
}

/** Seconds */
const RATE_LIMIT_PERIOD = 60;
export const RATE_LIMIT = 300;
const LIMITER_PREFIX = `cpz:limit:${process.env.MAILGUN_DOMAIN}:`;

export class MailUtil {
    private mailgun: Mailgun.Mailgun;
    #redis: Redis.Redis;
    #domain: string;
    constructor(redisClient: Redis.Redis) {
        try {
            this.mailgun = makeMailGunConnection();

            this.#domain = process.env.MAILGUN_DOMAIN;

            this.#redis = redisClient.duplicate();
        } catch (e) {
            logger.error(e, "Failed to init mailgun instance!");
        }
    }

    get domain() {
        return this.#domain;
    }

    // TODO: check & improve
    private async waitForLimit() {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const time = Date.now() / (RATE_LIMIT_PERIOD * 1000);
            const key = `${LIMITER_PREFIX}${Math.trunc(time)}`;

            const res = await this.#redis.multi().incr(key).expire(key, RATE_LIMIT_PERIOD).exec();

            const count = +res[0][1];

            //console.warn(`Count: ${count}`);

            if (count <= RATE_LIMIT) return;

            await sleep(1000 * RATE_LIMIT_PERIOD * (count / RATE_LIMIT - (time % 1)));
            // Or await sleep(1000 * RATE_LIMIT_PERIOD);
        }
    }

    send = async ({
        from, // = "Cryptuoso <noreply@cryptuoso.com>",
        to,
        subject,
        text,
        html,
        template = COVER_TEMPLATE_TYPES.simple,
        variables,
        tags
    }: SendProps) => {
        try {
            await this.waitForLimit();
            const mailGunVariables = variables && Object.keys(variables) && JSON.stringify(variables);
            const res = await this.mailgun.messages().send({
                from: from || `Cryptuoso <noreply@${this.domain}>`,
                to,
                subject,
                text,
                html,
                template,
                "h:X-Mailgun-Variables": mailGunVariables,
                "o:tag": tags
            });

            return res?.id;
        } catch (e) {
            logger.error(e);
            throw e;
        }
    };

    subscribeToList = async ({ list, email: address, name }: SubscribeProps) => {
        try {
            await this.waitForLimit();
            await this.mailgun.lists(list).members().create({
                subscribed: true,
                address,
                name
            });
            return true;
        } catch (e) {
            if (e.message.includes("Address already exists")) return;
            logger.error(e);
            throw e;
        }
    };
}

/* const mailUtil: MailUtil = new MailUtil(new Redis(process.env.REDISCS));
export default mailUtil; */
