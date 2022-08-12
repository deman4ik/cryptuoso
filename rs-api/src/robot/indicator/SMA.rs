use crate::robot::Candle;
use crate::utils::*;
use yata::prelude::*;

use super::BaseIndicator;

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
  result: Option<SMAResult>,
}

#[allow(dead_code)]
impl SMA {
  pub fn new(params: Params, result: Option<SMAResult>) -> Self {
    SMA {
      params,
      result: result,
    }
  }

  pub fn result(&self) -> Option<SMAResult> {
    self.result.clone()
  }
}

impl BaseIndicator for SMA {
  fn calc(&mut self, candles: &Vec<Candle>) -> Option<f64> {
    let period = usize::try_from(self.params.period).unwrap();
    if candles.len() < &period + 1 {
      panic!("Not enough candles");
    }

    let mut slice = candles.clone();
    if self.result.is_some() {
      let time = self.result.as_ref().unwrap().time;
      slice = slice
        .iter()
        .filter(|candle| candle.time > time)
        .cloned()
        .collect()
    }

    let initial = match &self.result {
      Some(result) => result.result,
      None => candles[&candles.len() - period - 1].close,
    };

    let mut sma = yata::methods::SMA::new(self.params.period, &initial).unwrap();

    let mut results = Vec::new();

    for candle in &slice {
      results.push(sma.next(&candle.close));
    }

    match &results.len() {
      0 => {
        self.result = None;
      }
      _ => {
        self.result = Some(SMAResult {
          result: results[&results.len() - 1],
          time: slice[&slice.len() - 1].time,
        });
      }
    };

    match &self.result {
      Some(result) => Some(result.result),
      None => None,
    }
  }
}

#[cfg(test)]
mod test {
  use super::*;
  use crate::test_utils::*;

  #[test]
  fn should_calc_sma() {
    let candles = load_candles();
    let mut sma = SMA::new(Params { period: 30 }, Option::None);
    assert!(sma.result().is_none());
    let result = sma.calc(&candles);
    assert!(result.is_some());
    assert!(sma.result().is_some());
    assert!(sma.result().unwrap().time > 0);
    assert!(sma.result().unwrap().result > 0.0);
    println!("{:?}", sma.result().unwrap());
  }

  #[test]
  fn should_calc_sma_with_prev_result() {
    let candles = load_candles();

    let mut sma = SMA::new(Params { period: 10 }, Option::None);
    let result = sma.calc(&candles);

    let mut sma1 = SMA::new(Params { period: 10 }, Option::None);
    sma1.calc(&candles[..=250].to_vec());
    let mut sma2 = SMA::new(Params { period: 10 }, sma1.result());
    let result2 = sma2.calc(&candles);

    assert_eq!(round(result2.unwrap()), round(result.unwrap()));
    println!("{:?} {:?}", round(result2.unwrap()), round(result.unwrap()));
  }
}
