pub mod manager;
pub mod position;
pub mod state;

use chrono::prelude::*;
use state::*;

use super::Candle;

#[derive(Debug, Clone, PartialEq)]
pub struct Signal {
  signal_type: SignalType,
  action: TradeAction,
  order_type: OrderType,
  price: f64,
  candle_timestamp: DateTime<Utc>,
}

impl Signal {
  pub fn from_state(signal_state: SignalState) -> Signal {
    Signal {
      signal_type: SignalType::from_str(&signal_state.signal_type),
      action: TradeAction::from_str(&Some(signal_state.action)).unwrap(),
      order_type: OrderType::from_str(&Some(signal_state.order_type)).unwrap(),
      price: signal_state.price,
      candle_timestamp: signal_state
        .candle_timestamp
        .parse::<DateTime<Utc>>()
        .unwrap(),
    }
  }
  pub fn state(&self) -> SignalState {
    SignalState {
      signal_type: self.signal_type.to_str(),
      action: self.action.to_str().unwrap(),
      order_type: self.order_type.to_str().unwrap(),
      price: self.price,
      candle_timestamp: format!("{:?}", self.candle_timestamp),
    }
  }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PositionInternal {
  highest_high: Option<f64>,
  lowest_low: Option<f64>,
  stop: Option<f64>,
}

//TODO: tests
