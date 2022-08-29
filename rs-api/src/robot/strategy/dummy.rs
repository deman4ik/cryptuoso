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

  fn handle_candles(&mut self, candles: Vec<Candle>) -> Result<(), String> {
    self.candles = match candles.len() {
      0 => return Err("candles is empty".into()),
      _ => Some(candles),
    };

    Ok(())
  }

  fn handle_candle(&mut self, candle: Candle) -> Result<(), String> {
    self.candles = self.candles.clone().map(|mut candles| {
      candles.remove(0);
      candles.push(candle.clone());
      candles
    }); //TODO: check length and timestamp

    self.positions.handle_candle(&candle);
    Ok(())
  }

  fn calc_indicators(&mut self) -> Result<(), Box<dyn Error>> {
    Ok(())
  }

  fn run_strategy(&mut self) -> Result<(), Box<dyn Error>> {
    Ok(())
  }

  fn run(&mut self) -> Result<(), Box<dyn Error>> {
    self.positions.clear_all();

    self.calc_indicators()?;

    self.run_strategy()?;

    self.positions.check_alerts()?;
    Ok(())
  }

  fn check(&mut self) -> Result<(), Box<dyn Error>> {
    self.positions.clear_closed_positions();
    self.positions.clear_trades();

    self.positions.check_alerts()?;
    Ok(())
  }

  fn strategy_state(&self) -> StrategyState {
    StrategyState::Breakout(self.state.clone())
  }

  fn robot_state(&self) -> RobotState {
    RobotState {
      position_last_num: Some(self.positions.position_last_num()),
      positions: Some(self.positions.positions_state()),
      alerts: Some(self.positions.alert_events()),
      trades: Some(self.positions.trade_events()),
    }
  }
}
