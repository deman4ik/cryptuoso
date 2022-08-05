use crate::robot::strategy::*;

#[napi(object)]
#[derive(Clone)]
pub struct DummyStrategyState {
  pub state: String,
}

pub struct Strategy {
  pub state: DummyStrategyState,
}

impl BaseStrategy for Strategy {
  type State = DummyStrategyState;

  fn new(state: Self::State) -> Self {
    Strategy { state: state }
  }

  fn run(&mut self) -> StrategyState {
    self.state.state = "dummy run completed".to_string();
    StrategyState::Breakout(self.state.clone())
  }

  fn state(&self) -> StrategyState {
    StrategyState::Breakout(self.state.clone())
  }
}
