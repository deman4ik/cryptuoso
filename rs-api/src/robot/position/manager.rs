use std::collections::HashMap;

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

  pub fn create(&mut self, preifx: Option<String>, parent_id: Option<String>) -> &Position {
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

    self.positions.get(&position_code).unwrap()
  }

  pub fn has_active_position(&self) -> bool {
    self
      .positions
      .values()
      .any(|position| position.prefix == "p".to_string())
  }

  pub fn has_active_position_prefix(&self, prefix: &String) -> bool {
    self
      .positions
      .values()
      .any(|position| position.prefix == prefix.clone())
  }

  pub fn clear_closed_positions(&mut self) {
    self
      .positions
      .retain(|_, position| position.status != PositionStatus::Closed);
  }

  pub fn clear_alerts(&mut self) {
    for position in self.positions.values_mut() {
      position.clear_alerts();
    }
  }

  pub fn positions_state(&self) -> Vec<PositionState> {
    self
      .positions
      .values()
      .map(|position| position.state())
      .collect()
  }

  pub fn alerts_state(&self) -> Vec<TradeState> {
    let mut alerts = Vec::new();
    for position in self.positions.values() {
      alerts.extend(position.alerts_state());
    }
    alerts
  }
}
