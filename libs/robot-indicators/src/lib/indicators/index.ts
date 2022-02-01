import { BaseIndicator } from "../BaseIndicator";
import { ChannelADX } from "./channel_adx";
import { FXHighBand } from "./fx_high_band";
import { FXLowBand } from "./fx_low_band";
import { HighestADX } from "./highest_adx";
import { HighestHigh } from "./highest_high";
import { LowestLow } from "./lowest_low";
import { Peak } from "./peak";
import { Trough } from "./trough";

export const indicators: { [key: string]: typeof BaseIndicator } = {
    ["channel_adx"]: ChannelADX,
    ["fx_high_band"]: FXHighBand,
    ["fx_low_band"]: FXLowBand,
    ["highest_adx"]: HighestADX,
    ["highest_high"]: HighestHigh,
    ["lowest_low"]: LowestLow,
    ["peak"]: Peak,
    ["trough"]: Trough
};
