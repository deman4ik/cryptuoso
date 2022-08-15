use std::error::Error;

use serde::Deserialize;

use self::position::state::PositionState;

pub mod indicator;
pub mod position;
pub mod strategy;

#[napi(object)]
#[derive(Clone)]
pub struct RobotSettings {
  pub exchange: String,
  pub timeframe: u16,
  pub strategy_settings: strategy::StrategySettings,
}

#[napi(object)]
#[derive(Clone)]
pub struct RobotState {
  pub position_last_num: Option<u32>,
  pub positions: Option<Vec<PositionState>>,
}

pub struct Robot {
  settings: RobotSettings,
  strategy: strategy::Strategy,
}

impl Robot {
  pub fn new(
    settings: RobotSettings,
    state: RobotState,
    strategy_params: strategy::StrategyParams,
    strategy_state: strategy::StrategyState,
  ) -> Self {
    let strategy_settings = settings.strategy_settings.clone();

    Robot {
      settings,
      strategy: strategy::Strategy::new(strategy_settings, strategy_params, strategy_state, state),
    }
  }

  pub fn run(&mut self, candles: Vec<Candle>) -> Result<strategy::StrategyState, Box<dyn Error>> {
    self.strategy.run(candles)
  }

  pub fn state(&self) -> strategy::StrategyState {
    self.strategy.state()
  }

  pub fn strategy_params(&self) -> strategy::StrategyParams {
    self.strategy.params()
  }

  pub fn settings(&self) -> RobotSettings {
    self.settings.clone()
  }
}

#[napi(object)]
#[derive(Debug, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candle {
  pub time: i64,
  pub timestamp: String,
  pub timeframe: u16,
  pub open: f64,
  pub high: f64,
  pub low: f64,
  pub close: f64,
  pub volume: f64,
}
