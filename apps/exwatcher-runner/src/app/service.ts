import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import {
    ExwatcherSchema,
    ExwatcherEvents,
    ExwatcherSubscribe,
    ExwatcherSubscribeAll,
    ExwatcherUnsubscribeAll,
    ExwatcherAddMarket,
    getExwatcherSubscribeEventName,
    getExwatcherSubscribeAllEventName,
    getExwatcherUnsubscribeAllEventName
} from "@cryptuoso/exwatcher-events";
import { PublicConnector } from "@cryptuoso/ccxt-public";
import { sql } from "slonik";
import { UserRoles } from "@cryptuoso/user-state";
import { sleep } from "@cryptuoso/helpers";

export type ExwatcherRunnerServiceConfig = HTTPServiceConfig;

const enum JobTypes {
    updateMarkets = "updateMarkets"
}

export default class ExwatcherRunnerService extends HTTPService {
    connector: PublicConnector;

    constructor(config?: ExwatcherRunnerServiceConfig) {
        super(config);
        this.connector = new PublicConnector();
        this.createRoutes({
            exwatcherSubscribe: {
                inputSchema: ExwatcherSchema[ExwatcherEvents.SUBSCRIBE],
                roles: [UserRoles.admin, UserRoles.manager],
                handler: this.subscribe
            },
            exwatcherSubscribeAll: {
                inputSchema: ExwatcherSchema[ExwatcherEvents.SUBSCRIBE_ALL],
                roles: [UserRoles.admin, UserRoles.manager],
                handler: this.subscribeAll
            },
            exwatcherUnsubscribeAll: {
                inputSchema: ExwatcherSchema[ExwatcherEvents.SUBSCRIBE_ALL],
                roles: [UserRoles.admin, UserRoles.manager],
                handler: this.unsubscribeAll
            },
            addMarket: {
                inputSchema: {
                    exchange: "string",
                    asset: "string",
                    currency: "string",
                    available: { type: "number", integer: true, optional: true }
                },
                roles: [UserRoles.admin, UserRoles.manager],
                handler: this.addMarket
            },
            updateMarkets: {
                roles: [UserRoles.admin, UserRoles.manager],
                handler: this.updateMarketsHTTPHandler
            }
        });
        this.addOnStartHandler(this.onServiceStart);
    }

    async onServiceStart() {
        const queueKey = this.name;

        this.createQueue(queueKey);

        this.createWorker(queueKey, this.updateMarkets);

        await this.connector.initAllConnectors(true);
        await this.addJob(queueKey, JobTypes.updateMarkets, null, {
            repeat: {
                cron: "0 0 */12 * * *"
            },
            attempts: 3,
            backoff: { type: "exponential", delay: 60000 },
            removeOnComplete: 1,
            removeOnFail: 10
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
            const count = await this.db.pg.oneFirst(
                sql`SELECT count(1) 
                         FROM markets
                         WHERE exchange = ${exchange}
                         AND asset = ${asset}
                         AND currency = ${currency}
                         AND available > 0;`
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
                    type: getExwatcherSubscribeEventName(exchange),
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
            const count = await this.db.pg.oneFirst<number>(
                sql`SELECT count(1) 
                         FROM markets
                         WHERE exchange = ${exchange}
                         AND available > 0;`
            );
            if (count === 0) throw new Error(`Market ${exchange} doesn't exists`);
            await this.events.emit<ExwatcherSubscribeAll>({
                type: getExwatcherSubscribeAllEventName(exchange),
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
            const count = await this.db.pg.oneFirst<number>(
                sql`SELECT count(1) 
                    FROM markets
                    WHERE exchange = ${exchange};`
            );
            if (count === 0) throw new Error(`Market ${exchange} doesn't exists`);
            await this.events.emit<ExwatcherUnsubscribeAll>({
                type: getExwatcherUnsubscribeAllEventName(exchange),
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
            while (!this.connector.isInited()) {
                this.log.info("Waiting for connectors to Initialize...");
                await sleep(5000);
            }
            const markets = await this.db.pg.any<{ exchange: string; asset: string; currency: string }>(
                sql`SELECT exchange, asset, currency FROM markets where available >= 5;`
            );
            this.log.info(`Updating ${markets.length} markets`);
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
                throw new Error(`Failed to update ${errors.length} markets of ${markets.length}`);
            }
            await this.db.pg.query(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_exchange_info;`);
            await this.db.pg.query(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_portfolio_limits;`);
            this.log.info(`Updated ${markets.length} markets!`);
        } catch (error) {
            this.log.error("Failed to update markets", error);
            throw error;
        }
    }

    async updateMarket({
        exchange,
        asset,
        currency,
        available = 15
    }: {
        exchange: string;
        asset: string;
        currency: string;
        available?: number;
    }) {
        this.log.debug(`Updating ${exchange}.${asset}.${currency} market...`);
        const { precision, limits, feeRate, loadFrom, info } = await this.connector.getMarket(
            exchange,
            asset,
            currency
        );
        await this.db.pg.query(sql`INSERT INTO markets (
                exchange, asset, currency, precision, limits, fee_rate, load_from, available, info )
                VALUES (
                    ${exchange},
                    ${asset},
                    ${currency},
                    ${JSON.stringify(precision)},
                    ${JSON.stringify(limits)},
                    ${feeRate},
                    ${loadFrom || null},
                    ${available},
                    ${JSON.stringify(info)}
                )
                ON CONFLICT ON CONSTRAINT markets_exchange_asset_currency_key
                DO UPDATE SET precision = excluded.precision, 
                limits = excluded.limits,
                fee_rate = excluded.fee_rate,
                load_from = excluded.load_from,
                info = excluded.info;
            `);
        this.log.debug(`${exchange}.${asset}.${currency} market updated!`);
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
            const { exchange, asset, currency, available } = req.body.input;

            const assetExists = await this.db.pg.maybeOne(sql`
            SELECT code from assets where code = ${asset};
            `);
            if (!assetExists)
                await this.db.pg.query(sql`
            INSERT INTO assets (code,name) VALUES (${asset},${asset});
            `);
            const currencyExists = await this.db.pg.maybeOne(sql`
             SELECT code from currencies where code = ${currency};
             `);
            if (!currencyExists)
                await this.db.pg.query(sql`
             INSERT INTO currencies (code,name) VALUES (${currency},${currency});
             `);
            const marketExists = await this.db.pg.maybeOne(sql`
            SELECT asset from markets where exchange = ${exchange}
            AND asset = ${asset}
            and currency = ${currency};
            `);
            if (!marketExists) await this.updateMarket({ ...req.body.input, available: available || 0 });
            res.send({ result: "OK" });
            res.end();
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }
}
