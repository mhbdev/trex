import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AppSelect, FieldLabelInfo } from "./ui-primitives";

const roles = ["market_technical_analyst", "news_analyst", "sentiment_analyst", "tokenomics_analyst", "bull_researcher", "bear_researcher", "research_manager", "trader", "aggressive_risk_analyst", "conservative_risk_analyst", "neutral_risk_analyst", "portfolio_manager", "reflector"];
const providers = ["openai", "anthropic", "google", "compatible", "boxapi", "liara"];
function providerLabel(provider: string, fa: boolean) {
  if (provider === "compatible") return fa ? "سرویس سازگار با OpenAI" : "OpenAI-compatible service";
  return provider === "boxapi" ? "BoxAPI" : provider === "liara" ? "Liara" : provider[0]!.toUpperCase() + provider.slice(1);
}
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
    market_technical_analyst: { fa: "تحلیل‌گر فنی بازار", en: "Market & technical analyst" }, news_analyst: { fa: "تحلیل‌گر خبر", en: "News analyst" },
    sentiment_analyst: { fa: "تحلیل‌گر دیدگاه کاربران", en: "Sentiment analyst" }, tokenomics_analyst: { fa: "تحلیل‌گر عرضه و کاربرد رمزارز", en: "Tokenomics analyst" },
    bull_researcher: { fa: "تحلیل‌گر سناریوی صعودی", en: "Bull researcher" }, bear_researcher: { fa: "تحلیل‌گر سناریوی نزولی", en: "Bear researcher" },
    research_manager: { fa: "مدیر پژوهش", en: "Research manager" }, trader: { fa: "معامله‌گر", en: "Trader" },
    aggressive_risk_analyst: { fa: "تحلیل‌گر ریسک فرصت‌محور", en: "Opportunity-focused risk analyst" }, conservative_risk_analyst: { fa: "تحلیل‌گر ریسک محتاط", en: "Conservative risk analyst" },
    neutral_risk_analyst: { fa: "تحلیل‌گر ریسک بی‌طرف", en: "Neutral risk analyst" }, portfolio_manager: { fa: "مدیر سبد دارایی", en: "Portfolio manager" }, reflector: { fa: "ارزیاب نتیجهٔ تصمیم‌ها", en: "Decision outcome reviewer" },
  };
  const write = (next: Route[]) => onChange(JSON.stringify(Object.fromEntries(next.map((route) => [route.role, `${route.provider}:${route.model.trim()}`]))));
  if (!routes) return <div className="route-editor-invalid"><p>{fa ? "این تنظیم قابل خواندن نیست. برای اصلاح دستی، ویرایش فنی را باز کنید." : "This setting could not be read. Open the raw editor to repair it."}</p><details><summary>{fa ? "ویرایش فنی" : "Repair raw JSON"}</summary><textarea rows={4} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} spellCheck={false}/></details></div>;
  return <div className="route-editor">
    <div className="route-editor-heading"><span>{fa ? "انتخاب مدل برای هر نقش" : "Assign models to agent roles"}<FieldLabelInfo label={fa ? "مدل هر نقش" : "Role model routing"} help={fa ? "برای بعضی نقش‌ها می‌توانید سرویس و مدل جداگانه انتخاب کنید. نقش‌های دیگر از مدل پیش‌فرض پروفایل استفاده می‌کنند." : "Choose a dedicated provider and model ID for selected roles. Roles without an override use the profile default."}/></span><small>{fa ? "اگر مدلی انتخاب نکنید، مدل پیش‌فرض پروفایل به کار می‌رود." : "Unlisted roles use the profile default. Enter a model ID before saving."}</small></div>
    {routes.map((route, index) => <div className="route-row" key={`${route.role}-${index}`}><AppSelect ariaLabel={fa ? "نقش دستیار" : "Agent role"} value={route.role} locale={locale} disabled={disabled} onValueChange={(role) => write(routes.map((item, row) => row === index ? { ...item, role } : item))} options={roles.map((role) => ({ value: role, label: roleNames[role]![locale], disabled: routes.some((item, row) => row !== index && item.role === role) }))}/><AppSelect ariaLabel={fa ? "سرویس هوش مصنوعی" : "Model provider"} value={route.provider} locale={locale} disabled={disabled} onValueChange={(provider) => write(routes.map((item, row) => row === index ? { ...item, provider } : item))} options={providers.map((provider) => ({ value: provider, label: providerLabel(provider, fa) }))}/><input aria-label={fa ? "شناسهٔ دقیق مدل" : "Exact model ID"} value={route.model} disabled={disabled} onChange={(event) => write(routes.map((item, row) => row === index ? { ...item, model: event.target.value } : item))} placeholder="model-id"/><button type="button" className="icon-button tiny" disabled={disabled} aria-label={fa ? "حذف انتخاب مدل" : "Remove route"} onClick={() => write(routes.filter((_, row) => row !== index))}><Trash2 size={13}/></button></div>)}
    <button type="button" className="text-button" disabled={disabled || routes.length >= roles.length} onClick={() => write([...routes, { role: roles.find((role) => !routes.some((route) => route.role === role)) ?? roles[0]!, provider: providers[0]!, model: "" }])}><Plus size={14}/>{fa ? "افزودن مسیر نقش" : "Add role route"}</button>
  </div>;
}
