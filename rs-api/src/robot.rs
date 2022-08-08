pub mod indicator;
pub mod position;
pub mod strategy;

#[napi(object)]
#[derive(Clone)]
pub struct RobotSettings {
  pub exchange: String,
  pub timeframe: u32,
  pub strategy_settings: strategy::StrategySettings,
}

pub struct Robot {
  settings: RobotSettings,
  strategy: strategy::Strategy,
}

impl Robot {
  pub fn new(
    settings: RobotSettings,
    strategy_params: strategy::StrategyParams,
    strategy_state: strategy::StrategyState,
  ) -> Self {
    let strategy_settings = settings.strategy_settings.clone();

    Robot {
      settings,
      strategy: strategy::Strategy::new(strategy_settings, strategy_params, strategy_state),
    }
  }

  pub fn run(&mut self) -> strategy::StrategyState {
    self.strategy.run()
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
