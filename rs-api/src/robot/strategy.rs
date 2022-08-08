use dummy::{DummyStrategyParams, DummyStrategyState, Strategy as DummyStrategy};
use napi::bindgen_prelude::ToNapiValue;
use t2_trend_friend::{
  Strategy as T2TrendFriendStrategy, T2TrendFriendStrategyParams, T2TrendFriendStrategyState,
};

use crate::robot::Candle;

pub mod dummy;
pub mod t2_trend_friend;

#[napi]
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

#[napi(object)]
#[derive(Clone, Copy)]
pub struct StrategySettings {
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

  fn new(settings: StrategySettings, params: Self::Params, state: Self::State) -> Self;
  fn calc_indicatos(&mut self);
  fn run_strategy(&mut self);
  fn run(&mut self, candles: Vec<Candle>) -> StrategyState;
  fn params(&self) -> StrategyParams;
  fn state(&self) -> StrategyState;
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
  ) -> Self {
    let state = match strategy_state {
      StrategyState::T2TrendFriend(state) => state,
      _ => panic!("Strategy not implemented"),
    };

    let params = match strategy_params {
      StrategyParams::T2TrendFriend(params) => params,
      _ => panic!("Strategy not implemented"),
    };

    match strategy_settings.strategy_type {
      StrategyType::T2TrendFriend => {
        Self::T2TrendFriend(T2TrendFriendStrategy::new(strategy_settings, params, state))
      }
      _ => panic!("Strategy not implemented"),
    }
  }

  pub fn run(&mut self, candles: Vec<Candle>) -> StrategyState {
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
}
