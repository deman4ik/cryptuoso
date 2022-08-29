use crate::robot::position::state::{PositionState, SignalEvent};
use crate::robot::strategy::t2_trend_friend::{
  T2TrendFriendStrategyParams, T2TrendFriendStrategyState,
};
use crate::robot::strategy::*;
use crate::robot::*;
use crate::test_utils::*;
use napi::bindgen_prelude::*;
use rayon::prelude::{IntoParallelRefMutIterator, ParallelIterator};
use std::collections::HashMap;
use std::env;

#[napi]
#[allow(dead_code)]
struct T2TrendFriendRobot {
  robot: Robot,
}

#[napi]
#[allow(dead_code)]
impl T2TrendFriendRobot {
  #[napi(constructor)]
  pub fn new(
    settings: RobotSettings,
    strategy_params: T2TrendFriendStrategyParams,
    strategy_state: T2TrendFriendStrategyState,
    robot_state: RobotState,
  ) -> Self {
    T2TrendFriendRobot {
      robot: Robot::new(
        settings,
        robot_state,
        StrategyParams::T2TrendFriend(strategy_params),
        StrategyState::T2TrendFriend(strategy_state),
      ),
    }
  }

  #[napi]
  pub fn handle_candles(&mut self, candles: Vec<Candle>) -> Result<()> {
    let result = self.robot.handle_candles(candles);
    match result {
      Ok(_) => Ok(()),
      Err(err) => Err(Error::new(Status::GenericFailure, err.to_string())), //TODO: better error handling
    }
  }

  #[napi]
  pub fn handle_candle(&mut self, candle: Candle) -> Result<()> {
    let result = self.robot.handle_candle(candle);
    match result {
      Ok(_) => Ok(()),
      Err(err) => Err(Error::new(Status::GenericFailure, err.to_string())), //TODO: better error handling
    }
  }

  #[napi]
  pub async fn run(&mut self) -> Result<()> {
    let result = self.robot.run();

    match result {
      Ok(_) => Ok(()),
      Err(err) => Err(Error::new(Status::GenericFailure, err.to_string())), //TODO: better error handling
    }
  }

  #[napi]
  pub async fn check(&mut self) -> Result<()> {
    let result = self.robot.check();

    match result {
      Ok(_) => Ok(()),
      Err(err) => Err(Error::new(Status::GenericFailure, err.to_string())), //TODO: better error handling
    }
  }

  #[napi(getter)]
  pub fn settings(&self) -> RobotSettings {
    self.robot.settings()
  }

  #[napi(getter)]
  pub fn strategy_state(&self) -> T2TrendFriendStrategyState {
    match self.robot.strategy_state() {
      StrategyState::T2TrendFriend(state) => state,
      _ => panic!("Invalid strategy state"),
    }
  }

  #[napi(getter)]
  pub fn robot_state(&self) -> RobotState {
    self.robot.robot_state()
  }

  #[napi(getter)]
  pub fn dir(&self) -> String {
    format!("{}", env::current_dir().unwrap().to_str().unwrap()).to_string()
  }

  pub fn backtest(&mut self, candles: &Vec<Candle>) -> Result<()> {
    let initial_candles = candles[0..299].to_vec();
    self.robot.handle_candles(initial_candles).unwrap();
    let final_candles = candles[300..].to_vec();
    let mut alerts_to_save: HashMap<String, SignalEvent> = HashMap::new();
    let mut trades_to_save: HashMap<String, SignalEvent> = HashMap::new();
    let mut positions_to_save: HashMap<String, PositionState> = HashMap::new();
    for candle in final_candles.iter() {
      self.robot.handle_candle(candle.clone()).unwrap();
      self.robot.check().unwrap();

      let robot_state = self.robot.robot_state();
      if let Some(alerts) = robot_state.alerts {
        for alert in alerts.iter() {
          alerts_to_save.insert(alert.id.to_string(), alert.clone());
        }
      }
      if let Some(trades) = robot_state.trades {
        for trade in trades.iter() {
          trades_to_save.insert(trade.id.to_string(), trade.clone());
        }
      }

      if let Some(positions) = robot_state.positions {
        for position in positions.iter() {
          positions_to_save.insert(position.id.to_string(), position.clone());
        }
      }

      self.robot.run().unwrap();

      let robot_state = self.robot.robot_state();
      if let Some(alerts) = robot_state.alerts {
        for alert in alerts.iter() {
          alerts_to_save.insert(alert.id.to_string(), alert.clone());
        }
      }
      if let Some(trades) = robot_state.trades {
        for trade in trades.iter() {
          trades_to_save.insert(trade.id.to_string(), trade.clone());
        }
      }

      if let Some(positions) = robot_state.positions {
        for position in positions.iter() {
          positions_to_save.insert(position.id.to_string(), position.clone());
        }
      }
    }

    println!("Alerts: {:?}", alerts_to_save.keys().len());
    println!("Trades: {:?}", trades_to_save.keys().len());
    println!("Positions: {:?}", positions_to_save.keys().len());
    Ok(())
  }
}

#[cfg(test)]
mod test {
  use chrono::Utc;

  use super::*;
  use crate::test_utils::*;

  #[test]
  fn backtest() {
    let mut robot = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 50,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let candles = load_candles();

    let started = Utc::now();

    robot.backtest(&candles).unwrap();

    let ended = Utc::now();
    println!("{:?}", ended.signed_duration_since(started).num_seconds());
  }

  #[test]
  #[ignore]
  fn backtest_multi() {
    let mut robot = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 50,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot2 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 50,
        sma2: 175,
        sma3: 105,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot3 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot4 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot5 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot6 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot7 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot8 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot9 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot10 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot11 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot12 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot13 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot14 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot15 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot16 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot17 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot18 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot19 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot20 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot21 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot22 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot23 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );

    let mut robot24 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot25 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot26 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot27 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot28 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot29 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot30 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot31 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot32 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot33 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot34 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot35 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot36 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot37 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot38 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot39 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot40 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot41 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot42 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot43 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot44 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot45 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot46 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot47 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot48 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot49 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let mut robot50 = T2TrendFriendRobot::new(
      RobotSettings {
        exchange: "binance_futures".to_string(),
        timeframe: 30,
        strategy_settings: StrategySettings {
          strategy_type: "t2_trend_friend".to_string(),
          backtest: true,
        },
      },
      T2TrendFriendStrategyParams {
        sma1: 55,
        sma2: 175,
        sma3: 100,
        min_bars_to_hold: 5,
      },
      T2TrendFriendStrategyState {
        sma1_result: None,
        sma2_result: None,
        sma3_result: None,
        bars_held: None,
      },
      RobotState {
        position_last_num: None,
        positions: None,
        alerts: None,
        trades: None,
      },
    );
    let candles = load_candles();

    let started = Utc::now();
    let mut tasks = vec![
      &mut robot,
      &mut robot2,
      &mut robot3,
      &mut robot4,
      &mut robot5,
      &mut robot6,
      &mut robot7,
      &mut robot8,
      &mut robot9,
      &mut robot10,
      &mut robot11,
      &mut robot12,
      &mut robot13,
      &mut robot14,
      &mut robot15,
      &mut robot16,
      &mut robot17,
      &mut robot18,
      &mut robot19,
      &mut robot20,
      &mut robot21,
      &mut robot22,
      &mut robot23,
      &mut robot24,
      &mut robot25,
      &mut robot26,
      &mut robot27,
      &mut robot28,
      &mut robot29,
      &mut robot30,
      &mut robot31,
      &mut robot32,
      &mut robot33,
      &mut robot34,
      &mut robot35,
      &mut robot36,
      &mut robot37,
      &mut robot38,
      &mut robot39,
      &mut robot40,
      &mut robot41,
      &mut robot42,
      &mut robot43,
      &mut robot44,
      &mut robot45,
      &mut robot46,
      &mut robot47,
      &mut robot48,
      &mut robot49,
      &mut robot50,
    ];
    tasks
      .par_iter_mut()
      .for_each(|task| task.backtest(&candles).unwrap());
    let ended = Utc::now();
    println!("{:?}", ended.signed_duration_since(started).num_seconds());
  }
}
