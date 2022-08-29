use std::result;

use crate::robot::Candle;
use yata::prelude::*;

use super::BaseIndicator;

#[derive(Debug, Clone)]
pub struct Params {
  pub period: u16,
}

#[napi(object)]
#[derive(Debug, Clone, PartialEq)]
pub struct SMAResult {
  pub result: f64,
  pub time: i64,
}

#[allow(non_snake_case)]
pub struct SMA {
  params: Params,
  indicator: yata::methods::SMA,
  result: Option<SMAResult>,
}

#[allow(dead_code)]
impl SMA {
  pub fn new(params: Params, result: Option<SMAResult>) -> Self {
    let initial = match result {
      Some(ref result) => result.result,
      None => 0.0,
    };
    SMA {
      params: params.clone(),
      result: result,
      indicator: yata::methods::SMA::new(params.period, &initial).unwrap(),
    }
  }

  pub fn result(&self) -> Option<SMAResult> {
    self.result.clone()
  }
}

impl BaseIndicator for SMA {
  fn calc(&mut self, candle: &Candle) -> Option<f64> {
    let result = self.indicator.next(&candle.close);

    self.result = Some(SMAResult {
      result,
      time: candle.time,
    });
    Some(self.result.as_ref().unwrap().result.clone())
  }
}

#[cfg(test)]
mod test {
  use super::*;
  use crate::{test_utils::*, utils::*};

  #[test]
  fn should_calc_sma() {
    let candles = load_candles();
    let mut sma = SMA::new(Params { period: 30 }, Option::None);
    assert!(sma.result().is_none());
    let result = sma.calc(&candles[0]);
    assert!(result.is_some());
    assert!(sma.result().is_some());
    assert!(sma.result().unwrap().time > 0);
    assert!(sma.result().unwrap().result > 0.0);
    println!("{:?}", sma.result().unwrap());
  }

  /*#[test]
  fn should_calc_sma_with_prev_result() {
    let candles = load_candles();

    let mut sma = SMA::new(Params { period: 10 }, Option::None);
    let result = sma.calc(&candles[0]);

    let mut sma1 = SMA::new(Params { period: 10 }, Option::None);
    sma1.calc(&candles[..=250].to_vec());
    let mut sma2 = SMA::new(Params { period: 10 }, sma1.result());
    let result2 = sma2.calc(&candles);

    assert_eq!(round(result2.unwrap()), round(result.unwrap()));
    println!("{:?} {:?}", round(result2.unwrap()), round(result.unwrap()));
  }*/
}
