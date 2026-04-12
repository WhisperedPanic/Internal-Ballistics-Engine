// js/solvers/wasm/src/lib.rs
use wasm_bindgen::prelude::*;
use rusoda::{LSODA, IStateInput, DStateOutput};
use serde::{Serialize, Deserialize};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

// ODE callback signature: JS passes a function, Rust calls it via wasm-bindgen
#[wasm_bindgen]
pub extern "C" fn ode_callback(
    t: f64,
    y: &[f64],
    dydt: &mut [f64],
    params_ptr: u32, // Opaque pointer to JS-side params (passed via closure)
) {
    // This is a placeholder - your JS wrapper will inject the real physics
    // For now, return zeros to avoid crash during build/test
    for d in dydt.iter_mut() { *d = 0.0; }
}

#[derive(Serialize, Deserialize)]
pub struct SolveResult {
    pub t: Vec<f64>,
    pub y: Vec<Vec<f64>>, // [state_dim x n_steps]
    pub success: bool,
    pub message: String,
    pub t_event: Option<f64>,
}

#[wasm_bindgen]
pub struct LsodaSolver {
    neq: i32,
    rtol: f64,
    atol: f64,
}

#[wasm_bindgen]
impl LsodaSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(neq: i32, rtol: f64, atol: f64) -> LsodaSolver {
        LsodaSolver { neq, rtol, atol }
    }
    
    // Minimal solve stub - expand with your ODE system
    #[wasm_bindgen]
    pub fn solve_stub(&self, y0: &[f64], t0: f64, tf: f64) -> JsValue {
        let result = SolveResult {
            t: vec![t0, tf],
            y: vec![y0.to_vec(), y0.to_vec()],
            success: true,
            message: "rusoda wrapper ready - implement full ODE callback in JS".into(),
            t_event: None,
        };
        serde_wasm_bindgen::to_value(&result).unwrap()
    }
}