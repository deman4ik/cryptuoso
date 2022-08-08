use crate::robot::strategy::*;

#[napi(object)]
#[derive(Clone)]
pub struct T2TrendFriendStrategyParams {
  pub sma1: u8,
  pub sma2: u8,
  pub sma3: u8,
  pub min_bars_to_hold: u8,
}

#[napi(object)]
#[derive(Clone)]
pub struct T2TrendFriendStrategyState {
  pub state: String,
}

pub struct Strategy {
  pub settings: StrategySettings,
  pub params: T2TrendFriendStrategyParams,
  pub state: T2TrendFriendStrategyState,
}

impl BaseStrategy for Strategy {
  type Params = T2TrendFriendStrategyParams;
  type State = T2TrendFriendStrategyState;

  fn new(settings: StrategySettings, params: Self::Params, state: Self::State) -> Self {
    Strategy {
      settings: settings,
      params: params,
      state: state,
    }
  }

  fn run(&mut self) -> StrategyState {
    self.state.state = "run completed".to_string();
    StrategyState::T2TrendFriend(self.state.clone())
  }

  fn params(&self) -> StrategyParams {
    StrategyParams::T2TrendFriend(self.params.clone())
  }

  fn state(&self) -> StrategyState {
    StrategyState::T2TrendFriend(self.state.clone())
  }
}
