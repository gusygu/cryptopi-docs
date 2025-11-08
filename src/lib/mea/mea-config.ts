import { MeaConfig } from "@/lib/mea";

// Example config you can tune
export const MEA_CONFIG: MeaConfig = {
  tiers: {
    bands: [
      { name: "flat",    zMin: 0.0,  zMax: 0.25,     weight: 0.2 },
      { name: "slight",  zMin: 0.25, zMax: 0.75,     weight: 0.4 },
      { name: "normal",  zMin: 0.75, zMax: 1.50,     weight: 1.0 },
      { name: "high",    zMin: 1.50, zMax: 2.50,     weight: 1.5 },
      { name: "extreme", zMin: 2.50, zMax: Infinity, weight: 2.0 },
    ],
    eps: 1e-9,
  },
  mood: {
    weakMax: 0.25,
    moderateMax: 1.00,
    defaultCoeff: 1.0,
    clampMin: 0.2,
    clampMax: 2.0,
    // optional: enrich with hand-tuned entries; keys formed as
    //  "+:moderate|up:strong|up:moderate": 1.35
    table: {
      "+:strong|up:strong|up:strong": 1.8,
      "-:strong|down:strong|down:strong": 0.5,
    },
  },
  clampMinAllocation: 0,
  clampMaxAllocation: Infinity,
  matrixMode: "diagonal", // "vector" | "diagonal" | "outer"
  perCoinCap: 3.0,
};
