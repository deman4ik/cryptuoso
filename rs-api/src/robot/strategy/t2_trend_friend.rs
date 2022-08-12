use crate::robot::indicator::BaseIndicator;
use crate::robot::indicator::SMA::{Params, SMAResult, SMA};
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
  pub sma1_result: Option<SMAResult>,
  pub sma2_result: Option<SMAResult>,
  pub sma3_result: Option<SMAResult>,
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

    let sma1_result = match &state.sma1_result {
      Some(result) => Some(result.clone()),
      None => None,
    };

    let sma2_result = match &state.sma2_result {
      Some(result) => Some(result.clone()),
      None => None,
    };

    let sma3_result = match &state.sma3_result {
      Some(result) => Some(result.clone()),
      None => None,
    };

    Strategy {
      settings: settings,
      params: params,
      state: state,
      indicators: Indicators {
        sma1: SMA::new(sma1_params, sma1_result),
        sma2: SMA::new(sma2_params, sma2_result),
        sma3: SMA::new(sma3_params, sma3_result),
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
    self.state.sma1_result = self.indicators.sma1.result().clone();
    self.state.sma2_result = self.indicators.sma2.result().clone();
    self.state.sma3_result = self.indicators.sma3.result().clone();
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

    self.state()
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
      sma1_result: None,
      sma2_result: None,
      sma3_result: None,
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
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
      },
    );
    let candles = load_candles();
    let strategy_state = strategy.run(candles.clone());

    let raw_state = match strategy_state {
      StrategyState::T2TrendFriend(state) => state,
      _ => panic!("wrong strategy state"),
    };

    assert!(raw_state.sma1_result.unwrap().result > 0.0);
    assert!(raw_state.sma2_result.unwrap().result > 0.0);
    assert!(raw_state.sma3_result.unwrap().result > 0.0);
  }
}
