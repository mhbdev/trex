import Decimal from "decimal.js";
import type { Candle } from "./types.ts";

export interface TechnicalIndicators {
  sampleSize: number;
  close: string;
  returnPct: string | null;
  sma7: string | null;
  sma25: string | null;
  ema12: string | null;
  ema26: string | null;
  macd: string | null;
  macdSignal: string | null;
  macdHistogram: string | null;
  rsi14: string | null;
  bollinger20: { middle: string; upper: string; lower: string } | null;
  atr14: string | null;
  volumeSma20: string | null;
  currentVolume: string;
}

function sma(values: Decimal[], period: number): Decimal | null {
  if (values.length < period) return null;
  return values.slice(-period).reduce((sum, value) => sum.plus(value), new Decimal(0)).div(period);
}

function emaSeries(values: Decimal[], period: number): Decimal[] {
  if (values.length === 0) return [];
  const alpha = new Decimal(2).div(period + 1);
  return values.reduce<Decimal[]>((series, value, index) => {
    if (index === 0) series.push(value);
    else series.push(value.mul(alpha).plus(series[index - 1]!.mul(new Decimal(1).minus(alpha))));
    return series;
  }, []);
}

export function computeTechnicalIndicators(input: readonly Candle[]): TechnicalIndicators | null {
  const candles = input.filter((candle) => candle.complete).sort((a, b) => a.timestamp - b.timestamp);
  if (candles.length === 0) return null;
  const closes = candles.map((candle) => new Decimal(candle.close));
  const volumes = candles.map((candle) => new Decimal(candle.volume));
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdSeries = ema12.map((value, index) => value.minus(ema26[index]!));
  const macdSignalSeries = emaSeries(macdSeries, 9);
  const changes = closes.slice(1).map((close, index) => close.minus(closes[index]!));
  const gains = changes.map((change) => Decimal.max(change, 0));
  const losses = changes.map((change) => Decimal.max(change.negated(), 0));
  const avgGain = gains.length >= 14 ? sma(gains, 14) : null;
  const avgLoss = losses.length >= 14 ? sma(losses, 14) : null;
  let rsi: Decimal | null = null;
  if (avgGain && avgLoss) rsi = avgLoss.isZero() ? (avgGain.isZero() ? new Decimal(50) : new Decimal(100)) : new Decimal(100).minus(new Decimal(100).div(new Decimal(1).plus(avgGain.div(avgLoss))));

  const bandValues = closes.slice(-20);
  let bollinger: TechnicalIndicators["bollinger20"] = null;
  if (bandValues.length === 20) {
    const middle = bandValues.reduce((sum, value) => sum.plus(value), new Decimal(0)).div(20);
    const variance = bandValues.reduce((sum, value) => sum.plus(value.minus(middle).pow(2)), new Decimal(0)).div(20);
    const deviation = variance.sqrt();
    bollinger = { middle: middle.toFixed(), upper: middle.plus(deviation.mul(2)).toFixed(), lower: middle.minus(deviation.mul(2)).toFixed() };
  }
  const trueRanges = candles.slice(1).map((candle, index) => {
    const high = new Decimal(candle.high);
    const low = new Decimal(candle.low);
    const previousClose = closes[index]!;
    return Decimal.max(high.minus(low), high.minus(previousClose).abs(), low.minus(previousClose).abs());
  });
  const atr = sma(trueRanges, 14);
  const priorClose = closes.length > 1 ? closes[closes.length - 2]! : null;
  return {
    sampleSize: candles.length,
    close: closes.at(-1)!.toFixed(),
    returnPct: priorClose?.isZero() ? null : priorClose ? closes.at(-1)!.minus(priorClose).div(priorClose).mul(100).toFixed(6) : null,
    sma7: sma(closes, 7)?.toFixed() ?? null,
    sma25: sma(closes, 25)?.toFixed() ?? null,
    ema12: ema12.at(-1)?.toFixed() ?? null,
    ema26: candles.length >= 26 ? ema26.at(-1)?.toFixed() ?? null : null,
    macd: candles.length >= 26 ? macdSeries.at(-1)?.toFixed() ?? null : null,
    macdSignal: candles.length >= 34 ? macdSignalSeries.at(-1)?.toFixed() ?? null : null,
    macdHistogram: candles.length >= 34 ? macdSeries.at(-1)!.minus(macdSignalSeries.at(-1)!).toFixed() : null,
    rsi14: rsi?.toFixed(4) ?? null,
    bollinger20: bollinger,
    atr14: atr?.toFixed() ?? null,
    volumeSma20: sma(volumes, 20)?.toFixed() ?? null,
    currentVolume: volumes.at(-1)!.toFixed(),
  };
}
