import { getUnderlyingArrayBuffer, loadObjectBuffer } from "@bnaya/objectbuffer";
import logger from "@cryptuoso/logger";
import { Candle } from "@cryptuoso/market";
import { Robot, RobotState, RobotStatus } from "@cryptuoso/robot-state";
import { Transfer, TransferDescriptor } from "threads";

import { expose } from "threads/worker";
import { RobotStateBuffer } from "./service";
export const worker = {
    async runStrategy(stateBuf: TransferDescriptor<ArrayBuffer>) {
        try {
            if (stateBuf instanceof ArrayBuffer) {
                const robotState: RobotStateBuffer["robotState"] = loadObjectBuffer(stateBuf);

                const robot = new Robot(robotState.state);
                logger.debug(`Worker - ${robot.status} - ${JSON.stringify(robotState.positionsToSave)}`);
                robot.status = RobotStatus.paused;
                robotState.positionsToSave = [{ a: 1 }, { a: 2 }];
                robotState.eventsToSend = [];
                robotState.state = robot.robotState;
                return Transfer(getUnderlyingArrayBuffer(robotState));
            } else throw new Error("Unknown data from main thread");
        } catch (err) {
            logger.error("Worker error");
            logger.error(err);
            throw err;
        }
    }
};

export type RobotWorker = typeof worker;

expose(worker);
