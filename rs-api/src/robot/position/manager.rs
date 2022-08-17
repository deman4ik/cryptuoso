use std::collections::HashMap;

use super::position::*;
use super::state::*;
use super::*;

pub struct PositionManager {
  last_position_num: u32,
  positions: HashMap<String, Position>,
  candle: Option<Candle>,
  backtest: bool,
}

impl PositionManager {
  pub fn new(
    positions: &Option<Vec<PositionState>>,
    last_position_num: &Option<u32>,
    backtest: bool,
  ) -> Self {
    let mut positions_map = HashMap::new();
    match positions {
      Some(positions) => {
        for position in positions {
          positions_map.insert(
            position.code.clone(),
            Position::from_state(position.clone(), &None, &backtest),
          );
        }
      }
      None => (),
    }
    PositionManager {
      positions: positions_map,
      last_position_num: match last_position_num {
        Some(num) => num.clone(),
        None => 0,
      },
      candle: None,
      backtest,
    }
  }

  pub fn handle_candle(&mut self, candle: &Candle) {
    self.candle = Some(candle.clone());
    self
      .positions
      .values_mut()
      .for_each(|position: &mut Position| {
        position.handle_candle(&self.candle);
      });
  }

  pub fn create_position_ext(
    &mut self,
    preifx: Option<String>,
    parent_id: Option<String>,
  ) -> &mut Position {
    self.last_position_num += 1;

    let position_prefix = match preifx {
      Some(prefix) => prefix,
      None => "p".to_string(),
    };
    let position_code = format!("{}_{}", position_prefix, self.last_position_num);

    self.positions.insert(
      position_code.clone(),
      Position::new(
        &position_prefix,
        &position_code,
        &parent_id,
        &self.candle,
        &self.backtest,
      ),
    );

    self.positions.get_mut(&position_code).unwrap()
  }

  pub fn create(&mut self) -> &mut Position {
    self.create_position_ext(None, None)
  }

  pub fn has_active_position(&self) -> bool {
    self
      .positions
      .values()
      .any(|position| *position.get_prefix() == "p".to_string())
  }

  pub fn has_active_position_prefix(&self, prefix: &String) -> bool {
    self
      .positions
      .values()
      .any(|position| *position.get_prefix() == prefix.clone())
  }

  pub fn get_active_position(&mut self) -> Result<&mut Position, String> {
    match self
      .positions
      .values_mut()
      .find(|position| *position.get_prefix() == "p".to_string() && position.is_active())
    {
      Some(position) => Ok(position),
      None => Err("No active position".to_string()),
    }
  }

  pub fn clear_closed_positions(&mut self) {
    self
      .positions
      .retain(|_, position| *position.get_status() != PositionStatus::Closed);
  }

  pub fn clear_alerts(&mut self) {
    for position in self.positions.values_mut() {
      position.clear_alerts();
    }
  }

  pub fn clear_trades(&mut self) {
    for position in self.positions.values_mut() {
      position.clear_trades();
    }
  }

  pub fn check_alerts(&mut self) -> Result<(), String> {
    for position in self.positions.values_mut() {
      position.check_alerts()?;
    }
    Ok(())
  }

  pub fn positions_state(&self) -> Vec<PositionState> {
    self
      .positions
      .values()
      .map(|position| position.state())
      .collect()
  }

  pub fn alerts_state(&self) -> Vec<SignalState> {
    let mut alerts = Vec::new();
    for position in self.positions.values() {
      alerts.extend(position.alerts_state());
    }
    alerts
  }

  pub fn trades_state(&self) -> Vec<SignalState> {
    let mut trades = Vec::new();
    for position in self.positions.values() {
      trades.extend(position.trades_state());
    }
    trades
  }
}

//TODO: tests
