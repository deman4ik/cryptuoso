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

export type UserRobotRunnerServiceConfig = BaseServiceConfig;

export default class UserRobotRunnerService extends BaseService {
    #jobRetries = 3;
    constructor(config?: UserRobotRunnerServiceConfig) {
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
    SELECT ur.id,
           ur.user_ex_acc_id,
           ur.user_id,
           ur.user_portfolio_id,
           ur.robot_id,
           ur.internal_state,
           ur.status,
           ur.started_at,
           ur.stopped_at,
           ur.message,
           r.exchange,
           r.asset,
           r.currency,
           r.timeframe,
           m.current_price,
           m.limits->'userRobot' as limits,
           m.precision,
           ea.total_balance_usd,
           st.net_profit as profit,
           m.trade_settings,
           urs.user_robot_settings, //TODO: deprecate
           ur.settings,
           json_build_object('type',  up.type,
           'status'. up.status,
           'settings', ups.user_portfolio_settings) as user_portfolio
           (SELECT array_to_json(array_agg(pos))
FROM
(SELECT p.id,
    p.position_id,
    p.user_robot_id,
    p.user_portfolio_id,
    p.parent_id,
    p.direction,
    p.entry_status,
    p.entry_price,
    to_char(p.entry_date::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as entry_date,
    p.exit_status,
    p.exit_price,
    to_char(p.exit_date::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as exit_date,
    p.exit_volume,
    p.reason,
    p.profit,
    p.bars_held,
    to_char(p.created_at::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
    to_char(p.updated_at::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at,
    p.internal_state,
    p.prefix,
    p.code,
    to_char(p.next_job_at::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as next_job_at,
    p.next_job,
    p.entry_executed,
    p.entry_remaining,
    p.exit_executed,
    p.exit_remaining,
    p.entry_signal_price,
    p.exit_signal_price,
    p.status,
    p.entry_volume,
    p.position_code,
    p.exchange,
    p.asset,
    p.currency,
    p.user_id,
    p.entry_action,
    p.exit_action,
    to_char(p.entry_candle_timestamp::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as entry_candle_timestamp,
    to_char(p.exit_candle_timestamp::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as exit_candle_timestamp,
    p.emulated,
  (SELECT array_to_json(array_agg(eo))
   FROM
     (SELECT o.id,
    o.user_ex_acc_id,
    o.user_robot_id,
    o.position_id,
    o.user_position_id,
    o.exchange,
    o.asset,
    o.currency,
    o.action,
    o.direction,
    o.type,
    o.signal_price,
    o.price,
    o.volume,
    o.status,
    o.ex_id,
    to_char(o.ex_timestamp::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ex_timestamp,
    to_char(o.ex_last_trade_at::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ex_last_trade_at,
    o.remaining,
    o.executed,
    to_char(o.last_checked_at::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as last_checked_at,
    o.params,
    to_char(o.created_at::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
    to_char(o.updated_at::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at,
    o.next_job,
    o.fee,
    o.error
      FROM user_orders o
      WHERE o.user_position_id = p.id
        AND (o.action = 'long'
             OR o.action = 'short') order by o.created_at asc) eo) AS entry_orders,
  (SELECT array_to_json(array_agg(eo))
   FROM
     (SELECT o.id,
    o.user_ex_acc_id,
    o.user_robot_id,
    o.position_id,
    o.user_position_id,
    o.exchange,
    o.asset,
    o.currency,
    o.action,
    o.direction,
    o.type,
    o.signal_price,
    o.price,
    o.volume,
    o.status,
    o.ex_id,
    to_char(o.ex_timestamp::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ex_timestamp,
    to_char(o.ex_last_trade_at::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ex_last_trade_at,
    o.remaining,
    o.executed,
    to_char(o.last_checked_at::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as last_checked_at,
    o.params,
    to_char(o.created_at::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
    to_char(o.updated_at::timestamp without time zone at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at,
    o.next_job,
    o.fee,
    o.error
      FROM user_orders o
      WHERE o.user_position_id = p.id
        AND (o.action = 'closeLong'
             OR o.action = 'closeShort') order by o.created_at asc) eo) AS exit_orders
FROM user_positions p
WHERE p.user_robot_id =${userRobotId}
  AND p.status IN ('delayed',
                   'new',
                   'open')) pos) AS positions
    FROM user_robots ur, robots r, 
    v_user_markets m, 
    v_user_amounts a, v_user_exchange_accs ea
    LEFT JOIN v_user_robot_stats st
    ON st.user_robot_id = ${userRobotId}
    LEFT JOIN v_user_robot_settings urs
    ON urs.user_robot_id = ${userRobotId}
    LEFT JOIN user_portfolios up
    ON up.id = ur.user_portfolio_id
    LEFT JOIN v_user_portfolio_settings ups
    ON ups.user_portfolio_id = ur.user_portfolio_id
    WHERE ur.robot_id = r.id  
      AND m.exchange = r.exchange
      AND m.asset = r.asset
      AND m.currency = r.currency
      AND m.user_id = ur.user_id    
      AND a.user_ex_acc_id = ur.user_ex_acc_id
      AND ea.id = ur.user_ex_acc_id
      AND ur.id = ${userRobotId};                   
  `);

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
            else balance = totalBalanceUsd; //? или тоже initialBalance
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
        next_job_at, next_job, emulated
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
             ${p.emulated || false}
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
          next_job = excluded.next_job;
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
            this.log.info(userRobotState);
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
                        message: userRobot.message
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
                        message: userRobot.message
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
                                userRobotId: userRobot.id
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
            }
        }
    }
}
