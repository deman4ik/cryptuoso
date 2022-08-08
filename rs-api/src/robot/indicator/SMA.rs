use crate::robot::Candle;
use yata::prelude::*;

use super::BaseIndicator;

pub struct Params {
  pub period: u16,
}

#[allow(non_snake_case)]
pub struct SMA {
  params: Params,
  results: Option<Vec<f64>>,
  result: Option<f64>,
}

#[allow(dead_code)]
impl SMA {
  pub fn new(params: Params, results: Option<Vec<f64>>) -> Self {
    SMA {
      params,
      results: match &results {
        Some(results) => Some(results.clone()),
        None => None,
      },
      result: match &results {
        Some(results) => Some(results[results.len() - 1].clone()),
        None => None,
      },
    }
  }

  pub fn results(&self) -> Option<Vec<f64>> {
    self.results.clone()
  }

  pub fn result(&self) -> Option<f64> {
    self.result
  }
}

impl BaseIndicator for SMA {
  fn calc(&mut self, candles: &Vec<Candle>) -> Option<f64> {
    let period = usize::try_from(self.params.period).unwrap();

    let mut sma = yata::methods::SMA::new(self.params.period, &candles[0].close).unwrap();

    let mut results = Vec::new();
    for candle in &candles[1..] {
      results.push(sma.next(&candle.close));
    }

    self.results = match &results.len() {
      0 => None,
      _ => Some(results),
    };

    self.result = match &self.results {
      Some(results) => Some(*results.last().unwrap()),
      None => None,
    };
    self.result
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
    assert!(sma.result().unwrap() > 0.0);
    println!("{:?}", sma.result().unwrap());
  }

  #[test]
  fn should_calc_sma_with_prev_results() {
    let candles = load_candles();
    let mut sma1 = SMA::new(Params { period: 30 }, Option::None);
    sma1.calc(&candles[..290].to_vec());
    let mut sma2 = SMA::new(Params { period: 30 }, sma1.results());
    let result2 = sma2.calc(&candles[289..].to_vec());
    assert!(result2.is_some());
    assert!(sma2.result().is_some());
    assert!(sma2.result().unwrap() > 0.0);
    println!("{:?}", sma2.result().unwrap());
  }
}
