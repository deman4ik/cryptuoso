use serde::Deserialize;
use std::fs::File;
use std::path::Path;
use yata::prelude::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandleInput {
  /// *Open* value of the candle
  pub open: f64,

  /// *High* value of the candle
  pub high: f64,

  /// *Low* value of the candle
  pub low: f64,

  /// *Close* value of the candle
  pub close: f64,

  /// *Volume* value of the candle
  pub volume: f64,
}

pub fn load_candles() -> Vec<Candle> {
  let json_file_path = Path::new("./candles.json"); //TODO: LOAD FROM SOME URL INSTEAD
  let file = File::open(json_file_path).expect("file not found");
  let candles: Vec<CandleInput> = serde_json::from_reader(file).expect("error while reading");
  candles
    .iter()
    .map(|c| Candle {
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    })
    .collect()
}
