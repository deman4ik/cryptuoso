use crate::robot::strategy::*;

#[napi(object)]
#[derive(Clone)]
pub struct T2TrendFriendStrategyState {
  pub state: String,
}

pub struct Strategy {
  pub state: T2TrendFriendStrategyState,
}

impl BaseStrategy for Strategy {
  type State = T2TrendFriendStrategyState;

  fn new(state: Self::State) -> Self {
    Strategy { state: state }
  }

  fn run(&mut self) -> StrategyState {
    self.state.state = "run completed".to_string();
    StrategyState::T2TrendFriend(self.state.clone())
  }

  fn state(&self) -> StrategyState {
    StrategyState::T2TrendFriend(self.state.clone())
  }
}
