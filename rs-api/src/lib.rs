#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

#[napi]
fn sum(a: i32, b: i32) -> i32 {
  a + b
}

#[napi]
fn sum_sum_a_a(a: i32, b: i32) -> i32 {
  a + b + sum(a, b)
}
