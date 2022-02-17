import { sql } from "@cryptuoso/postgres";
import { BaseService, BaseServiceConfig } from "@cryptuoso/service";
import {
    Queues,
    UserRobotDB,
    UserRobotJob,
    UserRobotJobType,
    UserRobotStatus,
    UserRobot,
    UserPositionDB,
    UserRobotStateExt,
    UserPositionStatus,
    UserTradeEvent,
    saveUserRobotState,
    getUserRobotState,
    saveUserPositions,
    saveUserOrders
} from "@cryptuoso/user-robot-state";
import {
    UserRobotWorkerError,
    UserRobotWorkerEvents,
    UserRobotWorkerStatus,
    UserTradeEvents
} from "@cryptuoso/user-robot-events";
import { Job } from "bullmq";
import { Order, SignalEvent } from "@cryptuoso/market";
import { ConnectorRunnerEvents, OrdersStatusEvent } from "@cryptuoso/connector-events";
import { BaseError } from "@cryptuoso/errors";
import { NewEvent } from "@cryptuoso/events";
import { StatsCalcRunnerEvents } from "@cryptuoso/stats-calc-events";
import { DatabaseTransactionConnectionType } from "slonik";
import { calcBalancePercent, calcCurrencyDynamic, getCurrentUserRobotSettings } from "@cryptuoso/robot-settings";
import dayjs from "@cryptuoso/dayjs";
import { keysToCamelCase, round, roundFirstSignificant } from "@cryptuoso/helpers";
import { TradeStatsRunnerEvents, TradeStatsRunnerUserRobot } from "@cryptuoso/trade-stats-events";

export type UserRobotWorkerServiceConfig = BaseServiceConfig;

export default class UserRobotWorkerService extends BaseService {
    #jobRetries = 3;
    constructor(config?: UserRobotWorkerServiceConfig) {
        super(config);
        try {
            this.addOnStartHandler(this.onServiceStart);
        } catch (err) {
            this.log.error("Error while constructing UserRobotRunnerService", err);
        }
    }

    async onServiceStart() {
        this.createWorker(Queues.userRobot, this.process);
    }

    #getNextJob = (userRobotId: string): Promise<UserRobotJob> =>
        this.db.pg.maybeOne<UserRobotJob>(sql`
 SELECT id, user_robot_id, type, data, retries
  FROM user_robot_jobs
 WHERE user_robot_id = ${userRobotId}
   AND allocation = 'shared'
   AND (retries is null OR retries <= ${this.#jobRetries})
 ORDER BY created_at 
  LIMIT 1;  
 `);

    async process(job: Job) {
        const beacon = this.lightship.createBeacon();
        try {
            const userRobotId = job.id;
            let nextJob: UserRobotJob = await this.#getNextJob(userRobotId);

            if (nextJob) {
                while (nextJob) {
                    const status: UserRobotStatus = await this.run(nextJob);

                    if (status && status !== UserRobotStatus.stopped && status !== UserRobotStatus.paused) {
                        nextJob = await this.#getNextJob(userRobotId);
                    } else {
                        nextJob = null;
                    }
                }
            }
            return { result: "ok" };
        } catch (err) {
            this.log.error(`Error while processing job ${job.id}`, err);
            throw err;
        } finally {
            await beacon.die();
        }
    }

    async run(job: UserRobotJob): Promise<UserRobotStatus> {
        const { id, userRobotId, type, data } = job;
        this.log.info(`User robot #${userRobotId} - Processing ${type} job`);

        try {
            const userRobotState = await getUserRobotState(this.db.pg, userRobotId);

            const settings = getCurrentUserRobotSettings(userRobotState);

            const userRobot = new UserRobot({ ...userRobotState, settings });
            const eventsToSend: NewEvent<any>[] = [];
            if (type === UserRobotJobType.signal) {
                userRobot.handleSignal(data as SignalEvent);
            } else if (type === UserRobotJobType.order) {
                const order = data as OrdersStatusEvent;
                const position = await this.db.pg.maybeOne<{ id: string; status: UserPositionStatus }>(sql`
                SELECT id, status
                FROM user_positions 
                WHERE user_robot_id = ${userRobotId}
                and id = ${order.userPositionId}
                `);
                if (!position)
                    throw new BaseError(
                        "Position not found",
                        {
                            order,
                            userRobotId
                        },
                        "ERR_NOT_FOUND"
                    );
                if (
                    [UserPositionStatus.new, UserPositionStatus.open, UserPositionStatus.delayed].includes(
                        position.status
                    )
                )
                    userRobot.handleOrder(order);
            } else if (type === UserRobotJobType.stop) {
                if (userRobot.status === UserRobotStatus.stopped) return userRobot.status;
                userRobot.stop(data as { message?: string });
            } else if (type === UserRobotJobType.pause) {
                if (userRobot.status === UserRobotStatus.paused || userRobot.status === UserRobotStatus.stopped)
                    return userRobot.status;
                userRobot.pause(data as { message?: string });
                const pausedEvent: NewEvent<UserRobotWorkerStatus> = {
                    type: UserRobotWorkerEvents.PAUSED,
                    data: {
                        userRobotId,
                        timestamp: dayjs.utc().toISOString(),
                        status: UserRobotStatus.paused,
                        message: userRobot.message,
                        userPortfolioId: userRobotState.userPortfolioId
                    }
                };
                eventsToSend.push(pausedEvent);
            } else throw new BaseError(`Unknown user robot job type "${type}"`, job);

            if (
                (userRobot.status === UserRobotStatus.stopping || userRobot.state.settings?.active === false) &&
                !userRobot.hasActivePositions
            ) {
                userRobot.setStop();
                const stoppedEvent: NewEvent<UserRobotWorkerStatus> = {
                    type: UserRobotWorkerEvents.STOPPED,
                    data: {
                        userRobotId,
                        timestamp: userRobot.stoppedAt,
                        status: UserRobotStatus.stopped,
                        message: userRobot.message,
                        userPortfolioId: userRobotState.userPortfolioId
                    }
                };
                eventsToSend.push(stoppedEvent);
                this.log.info(`User Robot #${userRobot.id} stopped!`);
            }

            if (userRobot.positions.length) {
                if (userRobot.connectorJobs.length) {
                    for (const connectorJob of userRobot.connectorJobs) {
                        eventsToSend.push({
                            type: ConnectorRunnerEvents.ADD_JOB,
                            data: connectorJob
                        });
                    }
                }

                if (userRobot.hasCanceledPositions) {
                    this.log.error(`User Robot #${userRobot.id} has canceled positions!`);
                }

                if (userRobot.hasClosedPositions) {
                    this.log.info(
                        `User Robot #${userRobot.id} has closed positions, sending ${StatsCalcRunnerEvents.USER_ROBOT} event.`
                    );
                    // <StatsCalcRunnerUserRobot>
                    const statsCalcEvent: NewEvent<any> = {
                        type: StatsCalcRunnerEvents.USER_ROBOT,
                        data: {
                            userRobotId: userRobot.id
                        }
                    };
                    eventsToSend.push(statsCalcEvent);
                    //TODO: deprecate

                    if (userRobot.state.userPortfolioId) {
                        const tradeStatsEvent: NewEvent<TradeStatsRunnerUserRobot> = {
                            type: TradeStatsRunnerEvents.USER_ROBOT,
                            data: {
                                userRobotId: userRobot.id,
                                userPortfolioId: userRobotState.userPortfolioId
                            }
                        };
                        eventsToSend.push(tradeStatsEvent);
                    }
                }

                if (userRobot.recentTrades.length) {
                    for (const trade of userRobot.recentTrades) {
                        const tradeEvent: NewEvent<UserTradeEvent> = {
                            type: UserTradeEvents.TRADE,
                            data: trade
                        };
                        eventsToSend.push(tradeEvent);
                    }
                }
            }

            await this.db.pg.transaction(async (t) => {
                if (userRobot.positions.length) {
                    await saveUserPositions(t, userRobot.positions);

                    if (userRobot.ordersToCreate.length) {
                        await saveUserOrders(t, userRobot.ordersToCreate);
                    }
                }

                await saveUserRobotState(t, userRobot.state);

                if (userRobot.status === UserRobotStatus.stopped)
                    await t.query(sql`DELETE FROM user_robot_jobs WHERE user_robot_id = ${userRobotId};`);
                else await t.query(sql`DELETE FROM user_robot_jobs WHERE id = ${job.id};`);
            });

            if (eventsToSend.length) {
                for (const event of eventsToSend) {
                    await this.events.emit(event);
                }
            }

            return userRobot.status;
        } catch (err) {
            this.log.error(`Robot #${userRobotId} processing ${type} job #${id} error`, err);
            try {
                const retries = job.retries ? job.retries + 1 : 1;

                await this.db.pg.query(sql`
                    UPDATE user_robot_jobs
                    SET retries = ${retries}, 
                        error = ${err.message}
                    WHERE id = ${job.id};`);
            } catch (e) {
                this.log.error(`Failed to update user robot's #${userRobotId} failed job status`, e);
            }

            if (job.retries >= this.#jobRetries) {
                await this.events.emit<UserRobotWorkerError>({
                    type: UserRobotWorkerEvents.ERROR,
                    data: {
                        userRobotId,
                        timestamp: dayjs.utc().toISOString(),
                        error: err.message,
                        job
                    }
                });
                await this.db.pg.query(sql`
                UPDATE user_robots
                SET status = ${UserRobotStatus.paused}, 
                    message = ${err.message}
                WHERE id = ${job.userRobotId};`);
                await this.events.emit<UserRobotWorkerStatus>({
                    type: UserRobotWorkerEvents.PAUSED,
                    data: {
                        userRobotId,
                        timestamp: dayjs.utc().toISOString(),
                        status: UserRobotStatus.paused,
                        message: err.message
                    }
                });
            }
        }
    }
}
