use crate::robot::Candle;

#[allow(non_snake_case)]
pub mod SMA;

pub trait BaseIndicator {
  fn calc(&mut self, candles: &Vec<Candle>) -> Option<f64>;
}
