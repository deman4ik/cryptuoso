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
  pub async fn run(&mut self, candles: Vec<Candle>) -> Result<()> {
    let result = self.robot.run(candles);

    match result {
      Ok(_) => Ok(()),
      Err(err) => Err(Error::new(Status::GenericFailure, err.to_string())), //TODO: better error handling
    }
  }

  #[napi]
  pub async fn check(&mut self, candle: Candle) -> Result<()> {
    let result = self.robot.check(candle);

    match result {
      Ok(_) => Ok(()),
      Err(err) => Err(Error::new(Status::GenericFailure, err.to_string())), //TODO: better error handling
    }
  }

  #[napi(getter)]
  pub fn settings(&self) -> RobotSettings {
    self.robot.settings()
  }

  #[napi(getter)]
  pub fn strategy_state(&self) -> T2TrendFriendStrategyState {
    match self.robot.strategy_state() {
      StrategyState::T2TrendFriend(state) => state,
      _ => panic!("Invalid strategy state"),
    }
  }

  #[napi(getter)]
  pub fn robot_state(&self) -> RobotState {
    self.robot.robot_state()
  }
}
