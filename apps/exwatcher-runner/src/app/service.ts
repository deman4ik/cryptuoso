import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import {
    ExwatcherSchema,
    ExwatcherWorkerEvents,
    ExwatcherSubscribe,
    ExwatcherSubscribeAll,
    ExwatcherUnsubscribeAll,
    ExwatcherAddMarket
} from "@cryptuoso/exwatcher-events";
import { PublicConnector } from "@cryptuoso/ccxt-public";
import { sql } from "slonik";
import cron from "node-cron";

export type ExwatcherRunnerServiceConfig = HTTPServiceConfig;

export default class ExwatcherRunnerService extends HTTPService {
    connector: PublicConnector;
    cronUpdateMarkets: cron.ScheduledTask = cron.schedule("0 0 */12 * * *", this.updateMarkets.bind(this), {
        scheduled: false
    });
    constructor(config?: ExwatcherRunnerServiceConfig) {
        super(config);
        this.connector = new PublicConnector();
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
            },
            addMarket: {
                inputSchema: ExwatcherSchema[ExwatcherWorkerEvents.ADD_MARKET],
                auth: true,
                roles: ["manager", "admin"],
                handler: this.addMarket
            }
        });
        this.addOnStartHandler(this.onStartService);
        this.addOnStopHandler(this.onStopService);
    }

    async onStartService() {
        this.cronUpdateMarkets.start();
    }

    async onStopService() {
        try {
            this.cronUpdateMarkets.stop();
        } catch (e) {
            this.log.error(e);
        }
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
            const count = await this.db.pg.oneFirst(
                sql`SELECT count(1) 
                         FROM markets
                         WHERE exchange = ${exchange}
                         AND asset = ${asset}
                         AND currency = ${currency};`
            );
            this.log.info("Markets count", count);
            if (count === 0) throw new Error(`Market ${exchange} ${asset}/${currency} doesn't exists`);
            const exwatcher = await this.db.pg.maybeOne(
                sql`SELECT id 
                         FROM exwatchers
                         WHERE exchange = ${exchange}
                         AND asset = ${asset}
                         AND currency = ${currency};`
            );

            if (!exwatcher) {
                await this.events.emit<ExwatcherSubscribe>({
                    type: ExwatcherWorkerEvents.SUBSCRIBE,
                    data: {
                        exchange,
                        asset,
                        currency
                    }
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
            const count = await this.db.pg.oneFirst(
                sql`SELECT count(1) 
                         FROM markets
                         WHERE exchange = ${exchange};`
            );
            if (count === 0) throw new Error(`Market ${exchange} doesn't exists`);
            await this.events.emit<ExwatcherSubscribeAll>({
                type: ExwatcherWorkerEvents.SUBSCRIBE_ALL,
                data: { exchange }
            });
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
            const count = await this.db.pg.oneFirst(
                sql`SELECT count(1) 
                    FROM markets
                    WHERE exchange = ${exchange};`
            );
            if (count === 0) throw new Error(`Market ${exchange} doesn't exists`);
            await this.events.emit<ExwatcherUnsubscribeAll>({
                type: ExwatcherWorkerEvents.UNSUBSCRIBE_ALL,
                data: { exchange }
            });
            res.send({ result: "OK" });
            res.end();
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }

    async updateMarkets() {
        try {
            const markets: { exchange: string; asset: string; currency: string }[] = await this.db.pg.any(
                sql`SELECT exchange, asset, currency FROM markets where available > 5;`
            );
            this.log.info(
                `Updating ${markets
                    .map(({ exchange, asset, currency }) => `${exchange}.${asset}.${currency}`)
                    .join(", ")} markets`
            );
            for (const market of markets) {
                try {
                    await this.updateMarket(market);
                } catch (error) {
                    this.log.error(
                        `Failed to update market ${market.exchange}.${market.asset}.${market.currency}`,
                        error
                    );
                }
            }
        } catch (error) {
            this.log.error("Failed to update markets", error);
        }
    }

    async updateMarket(params: { exchange: string; asset: string; currency: string }) {
        const { exchange, asset, currency } = params;
        const { precision, limits, averageFee, loadFrom } = await this.connector.getMarket(exchange, asset, currency);

        const available = 15;
        await this.db.pg.query(sql`INSERT INTO markets (
                exchange, asset, currency, precision, limits, average_fee, load_from, available )
                VALUES (
                    ${exchange},
                    ${asset},
                    ${currency},
                    ${sql.json(precision)},
                    ${sql.json(limits)},
                    ${averageFee},
                    ${loadFrom},
                    ${available}
                )
                ON CONFLICT ON CONSTRAINT markets_exchange_asset_currency_key
                DO UPDATE SET precision = excluded.precision, 
                limits = excluded.limits,
                average_fee = excluded.average_fee,
                load_from = excluded.load_from;
            `);
    }

    async addMarket(
        req: {
            body: {
                input: ExwatcherAddMarket;
            };
        },
        res: any
    ) {
        try {
            //TODO: add exchanges, assets, currencies
            await this.updateMarket(req.body.input);
            res.send({ result: "OK" });
            res.end();
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }
}
