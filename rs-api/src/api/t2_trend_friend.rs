use crate::robot::strategy::t2_trend_friend::{
  T2TrendFriendStrategyParams, T2TrendFriendStrategyState,
};
use crate::robot::strategy::*;
use crate::robot::*;
use napi::bindgen_prelude::*;

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
    robot_state: RobotState,
  ) -> Self {
    T2TrendFriendRobot {
      robot: Robot::new(
        settings,
        robot_state,
        StrategyParams::T2TrendFriend(strategy_params),
        StrategyState::T2TrendFriend(strategy_state),
      ),
    }
  }

  #[napi]
  pub async fn run(&mut self, candles: Vec<Candle>) -> Result<T2TrendFriendStrategyState> {
    let state = self.robot.run(candles);

    match state {
      Ok(state) => match state {
        StrategyState::T2TrendFriend(state) => Ok(state),
        _ => panic!("Invalid strategy state"),
      },
      Err(err) => Err(Error::new(Status::GenericFailure, err.to_string())), //TODO: better error handling
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
