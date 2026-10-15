export const DISCLAIMER = "Not financial advice. Demonstration only." as const;

export const TICKERS = [
  "RELIANCE",
  "TCS",
  "INFY",
  "HDFCBANK",
  "ICICIBANK",
  "ITC",
  "SBIN",
  "BHARTIARTL",
  "LT",
  "HINDUNILVR",
] as const;

export type Ticker = (typeof TICKERS)[number];

export const SECTOR_BY_TICKER: Record<Ticker, string> = {
  RELIANCE: "Energy",
  TCS: "IT",
  INFY: "IT",
  HDFCBANK: "Banks",
  ICICIBANK: "Banks",
  ITC: "FMCG",
  SBIN: "Banks",
  BHARTIARTL: "Telecom",
  LT: "Infra",
  HINDUNILVR: "FMCG",
};

export const SECTORS = ["Energy", "IT", "Banks", "FMCG", "Telecom", "Infra"] as const;

export const COMPANY_NAME: Record<Ticker, string> = {
  RELIANCE: "Reliance Industries",
  TCS: "Tata Consultancy Services",
  INFY: "Infosys",
  HDFCBANK: "HDFC Bank",
  ICICIBANK: "ICICI Bank",
  ITC: "ITC",
  SBIN: "State Bank of India",
  BHARTIARTL: "Bharti Airtel",
  LT: "Larsen and Toubro",
  HINDUNILVR: "Hindustan Unilever",
};

export const SYNTHETIC_ASOF_END = "2026-09-30";
export const TRADING_DAYS = 300;
export const ASOF_INDEX = 269;

export const AGENT_WEIGHTS = {
  momentum: 0.3,
  volume: 0.2,
  sentiment: 0.3,
  risk: 0.2,
} as const;
