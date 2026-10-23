import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Cpu, Gauge, LoaderCircle, Search, Shield, Sparkles, WalletCards } from "lucide-react";
import { api } from "./api";
import { AppSelect, FieldLabelInfo } from "./ui-primitives";

type Locale = "fa" | "en";
type Provider = "openai" | "anthropic" | "google" | "compatible" | "boxapi" | "liara";
type Field = { key: string; value: string; secret: boolean };
type SecretState = { aiApiKey?: boolean; providerKeys?: Partial<Record<Provider, boolean>>; wallexApiKey?: boolean; subAccountClientId?: boolean };
type Market = { symbol: string; baseAsset: string; quoteAsset: string; spotEnabled: boolean };
type Check = { name: string; status: string; detail: string };
type Helpers = {
  errorText: (message: string, locale: Locale) => string;
  issueText: (message: string, locale: Locale) => string;
  diagnosticTitle: (name: string, locale: Locale) => string;
  diagnosticDetailText: (name: string, status: string, detail: string, locale: Locale) => string;
  statusTitle: (value: string, locale: Locale) => string;
};

const providers: Provider[] = ["openai", "anthropic", "google", "compatible", "boxapi", "liara"];
const suggestedModel: Record<Provider, string> = { openai: "gpt-4.1-mini", anthropic: "", google: "", compatible: "", boxapi: "gpt-5.6-luna", liara: "" };
const starterBases = ["BTC", "ETH", "USDT"];

export function setupNeeded(config: { ai?: { apiKeyConfigured?: boolean }; wallex?: { allowedMarkets?: string[] } } | undefined): boolean {
  if (!config) return false;
  return !config.ai?.apiKeyConfigured || !(config.wallex?.allowedMarkets?.length);
}

export function SetupWizard({ locale, profileId, profileName, fields, secrets, helpers, notify, onRefresh, onFinish, onDismiss }: {
  locale: Locale; profileId: string; profileName: string; fields: Field[]; secrets: SecretState; helpers: Helpers;
  notify: (message: string) => void; onRefresh: () => void; onFinish: () => void; onDismiss: () => void;
}) {
  const tx = (fa: string, en: string) => locale === "fa" ? fa : en;
  const fieldValue = (key: string, fallback = "") => fields.find((field) => field.key === key)?.value || fallback;
  const currentProvider = fieldValue("AI_PROVIDER", "openai") as Provider;

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Step 1: AI provider, model, and credential.
  const [provider, setProvider] = useState<Provider>(providers.includes(currentProvider) ? currentProvider : "openai");
  const [model, setModel] = useState(fieldValue("AI_MODEL"));
  const [baseUrl, setBaseUrl] = useState(fieldValue("AI_BASE_URL"));
  const [boxapiBaseUrl, setBoxapiBaseUrl] = useState(fieldValue("BOXAPI_BASE_URL", "https://ai.boxapi.ir/ai/v1"));
  const [liaraBaseUrl, setLiaraBaseUrl] = useState(fieldValue("LIARA_BASE_URL", "https://ai.liara.ir"));
  const [liaraWorkspaceId, setLiaraWorkspaceId] = useState(fieldValue("LIARA_WORKSPACE_ID"));
  const [apiKey, setApiKey] = useState("");
  const keyAlreadySaved = Boolean(secrets.providerKeys?.[provider]) || (provider === currentProvider && Boolean(secrets.aiApiKey));

  // Step 2: Wallex markets and optional account access.
  const configuredMarkets = useMemo(() => fieldValue("WALLEX_ALLOWED_MARKETS").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean), [fields]);
  const [quoteCurrency, setQuoteCurrency] = useState(fieldValue("WALLEX_QUOTE_CURRENCY", "TMN").toUpperCase());
  const [selected, setSelected] = useState<string[]>(configuredMarkets);
  const [search, setSearch] = useState("");
  const [wallexApiKey, setWallexApiKey] = useState("");
  const [subAccountClientId, setSubAccountClientId] = useState("");
  const [packageId, setPackageId] = useState(fieldValue("WALLEX_PACKAGE_ID"));
  const marketsQuery = useQuery({
    queryKey: ["setup-markets", profileId],
    queryFn: () => api<{ markets: Market[] }>(`/api/markets?all=true&profileId=${encodeURIComponent(profileId)}`),
    retry: false, enabled: step === 1,
  });
  const markets = marketsQuery.data?.markets ?? [];
  const quoteOptions = useMemo(() => {
    const quotes = new Set<string>(markets.map((market) => market.quoteAsset.toUpperCase()));
    quotes.add(quoteCurrency);
    return [...quotes].sort((a, b) => (a === "TMN" ? -1 : b === "TMN" ? 1 : a.localeCompare(b)));
  }, [markets, quoteCurrency]);
  const quoteMarkets = useMemo(() => markets.filter((market) => market.quoteAsset.toUpperCase() === quoteCurrency).sort((a, b) => a.symbol.localeCompare(b.symbol)), [markets, quoteCurrency]);
  // Selected pairs float to the top so the user always sees what the allowlist contains.
  const visibleMarkets = quoteMarkets
    .filter((market) => !search || market.symbol.toLowerCase().includes(search.toLowerCase()) || market.baseAsset.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(selected.includes(b.symbol)) - Number(selected.includes(a.symbol)));
  useEffect(() => {
    // Suggest a short starter allowlist the first time the market list is available and nothing was configured.
    if (!markets.length || configuredMarkets.length || selected.length) return;
    const starter = quoteMarkets.filter((market) => starterBases.includes(market.baseAsset.toUpperCase()) && market.spotEnabled).map((market) => market.symbol);
    if (starter.length) setSelected(starter);
  }, [markets.length, quoteCurrency]);
  const toggleMarket = (symbol: string) => setSelected((current) => current.includes(symbol) ? current.filter((item) => item !== symbol) : [...current, symbol].sort());

  // Step 3: validation and diagnostics.
  const [checking, setChecking] = useState(false);
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] } | null>(null);
  const [diagnostics, setDiagnostics] = useState<{ healthy: boolean; checks: Check[] } | null>(null);
  const runChecks = async () => {
    setChecking(true); setError(""); setValidation(null); setDiagnostics(null);
    try {
      const [validate, doctor] = await Promise.all([
        api<{ valid: boolean; errors: string[] }>(`/api/validate?mode=shadow&profileId=${encodeURIComponent(profileId)}`),
        api<{ healthy: boolean; checks: Check[] }>(`/api/diagnostics?profileId=${encodeURIComponent(profileId)}`, { method: "POST", body: JSON.stringify({ mode: "shadow", checkWallex: true }) }),
      ]);
      setValidation(validate); setDiagnostics(doctor);
    } catch (caught) {
      setError(caught instanceof Error ? helpers.errorText(caught.message, locale) : tx("بررسی انجام نشد.", "The checks could not run."));
    } finally { setChecking(false); }
  };
  useEffect(() => { if (step === 2) void runChecks(); }, [step]);

  const stepOneProblem = (): string => {
    if (!model.trim()) return tx("نام مدل را وارد کنید.", "Enter the model ID.");
    if (!apiKey.trim() && !keyAlreadySaved) return tx("کلید دسترسی سرویس هوش مصنوعی لازم است.", "The AI provider API key is required.");
    if (provider === "compatible" && !/^https?:\/\//.test(baseUrl.trim())) return tx("نشانی سرویس سازگار با OpenAI باید با http یا https شروع شود.", "The OpenAI-compatible service URL must start with http or https.");
    if (provider === "liara" && !liaraWorkspaceId.trim()) return tx("شناسهٔ فضای کاری Liara لازم است.", "The Liara workspace ID is required.");
    return "";
  };
  const saveStepOne = async () => {
    const problem = stepOneProblem();
    if (problem) { setError(problem); return; }
    setSaving(true); setError("");
    try {
      const settings: Record<string, string> = { AI_PROVIDER: provider, AI_MODEL: model.trim() };
      if (provider === "compatible") settings.AI_BASE_URL = baseUrl.trim();
      if (provider === "boxapi") settings.BOXAPI_BASE_URL = boxapiBaseUrl.trim();
      if (provider === "liara") { settings.LIARA_BASE_URL = liaraBaseUrl.trim(); settings.LIARA_WORKSPACE_ID = liaraWorkspaceId.trim(); }
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ profileId, settings }) });
      if (apiKey.trim()) await api(`/api/profiles/${encodeURIComponent(profileId)}`, { method: "PUT", body: JSON.stringify({ secrets: { providerKeys: { [provider]: apiKey.trim() } } }) });
      setApiKey(""); onRefresh(); setStep(1);
    } catch (caught) { setError(caught instanceof Error ? helpers.errorText(caught.message, locale) : tx("ذخیره انجام نشد.", "Saving failed.")); }
    finally { setSaving(false); }
  };

  const saveStepTwo = async () => {
    if (!selected.length) { setError(tx("دست‌کم یک جفت‌ارز انتخاب کنید.", "Select at least one market.")); return; }
    setSaving(true); setError("");
    try {
      const settings: Record<string, string> = { WALLEX_QUOTE_CURRENCY: quoteCurrency, WALLEX_ALLOWED_MARKETS: selected.join(",") };
      if (packageId.trim() !== fieldValue("WALLEX_PACKAGE_ID")) settings.WALLEX_PACKAGE_ID = packageId.trim();
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ profileId, settings }) });
      const credentials: Record<string, string> = {};
      if (wallexApiKey.trim()) credentials.wallexApiKey = wallexApiKey.trim();
      if (subAccountClientId.trim()) credentials.subAccountClientId = subAccountClientId.trim();
      if (Object.keys(credentials).length) await api(`/api/profiles/${encodeURIComponent(profileId)}`, { method: "PUT", body: JSON.stringify({ secrets: credentials }) });
      setWallexApiKey(""); setSubAccountClientId(""); onRefresh(); setStep(2);
    } catch (caught) { setError(caught instanceof Error ? helpers.errorText(caught.message, locale) : tx("ذخیره انجام نشد.", "Saving failed.")); }
    finally { setSaving(false); }
  };

  const finish = () => {
    try { localStorage.setItem(`trex-setup-done:${profileId}`, String(Date.now())); } catch { /* storage unavailable */ }
    notify(tx("راه‌اندازی اولیه کامل شد. با یک شبیه‌سازی شروع کنید.", "Initial setup is complete. Start with a simulation."));
    onFinish();
  };

  const providerOptions = providers.map((id) => ({
    value: id,
    label: id === "openai" ? "OpenAI" : id === "anthropic" ? "Anthropic" : id === "google" ? "Google" : id === "compatible" ? tx("سرویس سازگار با OpenAI", "OpenAI-compatible") : id === "boxapi" ? "BoxAPI" : "Liara",
    detail: id === "compatible" ? tx("نشانی و مدل سرویس دلخواه", "Custom provider URL and model") : id === "boxapi" ? tx("مدل از مسیر BoxAPI", "Models through BoxAPI") : id === "liara" ? tx("مدل از مسیر Liara", "Models through Liara") : tx("کلید حساب خودتان", "Your own account key"),
  }));
  const steps = [
    { title: tx("هوش مصنوعی", "AI provider"), hint: tx("سرویس، مدل و کلید", "Service, model, and key"), icon: Cpu },
    { title: tx("والکس", "Wallex"), hint: tx("جفت‌ارزها و دسترسی حساب", "Markets and account access"), icon: WalletCards },
    { title: tx("بررسی", "Check"), hint: tx("اعتبارسنجی و سلامت", "Validation and health"), icon: Gauge },
  ];
  const failedChecks = diagnostics?.checks.filter((check) => check.status === "fail") ?? [];

  return <div className="wizard">
    <div className="page-heading"><div><h1>{tx("راه‌اندازی سریع", "Quick setup")}</h1><p className="muted">{tx(`سه قدم تا اولین شبیه‌سازی در پروفایل «${profileName}». کلیدها رمزگذاری می‌شوند و بعداً می‌توانید هر مورد را در صفحهٔ پروفایل‌ها تغییر دهید.`, `Three steps to your first simulation in the "${profileName}" profile. Credentials are encrypted, and everything can be changed later on the Profiles page.`)}</p></div><button className="text-button" onClick={onDismiss}>{tx("بعداً انجام می‌دهم", "Skip for now")}</button></div>
    <div className="wizard-steps" role="list">{steps.map((item, index) => <div key={item.title} role="listitem" className={`wizard-step ${index === step ? "active" : index < step ? "done" : ""}`} aria-current={index === step ? "step" : undefined}><span className="wizard-step-index">{index < step ? <Check size={13}/> : index + 1}</span><span><b>{item.title}</b><small>{item.hint}</small></span></div>)}</div>

    {error && <div className="notice warning" role="alert"><span className="notice-icon"><AlertTriangle size={17}/></span><div><b>{tx("ادامه ممکن نیست", "Cannot continue yet")}</b><p>{error}</p></div></div>}

    {step === 0 && <section className="card">
      <div className="card-heading"><div><h2><Cpu size={17}/>{tx("دستیارها با کدام سرویس هوش مصنوعی کار کنند؟", "Which AI service should the agents use?")}</h2><small className="muted">{tx("این سرویس برای همهٔ دستیارها پیش‌فرض می‌شود. مدل باید فراخوانی ابزار و خروجی ساخت‌یافته را پشتیبانی کند.", "This becomes the default for every agent. The model must support tool calling and structured output.")}</small></div></div>
      <div className="wizard-grid">
        <label className="wizard-field"><FieldLabelInfo label={tx("سرویس هوش مصنوعی", "AI provider")} help={tx("سرویسی که حساب و کلید آن را دارید.", "The service you hold an account and API key for.")}/><AppSelect ariaLabel={tx("سرویس هوش مصنوعی", "AI provider")} value={provider} locale={locale} options={providerOptions} onValueChange={(value) => { const next = value as Provider; setProvider(next); setModel(next === currentProvider ? fieldValue("AI_MODEL") : suggestedModel[next]); setError(""); }}/></label>
        <label className="wizard-field"><FieldLabelInfo label={tx("نام مدل", "Model ID")} help={tx("نام دقیق مدل همان‌طور که سرویس شما آن را می‌شناسد.", "The exact model ID as your provider lists it.")}/><input type="text" dir="ltr" value={model} onChange={(event) => setModel(event.target.value)} placeholder={suggestedModel[provider] || tx("مثلاً نام مدل از فهرست مدل‌های حساب شما", "e.g. a model ID from your account's model list")} autoComplete="off"/></label>
        {provider === "compatible" && <label className="wizard-field full"><FieldLabelInfo label={tx("نشانی سرویس سازگار با OpenAI", "OpenAI-compatible service URL")} help={tx("برای سرویس‌های اینترنتی نشانی HTTPS لازم است؛ http فقط برای localhost مجاز است.", "Internet services need HTTPS; http is allowed only for localhost.")}/><input type="url" dir="ltr" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://example.com/v1" autoComplete="off"/></label>}
        {provider === "boxapi" && <label className="wizard-field full"><FieldLabelInfo label={tx("نشانی سرویس BoxAPI", "BoxAPI service URL")} help={tx("اگر از سرویس رسمی استفاده می‌کنید، مقدار پیش‌فرض را نگه دارید.", "Keep the default for the official service.")}/><input type="url" dir="ltr" value={boxapiBaseUrl} onChange={(event) => setBoxapiBaseUrl(event.target.value)} autoComplete="off"/></label>}
        {provider === "liara" && <><label className="wizard-field"><FieldLabelInfo label={tx("نشانی سرویس Liara", "Liara service URL")} help={tx("اگر از سرویس رسمی استفاده می‌کنید، مقدار پیش‌فرض را نگه دارید.", "Keep the default for the official service.")}/><input type="url" dir="ltr" value={liaraBaseUrl} onChange={(event) => setLiaraBaseUrl(event.target.value)} autoComplete="off"/></label>
          <label className="wizard-field"><FieldLabelInfo label={tx("شناسهٔ فضای کاری Liara", "Liara workspace ID")} help={tx("فضای کاری‌ای که مدل‌ها و کلید شما به آن تعلق دارند.", "The workspace your models and key belong to.")}/><input type="text" dir="ltr" value={liaraWorkspaceId} onChange={(event) => setLiaraWorkspaceId(event.target.value)} autoComplete="off"/></label></>}
        <label className="wizard-field full"><FieldLabelInfo label={tx("کلید دسترسی (API key)", "API key")} help={tx("رمزگذاری‌شده ذخیره می‌شود و دیگر نمایش داده نمی‌شود.", "Stored encrypted and never displayed again.")}/><input type="password" dir="ltr" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={keyAlreadySaved ? tx("کلیدی ذخیره شده است؛ برای نگه‌داشتن آن خالی بگذارید", "A key is already saved; leave blank to keep it") : ""} autoComplete="off"/>{keyAlreadySaved && <small className="muted"><Check size={12}/> {tx("برای این سرویس کلید ذخیره شده است.", "A key is saved for this provider.")}</small>}</label>
      </div>
      <div className="wizard-actions"><span className="muted"><Shield size={13}/> {tx("فراخوانی مدل ممکن است برای حساب شما هزینه داشته باشد.", "Model calls may incur charges on your account.")}</span><div><button className="button primary" onClick={() => void saveStepOne()} disabled={saving}>{saving ? <LoaderCircle className="spin" size={15}/> : <ArrowRight size={15}/>}{tx("ذخیره و ادامه", "Save and continue")}</button></div></div>
    </section>}

    {step === 1 && <section className="card">
      <div className="card-heading"><div><h2><WalletCards size={17}/>{tx("کدام جفت‌ارزها بررسی شوند؟", "Which markets should the agents analyze?")}</h2><small className="muted">{tx("فهرست مجاز، بازارهای در دسترس اجراها را محدود می‌کند و سفارشی ثبت نمی‌کند. با چند جفت‌ارز شروع کنید.", "The allowlist limits which markets runs may use; it does not place orders. Start with a few pairs.")}</small></div><span className="count-pill">{selected.length} {tx("انتخاب‌شده", "selected")}</span></div>
      <div className="wizard-grid">
        <label className="wizard-field"><FieldLabelInfo label={tx("ارز بازار پایه", "Quote currency")} help={tx("ارزی که قیمت‌ها و ارزش سبد با آن نمایش داده می‌شود. فقط جفت‌ارزهای همین ارز نمایش داده می‌شوند.", "Prices and portfolio value are shown in this currency. Only pairs quoted in it are listed.")}/><AppSelect ariaLabel={tx("ارز بازار پایه", "Quote currency")} value={quoteCurrency} locale={locale} options={quoteOptions.map((quote) => ({ value: quote, label: quote }))} onValueChange={(value) => { setQuoteCurrency(value); setSelected((current) => current.filter((symbol) => symbol.endsWith(value))); }}/></label>
        <label className="wizard-field"><FieldLabelInfo label={tx("جست‌وجوی جفت‌ارز", "Search markets")} help={tx("نماد یا ارز پایه را بنویسید.", "Type a symbol or base asset.")}/><span className="field-search"><Search size={15}/><input aria-label={tx("جست‌وجو", "Search")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="BTC"/></span></label>
      </div>
      {marketsQuery.isPending && <div className="loading-line"><LoaderCircle className="spin" size={18}/>{tx("در حال دریافت بازارهای والکس…", "Fetching Wallex markets…")}</div>}
      {marketsQuery.isError && <div className="notice warning"><span className="notice-icon"><AlertTriangle size={17}/></span><div><b>{tx("بازارها بارگیری نشدند", "Could not load markets")}</b><p>{helpers.errorText(marketsQuery.error.message, locale)}</p></div></div>}
      {!marketsQuery.isPending && !marketsQuery.isError && <div className="wizard-market-grid">{visibleMarkets.slice(0, 120).map((market) => <button type="button" key={market.symbol} className={`wizard-market ${selected.includes(market.symbol) ? "selected" : ""}`} aria-pressed={selected.includes(market.symbol)} onClick={() => toggleMarket(market.symbol)}><span className="wizard-market-check">{selected.includes(market.symbol) ? <Check size={13}/> : null}</span>{market.baseAsset}/{market.quoteAsset}{!market.spotEnabled && <small>{tx("غیرفعال", "inactive")}</small>}</button>)}{visibleMarkets.length === 0 && <p className="muted">{tx("جفت‌ارزی با این مشخصات پیدا نشد.", "No market matches this search.")}</p>}</div>}
      <details className="wizard-optional">
        <summary><b>{tx("دسترسی به حساب والکس (اختیاری)", "Wallex account access (optional)")}</b><small>{tx("فقط برای نمایش موجودی واقعی و معاملهٔ واقعی لازم است؛ شبیه‌سازی بدون آن کار می‌کند.", "Needed only for the real balance view and live trading; simulations work without it.")}</small></summary>
        <div className="wizard-grid">
          <label className="wizard-field"><FieldLabelInfo label={tx("کلید API والکس", "Wallex API key")} help={tx("کلیدی با دسترسی خواندن و معامله و بدون دسترسی برداشت. رمزگذاری‌شده ذخیره می‌شود.", "A key with read and trade permission and no withdrawal permission. Stored encrypted.")}/><input type="password" dir="ltr" value={wallexApiKey} onChange={(event) => setWallexApiKey(event.target.value)} placeholder={secrets.wallexApiKey ? tx("ذخیره شده؛ برای نگه‌داشتن خالی بگذارید", "Saved; leave blank to keep") : ""} autoComplete="off"/></label>
          <label className="wizard-field"><FieldLabelInfo label={tx("شناسهٔ حساب اعتباری (client ID)", "Sub-account client ID")} help={tx("مقدار client_id در ردیف حساب اعتباری فعال والکس.", "The client_id of the active credit account in Wallex.")}/><input type="password" dir="ltr" value={subAccountClientId} onChange={(event) => setSubAccountClientId(event.target.value)} placeholder={secrets.subAccountClientId ? tx("ذخیره شده؛ برای نگه‌داشتن خالی بگذارید", "Saved; leave blank to keep") : ""} autoComplete="off"/></label>
          <label className="wizard-field full"><FieldLabelInfo label={tx("شناسهٔ بستهٔ اعتباری", "Credit package ID")} help={tx("شناسهٔ بسته از فهرست بسته‌های فعال والکس، نه مبلغ وام یا شناسهٔ حساب. با داشتن آن، کلید API هم لازم می‌شود.", "The package ID from Wallex's active packages list, not the loan amount or client ID. Setting it also requires the API key.")}/><input type="text" dir="ltr" value={packageId} onChange={(event) => setPackageId(event.target.value)} autoComplete="off"/></label>
        </div>
      </details>
      <div className="wizard-actions"><button className="button secondary" onClick={() => { setError(""); setStep(0); }} disabled={saving}><ArrowLeft size={15}/>{tx("قبلی", "Back")}</button><div><button className="button primary" onClick={() => void saveStepTwo()} disabled={saving || marketsQuery.isPending}>{saving ? <LoaderCircle className="spin" size={15}/> : <ArrowRight size={15}/>}{tx("ذخیره و ادامه", "Save and continue")}</button></div></div>
    </section>}

    {step === 2 && <section className="card">
      <div className="card-heading"><div><h2><Gauge size={17}/>{tx("بررسی نهایی", "Final check")}</h2><small className="muted">{tx("تنظیمات شبیه‌سازی اعتبارسنجی و دسترسی خواندنی والکس آزمایش می‌شود. مدلی فراخوانی نمی‌شود و سفارشی ثبت نمی‌شود.", "Validates the simulation settings and tests read-only Wallex access. No model is called and no order is placed.")}</small></div></div>
      <dl className="wizard-summary">
        <div><dt>{tx("سرویس و مدل", "Provider and model")}</dt><dd dir="ltr">{provider} · {model || fieldValue("AI_MODEL")}</dd></div>
        <div><dt>{tx("جفت‌ارزهای مجاز", "Allowed markets")}</dt><dd dir="ltr">{selected.join(", ") || "—"}</dd></div>
      </dl>
      {checking && <div className="loading-line"><LoaderCircle className="spin" size={18}/>{tx("در حال بررسی…", "Running checks…")}</div>}
      {validation && <div className={`validation-box ${validation.valid ? "success" : "failure"}`} role="status"><b>{validation.valid ? tx("تنظیمات شبیه‌سازی معتبر است", "Simulation settings are valid") : tx("تنظیمات نیاز به اصلاح دارد", "Settings need attention")}</b>{validation.errors.length > 0 && <ul>{validation.errors.map((item) => <li key={item}>{helpers.issueText(item, locale)}</li>)}</ul>}</div>}
      {diagnostics && <div className="diagnostic-list"><h3>{tx("نتیجهٔ بررسی‌ها", "Check results")}</h3>{diagnostics.checks.map((check) => <div className="diagnostic-row" key={check.name}><span className={`status status-${check.status === "fail" ? "failed" : check.status}`}>{helpers.statusTitle(check.status, locale)}</span><div><b>{helpers.diagnosticTitle(check.name, locale)}</b><small>{helpers.diagnosticDetailText(check.name, check.status, check.detail, locale)}</small></div></div>)}</div>}
      {!checking && validation && !validation.valid && <p className="form-caption"><AlertTriangle size={14}/>{tx("می‌توانید برگردید و موارد را اصلاح کنید، یا بعداً از صفحهٔ پروفایل‌ها تغییرشان دهید.", "Go back to fix these items, or adjust them later on the Profiles page.")}</p>}
      {!checking && validation?.valid && failedChecks.length === 0 && <div className="notice info"><span className="notice-icon"><Sparkles size={17}/></span><div><b>{tx("همه‌چیز آماده است", "Everything is ready")}</b><p>{tx("با یک آزمایش تاریخی یا شبیه‌سازی زنده شروع کنید؛ هر دو با سرمایهٔ مجازی کار می‌کنند.", "Start with a backtest or a live simulation; both use virtual capital.")}</p></div></div>}
      <div className="wizard-actions"><button className="button secondary" onClick={() => { setError(""); setStep(1); }} disabled={checking}><ArrowLeft size={15}/>{tx("قبلی", "Back")}</button><div><button className="button secondary" onClick={() => void runChecks()} disabled={checking}><Gauge size={15}/>{tx("بررسی دوباره", "Run checks again")}</button><button className="button primary" onClick={finish} disabled={checking}><Check size={15}/>{tx("پایان و رفتن به آزمایش و اجرا", "Finish and open Run lab")}</button></div></div>
    </section>}
  </div>;
}
