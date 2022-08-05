use crate::robot::strategy::t2_trend_friend::T2TrendFriendStrategyState;
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
  pub fn new(timeframe: u32, strategy_state: T2TrendFriendStrategyState) -> Self {
    T2TrendFriendRobot {
      robot: Robot::new(
        timeframe,
        StrategyType::T2TrendFriend,
        StrategyState::T2TrendFriend(strategy_state),
      ),
    }
  }

  #[napi]
  pub fn run(&mut self) -> T2TrendFriendStrategyState {
    let state = self.robot.run();
    match state {
      StrategyState::T2TrendFriend(state) => state,
      _ => panic!("Invalid strategy state"),
    }
  }

  #[napi(getter)]
  pub fn timeframe(&self) -> u32 {
    self.robot.timeframe()
  }

  #[napi(getter)]
  pub fn strategy_type(&self) -> strategy::StrategyType {
    self.robot.strategy_type()
  }

  #[napi(getter)]
  pub fn state(&self) -> T2TrendFriendStrategyState {
    match self.robot.state() {
      StrategyState::T2TrendFriend(state) => state,
      _ => panic!("Invalid strategy state"),
    }
  }
}
