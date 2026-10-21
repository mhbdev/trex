import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AppSelect, FieldLabelInfo } from "./ui-primitives";

const roles = ["market_technical_analyst", "news_analyst", "sentiment_analyst", "tokenomics_analyst", "bull_researcher", "bear_researcher", "research_manager", "trader", "aggressive_risk_analyst", "conservative_risk_analyst", "neutral_risk_analyst", "portfolio_manager", "reflector"];
const providers = ["openai", "anthropic", "google", "compatible", "boxapi", "liara"];
type Route = { role: string; provider: string; model: string };
function parse(value: string): Route[] | null {
  try {
    const input = JSON.parse(value) as Record<string, string>;
    if (!input || Array.isArray(input) || typeof input !== "object") return null;
    return Object.entries(input).map(([role, setting]) => {
      if (typeof setting !== "string") return null;
      const [provider, ...modelParts] = setting.split(":");
      const model = modelParts.join(":");
      return { role, provider: providers.includes(provider ?? "") ? provider! : "openai", model: model ?? "" };
    }).filter((route): route is Route => route !== null);
  } catch { return null; }
}

export function RoleRouteEditor({ value, disabled, locale, onChange }: { value: string; disabled: boolean; locale: "fa" | "en"; onChange: (value: string) => void }) {
  const fa = locale === "fa";
  const routes = useMemo(() => parse(value), [value]);
  const roleNames: Record<string, { fa: string; en: string }> = {
    market_technical_analyst: { fa: "تحلیل‌گر بازار و تکنیکال", en: "Market & technical analyst" }, news_analyst: { fa: "تحلیل‌گر خبر", en: "News analyst" },
    sentiment_analyst: { fa: "تحلیل‌گر احساسات", en: "Sentiment analyst" }, tokenomics_analyst: { fa: "تحلیل‌گر توکنومیک", en: "Tokenomics analyst" },
    bull_researcher: { fa: "پژوهشگر صعودی", en: "Bull researcher" }, bear_researcher: { fa: "پژوهشگر نزولی", en: "Bear researcher" },
    research_manager: { fa: "مدیر پژوهش", en: "Research manager" }, trader: { fa: "معامله‌گر", en: "Trader" },
    aggressive_risk_analyst: { fa: "تحلیل‌گر ریسک تهاجمی", en: "Aggressive risk analyst" }, conservative_risk_analyst: { fa: "تحلیل‌گر ریسک محتاط", en: "Conservative risk analyst" },
    neutral_risk_analyst: { fa: "تحلیل‌گر ریسک بی‌طرف", en: "Neutral risk analyst" }, portfolio_manager: { fa: "مدیر پرتفوی", en: "Portfolio manager" }, reflector: { fa: "بازتاب‌گر", en: "Reflector" },
  };
  const write = (next: Route[]) => onChange(JSON.stringify(Object.fromEntries(next.map((route) => [route.role, `${route.provider}:${route.model.trim()}`]))));
  if (!routes) return <div className="route-editor-invalid"><p>{fa ? "این تنظیم JSON معتبر نیست؛ برای اصلاح، ویرایش مستقیم را باز کنید." : "This JSON is invalid. Open the raw editor to repair it."}</p><details><summary>{fa ? "اصلاح مستقیم JSON" : "Repair raw JSON"}</summary><textarea rows={4} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} spellCheck={false}/></details></div>;
  return <div className="route-editor">
    <div className="route-editor-heading"><span>{fa ? "تخصیص مدل به نقش‌ها" : "Assign models to agent roles"}<FieldLabelInfo label={fa ? "تخصیص مدل به نقش‌ها" : "Role model routing"} help={fa ? "برای نقش‌های انتخاب‌شده، ارائه‌دهنده و شناسه مدل اختصاصی تعیین کنید. قالب مدل provider:model است؛ نقش‌های بدون مسیر از مدل پیش‌فرض پروفایل استفاده می‌کنند." : "Choose a dedicated provider and model ID for selected roles. Stored as provider:model; roles without an override use the profile default."}/></span><small>{fa ? "نقش‌های خالی از مدل پیش‌فرض استفاده می‌کنند. پیش از ذخیره، شناسه مدل را وارد کنید." : "Unlisted roles use the profile default. Enter a model ID before saving."}</small></div>
    {routes.map((route, index) => <div className="route-row" key={`${route.role}-${index}`}><AppSelect ariaLabel={fa ? "نقش عامل" : "Agent role"} value={route.role} locale={locale} disabled={disabled} onValueChange={(role) => write(routes.map((item, row) => row === index ? { ...item, role } : item))} options={roles.map((role) => ({ value: role, label: roleNames[role]![locale], disabled: routes.some((item, row) => row !== index && item.role === role) }))}/><AppSelect ariaLabel={fa ? "ارائه‌دهنده مدل" : "Model provider"} value={route.provider} locale={locale} disabled={disabled} onValueChange={(provider) => write(routes.map((item, row) => row === index ? { ...item, provider } : item))} options={providers.map((provider) => ({ value: provider, label: provider }))}/><input aria-label={fa ? "شناسه مدل دقیق" : "Exact model ID"} value={route.model} disabled={disabled} onChange={(event) => write(routes.map((item, row) => row === index ? { ...item, model: event.target.value } : item))} placeholder="model-id"/><button type="button" className="icon-button tiny" disabled={disabled} aria-label={fa ? "حذف مسیر" : "Remove route"} onClick={() => write(routes.filter((_, row) => row !== index))}><Trash2 size={13}/></button></div>)}
    <button type="button" className="text-button" disabled={disabled || routes.length >= roles.length} onClick={() => write([...routes, { role: roles.find((role) => !routes.some((route) => route.role === role)) ?? roles[0]!, provider: providers[0]!, model: "" }])}><Plus size={14}/>{fa ? "افزودن مسیر نقش" : "Add role route"}</button>
  </div>;
}
