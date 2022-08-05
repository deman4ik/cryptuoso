use dummy::{DummyStrategyState, Strategy as DummyStrategy};
use napi::bindgen_prelude::ToNapiValue;
use t2_trend_friend::{Strategy as T2TrendFriendStrategy, T2TrendFriendStrategyState};

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
  type State;

  fn new(state: Self::State) -> Self;
  fn run(&mut self) -> StrategyState;
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
  pub fn new(strategy_type: StrategyType, strategy_state: StrategyState) -> Self {
    let state = match strategy_state {
      StrategyState::T2TrendFriend(state) => state,
      _ => panic!("Strategy not implemented"),
    };

    match strategy_type {
      StrategyType::T2TrendFriend => Self::T2TrendFriend(T2TrendFriendStrategy::new(state)),
      _ => panic!("Strategy not implemented"),
    }
  }

  pub fn run(&mut self) -> StrategyState {
    match self {
      Self::Breakout(strategy) => strategy.run(),
      Self::BreakoutV2(strategy) => strategy.run(),
      Self::Channels(strategy) => strategy.run(),
      Self::CounterCandle(strategy) => strategy.run(),
      Self::DoubleReverseMM(strategy) => strategy.run(),
      Self::FxCash(strategy) => strategy.run(),
      Self::IRSTS(strategy) => strategy.run(),
      Self::Parabolic(strategy) => strategy.run(),
      Self::T2TrendFriend(strategy) => strategy.run(),
      Self::TrendlingLong(strategy) => strategy.run(),
      Self::TrendlingShort(strategy) => strategy.run(),
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
