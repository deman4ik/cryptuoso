import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import {
    ExwatcherSchema,
    ExwatcherWorkerEvents,
    ExwatcherSubscribe,
    ExwatcherSubscribeAll,
    ExwatcherUnsubscribeAll
} from "@cryptuoso/exwatcher-events";
export type ExwatcherRunnerServiceConfig = HTTPServiceConfig;

export default class ExwatcherRunnerService extends HTTPService {
    constructor(config?: ExwatcherRunnerServiceConfig) {
        super(config);
        this.createRoutes({
            exwatcherSubscribe: {
                inputSchema: ExwatcherSchema[ExwatcherWorkerEvents.SUBSCRIBE],
                auth: true,
                roles: ["manager", "admin"],
                handler: this.subscribe
            },
            exwatcherSubscribeAll: {
                inputSchema: ExwatcherSchema[ExwatcherWorkerEvents.SUBSCRIBE_ALL],
                auth: true,
                roles: ["manager", "admin"],
                handler: this.subscribeAll
            },
            exwatcherUnsubscribeAll: {
                inputSchema: ExwatcherSchema[ExwatcherWorkerEvents.SUBSCRIBE_ALL],
                auth: true,
                roles: ["manager", "admin"],
                handler: this.unsubscribeAll
            }
        });
    }

    async subscribe(
        req: {
            body: {
                input: ExwatcherSubscribe;
            };
        },
        res: any
    ) {
        try {
            const { exchange, asset, currency } = req.body.input;
            const { count } = await this.db.pg.one(
                this.db.sql`SELECT count(1) 
                         FROM markets
                         WHERE exchange = ${exchange}
                         AND asset = ${asset}
                         AND currency = ${currency};`
            );
            this.log.info("Markets count", count);
            if (count !== 1) throw new Error(`Market ${exchange} ${asset}/${currency} doesn't exists`);
            const exwatcher = await this.db.pg.one(
                this.db.sql`SELECT id 
                         FROM exwatchers
                         WHERE exchange = ${exchange}
                         AND asset = ${asset}
                         AND currency = ${currency};`
            );

            if (!exwatcher) {
                await this.events.emit<ExwatcherSubscribe>(ExwatcherWorkerEvents.SUBSCRIBE, {
                    exchange,
                    asset,
                    currency
                });
            }

            res.send({ result: "OK" });
            res.end();
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }

    async subscribeAll(
        req: {
            body: {
                input: ExwatcherSubscribeAll;
            };
        },
        res: any
    ) {
        try {
            const { exchange } = req.body.input;
            const { count } = await this.db.pg.one(
                this.db.sql`SELECT count(1) 
                         FROM markets
                         WHERE exchange = ${exchange};`
            );
            if (count === 0) throw new Error(`Market ${exchange} doesn't exists`);
            await this.events.emit<ExwatcherSubscribeAll>(ExwatcherWorkerEvents.SUBSCRIBE_ALL, { exchange });
            res.send({ result: "OK" });
            res.end();
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }

    async unsubscribeAll(
        req: {
            body: {
                input: ExwatcherUnsubscribeAll;
            };
        },
        res: any
    ) {
        try {
            const { exchange } = req.body.input;
            const { count } = await this.db.pg.one(
                this.db.sql`SELECT count(1) 
                         FROM markets
                         WHERE exchange = ${exchange};`
            );
            if (count === 0) throw new Error(`Market ${exchange} doesn't exists`);
            await this.events.emit<ExwatcherUnsubscribeAll>(ExwatcherWorkerEvents.UNSUBSCRIBE_ALL, { exchange });
            res.send({ result: "OK" });
            res.end();
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }
}
