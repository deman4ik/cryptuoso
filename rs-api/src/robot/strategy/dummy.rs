use std::error::Error;

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

#[allow(dead_code)]
pub struct Strategy {
  settings: StrategyOwnSettings,
  params: DummyStrategyParams,
  state: DummyStrategyState,
  positions: PositionManager,
  candles: Option<Vec<Candle>>,
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
      candles: None,
    }
  }

  fn get_candle(&self) -> Result<Candle, String> {
    match &self.candles {
      Some(candles) => {
        if candles.len() > 0 {
          match candles.last() {
            Some(candle) => Ok(candle.clone()),
            None => Err("No candles".to_string()),
          }
        } else {
          Err("No candles".to_string())
        }
      }
      None => Err("No candles".to_string()),
    }
  }

  fn calc_indicatos(&mut self) -> Result<(), Box<dyn Error>> {
    Ok(())
  }

  fn run_strategy(&mut self) -> Result<(), Box<dyn Error>> {
    Ok(())
  }

  fn run(&mut self, _candles: Vec<Candle>) -> Result<StrategyState, Box<dyn Error>> {
    self.calc_indicatos()?;
    self.run_strategy()?;

    Ok(StrategyState::Breakout(self.state.clone()))
  }

  fn check(&mut self, candle: Candle) -> Result<StrategyState, Box<dyn Error>> {
    self.positions.handle_candle(&candle);

    self.positions.check_alerts()?;
    Ok(self.state())
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
