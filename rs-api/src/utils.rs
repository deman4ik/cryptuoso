use std::collections::HashMap;

use crate::robot::Candle;

pub fn round(value: f64) -> f64 {
  let mut value = value;
  value *= 100.0;
  value = value.round();
  value /= 100.0;
  value
} //TODO generic or something else

pub fn merge_indicator_results(
  from: &HashMap<String, Vec<Candle>>,
  candles: &Vec<Candle>,
) -> Vec<Candle> {
  let mut result_candles = candles.clone();
  for (name, indicator_results) in from {
    for (i, candle) in result_candles.iter_mut().enumerate() {
      let result = indicator_results[i].clone().get_indicator_result(name);

      match result {
        Some(result) => candle.add_inidicator_result(name, result),
        None => (),
      }
    }
  }
  result_candles
}
