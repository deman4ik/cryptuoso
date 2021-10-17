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
    UserRobotConfirmTradeJob
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
import { calcBalancePercent, calcCurrencyDynamic } from "@cryptuoso/robot-settings";
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

    get getUserRobotState() {
        return this.#getUserRobotState;
    }

    #getUserRobotState = async (userRobotId: string) => {
        const rawData = await this.db.pg.one<UserRobotStateExt>(sql`
    SELECT * FROM v_user_robot_state WHERE id = ${userRobotId};                   
  `); //TODO: fields

        return keysToCamelCase(rawData) as UserRobotStateExt;
    };

    #getCurrentSettings = ({
        settings,
        currentPrice,
        totalBalanceUsd,
        userPortfolioId,
        userPortfolio: { type: userPortfolioType, settings: userPortfolioSettings },
        limits,
        precision,
        userRobotSettings //TODO: deprecate
    }: UserRobotStateExt): UserRobotDB["settings"] => {
        let volume: number;
        let volumeInCurrency: number;
        let balance;

        if (userPortfolioId) {
            if (userPortfolioType === "signals") balance = userPortfolioSettings.initialBalance;
            else balance = totalBalanceUsd;
            if (userPortfolioSettings.tradingAmountType === "balancePercent") {
                const currentPortfolioBalance = (userPortfolioSettings.balancePercent / 100) * balance;

                ({ volume, volumeInCurrency } = calcBalancePercent(
                    settings.share,
                    currentPortfolioBalance,
                    currentPrice
                ));
            } else if (userPortfolioSettings.tradingAmountType === "currencyFixed") {
                ({ volume, volumeInCurrency } = calcBalancePercent(
                    settings.share,
                    userPortfolioSettings.tradingAmountCurrency,
                    currentPrice
                ));
            }
            if (userPortfolioSettings.leverage) {
                volume = roundFirstSignificant(volume * userPortfolioSettings.leverage);
            }
        } else {
            //TODO: deprecate

            if (userRobotSettings.volumeType === "assetStatic") {
                volume = userRobotSettings.volume;
            } else if (userRobotSettings.volumeType === "currencyDynamic") {
                const { volumeInCurrency } = userRobotSettings;
                volume = calcCurrencyDynamic(volumeInCurrency, currentPrice);
            } else if (userRobotSettings.volumeType === "balancePercent") {
                const { balancePercent } = userRobotSettings;

                ({ volume } = calcBalancePercent(balancePercent, totalBalanceUsd, currentPrice));
            } else throw new BaseError("Unknown volume type", userRobotSettings);
        }

        if (volume < limits.min.amount) {
            volume = limits.min.amount;
            volumeInCurrency = limits.min.amountUSD;
        } else if (limits.max?.amount && volume > limits.max?.amount) {
            volume = limits.max?.amount;
            volumeInCurrency = limits.max.amountUSD;
        }

        if (volumeInCurrency < 7) {
            volumeInCurrency = 7;
            volume = calcCurrencyDynamic(volumeInCurrency, currentPrice);
        }

        if (volume > 100) {
            volume = round(volume);
            volumeInCurrency = round(volume * currentPrice, 2);
        }

        if (userPortfolioId) {
            if (balance < volumeInCurrency) throw new Error("Exchange account balance is insufficient");
        }

        return { ...settings, volume: round(volume, precision?.amount || 6) };
    };

    #savePositions = async (transaction: DatabaseTransactionConnectionType, positions: UserPositionDB[]) => {
        for (const p of positions) {
            this.log.info(p);
            await transaction.query(sql`
            INSERT INTO user_positions
      ( id, prefix, code,
        position_code, position_id,
        user_robot_id, user_portfolio_id, user_id,
        exchange, asset, currency,
        status, parent_id, direction,
        entry_status, entry_action, entry_signal_price,
        entry_price, entry_date, entry_candle_timestamp,
        entry_volume, entry_executed, entry_remaining,
        exit_status, exit_action, exit_signal_price,
        exit_price, exit_date, exit_candle_timestamp,
        exit_volume, exit_executed, exit_remaining,
        internal_state, reason, profit, bars_held,
        next_job_at, next_job, emulated, meta
         ) 
         VALUES (
             ${p.id}, ${p.prefix}, ${p.code}, 
             ${p.positionCode}, ${p.positionId || null},
             ${p.userRobotId}, ${p.userPortfolioId}, ${p.userId},
             ${p.exchange}, ${p.asset}, ${p.currency},
             ${p.status}, ${p.parentId || null}, ${p.direction},
             ${p.entryStatus || null}, ${p.entryAction || null}, ${p.entrySignalPrice || null},
             ${p.entryPrice || null}, ${p.entryDate || null}, ${p.entryCandleTimestamp || null},
             ${p.entryVolume || null}, ${p.entryExecuted || null}, ${p.entryRemaining || null},
             ${p.exitStatus || null}, ${p.exitAction || null}, ${p.exitSignalPrice || null},
             ${p.exitPrice || null}, ${p.exitDate || null}, ${p.exitCandleTimestamp || null},
             ${p.exitVolume || null}, ${p.exitExecuted || null}, ${p.exitRemaining || null},
             ${JSON.stringify(p.internalState) || null}, ${p.reason || null},
             ${p.profit || null}, ${p.barsHeld || null},
             ${p.nextJobAt || null}, ${p.nextJob || null},
             ${p.emulated || false}, ${JSON.stringify(p.meta)}
         )
          ON CONFLICT ON CONSTRAINT user_positions_pkey 
          DO UPDATE SET updated_at = now(),
          status = excluded.status,
          entry_status = excluded.entry_status,
          entry_action = excluded.entry_action,
          entry_signal_price = excluded.entry_signal_price,
          entry_price = excluded.entry_price,
          entry_date = excluded.entry_date,
          entry_candle_timestamp = excluded.entry_candle_timestamp,
          entry_volume = excluded.entry_volume,
          entry_executed = excluded.entry_executed,
          entry_remaining = excluded.entry_remaining,
          exit_status = excluded.exit_status,
          exit_action = excluded.exit_action,
          exit_signal_price = excluded.exit_signal_price,
          exit_price = excluded.exit_price,
          exit_date = excluded.exit_date,
          exit_candle_timestamp = excluded.exit_candle_timestamp,
          exit_volume = excluded.exit_volume,
          exit_executed = excluded.exit_executed,
          exit_remaining = excluded.exit_remaining,
          internal_state = excluded.internal_state,
          reason = excluded.reason,
          profit = excluded.profit,
          bars_held = excluded.bars_held,
          next_job_at = excluded.next_job_at,
          next_job = excluded.next_job,
          meta = excluded.meta;
            `);
        }
    };

    #saveOrders = async (transaction: DatabaseTransactionConnectionType, orders: Order[]) => {
        for (const order of orders) {
            this.log.info(order);
            await transaction.query(sql`
            INSERT INTO user_orders
            (
                id, user_ex_acc_id, user_robot_id, 
                position_id, user_position_id,
                prev_order_id,
                exchange, asset, currency,
                action, direction, type,
                signal_price, price, 
                volume, status, 
                ex_id, ex_timestamp, ex_last_trade_at,
                remaining, executed, fee, 
                last_checked_at, params,
                error, next_job
            ) VALUES (
                ${order.id}, ${order.userExAccId}, ${order.userRobotId},
                ${order.positionId || null}, ${order.userPositionId},
                ${order.prevOrderId || null},
                ${order.exchange}, ${order.asset}, ${order.currency},
                ${order.action}, ${order.direction}, ${order.type}, 
                ${order.signalPrice || null}, ${order.price || null},
                ${order.volume}, ${order.status},
                ${order.exId || null}, ${order.exTimestamp || null}, ${order.exLastTradeAt || null},
                ${order.remaining || null}, ${order.executed || null}, ${order.fee || null},
                ${order.lastCheckedAt || null}, ${JSON.stringify(order.params) || null},
                ${order.error || null}, ${JSON.stringify(order.nextJob) || null}
            );
            `);
        }
    };

    #saveState = async (transaction: DatabaseTransactionConnectionType, state: UserRobotDB) => {
        this.log.info(state);
        await transaction.query(sql`
            UPDATE user_robots
               SET internal_state = ${JSON.stringify(state.internalState) || null},
                   status = ${state.status},
                   started_at = ${state.startedAt || null},
                   stopped_at = ${state.stoppedAt || null},
                   message = ${state.message || null}
             WHERE id = ${state.id};
        `);
    };
    async run(job: UserRobotJob): Promise<UserRobotStatus> {
        const { id, userRobotId, type, data } = job;
        this.log.info(`User robot #${userRobotId} - Processing ${type} job`);

        try {
            const userRobotState = await this.#getUserRobotState(userRobotId);

            const settings = await this.#getCurrentSettings(userRobotState);

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
            } else if (type === UserRobotJobType.confirmTrade) {
                if (userRobot.state.settings.emulated) userRobot.confirmTrade(data as UserRobotConfirmTradeJob);
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
                    await this.#savePositions(t, userRobot.positions);

                    if (userRobot.ordersToCreate.length) {
                        await this.#saveOrders(t, userRobot.ordersToCreate);
                    }
                }

                await this.#saveState(t, userRobot.state);

                await t.query(sql`DELETE FROM user_robot_jobs WHERE id = ${job.id};`);
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
