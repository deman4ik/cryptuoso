use super::Candle;
use super::*;
use chrono::prelude::*;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq)]
pub struct Position {
  id: Uuid,
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
  alerts: Vec<Signal>,
  trades: Vec<Signal>,
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
      id: Uuid::new_v4(),
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
      trades: Vec::new(),
      internal: PositionInternal {
        highest_high: None,
        lowest_low: None,
        stop: None,
      },
    }
  }

  pub fn handle_candle(&mut self, candle: &Option<Candle>) {
    self.candle = candle.clone();
    if self.status == PositionStatus::Open {
      self.internal.highest_high = match self.internal.highest_high {
        Some(highest_high) => {
          if self.candle.as_ref().unwrap().high > highest_high {
            Some(self.candle.as_ref().unwrap().high)
          } else {
            Some(highest_high)
          }
        }
        None => Some(self.candle.as_ref().unwrap().high),
      };
      self.internal.lowest_low = match self.internal.lowest_low {
        Some(lowest_low) => {
          if self.candle.as_ref().unwrap().low < lowest_low {
            Some(self.candle.as_ref().unwrap().low)
          } else {
            Some(lowest_low)
          }
        }
        None => Some(self.candle.as_ref().unwrap().low),
      };
    }
  }

  pub fn get_prefix(&self) -> &String {
    &self.prefix
  }

  pub fn get_code(&self) -> &String {
    &self.code
  }

  pub fn get_parent_id(&self) -> &Option<String> {
    &self.parent_id
  }

  pub fn get_direction(&self) -> &Option<PositionDirection> {
    &self.direction
  }

  pub fn get_status(&self) -> &PositionStatus {
    &self.status
  }

  pub fn get_alerts(&self) -> &Vec<Signal> {
    &self.alerts
  }

  pub fn get_trades(&self) -> &Vec<Signal> {
    &self.trades
  }

  pub fn get_candle(&self) -> Result<&Candle, String> {
    match self.candle {
      Some(ref candle) => Ok(candle),
      None => Err(String::from("No candle found")),
    }
  }

  pub fn get_candle_timestamp(&self) -> Result<DateTime<Utc>, String> {
    match self.candle {
      Some(ref candle) => Ok(candle.timestamp.parse::<DateTime<Utc>>().unwrap()),
      None => Err("No candle".to_string()),
    }
  }

  pub fn is_active(&self) -> bool {
    self.status == PositionStatus::New || self.status == PositionStatus::Open
  }

  pub fn is_long(&self) -> bool {
    self.direction == Some(PositionDirection::Long)
  }

  pub fn is_short(&self) -> bool {
    self.direction == Some(PositionDirection::Short)
  }

  fn check_open(&self) -> Result<(), String> {
    if self.entry_status == Some(PositionStatus::Closed) {
      return Err("Position is already open".to_string());
    }
    Ok(())
  }

  fn check_close(&self) -> Result<(), String> {
    if self.entry_status != Some(PositionStatus::Closed) {
      return Err("Position is not open".to_string());
    } else if self.exit_status == Some(PositionStatus::Closed) {
      return Err("Position is already closed".to_string());
    }
    Ok(())
  }

  pub fn open(&mut self, alert: Signal) -> Result<(), String> {
    self.check_open()?;
    self.status = PositionStatus::Open;
    self.entry_status = Some(PositionStatus::Closed);
    self.entry_price = Some(alert.price.clone());
    self.entry_date = match self.backtest {
      true => Some(self.get_candle_timestamp()?),
      false => Some(Utc::now()),
    };
    self.entry_order_type = Some(alert.order_type.clone());
    self.entry_action = Some(alert.action.clone());
    self.entry_candle_timestamp = Some(alert.candle_timestamp.clone());
    self.direction = match &alert.action {
      TradeAction::Long => Some(PositionDirection::Long),
      TradeAction::Short => Some(PositionDirection::Short),
      _ => return Err("Invalid entry action".to_string()),
    };
    self.add_trade(
      self.entry_action.as_ref().unwrap().clone(),
      self.entry_price.as_ref().unwrap().clone(),
      self.entry_order_type.as_ref().unwrap().clone(),
    )?;
    Ok(())
  }

  pub fn close(&mut self, alert: Signal) -> Result<(), String> {
    self.check_close()?;
    self.status = PositionStatus::Closed;
    self.exit_status = Some(PositionStatus::Closed);
    self.exit_price = Some(alert.price.clone());
    self.exit_date = match self.backtest {
      true => Some(self.get_candle_timestamp()?),
      false => Some(Utc::now()),
    };
    self.exit_order_type = Some(alert.order_type.clone());
    self.exit_action = Some(alert.action.clone());
    self.exit_candle_timestamp = Some(alert.candle_timestamp.clone());

    self.add_trade(
      self.exit_action.as_ref().unwrap().clone(),
      self.exit_price.as_ref().unwrap().clone(),
      self.exit_order_type.as_ref().unwrap().clone(),
    )?;
    Ok(())
  }

  pub fn clear_alerts(&mut self) {
    self.alerts.clear();
  }

  pub fn clear_trades(&mut self) {
    self.trades.clear();
  }

  fn add_alert(
    &mut self,
    action: TradeAction,
    price: f64,
    order_type: OrderType,
  ) -> Result<(), String> {
    self.alerts.push(Signal {
      signal_type: SignalType::Alert,
      action,
      order_type,
      price,
      candle_timestamp: self.get_candle_timestamp()?,
    });
    Ok(())
  }

  fn add_trade(
    &mut self,
    action: TradeAction,
    price: f64,
    order_type: OrderType,
  ) -> Result<(), String> {
    self.trades.push(Signal {
      signal_type: SignalType::Trade,
      action,
      order_type,
      price,
      candle_timestamp: self.get_candle_timestamp()?,
    });
    Ok(())
  }

  pub fn buy_at_market_price(&mut self, price: f64) -> Result<(), String> {
    self.check_open()?;
    self.add_alert(TradeAction::Long, price, OrderType::Market)?;
    Ok(())
  }

  pub fn buy_at_market(&mut self) -> Result<(), String> {
    self.buy_at_market_price(self.get_candle()?.close)?;
    Ok(())
  }

  pub fn sell_at_market_price(&mut self, price: f64) -> Result<(), String> {
    self.check_close()?;
    self.add_alert(TradeAction::CloseLong, price, OrderType::Market)?;
    Ok(())
  }

  pub fn sell_at_market(&mut self) -> Result<(), String> {
    self.sell_at_market_price(self.get_candle()?.close)?;
    Ok(())
  }

  pub fn short_at_market_price(&mut self, price: f64) -> Result<(), String> {
    self.check_open()?;
    self.add_alert(TradeAction::Short, price, OrderType::Market)?;
    Ok(())
  }

  pub fn short_at_market(&mut self) -> Result<(), String> {
    self.short_at_market_price(self.get_candle()?.close)?;
    Ok(())
  }

  pub fn cover_at_market_price(&mut self, price: f64) -> Result<(), String> {
    self.check_close()?;
    self.add_alert(TradeAction::CloseShort, price, OrderType::Market)?;
    Ok(())
  }

  pub fn cover_at_market(&mut self) -> Result<(), String> {
    self.cover_at_market_price(self.get_candle()?.close)?;
    Ok(())
  }

  pub fn buy_at_stop_price(&mut self, price: f64) -> Result<(), String> {
    self.check_open()?;
    self.add_alert(TradeAction::Long, price, OrderType::Stop)?;
    Ok(())
  }

  pub fn buy_at_stop(&mut self) -> Result<(), String> {
    self.buy_at_stop_price(self.get_candle()?.open)?;
    Ok(())
  }

  pub fn sell_at_stop_price(&mut self, price: f64) -> Result<(), String> {
    self.check_close()?;
    self.add_alert(TradeAction::CloseLong, price, OrderType::Stop)?;
    Ok(())
  }

  pub fn sell_at_stop(&mut self) -> Result<(), String> {
    self.sell_at_stop_price(self.get_candle()?.open)?;
    Ok(())
  }

  pub fn sell_at_trailing_stop_price(&mut self, price: f64) -> Result<(), String> {
    self.check_close()?;
    self.internal.stop = match self.internal.stop {
      Some(stop) => Some(stop.max(price)),
      None => Some(price),
    };
    self.add_alert(
      TradeAction::CloseLong,
      self.internal.stop.unwrap(),
      OrderType::Stop,
    )?;
    Ok(())
  }

  pub fn sell_at_trailing_stop(&mut self) -> Result<(), String> {
    self.sell_at_trailing_stop_price(self.get_candle()?.open)?;
    Ok(())
  }

  pub fn short_at_stop_price(&mut self, price: f64) -> Result<(), String> {
    self.check_open()?;
    self.add_alert(TradeAction::Short, price, OrderType::Stop)?;
    Ok(())
  }

  pub fn short_at_stop(&mut self) -> Result<(), String> {
    self.short_at_stop_price(self.get_candle()?.open)?;
    Ok(())
  }

  pub fn cover_at_stop_price(&mut self, price: f64) -> Result<(), String> {
    self.check_close()?;
    self.add_alert(TradeAction::CloseShort, price, OrderType::Stop)?;
    Ok(())
  }

  pub fn cover_at_stop(&mut self) -> Result<(), String> {
    self.cover_at_stop_price(self.get_candle()?.open)?;
    Ok(())
  }

  pub fn cover_at_trailing_stop_price(&mut self, price: f64) -> Result<(), String> {
    self.check_close()?;
    self.internal.stop = match self.internal.stop {
      Some(stop) => Some(stop.min(price)),
      None => Some(price),
    };
    self.add_alert(
      TradeAction::CloseShort,
      self.internal.stop.unwrap(),
      OrderType::Stop,
    )?;
    Ok(())
  }

  pub fn cover_at_trailing_stop(&mut self) -> Result<(), String> {
    self.cover_at_trailing_stop_price(self.get_candle()?.open)?;
    Ok(())
  }

  pub fn buy_at_limit_price(&mut self, price: f64) -> Result<(), String> {
    self.check_open()?;
    self.add_alert(TradeAction::Long, price, OrderType::Limit)?;
    Ok(())
  }

  pub fn buy_at_limit(&mut self) -> Result<(), String> {
    self.buy_at_limit_price(self.get_candle()?.open)?;
    Ok(())
  }

  pub fn sell_at_limit_price(&mut self, price: f64) -> Result<(), String> {
    self.check_close()?;
    self.add_alert(TradeAction::CloseLong, price, OrderType::Limit)?;
    Ok(())
  }

  pub fn sell_at_limit(&mut self) -> Result<(), String> {
    self.sell_at_limit_price(self.get_candle()?.open)?;
    Ok(())
  }

  pub fn short_at_limit_price(&mut self, price: f64) -> Result<(), String> {
    self.check_open()?;
    self.add_alert(TradeAction::Short, price, OrderType::Limit)?;
    Ok(())
  }

  pub fn short_at_limit(&mut self) -> Result<(), String> {
    self.short_at_limit_price(self.get_candle()?.open)?;
    Ok(())
  }

  pub fn cover_at_limit_price(&mut self, price: f64) -> Result<(), String> {
    self.check_close()?;
    self.add_alert(TradeAction::CloseShort, price, OrderType::Limit)?;
    Ok(())
  }

  pub fn cover_at_limit(&mut self) -> Result<(), String> {
    self.cover_at_limit_price(self.get_candle()?.open)?;
    Ok(())
  }

  pub fn check_alerts(&mut self) -> Result<(), String> {
    for alert in &self.alerts.iter().cloned().collect::<Vec<Signal>>() {
      let success = self.check_alert(&alert)?;
      if success {
        self.clear_alerts();
        break;
      }
    }
    Ok(())
  }

  fn check_alert(&mut self, alert: &Signal) -> Result<bool, String> {
    let next_price: Option<f64>;
    match alert.order_type {
      OrderType::Market => {
        next_price = self.check_market_alert(alert)?;
      }
      OrderType::Stop => {
        next_price = self.check_stop_alert(alert)?;
      }
      OrderType::Limit => {
        next_price = self.check_limit_alert(alert)?;
      }
    }
    match next_price {
      Some(price) => {
        let mut alert = alert.clone();
        alert.price = price;
        match alert.action {
          TradeAction::Long | TradeAction::Short => self.open(alert)?,
          TradeAction::CloseLong | TradeAction::CloseShort => self.close(alert)?,
        }
        Ok(true)
      }
      None => Ok(false),
    }
  }

  fn check_market_alert(&self, alert: &Signal) -> Result<Option<f64>, String> {
    match alert.action {
      TradeAction::Long | TradeAction::CloseShort => {
        if self.backtest == false {
          return Ok(Some(self.get_candle()?.close.max(alert.price)));
        } else {
          return Ok(Some(self.get_candle()?.open));
        }
      }
      TradeAction::Short | TradeAction::CloseLong => {
        if self.backtest == false {
          return Ok(Some(self.get_candle()?.close.min(alert.price)));
        } else {
          return Ok(Some(self.get_candle()?.open));
        }
      }
    }
  }

  fn check_stop_alert(&self, alert: &Signal) -> Result<Option<f64>, String> {
    match alert.action {
      TradeAction::Long | TradeAction::CloseShort => {
        if self.get_candle()?.high >= alert.price {
          if self.backtest == false {
            return Ok(Some(self.get_candle()?.close.max(alert.price)));
          } else {
            return Ok(Some(self.get_candle()?.open.max(alert.price)));
          }
        }
      }
      TradeAction::Short | TradeAction::CloseLong => {
        if self.get_candle()?.low <= alert.price {
          if self.backtest == false {
            return Ok(Some(self.get_candle()?.close.min(alert.price)));
          } else {
            return Ok(Some(self.get_candle()?.open.min(alert.price)));
          }
        }
      }
    }
    return Ok(None);
  }

  fn check_limit_alert(&self, alert: &Signal) -> Result<Option<f64>, String> {
    match alert.action {
      TradeAction::Long | TradeAction::CloseShort => {
        if self.get_candle()?.low <= alert.price {
          if self.backtest == false {
            return Ok(Some(self.get_candle()?.close.min(alert.price)));
          } else {
            return Ok(Some(self.get_candle()?.open.min(alert.price)));
          }
        }
      }
      TradeAction::Short | TradeAction::CloseLong => {
        if self.get_candle()?.high >= alert.price {
          if self.backtest == false {
            return Ok(Some(self.get_candle()?.close.max(alert.price)));
          } else {
            return Ok(Some(self.get_candle()?.open.max(alert.price)));
          }
        }
      }
    }

    return Ok(None);
  }

  pub fn from_state(
    position_state: PositionState,
    candle: &Option<Candle>,
    backtest: &bool,
  ) -> Position {
    Position {
      id: Uuid::parse_str(&position_state.id).unwrap(),
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
        .map(|alert| Signal::from_state(alert.clone()))
        .collect(),
      trades: Vec::new(),
      internal: PositionInternal {
        highest_high: position_state.internal_state.highest_high,
        lowest_low: position_state.internal_state.lowest_low,
        stop: position_state.internal_state.stop,
      },
    }
  }

  pub fn state(&self) -> PositionState {
    PositionState {
      id: self.id.to_string(),
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

  pub fn alerts_state(&self) -> Vec<SignalState> {
    self.alerts.iter().map(|alert| alert.state()).collect()
  }

  pub fn trades_state(&self) -> Vec<SignalState> {
    self.trades.iter().map(|trade| trade.state()).collect()
  }

  pub fn alert_events(&self) -> Vec<SignalEvent> {
    self
      .alerts
      .iter()
      .map(|alert| SignalEvent {
        id: Uuid::new_v4().to_string(),
        timestamp: match self.backtest {
          true => format!("{:?}", alert.candle_timestamp),
          false => format!("{:?}", Utc::now()),
        },
        position_id: self.id.to_string(),
        position_prefix: self.prefix.clone(),
        position_code: self.code.clone(),
        position_parent_id: self.parent_id.clone(),
        signal_type: alert.signal_type.to_str(),
        action: alert.action.to_str().unwrap(),
        order_type: alert.order_type.to_str().unwrap(),
        price: alert.price,
        candle_timestamp: format!("{:?}", alert.candle_timestamp),
      })
      .collect()
  }

  pub fn trade_events(&self) -> Vec<SignalEvent> {
    self
      .trades
      .iter()
      .map(|trade| SignalEvent {
        id: Uuid::new_v4().to_string(),
        timestamp: match self.backtest {
          true => format!("{:?}", trade.candle_timestamp),
          false => format!("{:?}", Utc::now()),
        },
        position_id: self.id.to_string(),
        position_prefix: self.prefix.clone(),
        position_code: self.code.clone(),
        position_parent_id: self.parent_id.clone(),
        signal_type: trade.signal_type.to_str(),
        action: trade.action.to_str().unwrap(),
        order_type: trade.order_type.to_str().unwrap(),
        price: trade.price,
        candle_timestamp: format!("{:?}", trade.candle_timestamp),
      })
      .collect()
  }
}

//TODO: tests !!!
