import { useState } from "react";
import { CircleHelp, Database, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { FieldLabelInfo } from "./ui-primitives";

type Category = "market" | "technical" | "news" | "sentiment" | "tokenomics" | "on_chain" | "macro" | "prediction_market";
type Source = { id: string; url: string; timeoutMs: string; categories: Category[]; maxAgeSeconds: string; headers: Array<{ name: string; value: string }> };
type SourceKind = "research" | "quote";
const categories: Category[] = ["market", "technical", "news", "sentiment", "tokenomics", "on_chain", "macro", "prediction_market"];
const labels: Record<Category, { en: string; fa: string }> = {
  market: { en: "Market", fa: "بازار" }, technical: { en: "Technical", fa: "نمودار و شاخص‌ها" }, news: { en: "News", fa: "خبر" },
  sentiment: { en: "Sentiment", fa: "دیدگاه کاربران" }, tokenomics: { en: "Tokenomics", fa: "عرضه و کاربرد رمزارز" }, on_chain: { en: "On-chain", fa: "تراکنش‌های شبکه" },
  macro: { en: "Macro", fa: "اقتصاد کلان" }, prediction_market: { en: "Prediction markets", fa: "بازارهای پیش‌بینی" },
};
function emptySource(index: number, kind: SourceKind): Source {
  return { id: `${kind}-source-${index + 1}`, url: "", timeoutMs: kind === "research" ? "5000" : "4000", maxAgeSeconds: "86400", categories: ["market"], headers: [] };
}

/** User-friendly editor for optional write-only provider lists stored as encrypted profile secrets. */
export function EndpointListEditor({ kind, configured, value, cleared, onValue, onClear, locale, wallexBaseUrl, quoteCurrency = "TMN", redditEnabled = false }: {
  kind: SourceKind; configured?: boolean; value: string; cleared?: boolean; onValue: (value: string) => void; onClear: (value: boolean) => void;
  locale: "fa" | "en"; wallexBaseUrl: string; quoteCurrency?: string; redditEnabled?: boolean;
}) {
  const fa = locale === "fa";
  const isResearch = kind === "research";
  const [sources, setSources] = useState<Source[]>([]);
  const [editing, setEditing] = useState(false);
  const baseUrl = (wallexBaseUrl.trim() || "https://api.wallex.ir").replace(/\/+$/, "");
  const title = isResearch ? (fa ? "منابع پژوهشی تکمیلی" : "Additional research sources") : (fa ? "منبع جایگزین قیمت" : "Price fallback source");
  const explanation = isResearch
    ? (fa ? "برای بیشتر کاربران نیازی به تنظیم این بخش نیست؛ داده‌های آماده در دسترس‌اند. فقط اگر سرویس پژوهشی خودتان را دارید، آن را اضافه کنید." : "Most users can leave this unchanged; built-in sources are ready to use. Add a custom service only if you operate one.")
    : (fa ? "قیمت والکس به‌صورت پیش‌فرض استفاده می‌شود. فقط اگر منبع قیمت مستقل و سازگار دارید، آن را اضافه کنید." : "Wallex prices are used by default. Add a fallback only if you operate an independent compatible source.");

  const serialize = (next: Source[]) => {
    const payload = next.filter((source) => source.url.trim()).map((source) => ({
      id: source.id.trim(), url: source.url.trim(), timeoutMs: Number(source.timeoutMs) || (isResearch ? 5000 : 4000),
      ...(isResearch ? { categories: source.categories, maxAgeSeconds: Number(source.maxAgeSeconds) || 86400 } : {}),
      ...(source.headers.some((header) => header.name.trim()) ? { headers: Object.fromEntries(source.headers.filter((header) => header.name.trim()).map(({ name, value }) => [name.trim(), value])) } : {}),
    }));
    onValue(payload.length ? JSON.stringify(payload) : "");
  };
  const update = (index: number, change: Partial<Source>) => {
    onClear(false);
    const next = sources.map((source, row) => row === index ? { ...source, ...change } : source);
    setSources(next); serialize(next);
  };
  const beginEditing = () => { setSources([emptySource(0, kind)]); setEditing(true); onClear(false); };

  return <section className="endpoint-editor secret-wide" aria-label={title}>
    <div className="endpoint-editor-heading">
      <div><div className="field-label-info"><span className="field-label-copy">{title}</span><FieldLabelInfo label={title} help={explanation}/></div><small>{explanation}</small></div>
      <span className={`status ${configured ? "status-completed" : "status-neutral"}`}>{configured ? (fa ? "ذخیره‌شده" : "Stored") : (fa ? "اختیاری" : "Optional")}</span>
    </div>

    <div className="builtin-resource-panel">
      <div className="builtin-resource-heading"><span className="builtin-resource-icon"><Database size={15}/></span><div><b>{fa ? "منابع آماده" : "Ready-to-use sources"}</b><small>{fa ? "این منابع از قبل برای اجراها فعال‌اند؛ لازم نیست آن‌ها را دستی وارد کنید." : "These sources are already available to runs; no manual setup is needed."}</small></div><span className="status status-completed">{fa ? "آماده" : "Ready"}</span></div>
      {isResearch ? <div className="builtin-resource-list">
        <article className="builtin-resource-item"><div><b>{fa ? "بازارهای نقدی والکس" : "Wallex spot markets"}<span className="resource-state">{fa ? "اصلی" : "Primary"}</span></b><code dir="ltr">{baseUrl}/hector/web/v1/markets</code><small>{fa ? "فهرست جفت‌ارزهای فعال و آخرین قیمت را دریافت می‌کند. دستیارها هنگام تحلیل می‌توانند قیمت هر جفت فعال را جداگانه بخوانند." : "Discovers active spot pairs and their latest prices. Agents can also request the live price for any active pair during analysis."}</small></div></article>
        <article className="builtin-resource-item"><div><b>{fa ? "دفتر سفارش و نمودار قیمت والکس" : "Wallex order book and candles"}<span className="resource-state">{fa ? "فقط‌خواندنی" : "Read only"}</span></b><code dir="ltr">{baseUrl}/v1/depth · /v1/udf/history</code><small>{fa ? "بهترین قیمت‌های خرید و فروش و تغییرات قیمت در بازه‌های یک‌دقیقه‌ای را می‌خواند. دستیارها فقط وقتی لازم باشد این اطلاعات را دریافت می‌کنند." : "Bid/ask depth and one-minute OHLCV for active pairs; agents fetch these only when useful."}</small></div></article>
        <article className="builtin-resource-item"><div><b>{fa ? "بحث‌های عمومی ردیت" : "Public Reddit discussion"}<span className={`resource-state ${redditEnabled ? "resource-enabled" : "resource-disabled"}`}>{redditEnabled ? (fa ? "فعال" : "Enabled") : (fa ? "غیرفعال" : "Disabled")}</span></b><code dir="ltr">reddit.com/r/{"{crypto communities}"}/search.rss</code><small>{fa ? `دیدگاه‌های عمومی کاربران دربارهٔ رمزارز پایهٔ هر جفت‌ارز؛ این نوشته‌ها قیمت یا خبر تأییدشده نیستند.` : "Keyless public RSS search for each pair’s base asset; social opinion only, not price data or verified facts."}</small></div></article>
      </div> : <div className="builtin-resource-item builtin-primary-quote"><div><b>{fa ? "قیمت لحظه‌ای والکس" : "Wallex live market price"}<span className="resource-state">{fa ? "منبع اصلی" : "Primary source"}</span></b><code dir="ltr">{baseUrl}/hector/web/v1/markets</code><small>{fa ? `قیمت جفت‌های فعال با ارز بازار پایهٔ ${quoteCurrency.toUpperCase()}؛ معمولاً نیازی به افزودن منبع جایگزین نیست.` : `Live prices for active spot pairs quoted in ${quoteCurrency.toUpperCase()}. A fallback is only needed if you operate an independent compatible source.`}</small></div></div>}
      <p className="builtin-resource-footnote"><ShieldCheck size={13}/>{fa ? "خواندن قیمت، دفتر سفارش و داده‌های بازار امکان ثبت سفارش را فعال نمی‌کند." : "Reading prices, depth, and candles does not grant or create an order-submission path."}</p>
    </div>

    {configured && !editing && <div className="stored-endpoint-note"><b>{fa ? "منبع سفارشی ذخیره شده است" : "A custom source list is stored"}</b><small>{fa ? "نشانی و کلیدهای دسترسی برای امنیت پنهان هستند. منبع ذخیره‌شده تا زمان جایگزینی یا پاک‌کردن فعال می‌ماند." : "Addresses and credentials are hidden for security. The saved source list stays active until replaced or cleared."}</small><button type="button" className="button secondary small-button" onClick={beginEditing}><Plus size={13}/>{fa ? "جایگزینی منابع" : "Replace sources"}</button></div>}

    {editing && <details className="endpoint-contract"><summary>{fa ? "قالب فنی پاسخ سرویس (اختیاری)" : "Service response format (optional)"}</summary><p>{isResearch ? (fa ? "برای پژوهش، پاسخ باید فهرستی به نام items داشته باشد. هر مورد شامل دسته، نام منبع، عنوان و زمان ثبت است." : "Each source returns an items list. Every item needs a category, source name, title, and observation time.") : (fa ? "پاسخ باید نماد بازار و قیمت را داشته باشد. ثبت زمان اختیاری است و باید به میلی‌ثانیهٔ یونیکس باشد." : "The response must contain a market symbol and price. Observation time is optional and uses Unix milliseconds.")}</p><code dir="ltr">{isResearch ? '{ "items": [{ "category": "news", "source": "example", "title": "...", "observedAt": 0 }] }' : '{ "symbol": "BTCTMN", "price": "...", "observedAt": 0 }'}</code></details>}

    {editing && <div className="endpoint-source-list">{sources.map((source, index) => <fieldset className="endpoint-source" key={source.id}>
      <legend>{fa ? `منبع ${index + 1}` : `Source ${index + 1}`}{sources.length > 1 && <button className="icon-button tiny" type="button" aria-label={fa ? "حذف منبع" : "Remove source"} onClick={() => { const next = sources.filter((_, row) => row !== index); setSources(next); serialize(next); onClear(false); }}><Trash2 size={13}/></button>}</legend>
      <div className="endpoint-fields"><label>{fa ? "نام منبع" : "Source name"}<input required={Boolean(source.url.trim())} value={source.id} maxLength={100} onChange={(event) => update(index, { id: event.target.value })} placeholder={fa ? "مثلاً پژوهش-من" : "e.g. my-research-source"}/></label><label className="endpoint-url">{fa ? "نشانی سرویس (HTTPS)" : "Secure service address (HTTPS)"}<input type="url" value={source.url} onChange={(event) => update(index, { url: event.target.value })} placeholder="https://"/><small>{fa ? "نشانی سرویس خودتان را وارد کنید. نشانی HTTP فقط برای سرویسی پذیرفته می‌شود که روی همین دستگاه اجرا شده باشد." : "Enter your service address. HTTP is accepted only for services on this device."}</small></label>
        <label>{fa ? "مهلت درخواست (میلی‌ثانیه)" : "Timeout (ms)"}<input type="number" min="1" max="30000" value={source.timeoutMs} onChange={(event) => update(index, { timeoutMs: event.target.value })}/></label>
        {isResearch && <label>{fa ? "حداکثر عمر داده (ثانیه)" : "Maximum data age (seconds)"}<input type="number" min="1" max="2592000" value={source.maxAgeSeconds} onChange={(event) => update(index, { maxAgeSeconds: event.target.value })}/></label>}
      </div>
      {isResearch && <fieldset className="endpoint-categories"><legend>{fa ? "دسته‌های پشتیبانی‌شده" : "Supported data categories"}</legend><div>{categories.map((category) => <label key={category}><input type="checkbox" checked={source.categories.includes(category)} disabled={source.categories.length === 1 && source.categories.includes(category)} onChange={(event) => update(index, { categories: event.target.checked ? [...source.categories, category] : source.categories.filter((item) => item !== category) })}/>{labels[category][locale]}</label>)}</div><small>{fa ? "دست‌کم یک دسته را نگه دارید." : "Keep at least one category selected."}</small></fieldset>}
      <details className="endpoint-headers"><summary><CircleHelp size={13}/>{fa ? "اطلاعات ورود سرویس (اختیاری)" : "Service credentials (optional)"}</summary><small>{fa ? "برای سرویس‌هایی که کلید دسترسی می‌خواهند. مقدار هنگام ذخیره رمزگذاری می‌شود و بعداً نمایش داده نمی‌شود." : "For services that require credentials. Values are encrypted at rest and never shown again."}</small>{source.headers.map((header, headerIndex) => <div className="endpoint-header-row" key={headerIndex}><input aria-label={fa ? "نام هدر" : "Header name"} value={header.name} onChange={(event) => update(index, { headers: source.headers.map((item, row) => row === headerIndex ? { ...item, name: event.target.value } : item) })} placeholder="Authorization"/><input aria-label={fa ? "مقدار دسترسی" : "Credential value"} type="password" autoComplete="new-password" value={header.value} onChange={(event) => update(index, { headers: source.headers.map((item, row) => row === headerIndex ? { ...item, value: event.target.value } : item) })} placeholder="Bearer …"/><button className="icon-button tiny" type="button" aria-label={fa ? "حذف کلید دسترسی" : "Remove credential"} onClick={() => update(index, { headers: source.headers.filter((_, row) => row !== headerIndex) })}><Trash2 size={13}/></button></div>)}<button type="button" className="text-button" onClick={() => update(index, { headers: [...source.headers, { name: "", value: "" }] })}><Plus size={14}/>{fa ? "افزودن اطلاعات ورود" : "Add credential"}</button></details>
    </fieldset>)}</div>}

    <div className="endpoint-editor-footer">
      {(!configured || editing) && <button type="button" className="button secondary small-button" disabled={editing && sources.length >= (isResearch ? 10 : 5)} onClick={() => {
        onClear(false);
        if (!editing) { beginEditing(); return; }
        setSources((current) => [...current, emptySource(current.length, kind)]);
      }}><Plus size={13}/>{editing ? (fa ? "افزودن منبع" : "Add source") : (fa ? "افزودن منبع سفارشی" : "Add custom source")}</button>}
      {editing && <button type="button" className="text-button" onClick={() => { setEditing(false); setSources([]); onValue(""); onClear(false); }}>{fa ? "لغو ویرایش" : "Cancel editing"}</button>}
      {configured && <label className="clear-secret"><input type="checkbox" checked={Boolean(cleared)} onChange={(event) => onClear(event.target.checked)}/>{fa ? "پاک‌سازی فهرست ذخیره‌شده" : "Clear stored list"}</label>}
    </div>
    <input type="hidden" name={`${kind}-sources`} value={value}/>
  </section>;
}
