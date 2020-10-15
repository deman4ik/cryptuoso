import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import {
    ExwatcherSchema,
    ExwatcherEvents,
    ExwatcherSubscribe,
    ExwatcherSubscribeAll,
    ExwatcherUnsubscribeAll,
    ExwatcherAddMarket
} from "@cryptuoso/exwatcher-events";
import { PublicConnector } from "@cryptuoso/ccxt-public";
import { sql } from "slonik";
import { Queue, QueueScheduler, Worker } from "bullmq";

export type ExwatcherRunnerServiceConfig = HTTPServiceConfig;

const enum JobTypes {
    updateMarkets = "updateMarkets"
}

export default class ExwatcherRunnerService extends HTTPService {
    connector: PublicConnector;
    queueScheduler: QueueScheduler;
    queues: { [key: string]: Queue };
    workers: { [key: string]: Worker };
    constructor(config?: ExwatcherRunnerServiceConfig) {
        super(config);
        this.connector = new PublicConnector();
        this.createRoutes({
            exwatcherSubscribe: {
                inputSchema: ExwatcherSchema[ExwatcherEvents.SUBSCRIBE],
                auth: true,
                roles: ["manager", "admin"],
                handler: this.subscribe
            },
            exwatcherSubscribeAll: {
                inputSchema: ExwatcherSchema[ExwatcherEvents.SUBSCRIBE_ALL],
                auth: true,
                roles: ["manager", "admin"],
                handler: this.subscribeAll
            },
            exwatcherUnsubscribeAll: {
                inputSchema: ExwatcherSchema[ExwatcherEvents.SUBSCRIBE_ALL],
                auth: true,
                roles: ["manager", "admin"],
                handler: this.unsubscribeAll
            },
            addMarket: {
                inputSchema: ExwatcherSchema[ExwatcherEvents.ADD_MARKET],
                auth: true,
                roles: ["manager", "admin"],
                handler: this.addMarket
            },
            updateMarkets: {
                auth: true,
                roles: ["manager", "admin"],
                handler: this.updateMarketsHTTPHandler
            }
        });
        this.addOnStartHandler(this.onServiceStart);
        this.addOnStopHandler(this.onServiceStop);
    }

    async onServiceStart() {
        const queueKey = this.name;

        this.queueScheduler = new QueueScheduler(queueKey, { connection: this.redis });
        this.queues = {
            [queueKey]: new Queue(queueKey, { connection: this.redis })
        };
        this.workers = {
            [queueKey]: new Worker(queueKey, this.updateMarkets.bind(this))
        };

        await this.queues[queueKey].add(JobTypes.updateMarkets, null, {
            repeat: {
                cron: "0 0 */12 * * *"
            },
            attempts: 3,
            backoff: { type: "exponential", delay: 60000 }
        });
    }

    async onServiceStop() {
        try {
            const queueKey = this.name;

            await this.queueScheduler.close();
            await this.queues[queueKey]?.close();
            await this.workers[queueKey]?.close();
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
                    type: ExwatcherEvents.SUBSCRIBE,
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
                type: ExwatcherEvents.SUBSCRIBE_ALL,
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
                type: ExwatcherEvents.UNSUBSCRIBE_ALL,
                data: { exchange }
            });
            res.send({ result: "OK" });
            res.end();
        } catch (err) {
            this.log.error(err);
            throw err;
        }
    }

    async updateMarketsHTTPHandler(req: any, res: any) {
        await this.updateMarkets();
        res.send({ result: "OK" });
        res.end();
    }

    async updateMarkets() {
        try {
            const markets: { exchange: string; asset: string; currency: string }[] = await this.db.pg.any(
                sql`SELECT exchange, asset, currency FROM markets where available >= 5;`
            );
            this.log.info(
                `Updating ${markets
                    .map(({ exchange, asset, currency }) => `${exchange}.${asset}.${currency}`)
                    .join(", ")} markets`
            );
            const errors: { exchange: string; asset: string; currency: string; error: string }[] = [];
            for (const market of markets) {
                try {
                    await this.updateMarket(market);
                } catch (error) {
                    this.log.error(
                        `Failed to update market ${market.exchange}.${market.asset}.${market.currency}`,
                        error
                    );
                    errors.push({ ...market, error: error.message });
                }
            }
            if (errors.length > 0) {
                await this.events.emit({
                    type: `errors.${this.name}.updateMarkets`,
                    data: {
                        errors
                    }
                });
                throw new Error(`Failed to update ${errors.length} markets of ${markets}`);
            }
        } catch (error) {
            this.log.error("Failed to update markets", error);
            throw error;
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
