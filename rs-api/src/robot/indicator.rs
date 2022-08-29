use crate::robot::Candle;

#[allow(non_snake_case)]
pub mod SMA;

pub trait BaseIndicator {
  fn calc(&mut self, candle: &Candle) -> Option<f64>;
}
