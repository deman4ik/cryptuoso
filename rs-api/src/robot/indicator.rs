pub mod SMA;
use yata::prelude::*;

pub trait BaseIndicator {
  fn calc(&mut self, candles: &Vec<Candle>) -> Option<f64>;
}
