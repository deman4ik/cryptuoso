import { sql } from "@cryptuoso/postgres";
import { Exwatcher, ExwatcherStatus, RobotBaseService, RobotBaseServiceConfig } from "@cryptuoso/robot";
import { UserPortfolioState } from "@cryptuoso/portfolio-state";
import { ExchangeCandle, SignalEvent } from "@cryptuoso/market";
import { UserRobot, UserRobotStateExt } from "@cryptuoso/user-robot-state";
import { Robot, RobotState, RobotStatus } from "@cryptuoso/robot-state";
import { keysToCamelCase } from "@cryptuoso/helpers";
import { getCurrentUserRobotSettings } from "@cryptuoso/robot-settings";

export interface UserRobotBaseServiceConfig extends RobotBaseServiceConfig {
    userPortfolioId: string;
}

export class UserRobotBaseService extends RobotBaseService {
    #userPortfolioId: string;

    #userPortfolio: UserPortfolioState;

    robots: {
        [id: string]: { robot: Robot; userRobot: UserRobot; locked: boolean };
    } = {};

    constructor(config: UserRobotBaseServiceConfig) {
        super(config);

        this.#userPortfolioId = config.userPortfolioId || process.env.USER_PORTFOLIO_ID;

        //TODO: handle portfolio builded event

        this.addOnStartedHandler(this.onUserServiceStarted);
    }

    async onUserServiceStarted() {
        //TODO: init user connector
    }

    async getExwatcherSubscriptions(): Promise<Exwatcher[]> {
        const markets = await this.db.pg.any<{ asset: string; currency: string }>(sql`
        SELECT DISTINCT r.asset, r.currency 
        FROM user_robots ur, robots r
        WHERE ur.robot_id = r.id
        AND ur.status = 'started'
        AND ur.user_portfolio_id = ${this.#userPortfolioId};`);

        return markets.map((m) => ({
            ...m,
            id: this.createExwatcherId(m.asset, m.currency),
            exchange: this.exchange,
            status: ExwatcherStatus.pending,
            importerId: null,
            importStartedAt: null,
            error: null
        }));
    }

    async saveSubscription(subscription: Exwatcher): Promise<void> {
        return;
    }

    async deleteSubscription(id: string): Promise<void> {
        return;
    }

    saveCandles(candles: ExchangeCandle[]) {
        for (const { ...props } of candles) {
            this.saveCandlesHistory({ ...props });
        }
    }

    async getUserPortfolio() {
        const userPortfolio = await this.db.pg.one<UserPortfolioState>(sql`
        SELECT  p.id, p.type, p.user_id, p.user_ex_acc_id, p.exchange, p.status, 
                p.started_at,
              p.active_from as user_portfolio_settings_active_from,
              p.user_portfolio_settings as settings,
              p.robots 
           FROM v_user_portfolios p
           WHERE p.id = ${this.#userPortfolioId}; 
       `);

        if (userPortfolio.type !== "dedicated")
            throw new Error(`User Portfolios #${this.#userPortfolioId} type must be 'dedicated'`);

        if (userPortfolio.exchange !== this.exchange)
            throw new Error(
                `User Portfolios #${this.#userPortfolioId} exchange (${
                    userPortfolio.exchange
                }) is not service exchange (${this.exchange})`
            );

        if (userPortfolio.userId !== this.userId)
            throw new Error(
                `User Portfolios #${this.#userPortfolioId} user (${userPortfolio.userId}) is not service user (${
                    this.userId
                })`
            );

        this.#userPortfolio = userPortfolio;
    }

    async subscribeRobots({ asset, currency }: Exwatcher) {
        if (!this.#userPortfolio) await this.getUserPortfolio();

        const rawData = await this.db.pg.any<UserRobotStateExt>(sql`
        SELECT * FROM v_user_robot_state WHERE status = 'started'
         AND user_portfolio_id = ${this.#userPortfolioId}
         AND asset = ${asset}
         AND currency = ${currency};                   
      `);

        const userRobots = keysToCamelCase(rawData) as UserRobotStateExt[];

        await Promise.all(
            userRobots.map(async (userRobot) => {
                if (!this.robots[userRobot.robotId]) {
                    await this.subscribeUserRobot(userRobot);
                }
            })
        );
    }

    async subscribeUserRobot(userRobot: UserRobotStateExt) {
        const { robotId } = userRobot;
        try {
            const userRobotSettings = getCurrentUserRobotSettings(userRobot);

            this.robots[robotId] = {
                robot: null,
                userRobot: new UserRobot({ ...userRobot, settings: userRobotSettings }),
                locked: true
            };

            if (!userRobot.robotState || !Object.keys(userRobot.robotState).length) {
                const robotState = await this.db.pg.one<RobotState>(sql`
        SELECT r.id, 
               r.exchange, 
               r.asset, 
               r.currency, 
               r.timeframe, 
               r.strategy, 
               json_build_object('strategySettings', rs.strategy_settings,
                                 'robotSettings', rs.robot_settings,
                                 'activeFrom', rs.active_from) as settings,
               r.last_candle, 
               r.state, 
               r.has_alerts, 
               r.status,
               r.started_at, 
               r.stopped_at
        FROM robots r, v_robot_settings rs 
        WHERE rs.robot_id = r.id AND r.exchange = ${this.exchange}
        AND r.id = ${robotId};`);

                this.robots[robotId].robot = new Robot({
                    id: robotState.id,
                    exchange: robotState.exchange,
                    asset: robotState.asset,
                    currency: robotState.currency,
                    timeframe: robotState.timeframe,
                    strategy: robotState.strategy,
                    settings: {
                        strategySettings: robotState.settings.strategySettings,
                        robotSettings: robotState.settings.robotSettings,
                        activeFrom: robotState.settings.activeFrom
                    }
                });
                this.robots[robotId].robot.setStrategyState();
                this.robots[robotId].robot.initStrategy();
                this.robots[robotId].robot.setIndicatorsState();
                this.robots[robotId].robot.initIndicators();
            } else {
                this.robots[robotId].robot = new Robot(userRobot.robotState);
            }

            this.getActiveRobotAlerts(robotId);
            if (this.robots[robotId].robot.status !== RobotStatus.started) {
                this.robots[robotId].robot.start();
            }
            this.robots[robotId].locked = false;
            this.log.info(`Robot #${robotId} is subscribed!`);
        } catch (err) {
            this.log.error(`Failed to subscribe #${robotId} robot ${err.message}`);
            throw err;
        }
    }

    async handleSignal(signal: SignalEvent) {
        const userRobot = this.robots[signal.robotId].userRobot;

        userRobot.handleSignal(signal);

        //TODO: handle orders and save state
    }
}
