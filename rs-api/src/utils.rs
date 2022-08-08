pub fn round(value: f64) -> f64 {
  let mut value = value;
  value *= 100.0;
  value = value.round();
  value /= 100.0;
  value
} //TODO generic or something else
