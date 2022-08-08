use crate::robot::Candle;
use std::fs::File;
use std::path::Path;

pub fn load_candles() -> Vec<Candle> {
  let json_file_path = Path::new("./candles.json"); //TODO: LOAD FROM SOME URL INSTEAD
  let file = File::open(json_file_path).expect("file not found");
  let candles: Vec<Candle> = serde_json::from_reader(file).expect("error while reading");
  candles
}
