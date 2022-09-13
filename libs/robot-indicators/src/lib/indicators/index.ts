import { BaseIndicator } from "../BaseIndicator";
import { HighestADX } from "./highest_adx";
import { HighestHigh } from "./highest_high";
import { LowestLow } from "./lowest_low";
import { Peak } from "./peak";
import { Trough } from "./trough";

export const indicators: { [key: string]: typeof BaseIndicator } = {
    ["highest_adx"]: HighestADX,
    ["highest_high"]: HighestHigh,
    ["lowest_low"]: LowestLow,
    ["peak"]: Peak,
    ["trough"]: Trough
};
