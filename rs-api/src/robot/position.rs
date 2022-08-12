pub mod state;

use chrono::prelude::*;
use state::*;

pub struct Trade {
  action: TradeAction,
  order_type: OrderType,
  price: Option<f64>,
  candle_timestamp: DateTime<Utc>,
}

impl Trade {
  fn from_TradeState(trade_state: TradeState) -> Trade {
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
  fn to_TradeState(&self) -> TradeState {
    TradeState {
      action: self.action.to_str().unwrap(),
      order_type: self.order_type.to_str().unwrap(),
      price: self.price,
      candle_timestamp: format!("{:?}", self.candle_timestamp),
    }
  }
}

pub struct Position {
  prefix: String,
  code: String,
  parent_id: Option<String>,
  direction: PositionDirection,
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
}

impl Position {
  fn from_PositionState(position_state: PositionState) -> Position {
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
    }
  }

  fn to_PositionState(&self) -> PositionState {
    PositionState {
      prefix: self.prefix.clone(),
      code: self.code.clone(),
      parent_id: self.parent_id.clone(),
      direction: self.direction.to_str(),
      status: self.status.to_str().unwrap(),
      entry_status: match self.entry_status {
        Some(status) => status.to_str(),
        None => None,
      },
      entry_price: self.entry_price,
      entry_date: match self.entry_date {
        Some(date) => Some(format!("{:?}", date)),
        None => None,
      },
      entry_order_type: match self.entry_order_type {
        Some(order_type) => order_type.to_str(),
        None => None,
      },
      entry_action: match self.entry_action {
        Some(action) => action.to_str(),
        None => None,
      },
      entry_candle_timestamp: match self.entry_candle_timestamp {
        Some(date) => Some(format!("{:?}", date)),
        None => None,
      },
      exit_status: match self.exit_status {
        Some(status) => status.to_str(),
        None => None,
      },
      exit_price: self.exit_price,
      exit_date: match self.exit_date {
        Some(date) => Some(format!("{:?}", date)),
        None => None,
      },
      exit_order_type: match self.exit_order_type {
        Some(order_type) => order_type.to_str(),
        None => None,
      },

      exit_action: match self.exit_action {
        Some(action) => action.to_str(),
        None => None,
      },
      exit_candle_timestamp: match self.exit_candle_timestamp {
        Some(date) => Some(format!("{:?}", date)),
        None => None,
      },
    }
  }
}
