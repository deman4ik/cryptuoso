pub mod indicator;
pub mod position;
pub mod strategy;

pub struct Robot {
  timeframe: u32,
  strategy_type: strategy::StrategyType,
  strategy: strategy::Strategy,
}

impl Robot {
  pub fn new(
    timeframe: u32,
    strategy_type: strategy::StrategyType,
    strategy_state: strategy::StrategyState,
  ) -> Self {
    Robot {
      timeframe,
      strategy_type,
      strategy: strategy::Strategy::new(strategy_type, strategy_state),
    }
  }

  pub fn run(&mut self) -> strategy::StrategyState {
    self.strategy.run()
  }

  pub fn state(&self) -> strategy::StrategyState {
    self.strategy.state()
  }

  pub fn timeframe(&self) -> u32 {
    self.timeframe
  }

  pub fn strategy_type(&self) -> strategy::StrategyType {
    self.strategy_type
  }
}
