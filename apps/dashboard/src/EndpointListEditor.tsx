import { useState } from "react";
import { CircleHelp, Plus, Trash2 } from "lucide-react";
import { FieldLabelInfo } from "./ui-primitives";

type Category = "market" | "technical" | "news" | "sentiment" | "tokenomics" | "on_chain" | "macro" | "prediction_market";
type Source = { id: string; url: string; timeoutMs: string; categories: Category[]; maxAgeSeconds: string; headers: Array<{ name: string; value: string }> };
type SourceKind = "research" | "quote";
const categories: Category[] = ["market", "technical", "news", "sentiment", "tokenomics", "on_chain", "macro", "prediction_market"];
const labels: Record<Category, { en: string; fa: string }> = {
  market: { en: "Market", fa: "بازار" }, technical: { en: "Technical", fa: "تکنیکال" }, news: { en: "News", fa: "خبر" },
  sentiment: { en: "Sentiment", fa: "احساسات" }, tokenomics: { en: "Tokenomics", fa: "توکنومیک" }, on_chain: { en: "On-chain", fa: "آن‌چین" },
  macro: { en: "Macro", fa: "کلان" }, prediction_market: { en: "Prediction markets", fa: "بازار پیش‌بینی" },
};
function emptySource(index: number, kind: SourceKind): Source {
  return { id: `${kind}-source-${index + 1}`, url: "", timeoutMs: kind === "research" ? "5000" : "4000", maxAgeSeconds: "86400", categories: ["market"], headers: [] };
}

/** User-friendly editor for the two write-only provider lists stored as encrypted profile secrets. */
export function EndpointListEditor({ kind, configured, value, cleared, onValue, onClear, locale }: {
  kind: SourceKind; configured?: boolean; value: string; cleared?: boolean; onValue: (value: string) => void; onClear: (value: boolean) => void; locale: "fa" | "en";
}) {
  const fa = locale === "fa";
  const isResearch = kind === "research";
  const [sources, setSources] = useState<Source[]>([emptySource(0, kind)]);
  const update = (index: number, change: Partial<Source>) => {
    onClear(false);
    const next = sources.map((source, row) => row === index ? { ...source, ...change } : source);
    setSources(next);
    const payload = next.filter((source) => source.url.trim()).map((source) => ({
      id: source.id.trim(), url: source.url.trim(), timeoutMs: Number(source.timeoutMs) || (isResearch ? 5000 : 4000),
      ...(isResearch ? { categories: source.categories, maxAgeSeconds: Number(source.maxAgeSeconds) || 86400 } : {}),
      ...(source.headers.some((header) => header.name.trim()) ? { headers: Object.fromEntries(source.headers.filter((header) => header.name.trim()).map(({ name, value }) => [name.trim(), value])) } : {}),
    }));
    onValue(payload.length ? JSON.stringify(payload) : "");
  };
  const title = isResearch ? (fa ? "منابع پژوهش سفارشی" : "Custom research sources") : (fa ? "منابع جایگزین قیمت" : "Quote fallback sources");
  const explanation = isResearch
    ? (fa ? "هر endpoint باید JSON با ساختار { items: [...] } برگرداند؛ هر مورد شامل category، source، title و observedAt است. حداکثر ۱۰ منبع." : "Each endpoint returns JSON shaped as { items: [...] }; each item includes category, source, title, and observedAt. Up to 10 sources.")
    : (fa ? "هر endpoint باید JSON شامل symbol، price و observedAt اختیاری برگرداند. والکس همچنان منبع اصلی و تنها منبع اجرای معامله است؛ حداکثر ۵ منبع." : "Each endpoint returns JSON with symbol, price, and optional observedAt. Wallex remains the primary quote and only execution venue; up to 5 sources.");
  return <section className="endpoint-editor secret-wide" aria-label={title}>
    <div className="endpoint-editor-heading"><div><div className="field-label-info"><span className="field-label-copy">{title}</span><FieldLabelInfo label={title} help={explanation}/></div><small>{configured ? (fa ? "منابع فعلی فقط‌نوشتنی هستند؛ فهرست موجود تا زمان ذخیره تغییرات حفظ می‌شود." : "Stored sources are write-only. The existing list stays active until you save a replacement.") : explanation}</small></div><span className={`status ${configured ? "status-completed" : "status-neutral"}`}>{configured ? (fa ? "پیکربندی شده" : "Configured") : (fa ? "اختیاری" : "Optional")}</span></div>
    <div className="endpoint-source-list">{sources.map((source, index) => <fieldset className="endpoint-source" key={index}>
      <legend>{fa ? `منبع ${index + 1}` : `Source ${index + 1}`}{sources.length > 1 && <button className="icon-button tiny" type="button" aria-label={fa ? "حذف منبع" : "Remove source"} onClick={() => { onClear(false); const next = sources.filter((_, row) => row !== index); setSources(next); updateAfterRemove(next); }}><Trash2 size={13}/></button>}</legend>
      <div className="endpoint-fields"><label>{fa ? "شناسه منبع" : "Source ID"}<input required={Boolean(source.url.trim())} value={source.id} maxLength={100} onChange={(event) => update(index, { id: event.target.value })} placeholder="my-provider"/></label><label className="endpoint-url">{fa ? "نشانی HTTPS" : "HTTPS endpoint URL"}<input type="url" value={source.url} onChange={(event) => update(index, { url: event.target.value })} placeholder="https://api.example.com/research"/><small>{fa ? "HTTP فقط برای localhost مجاز است." : "HTTP is allowed only for localhost."}</small></label>
        <label>{fa ? "مهلت درخواست (میلی‌ثانیه)" : "Timeout (ms)"}<input type="number" min="1" max="30000" value={source.timeoutMs} onChange={(event) => update(index, { timeoutMs: event.target.value })}/></label>
        {isResearch && <label>{fa ? "حداکثر عمر داده (ثانیه)" : "Maximum data age (seconds)"}<input type="number" min="1" max="2592000" value={source.maxAgeSeconds} onChange={(event) => update(index, { maxAgeSeconds: event.target.value })}/></label>}
      </div>
      {isResearch && <fieldset className="endpoint-categories"><legend>{fa ? "دسته‌های داده‌ای که این منبع پشتیبانی می‌کند" : "Data categories this source supports"}</legend><div>{categories.map((category) => <label key={category}><input type="checkbox" checked={source.categories.includes(category)} disabled={source.categories.length === 1 && source.categories.includes(category)} onChange={(event) => update(index, { categories: event.target.checked ? [...source.categories, category] : source.categories.filter((item) => item !== category) })}/>{labels[category][locale]}</label>)}</div><small>{fa ? "دست‌کم یک دسته را انتخاب‌شده نگه دارید." : "At least one category is required."}</small></fieldset>}
      <details className="endpoint-headers"><summary><CircleHelp size={13}/>{fa ? "هدرهای سفارشی (اختیاری)" : "Custom headers (optional)"}</summary><small>{fa ? "برای هدرهایی مانند Authorization. مقدار هنگام ذخیره رمزگذاری می‌شود و بعداً نمایش داده نمی‌شود." : "For headers such as Authorization. Values are encrypted at rest and never shown again."}</small>{source.headers.map((header, headerIndex) => <div className="endpoint-header-row" key={headerIndex}><input aria-label={fa ? "نام هدر" : "Header name"} value={header.name} onChange={(event) => update(index, { headers: source.headers.map((item, row) => row === headerIndex ? { ...item, name: event.target.value } : item) })} placeholder="Authorization"/><input aria-label={fa ? "مقدار هدر" : "Header value"} type="password" autoComplete="new-password" value={header.value} onChange={(event) => update(index, { headers: source.headers.map((item, row) => row === headerIndex ? { ...item, value: event.target.value } : item) })} placeholder="Bearer …"/><button className="icon-button tiny" type="button" aria-label={fa ? "حذف هدر" : "Remove header"} onClick={() => update(index, { headers: source.headers.filter((_, row) => row !== headerIndex) })}><Trash2 size={13}/></button></div>)}<button type="button" className="text-button" onClick={() => update(index, { headers: [...source.headers, { name: "", value: "" }] })}><Plus size={14}/>{fa ? "افزودن هدر" : "Add header"}</button></details>
    </fieldset>)}</div>
    <div className="endpoint-editor-footer"><button type="button" className="button secondary small-button" disabled={sources.length >= (isResearch ? 10 : 5)} onClick={() => { onClear(false); const next = [...sources, emptySource(sources.length, kind)]; setSources(next); }}><Plus size={13}/>{fa ? "افزودن منبع" : "Add source"}</button>{configured && <label className="clear-secret"><input type="checkbox" checked={Boolean(cleared)} onChange={(event) => onClear(event.target.checked)}/>{fa ? "پاک‌سازی فهرست ذخیره‌شده" : "Clear stored list"}</label>}</div>
    <input type="hidden" name={`${kind}-sources`} value={value}/>
  </section>;

  function updateAfterRemove(next: Source[]) {
    onClear(false);
    const payload = next.filter((source) => source.url.trim()).map((source) => ({
      id: source.id.trim(), url: source.url.trim(), timeoutMs: Number(source.timeoutMs) || (isResearch ? 5000 : 4000),
      ...(isResearch ? { categories: source.categories, maxAgeSeconds: Number(source.maxAgeSeconds) || 86400 } : {}),
      ...(source.headers.some((header) => header.name.trim()) ? { headers: Object.fromEntries(source.headers.filter((header) => header.name.trim()).map(({ name, value }) => [name.trim(), value])) } : {}),
    }));
    onValue(payload.length ? JSON.stringify(payload) : "");
  }
}
