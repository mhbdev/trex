import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AppSelect, FieldLabelInfo, MoneyInput } from "./ui-primitives";

type Row = { pair: string; reservedBase: string; maxSellPct: string; maxSellQuantity: string; maxBuyNotional: string };

function parse(value: string): Row[] | null {
  try {
    const input = JSON.parse(value.trim() || "{}") as Record<string, Record<string, unknown>>;
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    return Object.entries(input).map(([pair, raw]) => {
      const limit = raw && typeof raw === "object" ? raw : {};
      const text = (field: unknown) => field === undefined || field === null ? "" : String(field);
      return { pair, reservedBase: text(limit.reservedBase), maxSellPct: text(limit.maxSellPct), maxSellQuantity: text(limit.maxSellQuantity), maxBuyNotional: text(limit.maxBuyNotional) };
    });
  } catch { return null; }
}

/** Visual editor for RISK_PAIR_LIMITS_JSON: one row per pair with the reserve, the sell caps, and the buy budget. */
export function PairLimitsEditor({ value, disabled, locale, pairs, quoteCurrency, onChange }: {
  value: string; disabled: boolean; locale: "fa" | "en"; pairs: string[]; quoteCurrency: string; onChange: (value: string) => void;
}) {
  const fa = locale === "fa";
  const rows = useMemo(() => parse(value), [value]);
  const write = (next: Row[]) => onChange(JSON.stringify(Object.fromEntries(next.filter((row) => row.pair).map((row) => [row.pair.toUpperCase(), Object.fromEntries(Object.entries({
    reservedBase: row.reservedBase, maxSellPct: row.maxSellPct, maxSellQuantity: row.maxSellQuantity, maxBuyNotional: row.maxBuyNotional,
  }).filter(([, field]) => field.trim() !== ""))]))));
  if (!rows) return <p className="field-hint">{fa ? "این تنظیم قابل خواندن نیست؛ از ویرایش فنی برای اصلاح آن استفاده کنید." : "This setting could not be read; use the raw editor to repair it."}</p>;
  const options = [...new Set([...pairs, ...rows.map((row) => row.pair)])].filter(Boolean).map((pair) => ({ value: pair, label: pair.endsWith(quoteCurrency) && pair.length > quoteCurrency.length ? `${pair.slice(0, -quoteCurrency.length)}/${quoteCurrency}` : pair }));
  const base = (pair: string) => pair.endsWith(quoteCurrency) && pair.length > quoteCurrency.length ? pair.slice(0, -quoteCurrency.length) : pair;
  const update = (index: number, change: Partial<Row>) => write(rows.map((row, position) => position === index ? { ...row, ...change } : row));
  return <div className="pair-limits-editor">
    <p className="field-hint">{fa ? "برای هر جفت‌ارز: مقداری از دارایی پایه که هرگز فروخته نمی‌شود، سقف فروش در هر چرخه و بودجهٔ خرید. دروازهٔ ریسک این‌ها را قطعی اعمال می‌کند و دستیارها هنگام برنامه‌ریزی آن‌ها را می‌بینند. خانه‌های خالی یعنی بدون محدودیت." : "Per pair: a base-asset amount that is never sold, a sell cap per cycle, and a buy budget. The risk gate enforces them deterministically and the agents see them when planning. Blank fields mean no limit."}</p>
    {rows.map((row, index) => <div className="pair-limit-row" key={index}>
      <label className="pair-limit-pair"><FieldLabelInfo label={fa ? "جفت‌ارز" : "Pair"} help={fa ? "جفت‌ارزی که این محدودیت‌ها به آن اعمال می‌شود." : "The pair these limits apply to."}/><AppSelect ariaLabel={fa ? "جفت‌ارز" : "Pair"} value={row.pair} locale={locale} disabled={disabled} options={options} placeholder={fa ? "انتخاب جفت‌ارز" : "Choose a pair"} onValueChange={(pair) => update(index, { pair })}/></label>
      <label><FieldLabelInfo label={fa ? `نگه‌داشت ${base(row.pair) || ""}` : `Reserved ${base(row.pair) || ""}`} help={fa ? "مقداری از دارایی پایه که هرگز فروخته نمی‌شود؛ هر فروش باید دست‌کم این مقدار را باقی بگذارد." : "Base-asset quantity that is never sold; every sell must leave at least this much."}/><input dir="ltr" inputMode="decimal" value={row.reservedBase} disabled={disabled} placeholder="0" onChange={(event) => update(index, { reservedBase: event.target.value.replace(/[^0-9.]/g, "") })}/></label>
      <label><FieldLabelInfo label={fa ? "حداکثر فروش (٪ دارایی)" : "Max sell (% of holding)"} help={fa ? "بیشترین سهمی از دارایی فعلی که یک فروش می‌تواند بردارد." : "The largest share of the current holding one sell may take."}/><input type="number" min="0" max="100" step="1" value={row.maxSellPct} disabled={disabled} placeholder="100" onChange={(event) => update(index, { maxSellPct: event.target.value })}/></label>
      <label><FieldLabelInfo label={fa ? "حداکثر فروش (مقدار)" : "Max sell (quantity)"} help={fa ? "بیشترین مقدار دارایی پایه در یک فروش. اگر همراه درصد تنظیم شود، مقدار کمتر اعمال می‌شود." : "The largest base-asset quantity in one sell. With a percentage set too, the smaller one applies."}/><input dir="ltr" inputMode="decimal" value={row.maxSellQuantity} disabled={disabled} placeholder={fa ? "بدون محدودیت" : "no limit"} onChange={(event) => update(index, { maxSellQuantity: event.target.value.replace(/[^0-9.]/g, "") })}/></label>
      <label><FieldLabelInfo label={fa ? "بودجهٔ خرید" : "Buy budget"} help={fa ? "بیشترین ارزشی که یک خرید می‌تواند به این جفت‌ارز اضافه کند، برحسب ارز بازار پایه." : "The most one buy may add to this pair, in the quote currency."}/><MoneyInput value={row.maxBuyNotional} currency={quoteCurrency} locale={locale} disabled={disabled} placeholder={fa ? "بدون محدودیت" : "no limit"} onChange={(raw) => update(index, { maxBuyNotional: raw })}/></label>
      <button type="button" className="icon-button tiny" disabled={disabled} onClick={() => write(rows.filter((_, position) => position !== index))} aria-label={fa ? "حذف این جفت‌ارز" : "Remove this pair"}><Trash2 size={14}/></button>
    </div>)}
    <button type="button" className="text-button" disabled={disabled} onClick={() => write([...rows, { pair: pairs.find((pair) => !rows.some((row) => row.pair === pair)) ?? "", reservedBase: "", maxSellPct: "", maxSellQuantity: "", maxBuyNotional: "" }])}><Plus size={14}/>{fa ? "افزودن جفت‌ارز" : "Add pair"}</button>
  </div>;
}
