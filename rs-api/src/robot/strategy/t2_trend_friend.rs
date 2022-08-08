use crate::robot::indicator::BaseIndicator;
use crate::robot::indicator::SMA::{Params, SMA};
use crate::robot::strategy::*;
use crate::robot::Candle;

#[napi(object)]
#[derive(Clone)]

pub struct T2TrendFriendStrategyParams {
  pub sma1: u16,
  pub sma2: u16,
  pub sma3: u16,
  pub min_bars_to_hold: u16,
}

#[allow(non_snake_case)]
#[napi(object)]
#[derive(Debug, Clone, PartialEq)]
pub struct T2TrendFriendStrategyState {
  pub sma1_results: Option<Vec<f64>>,
  pub sma2_results: Option<Vec<f64>>,
  pub sma3_results: Option<Vec<f64>>,
}

pub struct Indicators {
  sma1: SMA,
  sma2: SMA,
  sma3: SMA,
}

pub struct Strategy {
  settings: StrategySettings,
  params: T2TrendFriendStrategyParams,
  state: T2TrendFriendStrategyState,
  indicators: Indicators,
  candles: Option<Vec<Candle>>,
}

impl BaseStrategy for Strategy {
  type Params = T2TrendFriendStrategyParams;
  type State = T2TrendFriendStrategyState;

  #[allow(non_snake_case)]
  fn new(settings: StrategySettings, params: Self::Params, state: Self::State) -> Self {
    let sma1_params = Params {
      period: params.sma1,
    };
    let sma2_params = Params {
      period: params.sma2,
    };
    let sma3_params = Params {
      period: params.sma3,
    };

    let sma1_results = match &state.sma1_results {
      Some(results) => Some(results.clone()),
      None => None,
    };

    let sma2_results = match &state.sma2_results {
      Some(results) => Some(results.clone()),
      None => None,
    };

    let sma3_results = match &state.sma3_results {
      Some(results) => Some(results.clone()),
      None => None,
    };

    Strategy {
      settings: settings,
      params: params,
      state: state,
      indicators: Indicators {
        sma1: SMA::new(sma1_params, sma1_results),
        sma2: SMA::new(sma2_params, sma2_results),
        sma3: SMA::new(sma3_params, sma3_results),
      },
      candles: None,
    }
  }

  fn calc_indicatos(&mut self) {
    match &self.candles {
      Some(candles) => {
        self.indicators.sma1.calc(candles);
        self.indicators.sma2.calc(candles);
        self.indicators.sma3.calc(candles);
      } //TODO: parallelize
      None => panic!("candles is None"),
    }
    self.state.sma1_results = self.indicators.sma1.results();
    self.state.sma2_results = self.indicators.sma2.results();
    self.state.sma3_results = self.indicators.sma3.results();
  }

  fn run_strategy(&mut self) {
    ()
  }

  fn run(&mut self, candles: Vec<Candle>) -> StrategyState {
    self.candles = match candles.len() {
      0 => panic!("candles is empty"),
      _ => Some(candles),
    };

    self.calc_indicatos();
    self.run_strategy();

    StrategyState::T2TrendFriend(self.state.clone())
  }

  fn params(&self) -> StrategyParams {
    StrategyParams::T2TrendFriend(self.params.clone())
  }

  fn state(&self) -> StrategyState {
    StrategyState::T2TrendFriend(self.state.clone())
  }
}

#[cfg(test)]
mod test {
  use super::*;
  use crate::test_utils::*;

  #[test]
  fn should_create_new_strategy_instance() {
    let initial_state = T2TrendFriendStrategyState {
      sma1_results: None,
      sma2_results: None,
      sma3_results: None,
    };
    let strategy = Strategy::new(
      StrategySettings {
        strategy_type: StrategyType::T2TrendFriend,
        backtest: false,
      },
      T2TrendFriendStrategyParams {
        sma1: 10,
        sma2: 20,
        sma3: 30,
        min_bars_to_hold: 10,
      },
      initial_state.clone(),
    );

    assert_eq!(
      strategy.state(),
      StrategyState::T2TrendFriend(initial_state)
    );
  }

  #[test]
  fn should_run_strategy() {
    let params = T2TrendFriendStrategyParams {
      sma1: 10,
      sma2: 20,
      sma3: 30,
      min_bars_to_hold: 10,
    };
    let mut strategy = Strategy::new(
      StrategySettings {
        strategy_type: StrategyType::T2TrendFriend,
        backtest: false,
      },
      params.clone(),
      T2TrendFriendStrategyState {
        sma1_results: None,
        sma2_results: None,
        sma3_results: None,
      },
    );
    let candles = load_candles();
    let strategy_state = strategy.run(candles.clone());

    let raw_state = match strategy_state {
      StrategyState::T2TrendFriend(state) => state,
      _ => panic!("wrong strategy state"),
    };

    assert!(raw_state.sma1_results.unwrap().len() > 0);
    assert!(raw_state.sma2_results.unwrap().len() > 0);
    assert!(raw_state.sma3_results.unwrap().len() > 0);
  }
}
