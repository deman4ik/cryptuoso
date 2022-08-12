use super::*;
use chrono::prelude::*;
use napi::bindgen_prelude::ToNapiValue;

#[napi]
pub enum PositionDirection {
  Long,
  Short,
}

impl PositionDirection {
  pub fn from_str(s: &String) -> PositionDirection {
    match s.as_str() {
      "long" => PositionDirection::Long,
      "short" => PositionDirection::Short,
      _ => panic!("Invalid PositionDirection: {}", s),
    }
  }

  pub fn to_str(&self) -> String {
    match self {
      PositionDirection::Long => "long".to_string(),
      PositionDirection::Short => "short".to_string(),
    }
  }
}

#[napi]
pub enum PositionStatus {
  New,
  Open,
  Closed,
}

impl PositionStatus {
  pub fn from_str(s: &Option<String>) -> Option<PositionStatus> {
    match s {
      Some(some) => match some.as_str() {
        "new" => Some(PositionStatus::New),
        "open" => Some(PositionStatus::Open),
        "closed" => Some(PositionStatus::Closed),
        _ => None,
      },
      None => None,
    }
  }

  pub fn to_str(&self) -> Option<String> {
    match self {
      PositionStatus::New => Some("new".to_string()),
      PositionStatus::Open => Some("open".to_string()),
      PositionStatus::Closed => Some("closed".to_string()),
    }
  }
}

#[napi]
pub enum OrderType {
  Market,
  Limit,
  Stop,
}

impl OrderType {
  pub fn from_str(s: &Option<String>) -> Option<OrderType> {
    match s {
      Some(some) => match some.as_str() {
        "market" => Some(OrderType::Market),
        "limit" => Some(OrderType::Limit),
        "stop" => Some(OrderType::Stop),
        _ => None,
      },
      None => None,
    }
  }
  pub fn to_str(&self) -> Option<String> {
    match self {
      OrderType::Market => Some("market".to_string()),
      OrderType::Limit => Some("limit".to_string()),
      OrderType::Stop => Some("stop".to_string()),
    }
  }
}

#[napi]
pub enum OrderDirection {
  Buy,
  Sell,
}

impl OrderDirection {
  pub fn from_str(s: &String) -> OrderDirection {
    match s.as_str() {
      "buy" => OrderDirection::Buy,
      "sell" => OrderDirection::Sell,
      _ => panic!("Invalid order direction: {}", s),
    }
  }
  pub fn to_str(&self) -> String {
    match self {
      OrderDirection::Buy => "buy".to_string(),
      OrderDirection::Sell => "sell".to_string(),
    }
  }
}

#[napi]
pub enum TradeAction {
  Long,
  Short,
  CloseLong,
  CloseShort,
}

impl TradeAction {
  pub fn from_str(s: &Option<String>) -> Option<TradeAction> {
    match s {
      Some(some) => match some.as_str() {
        "long" => Some(TradeAction::Long),
        "short" => Some(TradeAction::Short),
        "closeLong" => Some(TradeAction::CloseLong),
        "closeShort" => Some(TradeAction::CloseShort),
        _ => None,
      },
      None => None,
    }
  }

  pub fn entry_from_str(s: &Option<String>) -> Option<TradeAction> {
    match s {
      Some(some) => match some.as_str() {
        "long" => Some(TradeAction::Long),
        "short" => Some(TradeAction::Short),
        _ => None,
      },
      None => None,
    }
  }

  pub fn exit_from_str(s: &Option<String>) -> Option<TradeAction> {
    match s {
      Some(some) => match some.as_str() {
        "closeLong" => Some(TradeAction::CloseLong),
        "closeShort" => Some(TradeAction::CloseShort),
        _ => None,
      },
      None => None,
    }
  }

  pub fn to_str(&self) -> Option<String> {
    match self {
      TradeAction::Long => Some("long".to_string()),
      TradeAction::Short => Some("short".to_string()),
      TradeAction::CloseLong => Some("closeLong".to_string()),
      TradeAction::CloseShort => Some("closeShort".to_string()),
    }
  }
}

#[napi]
pub enum SignalType {
  Alert,
  Trade,
}

impl SignalType {
  pub fn from_str(s: &String) -> SignalType {
    match s.as_str() {
      "alert" => SignalType::Alert,
      "trade" => SignalType::Trade,
      _ => panic!("Invalid signal type: {}", s),
    }
  }
  pub fn to_str(&self) -> String {
    match self {
      SignalType::Alert => "alert".to_string(),
      SignalType::Trade => "trade".to_string(),
    }
  }
}

#[napi(object)]
pub struct TradeState {
  #[napi(ts_type = "'long' | 'short' | 'closeLong' | 'closeShort'")]
  pub action: String,
  #[napi(ts_type = "'market' | 'limit' | 'stop'")]
  pub order_type: String,
  pub price: Option<f64>,
  pub candle_timestamp: String,
}

#[napi(object)]
pub struct PositionState {
  pub prefix: String,
  pub code: String,
  pub parent_id: Option<String>,
  #[napi(ts_type = "'long' | 'short'")]
  pub direction: String,
  #[napi(ts_type = "'new' | 'open' | 'closed'")]
  pub status: String,
  #[napi(ts_type = "'new' | 'open' | 'closed' | undefined")]
  pub entry_status: Option<String>,
  pub entry_price: Option<f64>,
  pub entry_date: Option<String>,
  #[napi(ts_type = "'market' | 'limit' | 'stop'")]
  pub entry_order_type: Option<String>,
  #[napi(ts_type = "'long' | 'short'")]
  pub entry_action: Option<String>,
  pub entry_candle_timestamp: Option<String>,
  #[napi(ts_type = "'new' | 'open' | 'closed' | undefined")]
  pub exit_status: Option<String>,
  pub exit_price: Option<f64>,
  pub exit_date: Option<String>,
  #[napi(ts_type = "'market' | 'limit' | 'stop'")]
  pub exit_order_type: Option<String>,
  #[napi(ts_type = "'closeLong' | 'closeShort'")]
  pub exit_action: Option<String>,
  pub exit_candle_timestamp: Option<String>,
}
