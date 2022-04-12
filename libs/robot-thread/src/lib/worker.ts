import { NewEvent } from "@cryptuoso/events";
import logger from "@cryptuoso/logger";
import { Candle } from "@cryptuoso/market";
import { Robot } from "@cryptuoso/robot-state";
import { RobotPositionState, RobotState } from "@cryptuoso/robot-types";

export interface RobotStateBuffer {
    state: RobotState;
    candles?: {
        time: number;
        timestamp: string;
        open: number;
        high: number;
        low: number;
        close: number;
    }[];
    positionsToSave?: RobotPositionState[];
    eventsToSend?: NewEvent<any>[];
}
export const worker = {
    async runStrategy(robotState: RobotStateBuffer) {
        try {
            const robot = new Robot(robotState.state);

            const candles = [...robotState.candles] as Candle[];
            robot.handleHistoryCandles(candles);
            const processed = robot.handleCandle(candles[candles.length - 1]);
            if (processed) {
                await robot.calcIndicators();
                robot.runStrategy();
                robot.finalize();
            }
            return {
                positionsToSave: [...robot.positionsToSave],
                eventsToSend: [...robot.eventsToSend],
                state: robot.robotState
            };
        } catch (err) {
            logger.error("Worker error");
            logger.error(err);
            throw err;
        }
    }
};

export type RobotWorker = typeof worker;
