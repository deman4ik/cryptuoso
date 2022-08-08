use crate::robot::strategy::t2_trend_friend::{
  T2TrendFriendStrategyParams, T2TrendFriendStrategyState,
};
use crate::robot::strategy::*;
use crate::robot::*;

#[napi]
#[allow(dead_code)]
struct T2TrendFriendRobot {
  robot: Robot,
}

#[napi]
#[allow(dead_code)]
impl T2TrendFriendRobot {
  #[napi(constructor)]
  pub fn new(
    settings: RobotSettings,
    strategy_params: T2TrendFriendStrategyParams,
    strategy_state: T2TrendFriendStrategyState,
  ) -> Self {
    T2TrendFriendRobot {
      robot: Robot::new(
        settings,
        StrategyParams::T2TrendFriend(strategy_params),
        StrategyState::T2TrendFriend(strategy_state),
      ),
    }
  }

  #[napi]
  pub fn run(&mut self, candles: Vec<Candle>) -> T2TrendFriendStrategyState {
    let state = self.robot.run(candles);
    match state {
      StrategyState::T2TrendFriend(state) => state,
      _ => panic!("Invalid strategy state"),
    }
  }

  #[napi(getter)]
  pub fn settings(&self) -> RobotSettings {
    self.robot.settings()
  }

  #[napi(getter)]
  pub fn strategy_params(&self) -> T2TrendFriendStrategyParams {
    match self.robot.strategy_params() {
      StrategyParams::T2TrendFriend(params) => params,
      _ => panic!("Invalid strategy params"),
    }
  }

  #[napi(getter)]
  pub fn state(&self) -> T2TrendFriendStrategyState {
    match self.robot.state() {
      StrategyState::T2TrendFriend(state) => state,
      _ => panic!("Invalid strategy state"),
    }
  }
}
