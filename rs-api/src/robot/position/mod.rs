pub mod manager;
pub mod state;

use chrono::prelude::*;
use state::*;

use super::Candle;

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
pub struct PositionInternal {
  highest_high: Option<f64>,
  lowest_low: Option<f64>,
  stop: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Position {
  backtest: bool,
  candle: Option<Candle>,
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
  internal: PositionInternal,
}

impl Position {
  pub fn new(
    prefix: &String,
    code: &String,
    parent_id: &Option<String>,
    candle: &Option<Candle>,
    backtest: &bool,
  ) -> Self {
    Position {
      backtest: backtest.clone(),
      candle: candle.clone(),
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
      internal: PositionInternal {
        highest_high: None,
        lowest_low: None,
        stop: None,
      },
    }
  }

  fn handle_candle(&mut self, candle: &Option<Candle>) {
    self.candle = candle.clone();
  }

  fn check_open(&self) -> Result<(), String> {
    if self.status == PositionStatus::Open {
      return Err("Position is already open".to_string());
    }
    Ok(())
  }

  fn check_close(&self) -> Result<(), String> {
    if self.status != PositionStatus::Open {
      return Err("Position is not open".to_string());
    } else if self.status == PositionStatus::Closed {
      return Err("Position is already closed".to_string());
    }
    Ok(())
  }

  pub fn clear_alerts(&mut self) {
    self.alerts.clear();
  }

  fn add_alert(&mut self, action: TradeAction, price: f64, order_type: OrderType) {
    self.alerts.push(Trade {
      action,
      order_type,
      price: Some(price),
      candle_timestamp: Utc::now(), //TODO: get candle timestamp
    });
  }

  pub fn buy_at_market_price(&mut self, price: f64) {
    self.check_open().expect("Position is already open"); //TODO: handle error
    self.add_alert(TradeAction::Long, price, OrderType::Market);
  }

  pub fn buy_at_market(&mut self) {
    self.buy_at_market_price(self.candle.as_ref().unwrap().close);
  }

  pub fn sell_at_market_price(&mut self, price: f64) {
    self.check_close().expect("Position is already closed"); //TODO: handle error
    self.add_alert(TradeAction::CloseLong, price, OrderType::Market);
  }

  pub fn sell_at_market(&mut self) {
    self.sell_at_market_price(self.candle.as_ref().unwrap().close);
  }

  pub fn short_at_market_price(&mut self, price: f64) {
    self.check_open().expect("Position is already open"); //TODO: handle error
    self.add_alert(TradeAction::Short, price, OrderType::Market);
  }

  pub fn short_at_market(&mut self) {
    self.short_at_market_price(self.candle.as_ref().unwrap().close);
  }

  pub fn cover_at_market_price(&mut self, price: f64) {
    self.check_close().expect("Position is already closed"); //TODO: handle error
    self.add_alert(TradeAction::CloseShort, price, OrderType::Market);
  }

  pub fn cover_at_market(&mut self) {
    self.cover_at_market_price(self.candle.as_ref().unwrap().close);
  }

  pub fn buy_at_stop_price(&mut self, price: f64) {
    self.check_open().expect("Position is already open"); //TODO: handle error
    self.add_alert(TradeAction::Long, price, OrderType::Stop);
  }

  pub fn buy_at_stop(&mut self) {
    self.buy_at_stop_price(self.candle.as_ref().unwrap().open);
  }

  pub fn sell_at_stop_price(&mut self, price: f64) {
    self.check_close().expect("Position is already closed"); //TODO: handle error
    self.add_alert(TradeAction::CloseLong, price, OrderType::Stop);
  }

  pub fn sell_at_stop(&mut self) {
    self.sell_at_stop_price(self.candle.as_ref().unwrap().open);
  }

  pub fn sell_at_trailing_stop_price(&mut self, price: f64) {
    self.check_close().expect("Position is already closed"); //TODO: handle error
    self.internal.stop = match self.internal.stop {
      Some(stop) => Some(stop.max(price)),
      None => Some(price),
    };
    self.add_alert(
      TradeAction::CloseLong,
      self.internal.stop.unwrap(),
      OrderType::Stop,
    );
  }

  pub fn sell_at_trailing_stop(&mut self) {
    self.sell_at_trailing_stop_price(self.candle.as_ref().unwrap().open);
  }

  pub fn short_at_stop_price(&mut self, price: f64) {
    self.check_open().expect("Position is already open"); //TODO: handle error
    self.add_alert(TradeAction::Short, price, OrderType::Stop);
  }

  pub fn short_at_stop(&mut self) {
    self.short_at_stop_price(self.candle.as_ref().unwrap().open);
  }

  pub fn cover_at_stop_price(&mut self, price: f64) {
    self.check_close().expect("Position is already closed"); //TODO: handle error
    self.add_alert(TradeAction::CloseShort, price, OrderType::Stop);
  }

  pub fn cover_at_stop(&mut self) {
    self.cover_at_stop_price(self.candle.as_ref().unwrap().open);
  }

  pub fn cover_at_trailing_stop_price(&mut self, price: f64) {
    self.check_close().expect("Position is already closed"); //TODO: handle error
    self.internal.stop = match self.internal.stop {
      Some(stop) => Some(stop.min(price)),
      None => Some(price),
    };
    self.add_alert(
      TradeAction::CloseShort,
      self.internal.stop.unwrap(),
      OrderType::Stop,
    );
  }

  pub fn cover_at_trailing_stop(&mut self) {
    self.cover_at_trailing_stop_price(self.candle.as_ref().unwrap().open);
  }

  pub fn buy_at_limit_price(&mut self, price: f64) {
    self.check_open().expect("Position is already open"); //TODO: handle error
    self.add_alert(TradeAction::Long, price, OrderType::Limit);
  }

  pub fn buy_at_limit(&mut self) {
    self.buy_at_limit_price(self.candle.as_ref().unwrap().open);
  }

  pub fn sell_at_limit_price(&mut self, price: f64) {
    self.check_close().expect("Position is already closed"); //TODO: handle error
    self.add_alert(TradeAction::CloseLong, price, OrderType::Limit);
  }

  pub fn sell_at_limit(&mut self) {
    self.sell_at_limit_price(self.candle.as_ref().unwrap().open);
  }

  pub fn short_at_limit_price(&mut self, price: f64) {
    self.check_open().expect("Position is already open"); //TODO: handle error
    self.add_alert(TradeAction::Short, price, OrderType::Limit);
  }

  pub fn short_at_limit(&mut self) {
    self.short_at_limit_price(self.candle.as_ref().unwrap().open);
  }

  pub fn cover_at_limit_price(&mut self, price: f64) {
    self.check_close().expect("Position is already closed"); //TODO: handle error
    self.add_alert(TradeAction::CloseShort, price, OrderType::Limit);
  }

  pub fn cover_at_limit(&mut self) {
    self.cover_at_limit_price(self.candle.as_ref().unwrap().open);
  }

  pub fn from_state(
    position_state: PositionState,
    candle: &Option<Candle>,
    backtest: &bool,
  ) -> Position {
    Position {
      backtest: backtest.clone(),
      candle: candle.clone(),
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
      internal: PositionInternal {
        highest_high: position_state.internal_state.highest_high,
        lowest_low: position_state.internal_state.lowest_low,
        stop: position_state.internal_state.stop,
      },
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
      internal_state: PositionInternalState {
        highest_high: self.internal.highest_high,
        lowest_low: self.internal.lowest_low,
        stop: self.internal.stop,
      },
    }
  }

  pub fn alerts_state(&self) -> Vec<TradeState> {
    self.alerts.iter().map(|alert| alert.state()).collect()
  }
}
