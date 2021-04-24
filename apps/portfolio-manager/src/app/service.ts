import { spawn, Worker as ThreadsWorker, Thread } from "threads";
import { Job } from "bullmq";
import { HTTPService, HTTPServiceConfig } from "@cryptuoso/service";
import { PortfolioWorker } from "./worker";
import { PortfolioBuilderJob, PortfolioDB, PortfolioOptions } from "@cryptuoso/portfolio-state";
import { UserRoles } from "@cryptuoso/user-state";
import { v4 as uuid } from "uuid";
import combinate from "combinate";
import { sql } from "@cryptuoso/postgres";

export type PortfolioManagerServiceConfig = HTTPServiceConfig;

export default class PortfolioManagerService extends HTTPService {
    constructor(config?: PortfolioManagerServiceConfig) {
        super(config);
        try {
            this.createRoutes({
                initPortfolios: {
                    inputSchema: {
                        exchange: "string"
                    },
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.initPortfolios.bind(this))
                },
                buildPortfolios: {
                    inputSchema: {
                        exchange: "string"
                    },
                    roles: [UserRoles.admin, UserRoles.manager],
                    handler: this.HTTPHandler.bind(this, this.buildPortfolios.bind(this))
                }
            });
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error("Error while constructing PortfolioManagerService", err);
        }
    }

    async onServiceStart(): Promise<void> {
        this.createWorker("portfolioBuilder", this.builder);
    }

    generateOptions() {
        const values = {
            diversification: [true, false],
            profit: [true, false],
            risk: [true, false],
            moneyManagement: [true, false],
            winRate: [true, false],
            efficiency: [true, false]
        };

        return combinate(values).slice(0, -1);
    }

    generateCode(options: PortfolioOptions) {
        return Object.entries(options)
            .filter(([, value]) => value)
            .map(([key]) => key)
            .sort()
            .join("+");
    }

    async initPortfolios({ exchange }: { exchange: string }) {
        const allOptions = this.generateOptions();
        const allPortfolios: PortfolioDB[] = allOptions.map((options) => ({
            id: uuid(),
            code: `${exchange}:${this.generateCode(options)}`,
            name: null,
            exchange,
            available: 5,
            settings: {
                options,
                minBalance: 0,
                initialBalance: 1000
            }
        }));
        await this.db.pg.query(sql`
                insert into portfolios
                (id, code, name, exchange, available, settings)
                SELECT *
                FROM ${sql.unnest(
                    this.db.util.prepareUnnest(
                        allPortfolios.map((p) => ({ ...p, settings: JSON.stringify(p.settings) })),
                        ["id", "code", "name", "exchange", "available", "settings"]
                    ),
                    ["uuid", "varchar", "varchar", "varchar", "int8", "jsonb"]
                )}
                ON CONFLICT ON CONSTRAINT portfolios_code_key
                DO UPDATE SET settings = excluded.settings;`);
        this.log.info(`Inited ${allPortfolios.length} ${exchange} portfolios`);
    }

    async buildPortfolios({ exchange }: { exchange: string }) {
        await this.addJob(
            "portfolioBuilder",
            "build",
            { exchange },
            {
                jobId: exchange,
                removeOnComplete: true,
                removeOnFail: 10
            }
        );
    }

    async builder(job: Job<PortfolioBuilderJob, boolean>) {
        try {
            const beacon = this.lightship.createBeacon();
            const portfolioWorker = await spawn<PortfolioWorker>(new ThreadsWorker("./worker"));
            this.log.info(`Processing job ${job.id}`);

            try {
                await portfolioWorker.init(job.data);
                await portfolioWorker.process();
                this.log.info(`Job ${job.id} processed`);
            } finally {
                await Thread.terminate(portfolioWorker);
                await beacon.die();
            }
        } catch (error) {
            this.log.error(error);
        }
    }
}
