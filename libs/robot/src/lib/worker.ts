import { loadObjectBuffer } from "@bnaya/objectbuffer";
import logger from "@cryptuoso/logger";
import { Candle } from "@cryptuoso/market";
import { Robot, RobotState } from "@cryptuoso/robot-state";
import { Transfer, TransferDescriptor } from "threads";
import { RobotStateBuffer } from "./robotBaseService";

export const worker = {
    async runStrategy(stateBuf: TransferDescriptor<ArrayBuffer>) {
        try {
            if (stateBuf instanceof ArrayBuffer) {
                const robotState: RobotStateBuffer = loadObjectBuffer(stateBuf);

                const robot = new Robot(robotState.state);
                robot.setStrategyState();
                robot.setIndicatorsState();
                const candles = [...robotState.candles] as Candle[];
                robot.handleHistoryCandles(candles);
                const processed = robot.handleCandle(candles[candles.length - 1]);
                if (processed) {
                    await robot.calcIndicators();
                    robot.runStrategy();
                    robot.finalize();
                }
                robotState.positionsToSave = [...robot.positionsToSave];
                robotState.eventsToSend = [...robot.eventsToSend];
                robotState.state = robot.robotState;
                return Transfer(stateBuf);
            } else throw new Error("Unknown data from main thread");
        } catch (err) {
            logger.error("Worker error");
            logger.error(err);
            throw err;
        }
    }
};

export type RobotWorker = typeof worker;
