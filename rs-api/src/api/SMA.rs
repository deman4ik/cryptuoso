use crate::robot::Candle;
use napi::bindgen_prelude::*;
use yata::prelude::*;

#[napi]
#[allow(dead_code)]
struct SmaIndicator {
  indicator: yata::methods::SMA,
  result: Option<f64>,
}

#[napi]
#[allow(dead_code)]
impl SmaIndicator {
  #[napi(constructor)]
  pub fn new(period: u16, result: Option<f64>) -> Self {
    let initial = match result {
      Some(ref result) => result,
      None => &0.0,
    };

    Self {
      result,
      indicator: yata::methods::SMA::new(period, &initial).unwrap(),
    }
  }

  #[napi]
  pub fn calc(&mut self, close: f64) -> Option<f64> {
    let result = self.indicator.next(&close);

    self.result = Some(result);
    self.result.clone()
  }
}
