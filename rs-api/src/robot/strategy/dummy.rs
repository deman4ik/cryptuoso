use std::error::Error;

use crate::robot::position::*;
use crate::robot::strategy::*;

#[napi(object)]
#[derive(Clone)]
pub struct DummyStrategyParams {
  pub min_bars_to_hold: u8,
}

#[napi(object)]
#[derive(Debug, Clone, PartialEq)]
pub struct DummyStrategyState {
  pub state: String,
}

pub struct Strategy {
  settings: StrategyOwnSettings,
  params: DummyStrategyParams,
  state: DummyStrategyState,
  positions: PositionManager,
}

impl BaseStrategy for Strategy {
  type Params = DummyStrategyParams;
  type State = DummyStrategyState;

  fn new(
    settings: StrategyOwnSettings,
    params: Self::Params,
    state: Self::State,
    positions: PositionManager,
  ) -> Self {
    Strategy {
      settings: settings,
      params: params,
      state: state,
      positions: positions,
    }
  }

  fn calc_indicatos(&mut self) -> Result<(), Box<dyn Error>> {
    Ok(())
  }

  fn run_strategy(&mut self) -> Result<(), Box<dyn Error>> {
    Ok(())
  }

  fn run(&mut self, _candles: Vec<Candle>) -> Result<StrategyState, Box<dyn Error>> {
    self.calc_indicatos();
    self.run_strategy();

    Ok(StrategyState::Breakout(self.state.clone()))
  }

  fn params(&self) -> StrategyParams {
    StrategyParams::Breakout(self.params.clone())
  }

  fn state(&self) -> StrategyState {
    StrategyState::Breakout(self.state.clone())
  }

  fn positions(&self) -> &PositionManager {
    &self.positions
  }
}
