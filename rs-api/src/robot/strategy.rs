use std::error::Error;

use dummy::{DummyStrategyParams, DummyStrategyState, Strategy as DummyStrategy};
use napi::bindgen_prelude::ToNapiValue;
use t2_trend_friend::{
  Strategy as T2TrendFriendStrategy, T2TrendFriendStrategyParams, T2TrendFriendStrategyState,
};

use crate::robot::Candle;

use super::{
  position::{
    state::{PositionState, TradeState},
    Position, PositionManager,
  },
  RobotState,
};

pub mod dummy;
pub mod t2_trend_friend;

#[derive(Clone, Debug)]
pub enum StrategyType {
  Breakout,
  BreakoutV2,
  Channels,
  CounterCandle,
  DoubleReverseMM,
  FxCash,
  IRSTS,
  Parabolic,
  T2TrendFriend,
  TrendlingLong,
  TrendlingShort,
}

impl StrategyType {
  pub fn from_str(s: &String) -> Self {
    match s.as_str() {
      "breakout" => StrategyType::Breakout,
      "breakout_v2" => StrategyType::BreakoutV2,
      "channels" => StrategyType::Channels,
      "counter_candle" => StrategyType::CounterCandle,
      "double_reverse_mm" => StrategyType::DoubleReverseMM,
      "fx_cash" => StrategyType::FxCash,
      "irsts" => StrategyType::IRSTS,
      "parabolic" => StrategyType::Parabolic,
      "t2_trend_friend" => StrategyType::T2TrendFriend,
      "trendling_long" => StrategyType::TrendlingLong,
      "trendling_short" => StrategyType::TrendlingShort,
      _ => panic!("Invalid strategy type"),
    }
  }

  pub fn as_str(&self) -> String {
    match self {
      StrategyType::Breakout => "breakout".to_string(),
      StrategyType::BreakoutV2 => "breakout_v2".to_string(),
      StrategyType::Channels => "channels".to_string(),
      StrategyType::CounterCandle => "counter_candle".to_string(),
      StrategyType::DoubleReverseMM => "double_reverse_mm".to_string(),
      StrategyType::FxCash => "fx_cash".to_string(),
      StrategyType::IRSTS => "irsts".to_string(),
      StrategyType::Parabolic => "parabolic".to_string(),
      StrategyType::T2TrendFriend => "t2_trend_friend".to_string(),
      StrategyType::TrendlingLong => "trendling_long".to_string(),
      StrategyType::TrendlingShort => "trendling_short".to_string(),
    }
  }
}

#[napi(object)]
#[derive(Clone)]
pub struct StrategySettings {
  #[napi(
    ts_type = "'breakout' | 'breakout_v2' | 'channels' | 'counter_candle' | 'double_reverse_mm' | 'fx_cash' | 'irsts' | 'parabolic' | 't2_trend_friend' | 'trendling_long' | 'trendling_short'"
  )]
  pub strategy_type: String,
  pub backtest: bool,
}

pub struct StrategyOwnSettings {
  pub strategy_type: StrategyType,
  pub backtest: bool,
}

pub enum StrategyParams {
  Breakout(DummyStrategyParams),
  BreakoutV2(DummyStrategyParams),
  Channels(DummyStrategyParams),
  CounterCandle(DummyStrategyParams),
  DoubleReverseMM(DummyStrategyParams),
  FxCash(DummyStrategyParams),
  IRSTS(DummyStrategyParams),
  Parabolic(DummyStrategyParams),
  T2TrendFriend(T2TrendFriendStrategyParams),
  TrendlingLong(DummyStrategyParams),
  TrendlingShort(DummyStrategyParams),
}

#[derive(Debug, PartialEq)]
pub enum StrategyState {
  Breakout(DummyStrategyState),
  BreakoutV2(DummyStrategyState),
  Channels(DummyStrategyState),
  CounterCandle(DummyStrategyState),
  DoubleReverseMM(DummyStrategyState),
  FxCash(DummyStrategyState),
  IRSTS(DummyStrategyState),
  Parabolic(DummyStrategyState),
  T2TrendFriend(T2TrendFriendStrategyState),
  TrendlingLong(DummyStrategyState),
  TrendlingShort(DummyStrategyState),
}

pub trait BaseStrategy {
  type Params;
  type State;

  fn new(
    settings: StrategyOwnSettings,
    params: Self::Params,
    state: Self::State,
    positions: PositionManager,
  ) -> Self;
  fn calc_indicatos(&mut self) -> Result<(), Box<dyn Error>>;
  fn run_strategy(&mut self) -> Result<(), Box<dyn Error>>;
  fn run(&mut self, candles: Vec<Candle>) -> Result<StrategyState, Box<dyn Error>>;
  fn params(&self) -> StrategyParams;
  fn state(&self) -> StrategyState;
  fn positions(&self) -> &PositionManager;
}

pub enum Strategy {
  Breakout(DummyStrategy),
  BreakoutV2(DummyStrategy),
  Channels(DummyStrategy),
  CounterCandle(DummyStrategy),
  DoubleReverseMM(DummyStrategy),
  FxCash(DummyStrategy),
  IRSTS(DummyStrategy),
  Parabolic(DummyStrategy),
  T2TrendFriend(T2TrendFriendStrategy),
  TrendlingLong(DummyStrategy),
  TrendlingShort(DummyStrategy),
}

impl Strategy {
  pub fn new(
    strategy_settings: StrategySettings,
    strategy_params: StrategyParams,
    strategy_state: StrategyState,
    robot_state: RobotState,
  ) -> Self {
    let state = match strategy_state {
      StrategyState::T2TrendFriend(state) => state,
      _ => panic!("Strategy not implemented"),
    };

    let params = match strategy_params {
      StrategyParams::T2TrendFriend(params) => params,
      _ => panic!("Strategy not implemented"),
    };
    let strategy_type = StrategyType::from_str(&strategy_settings.strategy_type);
    let strategy_own_settings = StrategyOwnSettings {
      strategy_type: strategy_type.clone(),
      backtest: strategy_settings.backtest,
    };
    match &strategy_type {
      StrategyType::T2TrendFriend => Self::T2TrendFriend(T2TrendFriendStrategy::new(
        strategy_own_settings,
        params,
        state,
        PositionManager::new(&robot_state.positions, &robot_state.position_last_num),
      )),
      _ => panic!("Strategy not implemented"),
    }
  }

  pub fn run(&mut self, candles: Vec<Candle>) -> Result<StrategyState, Box<dyn Error>> {
    match self {
      Self::Breakout(strategy) => strategy.run(candles),
      Self::BreakoutV2(strategy) => strategy.run(candles),
      Self::Channels(strategy) => strategy.run(candles),
      Self::CounterCandle(strategy) => strategy.run(candles),
      Self::DoubleReverseMM(strategy) => strategy.run(candles),
      Self::FxCash(strategy) => strategy.run(candles),
      Self::IRSTS(strategy) => strategy.run(candles),
      Self::Parabolic(strategy) => strategy.run(candles),
      Self::T2TrendFriend(strategy) => strategy.run(candles),
      Self::TrendlingLong(strategy) => strategy.run(candles),
      Self::TrendlingShort(strategy) => strategy.run(candles),
    }
  }

  pub fn params(&self) -> StrategyParams {
    match self {
      Self::Breakout(strategy) => strategy.params(),
      Self::BreakoutV2(strategy) => strategy.params(),
      Self::Channels(strategy) => strategy.params(),
      Self::CounterCandle(strategy) => strategy.params(),
      Self::DoubleReverseMM(strategy) => strategy.params(),
      Self::FxCash(strategy) => strategy.params(),
      Self::IRSTS(strategy) => strategy.params(),
      Self::Parabolic(strategy) => strategy.params(),
      Self::T2TrendFriend(strategy) => strategy.params(),
      Self::TrendlingLong(strategy) => strategy.params(),
      Self::TrendlingShort(strategy) => strategy.params(),
    }
  }

  pub fn state(&self) -> StrategyState {
    match self {
      Self::Breakout(strategy) => strategy.state(),
      Self::BreakoutV2(strategy) => strategy.state(),
      Self::Channels(strategy) => strategy.state(),
      Self::CounterCandle(strategy) => strategy.state(),
      Self::DoubleReverseMM(strategy) => strategy.state(),
      Self::FxCash(strategy) => strategy.state(),
      Self::IRSTS(strategy) => strategy.state(),
      Self::Parabolic(strategy) => strategy.state(),
      Self::T2TrendFriend(strategy) => strategy.state(),
      Self::TrendlingLong(strategy) => strategy.state(),
      Self::TrendlingShort(strategy) => strategy.state(),
    }
  }

  pub fn positions(&self) -> Vec<PositionState> {
    let positions = match self {
      Self::Breakout(strategy) => strategy.positions(),
      Self::BreakoutV2(strategy) => strategy.positions(),
      Self::Channels(strategy) => strategy.positions(),
      Self::CounterCandle(strategy) => strategy.positions(),
      Self::DoubleReverseMM(strategy) => strategy.positions(),
      Self::FxCash(strategy) => strategy.positions(),
      Self::IRSTS(strategy) => strategy.positions(),
      Self::Parabolic(strategy) => strategy.positions(),
      Self::T2TrendFriend(strategy) => strategy.positions(),
      Self::TrendlingLong(strategy) => strategy.positions(),
      Self::TrendlingShort(strategy) => strategy.positions(),
    };

    positions.positions_state()
  }

  pub fn alerts(&self) -> Vec<TradeState> {
    let positions = match self {
      Self::Breakout(strategy) => strategy.positions(),
      Self::BreakoutV2(strategy) => strategy.positions(),
      Self::Channels(strategy) => strategy.positions(),
      Self::CounterCandle(strategy) => strategy.positions(),
      Self::DoubleReverseMM(strategy) => strategy.positions(),
      Self::FxCash(strategy) => strategy.positions(),
      Self::IRSTS(strategy) => strategy.positions(),
      Self::Parabolic(strategy) => strategy.positions(),
      Self::T2TrendFriend(strategy) => strategy.positions(),
      Self::TrendlingLong(strategy) => strategy.positions(),
      Self::TrendlingShort(strategy) => strategy.positions(),
    };

    positions.alerts_state()
  }
}
