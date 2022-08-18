use rayon::prelude::{IntoParallelRefMutIterator, ParallelIterator};

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
  pub bars_held: Option<u16>,
}

pub struct Indicators {
  sma1: SMA,
  sma2: SMA,
  sma3: SMA,
}

#[allow(dead_code)]
pub struct Strategy {
  settings: StrategyOwnSettings,
  params: T2TrendFriendStrategyParams,
  state: T2TrendFriendStrategyState,
  positions: PositionManager,
  indicators: Indicators,
  candles: Option<Vec<Candle>>,
}

impl BaseStrategy for Strategy {
  type Params = T2TrendFriendStrategyParams;
  type State = T2TrendFriendStrategyState;

  #[allow(non_snake_case)]
  fn new(
    settings: StrategyOwnSettings,
    params: Self::Params,
    state: Self::State,
    positions: PositionManager,
  ) -> Self {
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
      positions,
      indicators: Indicators {
        sma1: SMA::new(sma1_params, sma1_result),
        sma2: SMA::new(sma2_params, sma2_result),
        sma3: SMA::new(sma3_params, sma3_result),
      },
      candles: None,
    }
  }

  fn get_candle(&self) -> Result<Candle, String> {
    match &self.candles {
      Some(candles) => {
        if candles.len() > 0 {
          match candles.last() {
            Some(candle) => Ok(candle.clone()),
            None => Err("No candles".to_string()),
          }
        } else {
          Err("No candles".to_string())
        }
      }
      None => Err("No candles".to_string()),
    }
  }

  fn calc_indicatos(&mut self) -> Result<(), Box<dyn Error>> {
    match &self.candles {
      Some(candles) => {
        let mut tasks = vec![
          &mut self.indicators.sma1,
          &mut self.indicators.sma2,
          &mut self.indicators.sma3,
        ];
        tasks.par_iter_mut().for_each(|task| {
          task.calc(candles);
        });
      }
      None => return Err("No candles to calc indicators".into()),
    }
    self.state.sma1_result = self.indicators.sma1.result().clone();
    self.state.sma2_result = self.indicators.sma2.result().clone();
    self.state.sma3_result = self.indicators.sma3.result().clone();
    Ok(())
  }

  fn run_strategy(&mut self) -> Result<(), Box<dyn Error>> {
    let candle = self.get_candle()?;
    let sma1 = match &self.state.sma1_result {
      Some(result) => result.result,
      None => return Err("sma1_result is None".into()),
    };
    let sma2 = match &self.state.sma2_result {
      Some(result) => result.result,
      None => return Err("sma2_result is None".into()),
    };
    let sma3 = match &self.state.sma3_result {
      Some(result) => result.result,
      None => return Err("sma3_result is None".into()),
    };
    if self.positions.has_active_position() {
      let position = self.positions.get_active_position()?;
      if position.is_long() {
        self.state.bars_held = Some(self.state.bars_held.unwrap_or(0) + 1);
        if candle.close < sma1 && self.state.bars_held.unwrap() > self.params.min_bars_to_hold {
          self.state.bars_held = Some(0);
          position.sell_at_market()?;
        }
      }
    } else if candle.close > sma1 && sma1 > sma2 && sma1 > sma3 && sma2 > sma3 {
      self.state.bars_held = Some(1);
      let position = self.positions.create();
      position.buy_at_market()?;
    }
    Ok(())
  }

  fn run(&mut self, candles: Vec<Candle>) -> Result<(), Box<dyn Error>> {
    self.candles = match candles.len() {
      0 => return Err("candles is empty".into()),
      _ => Some(candles),
    };

    self.positions.clear_all();

    self.calc_indicatos()?;

    self
      .positions
      .handle_candle(self.candles.as_ref().unwrap().last().unwrap());

    self.run_strategy()?;

    self.positions.check_alerts()?;
    Ok(())
  }

  fn check(&mut self, candle: Candle) -> Result<(), Box<dyn Error>> {
    self.positions.clear_closed_positions();
    self.positions.clear_trades();

    self.positions.handle_candle(&candle);

    self.positions.check_alerts()?;
    Ok(())
  }

  fn strategy_state(&self) -> StrategyState {
    StrategyState::T2TrendFriend(self.state.clone())
  }

  fn robot_state(&self) -> RobotState {
    RobotState {
      position_last_num: Some(self.positions.position_last_num()),
      positions: Some(self.positions.positions_state()),
      alerts: Some(self.positions.alert_events()),
      trades: Some(self.positions.trade_events()),
    }
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
      bars_held: None,
    };
    let strategy = Strategy::new(
      StrategyOwnSettings {
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
      PositionManager::new(&None, &None, false),
    );

    assert_eq!(
      strategy.strategy_state(),
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
      StrategyOwnSettings {
        strategy_type: StrategyType::T2TrendFriend,
        backtest: false,
      },
      params.clone(),
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      PositionManager::new(&None, &None, false),
    );
    let candles = load_candles();
    strategy.run(candles.clone()).unwrap();

    let raw_state = match strategy.strategy_state() {
      StrategyState::T2TrendFriend(state) => state,
      _ => panic!("wrong strategy state"),
    };

    assert!(raw_state.sma1_result.unwrap().result > 0.0);
    assert!(raw_state.sma2_result.unwrap().result > 0.0);
    assert!(raw_state.sma3_result.unwrap().result > 0.0);
  }
}
