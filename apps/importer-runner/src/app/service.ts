import { v4 as uuid } from "uuid";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import dayjs from "@cryptuoso/dayjs";
import { getValidDate, CANDLES_RECENT_AMOUNT } from "@cryptuoso/helpers";
import { Importer, Status, ImporterParams } from "@cryptuoso/importer-state";
import {
    ImporterRunnerSchema,
    ImporterRunnerEvents,
    ImporterRunnerStart,
    ImporterRunnerStop,
    ImporterWorkerEvents,
    ImporterWorkerCancel
} from "@cryptuoso/importer-events";
import { BaseError } from "@cryptuoso/errors";
import { Timeframe } from "@cryptuoso/market";
import { UserRoles } from "@cryptuoso/user-state";
import { sql } from "@cryptuoso/postgres";

export type ImporterRunnerServiceConfig = HTTPServiceConfig;

export default class ImporterRunnerService extends HTTPService {
    constructor(config?: ImporterRunnerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                importerStart: {
                    inputSchema: ImporterRunnerSchema[ImporterRunnerEvents.START],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.startHTTPHandler
                },
                importerStop: {
                    inputSchema: ImporterRunnerSchema[ImporterRunnerEvents.STOP],
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.stopHTTPHandler
                },
                importerStartAllMarkets: {
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.startAllMarketsHTTPHandler
                }
            });
            this.events.subscribe({
                [ImporterRunnerEvents.START]: {
                    handler: this.start.bind(this),
                    schema: ImporterRunnerSchema[ImporterRunnerEvents.START]
                },
                [ImporterRunnerEvents.STOP]: {
                    handler: this.stop.bind(this),
                    schema: ImporterRunnerSchema[ImporterRunnerEvents.STOP]
                }
            });
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error(err, "While constructing ImporterRunnerService");
        }
    }

    async onServiceStart() {
        this.createQueue("importCandles");
    }

    async startHTTPHandler(
        req: {
            body: {
                input: ImporterRunnerStart;
            };
        },
        res: any
    ) {
        const result = await this.start(req.body.input);
        res.send(result);
        res.end();
    }

    async start({ id, exchange, asset, currency, type, timeframes, dateFrom, dateTo, amount }: ImporterRunnerStart) {
        try {
            const params: ImporterParams = {
                timeframes: timeframes || Timeframe.validArray
            };
            const market = await this.db.pg.maybeOne<{ loadFrom: string }>(sql`
            select load_from from markets 
            where exchange = ${exchange} 
            and asset = ${asset} and currency = ${currency}
            `);
            if (!market)
                throw new BaseError(
                    `Market ${exchange} ${asset}/${currency} doesn't exists.`,
                    { exchange, asset, currency },
                    "NotFound"
                );
            if (type === "history") {
                params.dateFrom = dateFrom ? getValidDate(dateFrom) : market.loadFrom;
                params.dateTo = dateTo ? getValidDate(dateTo) : dayjs.utc().startOf("minute").toISOString();
            } else {
                params.amount = amount || CANDLES_RECENT_AMOUNT;
            }

            const importer = new Importer({
                id: id || uuid(),
                exchange,
                asset,
                currency,
                type,
                params,
                status: Status.queued
            });
            importer.init();

            await this.addJob("importCandles", importer.type, importer.state, {
                jobId: importer.id,
                removeOnComplete: true,
                removeOnFail: true
            });
            return { result: importer.id };
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }

    async stopHTTPHandler(
        req: {
            body: {
                input: ImporterRunnerStop;
            };
        },
        res: any
    ) {
        await this.stop(req.body.input);
        res.send({ result: "OK" });
        res.end();
    }

    async stop({ id }: ImporterRunnerStop) {
        try {
            const job = await this.queues["importCandles"].instance.getJob(id);
            if (job) {
                if (job.isActive) {
                    await this.events.emit<ImporterWorkerCancel>({
                        type: ImporterWorkerEvents.CANCEL,
                        data: {
                            id
                        }
                    });
                } else {
                    await job.remove();
                }
            }
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }

    async startAllMarketsHTTPHandler(req: any, res: any) {
        await this.startAllMarkets();
        res.send({ result: "OK" });
        res.end();
    }

    async startAllMarkets() {
        try {
            const markets = await this.db.pg.any<{ exchange: string; asset: string; currency: string }>(
                sql`SELECT exchange, asset, currency FROM markets where available >= 10;`
            );
            for (const market of markets) {
                await this.start({ ...market, type: "history", timeframes: [1440, 720, 480, 240, 120, 60, 30] });
            }
        } catch (error) {
            this.log.error(error);
            throw error;
        }
    }
}
