use crate::robot::strategy::*;

#[napi(object)]
#[derive(Clone)]
pub struct DummyStrategyParams {
  pub min_bars_to_hold: u8,
}

#[napi(object)]
#[derive(Clone)]
pub struct DummyStrategyState {
  pub state: String,
}

pub struct Strategy {
  pub settings: StrategySettings,
  pub params: DummyStrategyParams,
  pub state: DummyStrategyState,
}

impl BaseStrategy for Strategy {
  type Params = DummyStrategyParams;
  type State = DummyStrategyState;

  fn new(settings: StrategySettings, params: Self::Params, state: Self::State) -> Self {
    Strategy {
      settings: settings,
      params: params,
      state: state,
    }
  }

  fn run(&mut self) -> StrategyState {
    self.state.state = "run completed".to_string();
    StrategyState::Breakout(self.state.clone())
  }

  fn params(&self) -> StrategyParams {
    StrategyParams::Breakout(self.params.clone())
  }

  fn state(&self) -> StrategyState {
    StrategyState::Breakout(self.state.clone())
  }
}
