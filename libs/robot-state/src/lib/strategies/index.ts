import { BaseStrategy } from "../BaseStrategy";
import { Breakout } from "./breakout";
import { Breakoutv2 } from "./breakout_v2";
import { Channels } from "./channels";
import { CounterCandle } from "./counter_candle";
import { DoubleReverseMM } from "./double_reverse_mm";
import { FXCash } from "./fx_cash";
import { IRSTS } from "./irsts";
import { Parabolic } from "./parabolic";
import { T2TF } from "./t2_trend_friend";
import { TrendlineLong } from "./trendline_long";

export const strategies: { [key: string]: typeof BaseStrategy } = {
    breakout: Breakout,
    breakout_v2: Breakoutv2,
    channels: Channels,
    counter_candle: CounterCandle,
    double_reverse_mm: DoubleReverseMM,
    fx_cash: FXCash,
    irsts: IRSTS,
    parabolic: Parabolic,
    t2_trend_friend: T2TF,
    trendline_long: TrendlineLong
};
