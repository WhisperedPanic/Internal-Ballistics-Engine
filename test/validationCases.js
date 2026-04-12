export const VALIDATION_CASES = [
  {
    name: "ConstantPressure_Ideal",
    params: { /* P=const, no burn */ },
    expected: { muzzleVel_mps: 840.0, tolerance_pct: 0.1 },
    validate: (results) => { /* energy conservation check */ }
  },
  {
    name: "NATO_7.62_Reference", 
    params: { /* published test case */ },
    expected: { peakPress_Pa: 380e6, muzzleVel_mps: 840, tolerance_pct: 2.0 }
  }
];

export async function runAll() { /* iterate + log pass/fail */ }