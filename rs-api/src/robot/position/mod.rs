pub mod state;

use std::collections::HashMap;

use chrono::prelude::*;
use state::*;

#[derive(Debug, Clone, PartialEq)]
pub struct Trade {
  action: TradeAction,
  order_type: OrderType,
  price: Option<f64>,
  candle_timestamp: DateTime<Utc>,
}

impl Trade {
  pub fn from_state(trade_state: TradeState) -> Trade {
    Trade {
      action: TradeAction::from_str(&Some(trade_state.action)).unwrap(),
      order_type: OrderType::from_str(&Some(trade_state.order_type)).unwrap(),
      price: trade_state.price,
      candle_timestamp: trade_state
        .candle_timestamp
        .parse::<DateTime<Utc>>()
        .unwrap(),
    }
  }
  pub fn state(&self) -> TradeState {
    TradeState {
      action: self.action.to_str().unwrap(),
      order_type: self.order_type.to_str().unwrap(),
      price: self.price,
      candle_timestamp: format!("{:?}", self.candle_timestamp),
    }
  }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Position {
  prefix: String,
  code: String,
  parent_id: Option<String>,
  direction: Option<PositionDirection>,
  status: PositionStatus,
  entry_status: Option<PositionStatus>,
  entry_price: Option<f64>,
  entry_date: Option<DateTime<Utc>>,
  entry_order_type: Option<OrderType>,
  entry_action: Option<TradeAction>,
  entry_candle_timestamp: Option<DateTime<Utc>>,
  exit_status: Option<PositionStatus>,
  exit_price: Option<f64>,
  exit_date: Option<DateTime<Utc>>,
  exit_order_type: Option<OrderType>,
  exit_action: Option<TradeAction>,
  exit_candle_timestamp: Option<DateTime<Utc>>,
  alerts: Vec<Trade>,
}

impl Position {
  pub fn new(prefix: &String, code: &String, parent_id: &Option<String>) -> Self {
    Position {
      prefix: prefix.clone(),
      code: code.clone(),
      parent_id: parent_id.clone(),
      direction: None,
      status: PositionStatus::New,
      entry_status: None,
      entry_price: None,
      entry_date: None,
      entry_order_type: None,
      entry_action: None,
      entry_candle_timestamp: None,
      exit_status: None,
      exit_price: None,
      exit_date: None,
      exit_order_type: None,
      exit_action: None,
      exit_candle_timestamp: None,
      alerts: Vec::new(),
    }
  }

  pub fn clear_alerts(&mut self) {
    self.alerts.clear();
  }

  pub fn from_state(position_state: PositionState) -> Position {
    Position {
      prefix: position_state.prefix,
      code: position_state.code,
      parent_id: position_state.parent_id,
      direction: PositionDirection::from_str(&position_state.direction),
      status: PositionStatus::from_str(&Some(position_state.status)).unwrap(),
      entry_status: PositionStatus::from_str(&position_state.entry_status),
      entry_price: position_state.entry_price,
      entry_date: match position_state.entry_date {
        Some(date) => Some(date.parse::<DateTime<Utc>>().unwrap()),
        None => None,
      },
      entry_order_type: OrderType::from_str(&position_state.entry_order_type),
      entry_action: TradeAction::entry_from_str(&position_state.entry_action),
      entry_candle_timestamp: match position_state.entry_candle_timestamp {
        Some(date) => Some(date.parse::<DateTime<Utc>>().unwrap()),
        None => None,
      },
      exit_status: PositionStatus::from_str(&position_state.exit_status),
      exit_price: position_state.exit_price,
      exit_date: match position_state.exit_date {
        Some(date) => Some(date.parse::<DateTime<Utc>>().unwrap()),
        None => None,
      },

      exit_order_type: OrderType::from_str(&position_state.exit_order_type),
      exit_action: TradeAction::exit_from_str(&position_state.exit_action),
      exit_candle_timestamp: match position_state.exit_candle_timestamp {
        Some(date) => Some(date.parse::<DateTime<Utc>>().unwrap()),
        None => None,
      },
      alerts: position_state
        .alerts
        .iter()
        .map(|alert| Trade::from_state(alert.clone()))
        .collect(),
    }
  }

  pub fn state(&self) -> PositionState {
    PositionState {
      prefix: self.prefix.clone(),
      code: self.code.clone(),
      parent_id: self.parent_id.clone(),
      direction: match &self.direction {
        Some(direction) => Some(direction.to_str().unwrap()),
        None => None,
      },
      status: self.status.to_str().unwrap(),
      entry_status: match &self.entry_status {
        Some(status) => status.to_str(),
        None => None,
      },
      entry_price: self.entry_price,
      entry_date: match &self.entry_date {
        Some(date) => Some(format!("{:?}", date)),
        None => None,
      },
      entry_order_type: match &self.entry_order_type {
        Some(order_type) => order_type.to_str(),
        None => None,
      },
      entry_action: match &self.entry_action {
        Some(action) => action.to_str(),
        None => None,
      },
      entry_candle_timestamp: match &self.entry_candle_timestamp {
        Some(date) => Some(format!("{:?}", date)),
        None => None,
      },
      exit_status: match &self.exit_status {
        Some(status) => status.to_str(),
        None => None,
      },
      exit_price: self.exit_price,
      exit_date: match self.exit_date {
        Some(date) => Some(format!("{:?}", date)),
        None => None,
      },
      exit_order_type: match &self.exit_order_type {
        Some(order_type) => order_type.to_str(),
        None => None,
      },

      exit_action: match &self.exit_action {
        Some(action) => action.to_str(),
        None => None,
      },
      exit_candle_timestamp: match &self.exit_candle_timestamp {
        Some(date) => Some(format!("{:?}", date)),
        None => None,
      },
      alerts: self.alerts.iter().map(|alert| alert.state()).collect(),
    }
  }

  pub fn alerts_state(&self) -> Vec<TradeState> {
    self.alerts.iter().map(|alert| alert.state()).collect()
  }
}

pub struct PositionManager {
  last_position_num: u32,
  positions: HashMap<String, Position>,
}

impl PositionManager {
  pub fn new(positions: &Option<Vec<PositionState>>, last_position_num: &Option<u32>) -> Self {
    let mut positions_map = HashMap::new();
    match positions {
      Some(positions) => {
        for position in positions {
          positions_map.insert(
            position.code.clone(),
            Position::from_state(position.clone()),
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
    }
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
      Position::new(&position_prefix, &position_code, &parent_id),
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
