import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowLeftRight, BarChart3, Blocks, Check, ChevronDown,
  CircleHelp, CirclePause, CirclePlay, CircleStop, Cpu, Database, FileClock, Gauge, Globe2, KeyRound,
  LayoutDashboard, ListFilter, LoaderCircle, LockKeyhole, LogOut, Moon, Plus, RefreshCw, Search, Settings2,
  Shield, SlidersHorizontal, Sparkles, TerminalSquare, Trash2, TrendingDown, TrendingUp, WalletCards, X,
} from "lucide-react";
import { api, downloadReport, getToken } from "./api";
import { AppSelect, CurrencyPairAvatar, FieldLabelInfo, InfoTooltip, SegmentedTabs } from "./ui-primitives";
import { EndpointListEditor } from "./EndpointListEditor";
import { RoleRouteEditor } from "./RoleRouteEditor";
import { AgentWorkspace } from "./AgentWorkspace";
import { agentTitle } from "./agent-catalog";

type Locale = "fa" | "en";
type JsonMap = Record<string, any>;
type Profile = { id: string; name: string; active: boolean; settings: Record<string, string>; createdAt: number; updatedAt: number; secrets: JsonMap; secretState: JsonMap };
type Field = { key: string; group: string; value: string; source: "profile" | "default"; writable: boolean; secret: boolean };
type Run = { id: string; mode: string; status: string; startedAt: number; endedAt?: number | null; config?: JsonMap; report?: JsonMap | null; failureName?: string | null; failureMessage?: string | null };
type ManagedRun = { id: string; mode: string; profileId: string; state: string; message: string; startedAt: number; updatedAt: number; symbols: string[]; strategyIds: string[]; error?: string };
type Bootstrap = { profiles: Profile[]; activeProfileId: string; selectedProfileId: string; config: JsonMap; fields: Field[]; strategies: Strategy[]; runs: Run[]; managedRuns: ManagedRun[]; database: { url: string } };
type Strategy = { id: string; name: string; mandate: string; minConfidence: number; allowedOrderTypes: Array<"MARKET" | "LIMIT">; maxOrderNotional?: string; maxPositionNotional?: string; maxGrossExposure?: string };
type Audit = { run: JsonMap; decisions: JsonMap[]; riskOutcomes: JsonMap[]; orders: JsonMap[]; decisionMemories: JsonMap[]; portfolioHistory: Array<{ timestamp: number; equity: string; cash: string; positions: unknown[] }>; sourceSnapshots: JsonMap[]; aiModelCalls: JsonMap[] };

const copy: Record<Locale, Record<string, string>> = {
  fa: {
    overview: "نمای کلی", runLab: "آزمایش و اجرا", profiles: "پروفایل و تنظیمات", strategies: "عامل‌ها و استراتژی‌ها",
    markets: "بازارها", reports: "گزارش و ممیزی", orders: "سفارش‌ها", system: "سلامت سیستم", refresh: "به‌روزرسانی",
    connected: "به‌روزرسانی زنده فعال", reconnecting: "در حال اتصال دوباره", local: "محلی · فقط روی این دستگاه",
    operator: "فضای اپراتور", activeProfile: "پروفایل فعال", virtual: "سرمایه مجازی", actual: "موجودی واقعی والکس",
    runs: "اجراها", decisions: "تصمیم‌ها", noData: "هنوز داده‌ای برای نمایش وجود ندارد", recent: "آخرین اجراها",
    equity: "ارزش پرتفوی", return: "بازده خالص", drawdown: "بیشترین افت سرمایه", trades: "تعداد معاملات",
    runTitle: "اجرای استراتژی", backtest: "بک‌تست", shadow: "شبیه‌سازی زنده", live: "معامله واقعی",
    backtestHint: "بازپخش کندل‌های تکمیل‌شده والکس؛ اجرا از کندل بعدی شبیه‌سازی می‌شود.",
    shadowHint: "قیمت زنده و پرتفوی مجازی؛ هیچ مسیر ارسال سفارشی در این حالت وجود ندارد.",
    liveHint: "به حساب واقعی متصل می‌شود. هر پیشنهاد قبل از ارسال، بررسی ریسک قطعی را می‌گذراند.",
    symbol: "جفت‌ارز", symbols: "جفت‌ارزها با کاما جدا شوند", from: "از تاریخ", to: "تا تاریخ",
    watch: "تکرار خودکار ارزیابی", interval: "فاصله ارزیابی (ثانیه)", auto: "معامله خودکار پیوسته", start: "شروع اجرا",
    stop: "توقف ایمن", stopPending: "درخواست توقف ثبت شد", profile: "پروفایل", settings: "تنظیمات",
    save: "ذخیره تغییرات", create: "ساخت پروفایل", activate: "فعال‌سازی", delete: "حذف", import: "ورود امن از فایل dotenv",
    key: "کلید", value: "مقدار مؤثر", source: "منبع مقدار", ai: "هوش مصنوعی و عامل‌ها", wallex: "والکس",
    risk: "ریسک و ایمنی", simulation: "شبیه‌سازی", memory: "حافظه", dataSources: "منابع داده", advanced: "پیشرفته",
    profileSource: "پروفایل", default: "پیش‌فرض", secrets: "اعتبارنامه‌ها و کلیدها",
    configured: "تنظیم شده", missing: "تنظیم نشده", keyHint: "اعتبارنامه‌ها رمزگذاری می‌شوند و پس از ذخیره نمایش داده نمی‌شوند.",
    marketsTitle: "بازارهای فعال والکس", allMarkets: "نمایش همه بازارها", allowlist: "فهرست مجاز پروفایل",
    search: "جست‌وجو", apply: "ذخیره فهرست مجاز", reportsTitle: "عملکرد و ممیزی اجراها",
    export: "خروجی گزارش HTML", modelCalls: "فراخوانی‌های هوش مصنوعی", evidence: "شواهد و منابع", riskChecks: "بررسی‌های ریسک",
    decisionsTitle: "تصمیم‌های عامل‌ها", orderTitle: "سفارش‌ها و اجراها", details: "جزئیات", noRuns: "هنوز اجرایی ثبت نشده است.",
    liveConfirmTitle: "تأیید معامله واقعی", liveConfirmBody: "درخواست به والکس ارسال خواهد شد و می‌تواند از اعتبار واقعی استفاده کند.",
    profileLabel: "پروفایل انتخاب‌شده", pairLabel: "جفت‌ارزهای مجاز", exposure: "سقف کل مواجهه", typeTrade: "برای ادامه LIVE را بنویسید",
    acknowledge: "ریسک استفاده از اعتبار واقعی را می‌پذیرم.", confirmLive: "تأیید و شروع معامله واقعی", cancel: "انصراف",
    diagnostics: "بررسی سلامت", validate: "اعتبارسنجی تنظیمات", checkWallex: "بررسی اتصال خواندنی والکس", migrate: "اجرای مهاجرت پایگاه داده",
    encryption: "رمزنگاری پروفایل", generateKey: "ساخت کلید رمزنگاری", rotateKey: "چرخش کلید", oldKey: "کلید قبلی", newKey: "کلید جایگزین",
    importPath: "مسیر فایل .env روی همین دستگاه", profileName: "نام پروفایل جدید", copied: "کپی شد",
  },
  en: {
    overview: "Overview", runLab: "Run lab", profiles: "Profiles & settings", strategies: "Agents & strategies",
    markets: "Markets", reports: "Reports & audit", orders: "Orders", system: "System health", refresh: "Refresh",
    connected: "Live updates connected", reconnecting: "Reconnecting", local: "Local · this device only",
    operator: "Operator workspace", activeProfile: "Active profile", virtual: "Virtual capital", actual: "Actual Wallex balance",
    runs: "Runs", decisions: "Decisions", noData: "Nothing to show yet", recent: "Recent runs",
    equity: "Portfolio equity", return: "Net return", drawdown: "Maximum drawdown", trades: "Trades",
    runTitle: "Run a strategy", backtest: "Backtest", shadow: "Live simulation", live: "Live trading",
    backtestHint: "Replay completed Wallex candles; simulated execution starts no earlier than the next bar.",
    shadowHint: "Live prices and a virtual portfolio. This mode has no order submission path.",
    liveHint: "Connects to your real account. Every proposal passes deterministic risk checks before submission.",
    symbol: "Pair", symbols: "Pairs, comma separated", from: "From", to: "To",
    watch: "Repeat evaluations", interval: "Evaluation interval (seconds)", auto: "Continuous autonomous trading", start: "Start run",
    stop: "Stop safely", stopPending: "Stop requested", profile: "Profile", settings: "Settings",
    save: "Save changes", create: "Create profile", activate: "Activate", delete: "Delete", import: "Secure dotenv import",
    key: "Key", value: "Effective value", source: "Value source", ai: "AI & agents", wallex: "Wallex",
    risk: "Risk & safety", simulation: "Simulation", memory: "Memory", dataSources: "Data sources", advanced: "Advanced",
    profileSource: "Profile", default: "Default", secrets: "Credentials & keys",
    configured: "Configured", missing: "Not set", keyHint: "Credentials are encrypted and never displayed after saving.",
    marketsTitle: "Active Wallex markets", allMarkets: "Show all markets", allowlist: "Profile allowlist",
    search: "Search", apply: "Save allowlist", reportsTitle: "Performance & run audit",
    export: "Export HTML report", modelCalls: "AI model calls", evidence: "Evidence & sources", riskChecks: "Risk checks",
    decisionsTitle: "Agent decisions", orderTitle: "Orders & executions", details: "Details", noRuns: "No runs have been recorded yet.",
    liveConfirmTitle: "Confirm live trading", liveConfirmBody: "This request will reach Wallex and may use real trading credit.",
    profileLabel: "Selected profile", pairLabel: "Allowlisted pairs", exposure: "Maximum gross exposure", typeTrade: "Type LIVE to continue",
    acknowledge: "I understand this uses real trading credit.", confirmLive: "Confirm and start live trading", cancel: "Cancel",
    diagnostics: "Health checks", validate: "Validate settings", checkWallex: "Check Wallex read access", migrate: "Run database migrations",
    encryption: "Profile encryption", generateKey: "Generate encryption key", rotateKey: "Rotate key", oldKey: "Previous key", newKey: "Replacement key",
    importPath: "Local .env file path", profileName: "New profile name", copied: "Copied",
  },
};

const nav = [
  ["overview", LayoutDashboard], ["runLab", Activity], ["profiles", Settings2], ["strategies", Blocks],
  ["markets", ArrowLeftRight], ["reports", BarChart3], ["orders", WalletCards], ["system", Gauge],
] as const;

function sourceTitle(source: string, locale: Locale) {
  return source === "profile" ? copy[locale].profileSource : copy[locale].default;
}
function settingsGroupTitle(group: string, locale: Locale) {
  const titles: Record<string, { fa: string; en: string }> = {
    All: { fa: "همه", en: "All" }, Advanced: { fa: "پیشرفته", en: "Advanced" },
    Wallex: { fa: "والکس", en: "Wallex" }, "AI & agents": { fa: "هوش مصنوعی و عامل‌ها", en: "AI & agents" },
    Strategies: { fa: "استراتژی‌ها", en: "Strategies" }, Memory: { fa: "حافظه تصمیم", en: "Decision memory" },
    Simulation: { fa: "شبیه‌سازی", en: "Simulation" }, "Risk & safety": { fa: "ریسک و ایمنی", en: "Risk & safety" },
    "Data sources": { fa: "منابع داده", en: "Data sources" },
  };
  return titles[group]?.[locale] ?? group;
}

function settingTitle(key: string, locale: Locale): string {
  const titles: Record<string, { fa: string; en: string }> = {
    LOG_LEVEL: { fa: "جزئیات گزارش موتور", en: "Engine log detail" }, ENGINE_MODE: { fa: "حالت پیش‌فرض اجرا", en: "Default run mode" },
    WALLEX_BASE_URL: { fa: "نشانی API والکس", en: "Wallex API address" }, WALLEX_WS_URL: { fa: "نشانی داده زنده والکس", en: "Wallex live-data address" },
    WALLEX_ENABLE_LIVE_TRADING: { fa: "اجازه ارسال سفارش واقعی", en: "Allow real order submission" }, WALLEX_ENABLE_AUTOTRADING: { fa: "اجازه معامله خودکار", en: "Allow automated trading" },
    WALLEX_ALLOWED_MARKETS: { fa: "جفت‌ارزهای مجاز", en: "Allowed markets" }, WALLEX_PACKAGE_ID: { fa: "شناسه بسته اعتبار والکس", en: "Wallex credit package ID" }, WALLEX_QUOTE_CURRENCY: { fa: "ارز بازار پایه و حساب", en: "Quote and account currency" },
    LIVE_MAX_GROSS_EXPOSURE: { fa: "سقف کل مواجهه زنده", en: "Live total exposure cap" }, AI_PROVIDER: { fa: "ارائه‌دهنده پیش‌فرض هوش مصنوعی", en: "Default AI provider" }, AI_MODEL: { fa: "مدل پیش‌فرض هوش مصنوعی", en: "Default AI model" },
    AI_API_KEY: { fa: "کلید ارائه‌دهنده پیش‌فرض", en: "Default provider API key" }, AI_BASE_URL: { fa: "نشانی سرویس سازگار با OpenAI", en: "OpenAI-compatible service URL" }, BOXAPI_BASE_URL: { fa: "نشانی سرویس BoxAPI", en: "BoxAPI service URL" }, LIARA_BASE_URL: { fa: "نشانی سرویس Liara", en: "Liara service URL" }, LIARA_WORKSPACE_ID: { fa: "شناسه فضای کاری Liara", en: "Liara workspace ID" },
    AI_REQUEST_TIMEOUT_SECONDS: { fa: "مهلت درخواست مدل", en: "Model request timeout" }, AI_PROVIDER_KEYS_JSON: { fa: "کلیدهای ارائه‌دهندگان مدل", en: "Model provider keys" }, AI_ROLE_MODELS_JSON: { fa: "مسیر مدل برای هر عامل", en: "Model route per agent" }, AI_ROLE_INSTRUCTIONS_JSON: { fa: "دستورهای تکمیلی عامل‌ها", en: "Additional agent instructions" }, AI_ROLE_MAX_TOOL_STEPS_JSON: { fa: "سقف گام ابزار عامل‌ها", en: "Agent tool-step limits" }, AI_DISABLED_AGENTS_JSON: { fa: "عامل‌های اختیاری غیرفعال", en: "Disabled optional agents" },
    ENGINE_STRATEGIES_JSON: { fa: "تعریف استراتژی‌ها", en: "Strategy definitions" }, ENGINE_MAX_DEBATE_ROUNDS: { fa: "دورهای مناظره صعودی و نزولی", en: "Bull/bear debate rounds" }, ENGINE_MAX_RISK_DISCUSS_ROUNDS: { fa: "دورهای بررسی ریسک", en: "Risk review rounds" }, MEMORY_HOLDING_PERIOD_BARS: { fa: "افق ارزیابی حافظه", en: "Memory evaluation horizon" }, MEMORY_BENCHMARK_SYMBOL: { fa: "جفت‌ارز معیار حافظه", en: "Memory benchmark pair" },
    RESEARCH_ENDPOINTS_JSON: { fa: "منابع خبری و پژوهشی", en: "Research data sources" }, MARKET_QUOTE_FALLBACKS_JSON: { fa: "منابع جایگزین قیمت بازار", en: "Fallback market-price sources" }, PAPER_INITIAL_CASH: { fa: "سرمایه آغازین مجازی", en: "Starting virtual capital" }, BACKTEST_FEE_BPS: { fa: "کارمزد فرضی بک‌تست", en: "Backtest fee assumption" }, BACKTEST_SLIPPAGE_BPS: { fa: "لغزش فرضی بک‌تست", en: "Backtest slippage assumption" },
    RISK_MAX_ORDER_NOTIONAL: { fa: "سقف ارزش هر سفارش", en: "Per-order value cap" }, RISK_MAX_POSITION_NOTIONAL: { fa: "سقف ارزش هر موقعیت", en: "Per-position value cap" }, RISK_MAX_GROSS_EXPOSURE: { fa: "سقف کل مواجهه پرتفوی", en: "Portfolio gross-exposure cap" }, RISK_MAX_DRAWDOWN_PCT: { fa: "حداکثر افت سرمایه", en: "Maximum drawdown" }, RISK_MAX_DAILY_LOSS: { fa: "حداکثر زیان روزانه", en: "Maximum daily loss" }, RISK_MAX_DATA_AGE_SECONDS: { fa: "تازگی الزامی داده بازار", en: "Maximum market-data age" }, RISK_FEE_BUFFER_BPS: { fa: "ذخیره احتیاطی کارمزد", en: "Fee safety buffer" }, RISK_MAX_MARKET_SLIPPAGE_BPS: { fa: "حداکثر لغزش سفارش بازار", en: "Maximum market-order slippage" }, RISK_KILL_SWITCH: { fa: "توقف ورود به معامله", en: "Block new trading" },
  };
  return titles[key]?.[locale] ?? key.replaceAll("_", " ").toLocaleLowerCase(locale === "fa" ? "fa-IR" : "en-US");
}

const settingHelp: Record<string, { fa: string; en: string }> = {
  LOG_LEVEL: { fa: "جزئیات ثبت گزارش موتور: debug، info، warn یا error. مقدار پیش‌فرض info است.", en: "Engine log verbosity: debug, info, warn, or error. The default is info." },
  ENGINE_MODE: { fa: "حالت پیش‌فرض CLI؛ backtest، shadow یا live. انتخاب این مقدار به‌تنهایی معامله زنده را فعال نمی‌کند.", en: "Default CLI mode: backtest, shadow, or live. Selecting live here does not by itself enable live trading." },
  WALLEX_BASE_URL: { fa: "نشانی HTTPS سرویس REST والکس. برای استفاده معمول، مقدار پیش‌فرض رسمی را نگه دارید.", en: "HTTPS base URL for Wallex REST. Keep the official default for normal operation." },
  WALLEX_WS_URL: { fa: "نشانی WSS استریم عمومی Centrifugo والکس برای قیمت و به‌روزرسانی دفتر سفارش.", en: "WSS endpoint for Wallex Centrifugo public price and order-book updates." },
  WALLEX_ENABLE_LIVE_TRADING: { fa: "مجوز داخلی ارسال سفارش زنده. این گزینه جایگزین انتخاب حالت live و تأیید صریح هر شروع زنده نیست.", en: "Engine-side permission for live order writes. It does not replace choosing live mode and explicitly confirming each live start." },
  WALLEX_ENABLE_AUTOTRADING: { fa: "اجازه جداگانه برای تکرار خودکار چرخه‌های معامله زنده. این گزینه را فقط در صورت نیاز به اجرای پیوسته روشن کنید.", en: "Separate permission for repeated live cycles. Enable it only when you want ongoing automated execution." },
  WALLEX_ALLOWED_MARKETS: { fa: "فهرست نمادهای مجاز با کاما، مانند BTCTMN,ETHTMN. بازار باید در والکس فعال و در بسته اعتبار قابل معامله باشد.", en: "Comma-separated market symbols, for example BTCTMN,ETHTMN. A market must also be active on Wallex and available in the credit package." },
  WALLEX_PACKAGE_ID: { fa: "شناسه بسته اعتبار معاملاتی والکس؛ برای بررسی بازارهای غیرقابل معامله بسته استفاده می‌شود، نه به‌عنوان شناسه حساب یا کلید API.", en: "Wallex trade-credit package ID used to check unavailable markets. It is not an account ID or API key." },
  WALLEX_QUOTE_CURRENCY: { fa: "ارز بازار پایه و واحد حساب پرتفوی موتور، مانند TMN یا USDT. باید با جفت‌های انتخاب‌شده سازگار باشد.", en: "Portfolio denomination and quote currency, such as TMN or USDT. It must match the selected markets." },
  LIVE_MAX_GROSS_EXPOSURE: { fa: "سقف سخت مواجهه کل زنده برحسب ارز بازار پایه. باید عدد نامنفی باشد و برای شروع زنده بزرگ‌تر از صفر تنظیم شود؛ این سقف تضمین زیان نیست.", en: "Hard cap on total live exposure in the quote currency. Use a non-negative amount; live mode requires a value above zero. This is not a guaranteed loss cap." },
  AI_PROVIDER: { fa: "ارائه‌دهنده پیش‌فرض مدل: openai، anthropic، google، compatible، boxapi یا liara. در صورت تعریف مسیر جداگانه برای یک نقش، همان مسیر به کار می‌رود.", en: "Default model provider: openai, anthropic, google, compatible, boxapi, or liara. A role-specific route takes precedence when configured." },
  AI_MODEL: { fa: "شناسه دقیق مدل در ارائه‌دهنده انتخاب‌شده. این مدل باید در حساب شما و نشانی سرویس قابل دسترسی باشد.", en: "Exact model ID on the selected provider. It must be available to your account and service URL." },
  AI_BASE_URL: { fa: "نشانی پایه سرویس سازگار با OpenAI. فقط برای ارائه‌دهنده سازگار استفاده می‌شود و باید HTTPS باشد؛ برای توسعه، localhost مجاز است.", en: "Base URL for an OpenAI-compatible service. Used only with the compatible provider; HTTPS is required except for localhost during development." },
  AI_REQUEST_TIMEOUT_SECONDS: { fa: "حداکثر زمان هر درخواست مدل، بر حسب ثانیه؛ مقدار معتبر ۵ تا ۳۰۰ است.", en: "Per-request model timeout in seconds. Valid values are 5 through 300." },
  AI_ROLE_MODELS_JSON: { fa: "نگاشت اختیاری نقش عامل به provider:model، مانند trader:boxapi:gpt-model. شناسه‌ها باید با ارائه‌دهندگان پیکربندی‌شده سازگار باشند.", en: "Optional role-to-model routes. Use provider:model values, for example boxapi:gpt-model. Each provider and model ID must be supported." },
  ENGINE_MAX_DEBATE_ROUNDS: { fa: "تعداد رفت‌وبرگشت‌های متوالی پژوهشگر صعودی و نزولی؛ عدد صحیح ۱ تا ۱۰. دور بیشتر درخواست مدل و هزینه را افزایش می‌دهد.", en: "Sequential bull/bear debate cycles; integer from 1 to 10. More rounds increase model calls, latency, and cost." },
  ENGINE_MAX_RISK_DISCUSS_ROUNDS: { fa: "تعداد دورهای بررسی ریسک تهاجمی، محتاط و بی‌طرف؛ عدد صحیح ۱ تا ۱۰.", en: "Rounds of aggressive, conservative, and neutral risk review; integer from 1 to 10." },
  ENGINE_STRATEGIES_JSON: { fa: "آرایه JSON از پروفایل‌های استراتژی. هر پروفایل شامل شناسه، نام، mandate، حداقل اطمینان، نوع سفارش مجاز و سقف‌های اختیاری است. ویرایشگر استراتژی‌ها ساده‌تر است.", en: "JSON array of strategy profiles with ID, name, mandate, minimum confidence, allowed order types, and optional caps. Prefer the Agents & strategies editor." },
  MEMORY_HOLDING_PERIOD_BARS: { fa: "افق ارزیابی حافظه برحسب کندل یک‌دقیقه‌ای؛ عدد صحیح ۱ تا ۱۰۰٬۰۰۰. برای نمونه ۳۰ یعنی حدود ۳۰ دقیقه بازار.", en: "Decision-memory outcome horizon in completed one-minute bars; integer from 1 to 100,000. For example, 30 is about 30 minutes." },
  MEMORY_BENCHMARK_SYMBOL: { fa: "نماد معیار بازده برای سنجش alpha حافظه. خالی بماند تا BTC در همان ارز بازار پایه انتخاب شود.", en: "Benchmark symbol for memory alpha. Leave blank to infer BTC in the same quote currency." },
  PAPER_INITIAL_CASH: { fa: "وجه اولیه مجازی برای هر پرتفوی backtest یا shadow جدید. برحسب ارز بازار پایه و به‌صورت عدد مثبت.", en: "Starting virtual cash for a new backtest or shadow portfolio, denominated in the quote currency." },
  BACKTEST_FEE_BPS: { fa: "کارمزد فرضی هر سمت اجرای شبیه‌سازی‌شده برحسب واحد پایه؛ ۱۰۰ واحد پایه برابر ۱٪ است.", en: "Assumed fee per simulated fill side in basis points; 100 bps equals 1%." },
  BACKTEST_SLIPPAGE_BPS: { fa: "لغزش فرضی قیمت شبیه‌سازی برحسب واحد پایه؛ ۱۰۰ واحد پایه برابر ۱٪ است. دفتر سفارش تاریخی بازسازی نمی‌شود.", en: "Assumed simulated price slippage in basis points; 100 bps equals 1%. It does not reconstruct historical order books." },
  RISK_MAX_ORDER_NOTIONAL: { fa: "بیشترین ارزش مجاز برای یک سفارش، برحسب ارز بازار پایه.", en: "Maximum notional value for one proposed order, in the quote currency." },
  RISK_MAX_POSITION_NOTIONAL: { fa: "بیشترین ارزش مجاز موقعیت یک جفت‌ارز پس از اجرای سفارش.", en: "Maximum allowed notional for one market position after the proposed order." },
  RISK_MAX_GROSS_EXPOSURE: { fa: "بیشترین مواجهه اسمی مجموع موقعیت‌ها در ارز بازار پایه. سقف سخت زنده و سقف استراتژی می‌توانند مقدار مؤثر را کمتر کنند.", en: "Maximum aggregate marked position exposure in quote currency. Live and strategy-specific caps may tighten it further." },
  RISK_MAX_DRAWDOWN_PCT: { fa: "حداکثر افت مجاز از بیشترین equity ثبت‌شده، برحسب درصد. این محدودیت معامله جدید را می‌بندد؛ موقعیت را خودکار نمی‌فروشد.", en: "Maximum permitted drawdown from the equity high-water mark, in percent. It blocks new orders; it does not liquidate positions." },
  RISK_MAX_DAILY_LOSS: { fa: "حد زیان روزانه برحسب ارز بازار پایه؛ با رسیدن زیان ثبت‌شده به حد، سفارش جدید رد می‌شود.", en: "Daily loss threshold in quote currency. New orders are rejected once tracked loss reaches the limit." },
  RISK_MAX_DATA_AGE_SECONDS: { fa: "حداکثر سن quote و depth برای تصمیم یا سفارش؛ عدد صحیح مثبت برحسب ثانیه.", en: "Maximum age for quote and required order-book depth, in positive integer seconds." },
  RISK_FEE_BUFFER_BPS: { fa: "ذخیره اضافی کارمزد هنگام بررسی کفایت نقدینگی خرید، برحسب basis point.", en: "Extra fee reserve used when checking available cash for buys, in basis points." },
  RISK_MAX_MARKET_SLIPPAGE_BPS: { fa: "بیشترین لغزش نامساعد قابل‌قبول سفارش بازار در برابر quote، برحسب basis point.", en: "Maximum accepted adverse market-order slippage versus the quote, in basis points." },
  RISK_KILL_SWITCH: { fa: "کلید توقف ورود به معامله. روشن کردن آن همه سفارش جدید را رد می‌کند اما موقعیت‌های موجود را نمی‌بندد.", en: "Trading kill switch. When enabled, the engine rejects new orders but does not close existing positions." },
};

function fieldHelp(key: string, group: string, locale: Locale): string {
  const detail = settingHelp[key];
  if (detail) return detail[locale];
  return locale === "fa"
    ? `تنظیم ${settingsGroupTitle(group, locale)} در پیکربندی موتور. مقدار باید با نوع این فیلد و طرح‌واره موتور سازگار باشد؛ قبل از شروع اجرا، نتیجه اعتبارسنجی را بررسی کنید.`
    : `${settingsGroupTitle(group, locale)} engine setting. Use a value matching this field's type and engine schema, then validate the profile before running.`;
}

function diagnosticTitle(name: string, locale: Locale): string {
  if (locale !== "fa") return name;
  const names: Record<string, string> = { Configuration: "پیکربندی", "Mode safety": "آمادگی حالت اجرا", Database: "پایگاه داده", "Wallex read API": "دسترسی خواندنی والکس", "Order write safety": "ایمنی ارسال سفارش" };
  return names[name] ?? name;
}

function issueText(message: string, locale: Locale): string {
  if (locale !== "fa") return message;
  const translations: Array<[RegExp, string]> = [
    [/^WALLEX_ENABLE_LIVE_TRADING must be true for live mode\.$/, "برای معامله واقعی، اجازه ارسال سفارش واقعی را در تنظیمات پروفایل فعال کنید."],
    [/^WALLEX_API_KEY is required for live mode\.$/, "کلید API حساب اعتباری والکس را در بخش اعتبارنامه‌ها وارد کنید."],
    [/^WALLEX_SUB_ACCOUNT_CLIENT_ID is required for credit-account spot trading\.$/, "شناسه زیرحساب اعتباری والکس را در بخش اعتبارنامه‌ها وارد کنید."],
    [/^WALLEX_PACKAGE_ID is required to enforce package market restrictions\.$/, "شناسه بسته اعتبار معاملاتی لازم است تا محدودیت جفت‌ارزها بررسی شود."],
    [/^WALLEX_ALLOWED_MARKETS must list approved symbols\.$|^Add approved markets to WALLEX_ALLOWED_MARKETS\.$/, "ابتدا دست‌کم یک جفت‌ارز فعال و مجاز را در صفحه بازارها انتخاب کنید."],
    [/^RISK_KILL_SWITCH is enabled; live execution cannot start\.$/, "کلید توقف فعال است؛ تا زمان خاموش‌کردن آن، معامله واقعی شروع نمی‌شود."],
    [/^An API key is required for AI provider (.+?) \(AI_PROVIDER_KEYS_JSON or AI_API_KEY\)\.$/, "کلید API برای ارائه‌دهنده هوش مصنوعی «$1» در تنظیمات اعتبارنامه‌ها ثبت نشده است."],
    [/^AI_BASE_URL is required for an OpenAI-compatible provider\.$/, "برای ارائه‌دهنده سازگار با OpenAI، نشانی سرویس را در تنظیمات هوش مصنوعی وارد کنید."],
    [/^WALLEX_API_KEY is required to refresh challenge package market restrictions\.$/, "برای دریافت محدودیت‌های بسته اعتبار والکس، کلید خواندنی همان حساب را تنظیم کنید."],
    [/^Inactive allowlisted markets: (.+)\.$/, "این جفت‌ارزها در حال حاضر در والکس فعال نیستند: $1"],
    [/^(\d+) active spot markets received\.$/, "$1 بازار فعال اسپات از والکس دریافت شد."],
    [/^Not checked\. Enable the read-only connection check to test Wallex\.$/, "بررسی نشده است. فعال‌کردن گزینه اتصال، فقط فهرست بازارهای والکس را به‌صورت خواندنی دریافت می‌کند."],
    [/^Required providers and safety gates are configured\.$/, "ارائه‌دهندگان لازم و کنترل‌های ایمنی این حالت آماده‌اند."],
    [/^(.+) settings parsed successfully\.$/, "تنظیمات پروفایل و حالت انتخاب‌شده با موفقیت خوانده شدند."],
    [/^SQLite is available and migrations are current\.$/, "پایگاه داده در دسترس است و نسخه ساختار آن به‌روز است."],
    [/^Diagnostics never submits or cancels exchange orders\.$/, "بررسی سلامت هیچ سفارش صرافی را ارسال یا لغو نمی‌کند."],
  ];
  for (const [pattern, translated] of translations) if (pattern.test(message)) return message.replace(pattern, translated);
  return "برای دیدن متن فنی یا جزئیات بیشتر، بخش جزئیات فنی را باز کنید.";
}

function diagnosticDetailText(name: string, status: string, detail: string, locale: Locale): string {
  if (locale !== "fa") return detail;
  if (name === "Mode safety" && status === "fail") return detail.split(/;\s*/).map((issue) => issueText(issue, locale)).join(" · ");
  return issueText(detail, locale);
}

function riskReasonText(reason: string, locale: Locale): string {
  if (locale !== "fa") return reason;
  const known: Record<string, string> = {
    "Portfolio manager returned HOLD; no order is eligible.": "مدیر پرتفوی تصمیم «نگه‌داری» گرفت؛ سفارشی برای اجرا واجد شرایط نبود.",
    "No order was proposed.": "سفارشی پیشنهاد نشد.",
    "Kill switch is enabled.": "توقف ورود به معامله فعال است.",
    "Market is not allowlisted.": "این جفت‌ارز در فهرست مجاز پروفایل نیست.",
    "Market data is stale.": "داده بازار قدیمی است و برای سفارش‌گذاری پذیرفته نمی‌شود.",
  };
  return known[reason] ?? reason;
}

function strategyIdTitle(id: string, locale: Locale): string {
  if (locale !== "fa") return id;
  const labels: Record<string, string> = { "agentic-balanced": "متعادل عامل‌محور", momentum: "مومنتوم", "mean-reversion": "بازگشت به میانگین", "capital-preservation": "حفظ سرمایه" };
  return labels[id] ?? id;
}

function strategyTitle(strategy: Strategy, locale: Locale): string {
  if (locale !== "fa") return strategy.name;
  const defaultNames: Record<string, string> = {
    "agentic-balanced": "Agentic balanced", momentum: "Momentum", "mean-reversion": "Mean reversion", "capital-preservation": "Capital preservation",
  };
  if (defaultNames[strategy.id] && strategy.name !== defaultNames[strategy.id]) return strategy.name;
  const titles: Record<string, string> = {
    "agentic-balanced": "متعادل عامل‌محور", momentum: "مومنتوم", "mean-reversion": "بازگشت به میانگین", "capital-preservation": "حفظ سرمایه",
  };
  return titles[strategy.id] ?? strategy.name;
}
function strategyHelp(strategy: Strategy, locale: Locale): string {
  const limits = [strategy.maxOrderNotional && `${locale === "fa" ? "سقف سفارش" : "order cap"}: ${strategy.maxOrderNotional}`, strategy.maxPositionNotional && `${locale === "fa" ? "سقف موقعیت" : "position cap"}: ${strategy.maxPositionNotional}`, strategy.maxGrossExposure && `${locale === "fa" ? "سقف کل" : "gross cap"}: ${strategy.maxGrossExposure}`].filter(Boolean).join(" · ");
  const confidence = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 0 }).format(strategy.minConfidence * 100);
  const allowedOrders = strategy.allowedOrderTypes.map((type) => orderValueTitle(type, locale)).join(locale === "fa" ? "، " : ", ");
  const rules = `${locale === "fa" ? "حداقل اطمینان" : "Minimum confidence"}: ${confidence}% · ${locale === "fa" ? "سفارش مجاز" : "Allowed orders"}: ${allowedOrders}${limits ? ` · ${limits}` : ""}`;
  if (locale === "fa") {
    const builtIn: Record<string, string> = {
      "agentic-balanced": "تحلیل بازار و تکنیکال، خبر، احساسات و توکنومیک را با مناظره صعودی/نزولی و هیئت بررسی ریسک ترکیب می‌کند. هنگام تعارض یا کمبود شواهد، نگه‌داری را ترجیح می‌دهد.",
      momentum: "به حرکت جهت‌دار پایدار و تأیید مومنتوم یا حجم تکیه می‌کند. از تعقیب حرکت کش‌آمده پرهیز می‌کند و بدون تأیید روند، نگه‌داری را ترجیح می‌دهد.",
      "mean-reversion": "حرکت بیش‌ازحد و شواهد معقول بازگشت را بررسی می‌کند. تنها سفارش محدود مجاز است؛ یک سیگنال اشباع به‌تنهایی تأیید بازگشت نیست.",
      "capital-preservation": "حفظ سرمایه را مقدم می‌داند، به شواهد قوی و هم‌جهت نیاز دارد و هنگام ابهام مهم، نگه‌داری را ترجیح می‌دهد. تنها سفارش محدود مجاز است.",
    };
    return `${builtIn[strategy.id] ?? strategy.mandate} ${rules}. این پروفایل روی پیشنهاد عامل‌ها قید می‌گذارد؛ تضمین سود نیست.`;
  }
  const builtIn: Record<string, string> = {
    "agentic-balanced": "Combines market/technical, news, sentiment, and tokenomics research with bull/bear debate and risk review. Prefers HOLD when evidence conflicts or is incomplete.",
    momentum: "Requires persistent directional movement with confirming momentum or volume; avoids chasing an extended move and prefers HOLD without trend confirmation.",
    "mean-reversion": "Looks for a stretched move with plausible reversion evidence and permits LIMIT orders only; a single oversold/overbought signal is not confirmation.",
    "capital-preservation": "Prioritizes capital preservation, requires strong aligned evidence, and prefers HOLD under material uncertainty. LIMIT orders only.",
  };
  return `${builtIn[strategy.id] ?? strategy.mandate} ${rules}. This profile constrains agent proposals; it does not guarantee profit.`;
}

function marketModeOptions(locale: Locale) {
  return [
    { value: "backtest", label: copy[locale].backtest, detail: locale === "fa" ? "کندل تاریخی · پرتفوی مجازی" : "Historical candles · virtual portfolio" },
    { value: "shadow", label: copy[locale].shadow, detail: locale === "fa" ? "داده زنده · بدون سفارش واقعی" : "Live data · no real orders" },
    { value: "live", label: copy[locale].live, detail: locale === "fa" ? "سفارش واقعی والکس" : "Real Wallex orders" },
  ];
}
function modeHelp(mode: "backtest" | "shadow" | "live", locale: Locale) {
  const details: Record<typeof mode, { fa: string; en: string }> = {
    backtest: { fa: "کندل‌های تاریخی تکمیل‌شده والکس را بازپخش می‌کند. هر تصمیم با اطلاعات همان زمان می‌گیرد و اجرای شبیه‌سازی‌شده زودتر از کندل بعدی انجام نمی‌شود؛ کارمزد و لغزش باید در فرض‌ها لحاظ شوند.", en: "Replays completed historical Wallex candles. Decisions only see data available at that point; simulated fills occur no earlier than the next candle, with explicit fee and slippage assumptions." },
    shadow: { fa: "از قیمت زنده و پرتفوی مجازی مستقل استفاده می‌کند؛ سفارش‌ها فرضی‌اند و هیچ مسیر ارسال یا لغو سفارش والکس در این حالت در دسترس نیست.", en: "Uses live prices with an isolated virtual portfolio. Orders are hypothetical; Wallex order submission and cancellation are unavailable in this mode." },
    live: { fa: "به حساب اعتباری واقعی والکس متصل می‌شود. سفارش تنها پس از تأیید صریح شروع، کنترل قطعی ریسک و تطبیق وضعیت حساب ارسال می‌شود. معامله خودکار فقط با مجوز جداگانه فعال است.", en: "Connects to the real Wallex credit account. Orders require explicit start confirmation, deterministic risk checks, and account reconciliation. Autonomous cycles need separate enablement." },
  };
  return details[mode][locale];
}
function money(value?: string | number, currency = "TMN", locale: Locale = "fa") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 2 }).format(number)} ${currency}`;
}
function percent(value?: string | number, locale?: Locale) {
  const number = Number(value);
  const activeLocale = locale ?? (typeof document !== "undefined" && document.documentElement.lang === "fa" ? "fa" : "en");
  return Number.isFinite(number)
    ? `${new Intl.NumberFormat(activeLocale === "fa" ? "fa-IR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(number)}%`
    : "—";
}
function pnlTone(value: unknown): "up" | "down" | "plain" {
  const number = Number(value);
  return !Number.isFinite(number) || number === 0 ? "plain" : number > 0 ? "up" : "down";
}
function pnlClass(value: unknown): "positive" | "negative" | "neutral" {
  const tone = pnlTone(value);
  return tone === "up" ? "positive" : tone === "down" ? "negative" : "neutral";
}
function dateLabel(value?: number | null, locale: Locale = "fa") {
  return value ? new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}
function statusClass(value: string) { return `status status-${value.toLowerCase().replace(/[^a-z]+/g, "-")}`; }
function statusTitle(value: string, locale: Locale) {
  const labels: Record<string, { fa: string; en: string }> = {
    completed: { fa: "تکمیل‌شده", en: "Completed" }, failed: { fa: "ناموفق", en: "Failed" }, rejected: { fa: "ردشده", en: "Rejected" },
    blocked: { fa: "مسدود", en: "Blocked" }, running: { fa: "در حال اجرا", en: "Running" }, starting: { fa: "در حال شروع", en: "Starting" },
    waiting: { fa: "در انتظار", en: "Waiting" }, stopping: { fa: "در حال توقف", en: "Stopping" }, stopped: { fa: "متوقف‌شده", en: "Stopped" },
    pending: { fa: "در صف", en: "Pending" }, submitted: { fa: "ارسال‌شده", en: "Submitted" }, pass: { fa: "مجاز", en: "Passed" },
    new: { fa: "جدید", en: "New" }, open: { fa: "باز", en: "Open" }, partially_filled: { fa: "بخشی پرشده", en: "Partially filled" },
    filled: { fa: "پرشده", en: "Filled" }, canceled: { fa: "لغوشده", en: "Canceled" }, cancelled: { fa: "لغوشده", en: "Canceled" },
    reconciling: { fa: "در حال تطبیق", en: "Reconciling" }, cancel_pending: { fa: "در انتظار لغو", en: "Cancellation pending" },
    accepted: { fa: "پذیرفته‌شده", en: "Accepted" }, resolved: { fa: "تطبیق‌شده", en: "Resolved" }, settled: { fa: "ارزیابی‌شده", en: "Settled" },
    warning: { fa: "هشدار", en: "Warning" }, unknown: { fa: "نامشخص", en: "Unknown" },
    fail: { fa: "نیازمند رسیدگی", en: "Needs attention" }, skip: { fa: "بررسی‌نشده", en: "Not checked" },
  };
  const key = value.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  return labels[key]?.[locale] ?? value.replaceAll("_", " ");
}
function modeTitle(mode: string, locale: Locale) { return copy[locale][mode] ?? mode; }
function reportAssumptionText(value: string, locale: Locale): string {
  if (locale !== "fa") return value;
  const translations: Record<string, string> = {
    "Live Wallex market data; no order-write adapter is constructed in shadow mode.": "داده‌های بازار والکس زنده هستند؛ در حالت شبیه‌سازی زنده امکان ارسال سفارش وجود ندارد.",
    "Virtual portfolio is isolated from the exchange wallet.": "پرتفوی مجازی از کیف پول صرافی جداست و موجودی واقعی را تغییر نمی‌دهد.",
    "Paper fills are estimates from the visible depth snapshot; configured slippage and fees are applied.": "پرشدن سفارش فرضی برآوردی از عمق قابل‌مشاهده بازار است و کارمزد و لغزش تنظیم‌شده را اعمال می‌کند.",
    "Paper fills walk the same fresh visible book checked by the shadow risk gate; configured slippage and fees are applied.": "پرشدن سفارش فرضی بر مبنای همان دفتر سفارش تازه و قابل‌مشاهده‌ای است که در کنترل ریسک شبیه‌سازی زنده بررسی شده؛ کارمزد و لغزش تنظیم‌شده اعمال می‌شوند.",
    "Shadow fills do not model queue priority, exchange latency, hidden liquidity, actual order acceptance, or market impact beyond configured slippage; shadow results do not guarantee live execution or returns.": "این شبیه‌سازی اولویت صف، تأخیر صرافی، نقدینگی پنهان، پذیرش واقعی سفارش یا اثر بازار فراتر از لغزش تنظیم‌شده را بازسازی نمی‌کند؛ نتیجه آن تضمین اجرای زنده یا سود نیست.",
    "Market decisions use completed Wallex 1-minute bars only.": "تصمیم‌های بازار فقط با کندل‌های یک‌دقیقه‌ای تکمیل‌شده والکس گرفته می‌شوند.",
    "External news, sentiment, tokenomics, and on-chain feeds are not replayed historically because current feeds would introduce lookahead bias.": "خبر، احساسات بازار، توکنومیک و داده‌های درون‌زنجیره‌ای تاریخی بازپخش نمی‌شوند؛ استفاده از داده فعلی در گذشته باعث سوگیری نگاه به آینده می‌شود.",
    "Simulated fills occur at the next bar open at earliest.": "اجرای فرضی سفارش زودتر از قیمت آغاز کندل بعدی انجام نمی‌شود.",
    "Historical candles do not reproduce historical order-book depth or queue position.": "کندل‌های تاریخی عمق دفتر سفارش و جایگاه صف تاریخی را بازسازی نمی‌کنند.",
    "Wallex credit-account spot execution.": "سفارش‌های زنده در بازار اسپات حساب اعتبار معاملاتی والکس اجرا می‌شوند.",
    "Sub-account-specific API key and sub-account-client-id are required.": "کلید API اختصاصی زیرحساب و شناسه همان زیرحساب لازم است.",
    "The exchange order and fill records are authoritative.": "وضعیت نهایی سفارش و پرشدن‌ها از سوابق ثبت‌شده در والکس خوانده می‌شوند.",
  };
  if (translations[value]) return translations[value]!;
  if (value.startsWith("Live Wallex market data;")) return "داده‌های بازار والکس زنده هستند؛ در حالت شبیه‌سازی، ارسال سفارش واقعی در دسترس نیست.";
  if (value.startsWith("Virtual portfolio is isolated")) return "پرتفوی مجازی مستقل از کیف پول صرافی است و موجودی واقعی را تغییر نمی‌دهد.";
  const fee = value.match(/^Fee: ([\d.]+) bps; slippage: ([\d.]+) bps\.$/);
  if (fee) return `کارمزد: ${fee[1]} واحد پایه؛ لغزش قیمت: ${fee[2]} واحد پایه.`;
  return value;
}
function operationTitle(operation: string, locale: Locale) {
  const labels: Record<string, { fa: string; en: string }> = {
    analyze: { fa: "تحلیل", en: "Analysis" }, propose: { fa: "پیشنهاد", en: "Proposal" },
    reflect: { fa: "بازتاب", en: "Reflection" }, tool: { fa: "ابزار پژوهش", en: "Research tool" },
  };
  return labels[operation.toLowerCase()]?.[locale] ?? operation.replaceAll("_", " ");
}
function orderValueTitle(value: string, locale: Locale) {
  const normalized = value.toUpperCase();
  const labels: Record<string, { fa: string; en: string }> = {
    BUY: { fa: "خرید", en: "Buy" }, SELL: { fa: "فروش", en: "Sell" }, MARKET: { fa: "سفارش بازار", en: "Market order" }, LIMIT: { fa: "سفارش محدود", en: "Limit order" },
  };
  return labels[normalized]?.[locale] ?? value;
}
function actionTitle(value: string, locale: Locale) {
  const labels: Record<string, { fa: string; en: string }> = {
    BUY: { fa: "خرید", en: "Buy" }, SELL: { fa: "فروش", en: "Sell" }, HOLD: { fa: "نگه‌داری", en: "Hold" },
  };
  return labels[value.toUpperCase()]?.[locale] ?? value;
}
function auditCategoryTitle(category: string, locale: Locale) {
  const role = agentTitle(category, locale);
  if (role !== category) return role;
  const labels: Record<string, { fa: string; en: string }> = {
    market_data: { fa: "داده بازار", en: "Market data" }, news: { fa: "خبر", en: "News" }, sentiment: { fa: "احساسات بازار", en: "Market sentiment" },
    fundamentals: { fa: "توکنومیک و داده درون‌زنجیره", en: "Tokenomics and on-chain data" }, technical: { fa: "تحلیل تکنیکال", en: "Technical analysis" },
  };
  return labels[category.toLowerCase()]?.[locale] ?? category.replaceAll("_", " ");
}
function runSymbols(config: JsonMap): string[] {
  const values = Array.isArray(config.symbols) ? config.symbols : typeof config.symbol === "string" ? [config.symbol] : [];
  return values.map((value) => String(value).toUpperCase()).filter(Boolean);
}
function runStrategies(config: JsonMap): string[] {
  const configured = config.strategyIds ?? config.strategies ?? config.strategy;
  const values = Array.isArray(configured) ? configured : configured ? [configured] : [];
  return values.map((value) => typeof value === "string" ? value : String(object(value).id ?? "")).filter(Boolean);
}
function pretty(value: unknown) { return JSON.stringify(value, null, 2) ?? "—"; }
function object(value: unknown): JsonMap { return value && typeof value === "object" ? value as JsonMap : {}; }

function useToast() {
  const [toast, setToast] = useState("");
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 4500); return () => clearTimeout(id); }, [toast]);
  return { toast, notify: setToast };
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section>; }
function PageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{description && <p className="muted intro">{description}</p>}</div>{action}</div>;
}
function Empty({ text }: { text: string }) { return <div className="empty"><span className="empty-mark"><FileClock size={20} /></span><p>{text}</p></div>; }
function Metric({ label, value, note, icon: Icon, tone = "plain" }: { label: string; value: string; note?: string; icon: typeof Activity; tone?: "plain" | "up" | "down" }) {
  return <Card className="metric-card"><div className="metric-head"><p className="metric-label">{label}</p><span className={`metric-icon ${tone}`}><Icon size={17} /></span></div><strong className={tone}>{value}</strong>{note && <small>{note}</small>}</Card>;
}
function EquityChart({ points, label, locale }: { points: Array<{ timestamp?: number; equity?: string | number }>; label: string; locale: Locale }) {
  const values = points.map((point) => Number(point.equity)).filter(Number.isFinite);
  if (values.length < 2) return <div className="chart-empty"><BarChart3 size={22} /><span>{label}</span></div>;
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const coords = values.map((value, index) => `${(index / (values.length - 1)) * 100},${92 - ((value - min) / range) * 84}`).join(" ");
  const first = values[0]!, last = values.at(-1)!;
  if (max - min <= Math.max(0.000001, Math.abs(first) * 0.000001)) return <div className="chart-empty"><BarChart3 size={22} /><span>{label}</span><small>{locale === "fa" ? "ارزش پرتفوی در این اجرا هنوز تغییر معناداری نکرده است." : "Equity has not changed materially in this run yet."}</small></div>;
  const positive = last >= first;
  return <div className="equity-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label}>
    <defs><linearGradient id="equity-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={positive ? "#68dbbb" : "#f18b87"} stopOpacity=".25"/><stop offset="100%" stopColor={positive ? "#68dbbb" : "#f18b87"} stopOpacity="0"/></linearGradient></defs>
    <path d={`M 0 100 L ${coords.replaceAll(" ", " L ")} L 100 100 Z`} fill="url(#equity-fill)" />
    <polyline points={coords} fill="none" stroke={positive ? "#68dbbb" : "#f18b87"} strokeWidth=".8" vectorEffect="non-scaling-stroke" />
  </svg><div className="chart-endpoints"><span>{money(first)}</span><span>{money(last)}</span></div></div>;
}

export default function App() {
  const queryClient = useQueryClient();
  const [locale, setLocale] = useState<Locale>(() => (localStorage.getItem("trex-locale") ?? localStorage.getItem("wallex-locale")) === "en" ? "en" : "fa");
  const [view, setView] = useState("overview");
  const [strategySection, setStrategySection] = useState<"agents" | "strategies">("agents");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const { toast, notify } = useToast();
  const t = copy[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
    localStorage.setItem("trex-locale", locale);
    localStorage.removeItem("wallex-locale");
  }, [locale]);

  useEffect(() => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    document.querySelector<HTMLElement>(".sidebar .nav-item.active")?.scrollIntoView({
      behavior, block: "nearest", inline: "nearest",
    });
  }, [view]);

  const bootQuery = useQuery({
    queryKey: ["bootstrap", selectedProfileId ?? "active"],
    queryFn: () => api<Bootstrap>(`/api/bootstrap${selectedProfileId ? `?profileId=${encodeURIComponent(selectedProfileId)}` : ""}`),
  });
  const bootstrap = bootQuery.data;
  useEffect(() => {
    if (bootstrap?.activeProfileId && selectedProfileId === null) setSelectedProfileId(bootstrap.activeProfileId);
  }, [bootstrap?.activeProfileId, selectedProfileId]);
  const profileId = selectedProfileId ?? bootstrap?.activeProfileId ?? "";

  useEffect(() => {
    let source: EventSource | undefined;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = async (refreshToken = false) => {
      try {
        const token = await getToken(refreshToken);
        if (cancelled) return;
        source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
        source.onopen = () => setStreaming(true);
        source.onerror = () => {
          setStreaming(false);
          source?.close();
          if (!cancelled) reconnectTimer = setTimeout(() => void connect(true), 1500);
        };
        source.addEventListener("state", (message) => {
          try {
            const data = JSON.parse((message as MessageEvent<string>).data) as { managedRuns: ManagedRun[]; recentRuns: Run[] };
            queryClient.setQueryData(["runs", profileId], (previous: JsonMap | undefined) => ({ ...previous, runs: data.recentRuns, managedRuns: data.managedRuns }));
            queryClient.setQueryData(["bootstrap", selectedProfileId ?? "active"], (previous: Bootstrap | undefined) => previous ? { ...previous, runs: data.recentRuns, managedRuns: data.managedRuns } : previous);
            queryClient.invalidateQueries({ queryKey: ["reports"] });
            queryClient.invalidateQueries({ queryKey: ["benchmarks"] });
          } catch { /* A malformed update is ignored; reconnect reloads persisted state. */ }
        });
      } catch {
        setStreaming(false);
        if (!cancelled) reconnectTimer = setTimeout(() => void connect(true), 1500);
      }
    };
    void connect();
    return () => { cancelled = true; if (reconnectTimer) clearTimeout(reconnectTimer); source?.close(); };
  }, [profileId, queryClient, selectedProfileId]);

  const activateMutation = useMutation({
    mutationFn: (id: string) => api(`/api/profiles/${encodeURIComponent(id)}/activate`, { method: "POST", body: "{}" }),
    onSuccess: (_result, id) => { setSelectedProfileId(id); void queryClient.invalidateQueries(); notify(locale === "fa" ? "پروفایل فعال شد." : "Profile activated."); },
    onError: (error) => notify(error.message),
  });

  const profile = bootstrap?.profiles.find((item) => item.id === profileId);
  const assetIconsQuery = useQuery({
    queryKey: ["wallex-asset-icons"],
    enabled: Boolean(bootstrap),
    staleTime: 6 * 60 * 60 * 1000,
    queryFn: async () => {
      const { markets } = await api<{ markets: Array<{ baseAsset: string; quoteAsset: string; baseAssetIconUrl?: string; quoteAssetIconUrl?: string }> }>("/api/markets?all=true");
      const icons: Record<string, string> = {};
      for (const market of markets) {
        if (market.baseAssetIconUrl?.startsWith("https://")) icons[market.baseAsset.toUpperCase()] = market.baseAssetIconUrl;
        if (market.quoteAssetIconUrl?.startsWith("https://")) icons[market.quoteAsset.toUpperCase()] = market.quoteAssetIconUrl;
      }
      return icons;
    },
  });
  const runQuery = useQuery({ queryKey: ["runs", profileId], queryFn: () => api<{ runs: Run[]; managedRuns: ManagedRun[] }>("/api/runs?limit=100") });
  const runs = runQuery.data?.runs ?? bootstrap?.runs ?? [];
  const managedRuns = runQuery.data?.managedRuns ?? bootstrap?.managedRuns ?? [];
  const latestReport = runs.find((run) => run.report)?.report ?? {};
  const navTitle = t[view] ?? t.overview;
  const refresh = () => { void queryClient.invalidateQueries(); };

  if (bootQuery.isPending) return <div className="boot-screen"><span className="brand-mark"><Activity size={21} /></span><LoaderCircle className="spin" size={20} /><p>{locale === "fa" ? "در حال آماده‌سازی فضای اپراتور…" : "Preparing operator workspace…"}</p></div>;
  if (bootQuery.isError || !bootstrap) return <div className="boot-screen"><AlertTriangle size={28} /><h1>{locale === "fa" ? "سرویس داشبورد در دسترس نیست" : "Dashboard service unavailable"}</h1><p>{bootQuery.error?.message}</p><button className="button primary" onClick={() => void bootQuery.refetch()}><RefreshCw size={16} />{t.refresh}</button></div>;

  const renderView = () => {
    if (view === "overview") return <OverviewView t={t} locale={locale} config={bootstrap.config} runs={runs} managedRuns={managedRuns} latestReport={latestReport} assetIcons={assetIconsQuery.data ?? {}} onNavigate={setView} />;
    if (view === "runLab") return <RunLabView t={t} locale={locale} profileId={profileId} profiles={bootstrap.profiles} config={bootstrap.config} strategies={bootstrap.strategies} runs={runs} managedRuns={managedRuns} assetIcons={assetIconsQuery.data ?? {}} notify={notify} onRefresh={refresh} />;
    if (view === "profiles") return <ProfilesView t={t} locale={locale} profile={profile} profiles={bootstrap.profiles} profileId={profileId} fields={bootstrap.fields} encryptionConfigured={Boolean((bootstrap as JsonMap).encryptionKeyConfigured)} onSelect={setSelectedProfileId} onNavigate={(target) => { if (target === "strategies") setStrategySection("strategies"); setView(target); }} notify={notify} onRefresh={refresh} />;
    if (view === "strategies") return <StrategiesView t={t} locale={locale} profileId={profileId} config={bootstrap.config} fields={bootstrap.fields} strategies={bootstrap.strategies} section={strategySection} onSectionChange={setStrategySection} notify={notify} onRefresh={refresh} />;
    if (view === "markets") return <MarketsView t={t} locale={locale} profileId={profileId} configured={bootstrap.config?.wallex?.allowedMarkets ?? []} notify={notify} onRefresh={refresh} />;
    if (view === "reports") return <ReportsView t={t} locale={locale} runs={runs} notify={notify} />;
    if (view === "orders") return <OrdersView t={t} locale={locale} notify={notify} />;
    return <SystemView t={t} locale={locale} profileId={profileId} profiles={bootstrap.profiles} config={bootstrap.config} fields={bootstrap.fields} database={bootstrap.database} notify={notify} onRefresh={refresh} />;
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Activity size={19} /></span><span><strong>Trex</strong><small>TRADING SYSTEM</small></span></div>
      <div className="side-label">{locale === "fa" ? "میز کار" : "WORKSPACE"}</div>
      <nav aria-label={locale === "fa" ? "ناوبری اصلی" : "Primary navigation"}>
        {nav.map(([id, Icon]) => <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => { if (id === "strategies") setStrategySection("agents"); setView(id); }} aria-current={view === id ? "page" : undefined}>
          <Icon size={17} strokeWidth={1.8} /><span>{t[id]}</span>{id === "runLab" && managedRuns.some((run) => ["running", "waiting", "starting"].includes(run.state)) && <i className="live-dot" />}
        </button>)}
      </nav>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumbs"><span>{t.operator}</span><span className="crumb-separator">/</span><strong>{navTitle}</strong></div>
        <div className="top-actions">
          <div className="profile-select"><span>{t.activeProfile}</span><AppSelect ariaLabel={t.activeProfile} value={profileId} locale={locale} onValueChange={(id) => activateMutation.mutate(id)} options={bootstrap.profiles.map((item) => ({ value: item.id, label: item.name, ...(item.active ? { detail: locale === "fa" ? "پروفایل فعال" : "Active profile" } : {}) }))}/></div>
          <button className="icon-button language-toggle" onClick={() => setLocale(locale === "fa" ? "en" : "fa")} aria-label={locale === "fa" ? "Switch to English" : "تغییر زبان به فارسی"}><Globe2 size={17} /><span>{locale === "fa" ? "EN" : "فا"}</span></button>
          <button className="icon-button" onClick={refresh} aria-label={t.refresh}><RefreshCw size={16} /></button>
        </div>
      </header>
      <main className="page-content" id="main-content">{renderView()}</main>
      <footer className="statusbar"><span><span className={`connection-dot ${streaming ? "online" : ""}`} />{streaming ? t.connected : t.reconnecting}</span><span>SQLite · Bun · Wallex spot</span></footer>
    </div>
    {toast && <div className="toast" role="status"><span><Check size={16} /></span>{toast}<button onClick={() => notify("")} aria-label="Dismiss"><X size={15} /></button></div>}
  </div>;
}

function OverviewView({ t, locale, config, runs, managedRuns, latestReport, assetIcons, onNavigate }: { t: Record<string, string>; locale: Locale; config: JsonMap; runs: Run[]; managedRuns: ManagedRun[]; latestReport: JsonMap; assetIcons: Record<string, string>; onNavigate: (view: string) => void }) {
  const hasVirtual = runs.some((run) => ["shadow", "backtest"].includes(run.mode));
  const portfolio = object(latestReport);
  const actualQuery = useQuery({ queryKey: ["account-balance"], queryFn: () => api<{ portfolio: JsonMap; observedAt: number; label: string }>("/api/account"), enabled: false, retry: false });
  const alive = managedRuns.filter((run) => ["starting", "running", "waiting", "stopping"].includes(run.state));
  const chartPoints = Array.isArray(portfolio.equityCurve) ? portfolio.equityCurve : [];
  const returnTone = pnlTone(portfolio.netReturnPct);
  return <>
    <PageHeading title={t.overview} description={locale === "fa" ? "وضعیت اجرای عامل‌ها، پرتفوی شبیه‌سازی و ممیزی معامله را از اینجا دنبال کنید." : "Monitor agent runs, simulated portfolios, and the trading audit trail from one place."} action={<button className="button primary" onClick={() => onNavigate("runLab")}><Plus size={16} />{t.start}</button>} />
    <div className="notice info"><span className="notice-icon"><Shield size={17} /></span><div><b>{locale === "fa" ? "محیط ایمن برای آزمایش" : "Safe testing environment"}</b><p>{locale === "fa" ? "بک‌تست و شبیه‌سازی زنده با پرتفوی مجازی اجرا می‌شوند و به مسیر سفارش‌گذاری والکس دسترسی ندارند." : "Backtests and shadow runs use a virtual portfolio and cannot submit Wallex orders."}</p></div><button className="text-button" onClick={() => onNavigate("runLab")}>{locale === "fa" ? "شروع آزمایش" : "Start a test"}<span>←</span></button></div>
    <div className="metric-grid">
      <Metric label={t.runs} value={String(runs.length)} note={`${alive.length} ${locale === "fa" ? "در حال اجرا" : "active now"}`} icon={Activity} />
      <Metric label={t.decisions} value={String(runs.reduce((sum, run) => sum + Number(object(run.report).acceptedProposals ?? 0), 0))} note={locale === "fa" ? "پیشنهادهای پذیرفته‌شده" : "accepted proposals"} icon={Cpu} />
      <Metric label={t.return} value={percent(portfolio.netReturnPct)} note={portfolio.mode === "live" ? "LIVE" : locale === "fa" ? "عملکرد آخرین گزارش" : "latest report"} icon={returnTone === "up" ? TrendingUp : returnTone === "down" ? TrendingDown : Activity} tone={returnTone} />
      <Metric label={t.trades} value={String(portfolio.tradeCount ?? 0)} note={locale === "fa" ? "تکمیل‌شده در آخرین گزارش" : "filled in latest report"} icon={ArrowLeftRight} />
    </div>
    <div className="overview-grid">
      <Card className="chart-card"><div className="card-heading"><div><h2>{t.equity}</h2><small className="muted">{hasVirtual ? `${t.virtual} · ${portfolio.quoteCurrency ?? config.wallex?.quoteCurrency ?? "TMN"}` : t.noData}</small></div><button className="icon-button" onClick={() => onNavigate("reports")} aria-label={t.reports}><BarChart3 size={17} /></button></div><EquityChart points={chartPoints} label={t.equity} locale={locale} /></Card>
      <Card className="active-runs-card"><div className="card-heading"><div><h2>{locale === "fa" ? "اجراهای فعال" : "Active runs"}</h2></div><span className="count-pill">{alive.length}</span></div>
        {alive.length === 0 ? <Empty text={locale === "fa" ? "اجرای فعالی وجود ندارد." : "No active run right now."} /> : <div className="active-list">{alive.map((run) => <div className="active-row" key={run.id}><span className={`mode-badge ${run.mode}`}>{modeTitle(run.mode, locale)}</span><div className="active-copy"><strong>{run.symbols.join(", ")}</strong><small>{run.message}</small></div><span className={statusClass(run.state)}>{statusTitle(run.state, locale)}</span></div>)}</div>}
        <button className="text-button wide" onClick={() => onNavigate("runLab")}>{locale === "fa" ? "مدیریت اجراها" : "Manage runs"}<span>←</span></button>
      </Card>
    </div>
    <div className="overview-grid lower">
      <Card><div className="card-heading"><div><h2>{t.recent}</h2></div><button className="text-button" onClick={() => onNavigate("reports")}>{t.reports}<span>←</span></button></div>
        {runs.length === 0 ? <Empty text={t.noRuns} /> : <div className="table-wrap"><table><thead><tr><th>{locale === "fa" ? "حالت" : "Mode"}</th><th>{t.symbol}</th><th>{locale === "fa" ? "وضعیت" : "Status"}</th><th>{t.return}</th><th>{locale === "fa" ? "زمان" : "Time"}</th></tr></thead><tbody>{runs.slice(0, 6).map((run) => <tr key={run.id}><td><span className={`mode-badge ${run.mode}`}>{modeTitle(run.mode, locale)}</span></td><td>{object(run.config).symbol ?? "—"}</td><td><span className={statusClass(run.status)}>{statusTitle(run.status, locale)}</span></td><td className={pnlClass(object(run.report).netReturnPct)}>{percent(object(run.report).netReturnPct)}</td><td>{dateLabel(run.startedAt, locale)}</td></tr>)}</tbody></table></div>}
      </Card>
      <Card className="balance-card"><div className="card-heading"><div><h2>{t.actual}</h2></div><span className="secure-mark"><LockKeyhole size={16} /></span></div><p className="muted">{locale === "fa" ? "خواندن موجودی حساب مجاز است و هیچ سفارش یا تغییری ایجاد نمی‌کند." : "Balance access is read-only; this action does not create or change orders."}</p>
        {actualQuery.data ? <div className="balance-value"><strong>{money(actualQuery.data.portfolio.equity, actualQuery.data.portfolio.quoteCurrency, locale)}</strong><small>{dateLabel(actualQuery.data.observedAt, locale)} · read-only</small></div> : <button className="button secondary full" onClick={() => void actualQuery.refetch()} disabled={actualQuery.isFetching}><RefreshCw size={15} className={actualQuery.isFetching ? "spin" : ""} />{locale === "fa" ? "دریافت موجودی واقعی" : "Fetch actual balance"}</button>}
        {actualQuery.isError && <p className="error-text">{actualQuery.error.message}</p>}
      </Card>
    </div>
  </>;
}

function ProfilesView({ t, locale, profile, profiles, profileId, fields, encryptionConfigured, onSelect, onNavigate, notify, onRefresh }: {
  t: Record<string, string>; locale: Locale; profile: Profile | undefined; profiles: Profile[]; profileId: string; fields: Field[];
  encryptionConfigured: boolean; onSelect: (id: string) => void; onNavigate: (view: string) => void; notify: (message: string) => void; onRefresh: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("AI & agents");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({});
  const [secretEditorRevision, setSecretEditorRevision] = useState(0);
  const [clearSecrets, setClearSecrets] = useState<Record<string, boolean>>({});
  const [dotenvPath, setDotenvPath] = useState("");
  const [importName, setImportName] = useState("");
  const [importTarget, setImportTarget] = useState<"new" | "replace">("new");
  const [generatedKey, setGeneratedKey] = useState("");
  const [previousKey, setPreviousKey] = useState("");
  const [replacementKey, setReplacementKey] = useState("");
  const queryClient = useQueryClient();
  const groups = [...new Set(fields.filter((field) => !field.secret).map((field) => field.group))];
  const hasUnsavedSettings = fields.some((field) => field.writable && !field.secret && draft[field.key] !== undefined && draft[field.key] !== field.value);
  useEffect(() => {
    setDraft(Object.fromEntries(fields.filter((field) => !field.secret).map((field) => [field.key, field.value])));
    setSecretDraft({}); setClearSecrets({});
  }, [profileId]);

  const createProfile = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await api<{ profile: Profile }>("/api/profiles", { method: "POST", body: JSON.stringify({ name: newName.trim(), ...(copyFrom ? { copyFrom } : {}) }) });
      setNewName(""); onSelect(result.profile.id); onRefresh(); notify(locale === "fa" ? "پروفایل ساخته شد." : "Profile created.");
    } catch (error) { notify(error instanceof Error ? error.message : "Profile could not be created."); }
  };
  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    const updates = Object.fromEntries(fields.filter((field) => field.writable && !field.secret && draft[field.key] !== field.value).map((field) => [field.key, draft[field.key] ?? ""]));
    if (!Object.keys(updates).length) { notify(locale === "fa" ? "تغییری برای ذخیره نیست." : "No settings changed."); return; }
    setSavingSettings(true);
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ profileId, settings: updates }) });
      onRefresh(); notify(locale === "fa" ? `${Object.keys(updates).length} تنظیم ذخیره شد.` : `${Object.keys(updates).length} settings saved.`);
    } catch (error) { notify(error instanceof Error ? error.message : (locale === "fa" ? "ذخیره تنظیمات ناموفق بود." : "Settings could not be saved.")); }
    finally { setSavingSettings(false); }
  };
  const saveSecrets = async (event: FormEvent) => {
    event.preventDefault();
    const secrets: JsonMap = {}, providers: JsonMap = {};
    for (const key of new Set([...Object.keys(secretDraft), ...Object.keys(clearSecrets)])) {
      const value = secretDraft[key] ?? "";
      const submittedValue = clearSecrets[key] ? "" : value;
      if (key.startsWith("provider:")) { if (value || clearSecrets[key]) providers[key.slice(9)] = submittedValue; }
      else if (value || clearSecrets[key]) secrets[key] = submittedValue;
    }
    if (Object.keys(providers).length) secrets.providerKeys = providers;
    if (!Object.keys(secrets).length) { notify(locale === "fa" ? "کلید جدیدی وارد نشده است." : "Enter a new credential or select one to clear."); return; }
    try {
      await api(`/api/profiles/${encodeURIComponent(profileId)}`, { method: "PUT", body: JSON.stringify({ secrets }) });
      setSecretDraft({}); setClearSecrets({}); setSecretEditorRevision((revision) => revision + 1); onRefresh(); notify(locale === "fa" ? "کلیدها به صورت رمزگذاری‌شده ذخیره شدند." : "Credentials saved encrypted.");
    } catch (error) { notify(error instanceof Error ? error.message : "Credentials could not be saved."); }
  };
  const importDotenv = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await api<{ profile: Profile; removedConfigurationAssignments: number; file: string }>("/api/profiles/import-dotenv", { method: "POST", body: JSON.stringify({ path: dotenvPath, name: importTarget === "new" ? importName.trim() || "Imported profile" : profile?.name ?? "Imported profile", ...(importTarget === "replace" && profileId ? { profileId } : {}) }) });
      setDotenvPath(""); setImportName(""); onSelect(result.profile.id); onRefresh();
      notify(locale === "fa" ? `${result.file} وارد شد؛ ${result.removedConfigurationAssignments} تنظیم قدیمی از فایل پاک شد.` : `Imported ${result.file}; removed ${result.removedConfigurationAssignments} legacy configuration assignments.`);
    } catch (error) { notify(error instanceof Error ? error.message : "Import failed."); }
  };
  const rotateKey = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await api<{ reencryptedSecretCount: number }>("/api/secrets/rekey", { method: "POST", body: JSON.stringify({ previousKey, replacementKey }) });
      setPreviousKey(""); setReplacementKey(""); onRefresh();
      notify(locale === "fa" ? `${result.reencryptedSecretCount} مقدار بازرمزگذاری شد؛ کلید جایگزین را در secret manager ذخیره کنید.` : `Re-encrypted ${result.reencryptedSecretCount} values. Store the replacement key in your secret manager.`);
    } catch (error) { notify(error instanceof Error ? error.message : "Key rotation failed."); }
  };

  return <>
    <PageHeading title={t.profiles} description={locale === "fa" ? "پروفایل‌ها محیط‌های مستقل موتور هستند. تنظیمات و اعتبارنامه‌ها در پایگاه داده ذخیره می‌شوند؛ اعتبارنامه‌ها رمزگذاری و پس از ثبت پنهان می‌مانند." : "Profiles are isolated engine environments. Settings and credentials are stored in the database; credentials are encrypted and never displayed after saving."} />
    <div className="profile-layout">
      <Card className="profile-list-card"><div className="card-heading"><div><h2>{locale === "fa" ? "پروفایل‌ها" : "Profiles"}</h2></div><span className="count-pill">{profiles.length}</span></div>
        <div className="profile-list">{profiles.map((item) => <div className={`profile-row ${item.id === profileId ? "selected" : ""}`} key={item.id}><button className="profile-pick" onClick={() => onSelect(item.id)}><span className="profile-avatar">{item.name.slice(0, 1).toUpperCase()}</span><span><b>{item.name}</b><small>{item.active ? (locale === "fa" ? "فعال" : "Active") : (locale === "fa" ? "غیرفعال" : "Inactive")}</small></span></button>{item.active && <Check size={15} className="positive" />}<button className="icon-button tiny" title={t.delete} disabled={item.active || profiles.length <= 1} onClick={async () => { if (!window.confirm(locale === "fa" ? `پروفایل «${item.name}» حذف شود؟` : `Delete profile “${item.name}”?`)) return; try { await api(`/api/profiles/${encodeURIComponent(item.id)}`, { method: "DELETE" }); onRefresh(); notify(locale === "fa" ? "پروفایل حذف شد." : "Profile deleted."); } catch (error) { notify(error instanceof Error ? error.message : "Delete failed."); } }}><Trash2 size={14}/></button></div>)}</div>
        <form className="create-profile-form" onSubmit={createProfile}><label className="sr-only" htmlFor="new-profile-name">{t.profileName}</label><input id="new-profile-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t.profileName} maxLength={80} required/><FieldLabelInfo className="compact-info" label={locale === "fa" ? "کپی تنظیمات از" : "Copy settings from"} help={locale === "fa" ? "تنظیمات و اعتبارنامه‌های رمزگذاری‌شدهٔ پروفایل انتخاب‌شده به پروفایل جدید کپی می‌شوند. با شروع خالی، فقط پیش‌فرض‌های موتور اعمال می‌شوند." : "Copies settings and encrypted credentials from the selected profile. Start blank to use engine defaults."}/><AppSelect ariaLabel={locale === "fa" ? "کپی تنظیمات از" : "Copy settings from"} value={copyFrom || "__trex_empty__"} onValueChange={setCopyFrom} locale={locale} placeholder={locale === "fa" ? "شروع خالی" : "Start blank"} options={[{ value: "__trex_empty__", label: locale === "fa" ? "شروع خالی" : "Start blank" }, ...profiles.map((item) => ({ value: item.id, label: item.name }))]}/><button className="button secondary full"><Plus size={15}/>{t.create}</button></form>
      </Card>
      <div className="profile-content">
        <Card><div className="card-heading"><div><h2>{profile?.name ?? t.profile}</h2><small className="muted">{profile?.active ? (locale === "fa" ? "پروفایل فعال موتور" : "Active engine profile") : (locale === "fa" ? "پیش‌نمایش پروفایل" : "Profile preview")}</small></div>{profile && !profile.active && <button className="button secondary" onClick={async () => { try { await api(`/api/profiles/${encodeURIComponent(profile.id)}/activate`, { method: "POST" }); onSelect(profile.id); onRefresh(); notify(locale === "fa" ? "پروفایل فعال شد." : "Profile activated."); } catch (error) { notify(error instanceof Error ? error.message : "Activation failed."); } }}><Check size={15}/>{t.activate}</button>}</div>
          <div className="segmented-scroll" role="tablist" aria-label={t.settings}>{["All", ...groups].map((group, index) => <button id={`settings-tab-${index}`} aria-controls="settings-tab-panel" role="tab" tabIndex={selectedGroup === group ? 0 : -1} aria-selected={selectedGroup === group} className={selectedGroup === group ? "selected" : ""} key={group} onKeyDown={(event) => {
            const tabs = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]") ?? [])];
            const direction = locale === "fa" ? -1 : 1;
            const nextIndex = event.key === "ArrowRight" ? (index + direction + tabs.length) % tabs.length : event.key === "ArrowLeft" ? (index - direction + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
            if (nextIndex >= 0) { event.preventDefault(); tabs[nextIndex]?.focus(); setSelectedGroup(["All", ...groups][nextIndex]!); }
          }} onClick={() => setSelectedGroup(group)}>{settingsGroupTitle(group, locale)}</button>)}</div>
          <div id="settings-tab-panel" role="tabpanel" aria-labelledby={`settings-tab-${["All", ...groups].indexOf(selectedGroup)}`} tabIndex={0}>
          <div className="field-toolbar"><label className="field-search"><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.search}/></label><span className="muted small-text">{locale === "fa" ? "تنظیمات پیشرفته معتبرسازی‌شده" : "Advanced schema-validated settings"}</span></div>
          <form onSubmit={saveSettings}><div className="settings-groups">{groups.filter((group) => selectedGroup === "All" || group === selectedGroup).map((group) => {
            const visible = fields.filter((field) => !field.secret && field.group === group && `${settingTitle(field.key, locale)} ${field.key} ${field.group}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
            if (!visible.length) return null;
            return <section className="settings-group" key={group}><h3>{settingsGroupTitle(group, locale)}</h3><div className="settings-fields">{visible.map((field) => {
              const value = draft[field.key] ?? field.value, boolean = ["true", "false"].includes(value.toLowerCase()), jsonValue = field.key.endsWith("_JSON");
              const update = (next: string) => setDraft((prev) => ({ ...prev, [field.key]: next }));
              const settingLabel = <span className="setting-meta"><FieldLabelInfo className="setting-field-label" label={settingTitle(field.key, locale)} help={fieldHelp(field.key, field.group, locale)}/><small className={`source-tag source-${field.source}`}>{sourceTitle(field.source, locale)}</small></span>;
              const effectiveHint = locale === "fa" ? "برای این سرویس فقط خواندنی است." : "Read-only for this service.";
              return <div className={`setting-field ${jsonValue ? "setting-wide" : ""}`} key={field.key}>{settingLabel}
                {boolean ? <AppSelect ariaLabel={settingTitle(field.key, locale)} value={value.toLowerCase()} disabled={!field.writable} locale={locale} onValueChange={update} options={[{ value: "true", label: locale === "fa" ? "فعال · true" : "Enabled · true" }, { value: "false", label: locale === "fa" ? "غیرفعال · false" : "Disabled · false" }]}/> : ["AI_ROLE_MODELS_JSON", "AI_ROLE_INSTRUCTIONS_JSON", "AI_ROLE_MAX_TOOL_STEPS_JSON", "AI_DISABLED_AGENTS_JSON"].includes(field.key) ? <><p className="field-hint route-note">{locale === "fa" ? "برای تنظیم بصری و اعتبارسنجی عامل‌ها، از فضای تیم عامل‌ها استفاده کنید." : "Use the visual agent workspace for guided editing and validation."}<button type="button" className="text-button" onClick={() => onNavigate("strategies")}>{locale === "fa" ? "بازکردن تنظیمات عامل‌ها" : "Open agent settings"}<ArrowLeftRight size={13}/></button></p><details className="advanced-json"><summary>{locale === "fa" ? "ویرایش مستقیم JSON پیشرفته" : "Advanced raw JSON editor"}</summary>{field.key === "AI_ROLE_MODELS_JSON" ? <RoleRouteEditor value={value} disabled={!field.writable} locale={locale} onChange={update}/> : <textarea rows={3} value={value} disabled={!field.writable} spellCheck={false} onChange={(event) => update(event.target.value)}/>}</details></> : field.key === "ENGINE_STRATEGIES_JSON" ? <><p className="field-hint route-note">{locale === "fa" ? "برای ویرایش معمول، از صفحه عامل‌ها و استراتژی‌ها استفاده کنید." : "For normal edits, use the Agents & strategies workspace."}<button type="button" className="text-button" onClick={() => onNavigate("strategies")}>{locale === "fa" ? "مدیریت استراتژی‌ها" : "Manage strategies"}<ArrowLeftRight size={13}/></button></p><details className="advanced-json"><summary>{locale === "fa" ? "ویرایش مستقیم JSON پیشرفته" : "Advanced raw JSON editor"}</summary><textarea rows={3} value={value} disabled={!field.writable} spellCheck={false} onChange={(event) => update(event.target.value)}/></details></> : jsonValue ? <textarea rows={3} value={value} disabled={!field.writable} spellCheck={false} onChange={(event) => update(event.target.value)}/> : <input value={value} disabled={!field.writable} onChange={(event) => update(event.target.value)}/>}
                {!field.writable && <small className="field-hint">{effectiveHint}</small>}
              </div>;
            })}</div></section>;
          })}</div><div className="form-footer"><small className={hasUnsavedSettings ? "unsaved-note" : "muted"} role="status">{hasUnsavedSettings ? (locale === "fa" ? "تغییرات ذخیره‌نشده · مقدارهای ورودی پیش از ثبت اعتبارسنجی می‌شوند." : "Unsaved changes · values are validated before saving.") : (locale === "fa" ? "همه تغییرات ذخیره شده‌اند. مقادیر پیش از ثبت اعتبارسنجی می‌شوند." : "All changes are saved. Values are validated before saving.")}</small><button className="button primary" disabled={!hasUnsavedSettings || savingSettings}>{savingSettings && <LoaderCircle className="spin" size={15}/>}<Check size={15}/>{savingSettings ? (locale === "fa" ? "در حال ذخیره…" : "Saving…") : t.save}</button></div></form>
          </div>
        </Card>
        <Card><div className="card-heading"><div><h2><KeyRound size={17}/>{t.secrets}</h2><small className="muted">{t.keyHint}</small></div><span className={`status ${encryptionConfigured ? "status-completed" : "status-warning"}`}>{encryptionConfigured ? t.configured : t.missing}</span></div>
          {!encryptionConfigured && <div className="notice warning"><span className="notice-icon"><AlertTriangle size={17}/></span><div><b>{locale === "fa" ? "کلید اصلی رمزنگاری تنظیم نشده" : "Encryption master key is not configured"}</b><p>{locale === "fa" ? "فقط کلید اصلی رمزنگاری خارج از پایگاه داده می‌ماند و باید در مدیر اسرار سیستم‌عامل یا فرایند سرویس نگهداری شود. خود تنظیمات و اعتبارنامه‌ها در پروفایل پایگاه داده ذخیره می‌شوند." : "Only the encryption master key stays outside the database and belongs in the OS or service secret manager. Runtime settings and credentials are stored in database profiles."}</p></div><button className="button secondary" onClick={async () => { try { const result = await api<{ key: string }>("/api/secrets/generate-key", { method: "POST", body: "{}" }); setGeneratedKey(result.key); } catch (error) { notify(error instanceof Error ? error.message : "Key generation failed."); } }}><Sparkles size={15}/>{t.generateKey}</button></div>}
          {generatedKey && <div className="generated-key"><code>{generatedKey}</code><button className="button secondary" onClick={() => { void navigator.clipboard.writeText(generatedKey); notify(t.copied); }}>{locale === "fa" ? "کپی کلید" : "Copy key"}</button><button className="icon-button" onClick={() => setGeneratedKey("")} aria-label={t.cancel}><X size={15}/></button></div>}
          <form onSubmit={saveSecrets}><div className="secret-grid">
            <SecretControl label="AI_API_KEY" id="aiApiKey" configured={profile?.secrets?.aiApiKey} value={secretDraft.aiApiKey ?? ""} cleared={clearSecrets.aiApiKey} onValue={(value) => setSecretDraft((prev) => ({ ...prev, aiApiKey: value }))} onClear={(value) => setClearSecrets((prev) => ({ ...prev, aiApiKey: value }))} locale={locale}/>
            {(["openai", "anthropic", "google", "compatible", "boxapi", "liara"] as const).map((provider) => <SecretControl key={provider} label={`${provider.toUpperCase()} API key`} id={`provider:${provider}`} configured={profile?.secrets?.providerKeys?.[provider]} value={secretDraft[`provider:${provider}`] ?? ""} cleared={clearSecrets[`provider:${provider}`]} onValue={(value) => setSecretDraft((prev) => ({ ...prev, [`provider:${provider}`]: value }))} onClear={(value) => setClearSecrets((prev) => ({ ...prev, [`provider:${provider}`]: value }))} locale={locale}/>)}
            <SecretControl label="WALLEX_API_KEY" id="wallexApiKey" configured={profile?.secrets?.wallexApiKey} value={secretDraft.wallexApiKey ?? ""} cleared={clearSecrets.wallexApiKey} onValue={(value) => setSecretDraft((prev) => ({ ...prev, wallexApiKey: value }))} onClear={(value) => setClearSecrets((prev) => ({ ...prev, wallexApiKey: value }))} locale={locale}/>
            <SecretControl label="WALLEX_SUB_ACCOUNT_CLIENT_ID" id="subAccountClientId" configured={profile?.secrets?.subAccountClientId} value={secretDraft.subAccountClientId ?? ""} cleared={clearSecrets.subAccountClientId} onValue={(value) => setSecretDraft((prev) => ({ ...prev, subAccountClientId: value }))} onClear={(value) => setClearSecrets((prev) => ({ ...prev, subAccountClientId: value }))} locale={locale}/>
            <EndpointListEditor key={`${profileId}:research:${secretEditorRevision}`} kind="research" configured={profile?.secrets?.researchEndpoints} value={secretDraft.researchEndpoints ?? ""} cleared={clearSecrets.researchEndpoints} onValue={(value) => setSecretDraft((prev) => ({ ...prev, researchEndpoints: value }))} onClear={(value) => setClearSecrets((prev) => ({ ...prev, researchEndpoints: value }))} locale={locale}/>
            <EndpointListEditor key={`${profileId}:quote:${secretEditorRevision}`} kind="quote" configured={profile?.secrets?.marketQuoteFallbacks} value={secretDraft.marketQuoteFallbacks ?? ""} cleared={clearSecrets.marketQuoteFallbacks} onValue={(value) => setSecretDraft((prev) => ({ ...prev, marketQuoteFallbacks: value }))} onClear={(value) => setClearSecrets((prev) => ({ ...prev, marketQuoteFallbacks: value }))} locale={locale}/>
          </div><div className="form-footer"><small className="muted"><LockKeyhole size={13}/>{locale === "fa" ? "کلیدها، شناسه حساب و هدرهای منبع داده در پایگاه داده رمز می‌شوند." : "Provider keys, account identifiers, and data-source credentials are encrypted before persistence."}</small><button className="button primary" disabled={!encryptionConfigured}><LockKeyhole size={15}/>{t.save}</button></div></form>
        </Card>
        <Card><div className="card-heading"><div><h2>{t.import}</h2><small className="muted">{locale === "fa" ? "پس از اعتبارسنجی و تأیید رمزگشایی، کلیدهای واردشده از فایل محلی حذف می‌شوند." : "Imported values are validated and decrypt-checked before their secret assignments are removed from the local file."}</small></div></div>
          <form className="import-form" onSubmit={importDotenv}><label><FieldLabelInfo label={t.importPath} help={locale === "fa" ? "مسیر محلی روی همین رایانه‌ای که سرویس TREX اجرا می‌شود. تنظیمات و رازهای شناخته‌شده پس از واردسازی معتبر از فایل حذف می‌شوند؛ کلید اصلی رمزنگاری وارد نمی‌شود." : "Local path on the computer running TREX. Recognized runtime settings and secrets are removed after successful import; the encryption master key is never imported."}/><input required value={dotenvPath} onChange={(event) => setDotenvPath(event.target.value)} placeholder="D:\\trex\\.env.test"/></label><label><FieldLabelInfo label={locale === "fa" ? "مقصد واردسازی" : "Import destination"} help={locale === "fa" ? "پروفایل مستقل جدید می‌سازد یا تنظیمات پروفایل انتخاب‌شده را جایگزین می‌کند." : "Create an isolated profile or replace the selected profile's settings."}/><AppSelect ariaLabel={locale === "fa" ? "مقصد واردسازی" : "Import destination"} value={importTarget} onValueChange={(value) => setImportTarget(value as "new" | "replace")} locale={locale} options={[{ value: "new", label: locale === "fa" ? "ساخت پروفایل جدید" : "Create a new profile" }, { value: "replace", label: locale === "fa" ? `جایگزینی «${profile?.name ?? ""}»` : `Replace “${profile?.name ?? ""}”` }]}/></label>{importTarget === "new" && <label><FieldLabelInfo label={t.profileName} help={locale === "fa" ? "نام قابل‌شناسایی برای پروفایل واردشده، حداکثر ۸۰ نویسه." : "A recognizable name for the imported profile, up to 80 characters."}/><input required value={importName} onChange={(event) => setImportName(event.target.value)} placeholder={locale === "fa" ? "مثلاً آزمایش شبیه‌سازی" : "e.g. Shadow testing"}/></label>}<button className="button secondary"><ArrowDownToLine size={15}/>{locale === "fa" ? "واردسازی، اعتبارسنجی و پاک‌سازی" : "Import, verify, and scrub configuration"}</button></form>
        </Card>
        <Card><div className="card-heading"><div><h2>{t.encryption} · {t.rotateKey}</h2><small className="muted">{locale === "fa" ? "ابتدا کلید جایگزین را خارج از برنامه تنظیم کنید؛ سپس کلید قبلی را برای بازرمزگذاری وارد کنید." : "Run the service with the replacement key, then provide the previous key to re-encrypt stored credentials."}</small></div></div><form className="rekey-form" onSubmit={rotateKey}><label><FieldLabelInfo label={t.oldKey} help={locale === "fa" ? "کلید رمزنگاری فعلی که محرمانه‌ها با آن رمز شده‌اند. فقط هنگام چرخش وارد شود و در مرورگر ذخیره نمی‌شود." : "Current external encryption key used for stored credentials. Enter only during rotation; it is not saved by the browser."}/><input type="password" value={previousKey} onChange={(event) => setPreviousKey(event.target.value)} autoComplete="off" required/></label><label><FieldLabelInfo label={t.newKey} help={locale === "fa" ? "کلید جدید ۳۲ بایتی که سرویس با آن اجرا شده است؛ باید با کلید فعال فرایند یکسان باشد." : "New 32-byte key already configured for the service process; it must match the active key."}/><input type="password" value={replacementKey} onChange={(event) => setReplacementKey(event.target.value)} autoComplete="off" required/></label><button className="button secondary"><KeyRound size={15}/>{t.rotateKey}</button></form></Card>
      </div>
    </div>
  </>;
}

function SecretControl({ label, id, configured, value, cleared, onValue, onClear, locale }: { label: string; id: string; configured?: boolean; value: string; cleared?: boolean; onValue: (value: string) => void; onClear: (value: boolean) => void; locale: Locale }) {
  const titles: Record<string, { fa: string; en: string }> = {
    AI_API_KEY: { fa: "کلید مدل پیش‌فرض", en: "Default model API key" },
    "OPENAI API key": { fa: "کلید OpenAI", en: "OpenAI API key" },
    "ANTHROPIC API key": { fa: "کلید Anthropic", en: "Anthropic API key" },
    "GOOGLE API key": { fa: "کلید Google", en: "Google API key" },
    "COMPATIBLE API key": { fa: "کلید سرویس سازگار", en: "Compatible service API key" },
    "BOXAPI API key": { fa: "کلید BoxAPI", en: "BoxAPI API key" },
    "LIARA API key": { fa: "کلید Liara", en: "Liara API key" },
    WALLEX_API_KEY: { fa: "کلید API والکس", en: "Wallex API key" },
    WALLEX_SUB_ACCOUNT_CLIENT_ID: { fa: "شناسه کارخواه زیرحساب والکس", en: "Wallex sub-account client ID" },
  };
  const title = titles[label]?.[locale] ?? label;
  const help = label === "WALLEX_SUB_ACCOUNT_CLIENT_ID"
    ? (locale === "fa" ? "شناسه حساب فرعی فعال برای بسته اعتبار معاملاتی والکس؛ باید با کلید API همان حساب جفت شود. این مقدار محرمانه است و پس از ثبت نمایش داده نمی‌شود." : "Client ID for the active Wallex credit sub-account. It must be paired with that sub-account's API key and is never displayed after saving.")
    : label === "WALLEX_API_KEY"
      ? (locale === "fa" ? "کلید API حساب فرعی اعتبار معاملاتی والکس با دسترسی فقط خواندن و معامله. مجوز برداشت را فعال نکنید." : "API key for the Wallex credit sub-account, with read and trade permissions only. Do not enable withdrawals.")
      : label.includes("API key")
        ? (locale === "fa" ? `کلید ارائه‌دهنده ${label.replace(" API key", "")} برای نقش‌های مدل. مقدار فعلی قابل بازیابی یا نمایش نیست.` : `${label.replace(" API key", "")} provider credential for model requests. The stored value cannot be read back or displayed.`)
        : (locale === "fa" ? "کلید ارائه‌دهنده پیش‌فرض هوش مصنوعی. برای مسیر نقش‌محور می‌توان کلید جداگانه ارائه‌دهنده را نیز تعریف کرد." : "Default AI provider credential. Provider-specific keys can also be configured for role-based model routing.");
  return <div className="secret-field"><div className="secret-label"><FieldLabelInfo label={title} htmlFor={id} help={help}/><small className={configured ? "configured-text" : "muted"}>{configured ? (locale === "fa" ? "ذخیره‌شده" : "Stored") : (locale === "fa" ? "خالی" : "Not set")}</small></div><input id={id} type="password" value={value} onChange={(event) => { onClear(false); onValue(event.target.value); }} autoComplete="new-password" placeholder={configured ? (locale === "fa" ? "مقدار فعلی پنهان است" : "Stored value hidden") : (locale === "fa" ? "مقدار جدید" : "Enter new value")}/><label className="clear-secret"><input type="checkbox" checked={Boolean(cleared)} onChange={(event) => onClear(event.target.checked)}/>{locale === "fa" ? "پاک‌سازی مقدار ذخیره‌شده" : "Clear stored value"}</label></div>;
}

function StrategiesView({ t, locale, profileId, config, fields, strategies, section, onSectionChange, notify, onRefresh }: { t: Record<string, string>; locale: Locale; profileId: string; config: JsonMap; fields: Field[]; strategies: Strategy[]; section: "agents" | "strategies"; onSectionChange: (section: "agents" | "strategies") => void; notify: (message: string) => void; onRefresh: () => void }) {
  const [draft, setDraft] = useState<Strategy[]>(strategies);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(strategies);
  useEffect(() => setDraft(strategies), [profileId, strategies]);
  const updateStrategy = (id: string, change: Partial<Strategy>) => setDraft((current) => current.map((strategy) => strategy.id === id ? { ...strategy, ...change } : strategy));
  const updateLimit = (id: string, key: "maxOrderNotional" | "maxPositionNotional" | "maxGrossExposure", value: string) => setDraft((current) => current.map((strategy) => {
    if (strategy.id !== id) return strategy;
    const next = { ...strategy };
    if (value) next[key] = value;
    else delete next[key];
    return next;
  }));
  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try { await api("/api/strategies", { method: "PUT", body: JSON.stringify({ profileId, strategies: draft }) }); onRefresh(); notify(locale === "fa" ? "استراتژی‌ها ذخیره شدند." : "Strategies saved."); }
    catch (error) { notify(error instanceof Error ? error.message : (locale === "fa" ? "تنظیمات استراتژی معتبر نیست." : "Strategy settings are invalid.")); }
    finally { setSaving(false); }
  };
  const addStrategy = () => setDraft((current) => [...current, { id: `custom-${Math.random().toString(36).slice(2, 8)}`, name: locale === "fa" ? "استراتژی جدید" : "New strategy", mandate: "Describe the evidence, entry conditions, invalidation conditions, and when to prefer HOLD.", minConfidence: 0.65, allowedOrderTypes: ["LIMIT"] }]);
  const filtered = draft.filter((strategy) => `${strategy.id} ${strategy.name} ${strategy.mandate}`.toLowerCase().includes(filter.toLowerCase()));
  const description = section === "agents"
    ? (locale === "fa" ? "تیم تحلیل و تصمیم‌گیری موتور را ببینید و مسیر مدل، دستور تکمیلی و عامل‌های اختیاری را برای هر پروفایل تنظیم کنید." : "Inspect the engine’s analysis and decision workflow, then configure model routes, role guidance, and optional agents per profile.")
    : (locale === "fa" ? "استراتژی‌ها محدودیت پیشنهاد عامل‌ها را مشخص می‌کنند. عامل‌ها سفارش‌گذاری نمی‌کنند؛ مسیر ریسک و اجرا در اختیار موتور باقی می‌ماند." : "Strategies constrain agent proposals. Agents cannot submit orders; risk and execution remain controlled by the engine.");
  return <><PageHeading title={t.strategies} description={description} action={section === "strategies" ? <button className="button secondary" onClick={addStrategy}><Plus size={16}/>{locale === "fa" ? "استراتژی جدید" : "Add strategy"}</button> : undefined} />
    <SegmentedTabs id="agent-management" label={locale === "fa" ? "مدیریت عامل‌ها و استراتژی‌ها" : "Agent and strategy management"} value={section} locale={locale} onValueChange={(value) => onSectionChange(value as "agents" | "strategies")} options={[{ value: "agents", label: locale === "fa" ? "تیم عامل‌ها" : "Agent team" }, { value: "strategies", label: locale === "fa" ? "استراتژی‌ها" : "Strategies" }]} />
    <div id="agent-management-panel" role="tabpanel" aria-labelledby={`agent-management-tab-${section}`} tabIndex={0}>
    {section === "agents" ? <AgentWorkspace profileId={profileId} config={config} fields={fields} locale={locale} notify={notify} onRefresh={onRefresh} /> : <>
    <div className="strategy-toolbar"><div className="field-search"><Search size={15}/><input aria-label={t.search} placeholder={t.search} value={filter} onChange={(event) => setFilter(event.target.value)}/></div><span className="count-pill">{draft.length} {t.strategies}</span><small className={`strategy-save-state ${dirty ? "dirty" : ""}`} role="status">{dirty ? (locale === "fa" ? "تغییرات ذخیره‌نشده" : "Unsaved changes") : (locale === "fa" ? "همگام با پروفایل" : "In sync with profile")}</small><button className="button primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/>}{saving ? (locale === "fa" ? "در حال ذخیره…" : "Saving…") : t.save}</button></div>
    <div className="strategy-grid">{filtered.map((strategy, index) => <details className="strategy-card card" key={`${profileId}:${strategy.id}`} open={strategy.id === "agentic-balanced"}><summary className="strategy-summary"><span className="strategy-index">{String(index + 1).padStart(2, "0")}</span><span className="strategy-summary-copy"><b>{strategyTitle(strategy, locale)}</b><small><code>{strategy.id}</code> · {locale === "fa" ? "حداقل اطمینان" : "Min confidence"} {new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 0 }).format(strategy.minConfidence * 100)}%</small></span><span className="strategy-summary-orders">{strategy.allowedOrderTypes.map((type) => orderValueTitle(type, locale)).join(" · ") || (locale === "fa" ? "بدون نوع سفارش" : "No order types")}</span><ChevronDown size={16} className="strategy-chevron"/></summary><div className="strategy-editor"><div className="strategy-head"><span className="tag">{locale === "fa" ? "تنظیمات استراتژی" : "Strategy settings"}</span><button type="button" className="icon-button tiny" disabled={["agentic-balanced", "momentum", "mean-reversion", "capital-preservation"].includes(strategy.id)} title={t.delete} aria-label={`${t.delete}: ${strategy.name}`} onClick={() => setDraft((current) => current.filter((item) => item.id !== strategy.id))}><Trash2 size={14}/></button></div>
      <label className="setting-field"><FieldLabelInfo label={locale === "fa" ? "نام" : "Name"} help={locale === "fa" ? "نام نمایشی برای تشخیص استراتژی در فرم اجرا و گزارش ممیزی." : "Display name used in run forms and audit reports."}/><input value={strategy.name} onChange={(event) => updateStrategy(strategy.id, { name: event.target.value })}/></label>
      <label className="setting-field"><FieldLabelInfo label={locale === "fa" ? "شناسه یکتا" : "Strategy ID"} help={locale === "fa" ? "شناسه پایدار کوچک‌حروف با خط تیره؛ در گزارش‌ها و درخواست اجرا به این مقدار ارجاع می‌شود. شناسه استراتژی‌های داخلی ثابت است." : "Stable lowercase ID with hyphens, referenced in runs and reports. Built-in strategy IDs are fixed."}/><input value={strategy.id} disabled={strategy.id.startsWith("agentic-") || ["momentum", "mean-reversion", "capital-preservation"].includes(strategy.id)} onChange={(event) => updateStrategy(strategy.id, { id: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}/></label>
      <label className="setting-field"><FieldLabelInfo label={locale === "fa" ? "دستور / مأموریت" : "Mandate"} help={locale === "fa" ? "دستور تخصصی استراتژی برای عامل معامله‌گر: شرایط ورود، شواهد تأیید، ابطال تحلیل، احتیاط‌ها و زمان ترجیح HOLD را روشن بنویسید. حداقل ۲۰ و حداکثر ۲۰۰۰ نویسه." : "Trader-agent policy: describe entry evidence, confirmation, invalidation, cautions, and when HOLD is preferred. Length must be 20–2,000 characters."}/><textarea rows={4} value={strategy.mandate} onChange={(event) => updateStrategy(strategy.id, { mandate: event.target.value })}/></label>
      <div className="strategy-bottom"><label className="setting-field"><span><FieldLabelInfo label={locale === "fa" ? "حداقل اطمینان" : "Minimum confidence"} help={locale === "fa" ? "حداقل confidence از صفر تا یک برای حفظ سفارش پیشنهادی؛ اگر پایین‌تر باشد، strategy gate پیشنهاد را به HOLD تبدیل می‌کند." : "Minimum confidence from 0 to 1 for retaining a proposed order. Below this threshold, the strategy gate converts it to HOLD."}/><b>{Math.round(strategy.minConfidence * 100)}%</b></span><input type="range" min="0" max="1" step="0.01" value={strategy.minConfidence} onChange={(event) => updateStrategy(strategy.id, { minConfidence: Number(event.target.value) })}/></label>
        <fieldset className="order-types"><legend><FieldLabelInfo label={locale === "fa" ? "نوع سفارش مجاز" : "Allowed order types"} help={locale === "fa" ? "انواع سفارشی که این استراتژی می‌تواند پیشنهاد کند. اجرای سفارش همچنان از دروازه بازار و ریسک موتور عبور می‌کند." : "Order types this strategy may propose. Every proposal still passes engine market and risk gates."}/></legend>{(["MARKET", "LIMIT"] as const).map((type) => <label key={type}><input type="checkbox" checked={strategy.allowedOrderTypes.includes(type)} onChange={(event) => updateStrategy(strategy.id, { allowedOrderTypes: event.target.checked ? [...strategy.allowedOrderTypes, type] : strategy.allowedOrderTypes.filter((item) => item !== type) })}/>{type}</label>)}</fieldset></div>
      <div className="strategy-limits"><label><FieldLabelInfo label={locale === "fa" ? "سقف ارزش سفارش" : "Max order notional"} help={locale === "fa" ? "حداکثر ارزش یک سفارش این استراتژی به ارز بازار پایه. خالی یعنی سقف کل ریسک پروفایل اعمال شود." : "Per-order notional cap in quote currency for this strategy. Blank uses the profile risk cap."}/><input inputMode="decimal" value={strategy.maxOrderNotional ?? ""} placeholder={locale === "fa" ? "بدون محدودیت جداگانه" : "Use profile limit"} onChange={(event) => updateLimit(strategy.id, "maxOrderNotional", event.target.value)}/></label><label><FieldLabelInfo label={locale === "fa" ? "سقف موقعیت" : "Max position"} help={locale === "fa" ? "حداکثر اندازه موقعیت این استراتژی در یک جفت‌ارز، به ارز بازار پایه. خالی یعنی سقف پروفایل." : "Maximum position notional in one market. Blank uses the profile cap."}/><input inputMode="decimal" value={strategy.maxPositionNotional ?? ""} placeholder={locale === "fa" ? "از تنظیمات پروفایل" : "Use profile limit"} onChange={(event) => updateLimit(strategy.id, "maxPositionNotional", event.target.value)}/></label><label><FieldLabelInfo label={locale === "fa" ? "سقف مواجهه کل" : "Max gross exposure"} help={locale === "fa" ? "سقف مجموع موقعیت‌های این استراتژی در ارز بازار پایه؛ باید مثبت باشد و نمی‌تواند محدودیت کلی ریسک را افزایش دهد." : "Total exposure cap for this strategy in quote currency. Must be positive and can only tighten the global risk limit."}/><input inputMode="decimal" value={strategy.maxGrossExposure ?? ""} placeholder={locale === "fa" ? "از تنظیمات پروفایل" : "Use profile limit"} onChange={(event) => updateLimit(strategy.id, "maxGrossExposure", event.target.value)}/></label></div>
    </div></details>)}</div>
    {filtered.length === 0 && <Empty text={locale === "fa" ? "استراتژی‌ای با این جست‌وجو پیدا نشد." : "No strategy matches this search."}/>}
    </>}
    </div>
  </>;
}

function MarketsView({ t, locale, profileId, configured, notify, onRefresh }: { t: Record<string, string>; locale: Locale; profileId: string; configured: string[]; notify: (message: string) => void; onRefresh: () => void }) {
  const [all, setAll] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>(configured);
  const marketsQuery = useQuery({ queryKey: ["markets", profileId, all], queryFn: () => api<{ markets: Array<{ symbol: string; baseAsset: string; quoteAsset: string; spotEnabled: boolean; baseAssetIconUrl?: string; quoteAssetIconUrl?: string; pricePrecision?: number; quantityPrecision?: number }>; configuredAllowlist: string[] }>(`/api/markets?all=${all}`), retry: false });
  useEffect(() => setSelected(configured), [profileId, configured.join(",")]);
  const markets = marketsQuery.data?.markets ?? [];
  const filtered = markets.filter((market) => market.symbol.toLowerCase().includes(search.toLowerCase()) || market.baseAsset.toLowerCase().includes(search.toLowerCase()));
  const toggle = (symbol: string) => setSelected((current) => current.includes(symbol) ? current.filter((item) => item !== symbol) : [...current, symbol].sort());
  const save = async () => {
    try { await api("/api/settings", { method: "PUT", body: JSON.stringify({ profileId, settings: { WALLEX_ALLOWED_MARKETS: selected.join(",") } }) }); onRefresh(); notify(locale === "fa" ? `فهرست ${selected.length} جفت‌ارز ذخیره شد.` : `Saved ${selected.length} allowlisted pairs.`); }
    catch (error) { notify(error instanceof Error ? error.message : "Allowlist could not be saved."); }
  };
  return <><PageHeading title={t.marketsTitle} description={locale === "fa" ? "جفت‌های مجاز در تمام حالت‌ها کنترل نهایی انتخاب بازار هستند. محدودیت‌های بسته اعتبار والکس را پیش از فعال‌سازی بررسی کنید." : "The configured allowlist gates markets in every mode. Check your Wallex credit package restrictions before enabling a pair."} action={<button className="button secondary" onClick={() => void marketsQuery.refetch()} disabled={marketsQuery.isFetching}><RefreshCw size={15} className={marketsQuery.isFetching ? "spin" : ""}/>{t.refresh}</button>} />
    <Card><div className="market-toolbar"><div className="field-search"><Search size={15}/><input aria-label={t.search} placeholder={t.search} value={search} onChange={(event) => setSearch(event.target.value)}/></div><label className="checkbox-row"><input type="checkbox" checked={all} onChange={(event) => setAll(event.target.checked)}/>{t.allMarkets}</label><span className="count-pill">{selected.length} {t.allowlist}</span><button className="button primary" onClick={() => void save()}><Check size={15}/>{t.apply}</button></div>
      <div className="table-wrap market-table-wrap"><table><thead><tr><th>{locale === "fa" ? "مجاز" : "Allow"}</th><th>{t.symbol}</th><th>{locale === "fa" ? "ارز پایه" : "Base asset"}</th><th>{locale === "fa" ? "بازار پایه" : "Quote asset"}</th><th>{locale === "fa" ? "وضعیت" : "Status"}</th><th><FieldLabelInfo label={locale === "fa" ? "دقت قیمت / مقدار" : "Price / quantity precision"} help={locale === "fa" ? "تعداد رقم اعشار مجاز برای قیمت و مقدار سفارش در این بازار والکس. سفارش‌هایی که از این دقت بیشتر داشته باشند پذیرفته نمی‌شوند." : "Maximum decimal places allowed for order prices and quantities on this Wallex market. Orders with more precision are rejected."}/></th></tr></thead><tbody>{filtered.map((market) => <tr key={market.symbol}><td><input type="checkbox" aria-label={`${market.symbol} allowlist`} checked={selected.includes(market.symbol)} onChange={() => toggle(market.symbol)}/></td><td><b>{market.symbol}</b></td><td>{market.baseAsset}</td><td>{market.quoteAsset}</td><td><span className={market.spotEnabled ? "status status-completed" : "status status-failed"}>{market.spotEnabled ? (locale === "fa" ? "فعال" : "Active") : (locale === "fa" ? "غیرفعال" : "Inactive")}</span></td><td>{market.pricePrecision ?? "—"} / {market.quantityPrecision ?? "—"}</td></tr>)}</tbody></table></div>
      {marketsQuery.isError && <div className="notice warning"><AlertTriangle size={16}/><p>{marketsQuery.error.message}</p></div>}
      {marketsQuery.isPending && <div className="loading-line"><LoaderCircle className="spin" size={18}/>{locale === "fa" ? "در حال دریافت بازارهای والکس…" : "Fetching Wallex markets…"}</div>}
      {!marketsQuery.isPending && !marketsQuery.isError && filtered.length === 0 && <Empty text={t.noData}/>}
    </Card>
    <p className="form-caption"><Shield size={14}/>{locale === "fa" ? "بازار فقط هنگام شروع هر اجرا از این فهرست انتخاب می‌شود؛ هیچ گزینه‌ای باعث معامله نمی‌شود." : "Selecting a market only makes it available to a run; it does not place an order."}</p>
  </>;
}

function RunLabView({ t, locale, profileId, profiles, config, strategies, runs, managedRuns, assetIcons, notify, onRefresh }: { t: Record<string, string>; locale: Locale; profileId: string; profiles: Profile[]; config: JsonMap; strategies: Strategy[]; runs: Run[]; managedRuns: ManagedRun[]; assetIcons: Record<string, string>; notify: (message: string) => void; onRefresh: () => void }) {
  const [mode, setMode] = useState<"backtest" | "shadow" | "live">("shadow");
  const [symbols, setSymbols] = useState<string>((config.wallex?.allowedMarkets ?? [])[0] ?? "BTCTMN");
  const [strategyIds, setStrategyIds] = useState<string[]>([strategies[0]?.id ?? "agentic-balanced"]);
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [watch, setWatch] = useState(false);
  const [autoTrade, setAutoTrade] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState("60");
  const [startingCash, setStartingCash] = useState("");
  const [feeBps, setFeeBps] = useState("");
  const [slippageBps, setSlippageBps] = useState("");
  const [riskCap, setRiskCap] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [understandsRisk, setUnderstandsRisk] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const queryClient = useQueryClient();
  const selectedProfile = profiles.find((item) => item.id === profileId);
  const startMutation = useMutation({
    mutationFn: (body: JsonMap) => api<{ run: ManagedRun }>("/api/runs", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: ({ run }) => { setShowConfirmation(false); setConfirmationText(""); setUnderstandsRisk(false); void queryClient.invalidateQueries({ queryKey: ["runs"] }); onRefresh(); notify(locale === "fa" ? `اجرای ${run.id.slice(0, 8)} آغاز شد.` : `Run ${run.id.slice(0, 8)} started.`); },
    onError: (error) => notify(error.message),
  });
  const stopRun = async (runId: string) => {
    try { await api(`/api/managed-runs/${encodeURIComponent(runId)}/stop`, { method: "POST", body: JSON.stringify({}) }); void queryClient.invalidateQueries({ queryKey: ["runs"] }); notify(t.stopPending); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not stop this run."); }
  };
  const resumeRun = async (run: Run) => {
    try { await api(`/api/runs/${encodeURIComponent(run.id)}/resume`, { method: "POST", body: JSON.stringify({ profileId }) }); onRefresh(); notify(locale === "fa" ? "بازیابی بک‌تست آغاز شد." : "Backtest recovery started."); }
    catch (error) { notify(error instanceof Error ? error.message : "Recovery could not start."); }
  };
  const overrideValues = () => ({
    ...(startingCash ? { PAPER_INITIAL_CASH: startingCash } : {}),
    ...(feeBps ? { BACKTEST_FEE_BPS: feeBps } : {}),
    ...(slippageBps ? { BACKTEST_SLIPPAGE_BPS: slippageBps } : {}),
    ...(riskCap ? { RISK_MAX_GROSS_EXPOSURE: riskCap, RISK_MAX_ORDER_NOTIONAL: riskCap, LIVE_MAX_GROSS_EXPOSURE: riskCap } : {}),
  });
  const makeRequest = (confirmed: boolean) => {
    const pairs = symbols.split(",").map((pair) => pair.trim().toUpperCase()).filter(Boolean);
    const overrides = overrideValues();
    if (mode === "backtest") return { mode, profileId, symbols: pairs, strategyIds, from: Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000), to: Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000), overrides };
    if (mode === "shadow") return { mode, profileId, symbols: pairs, strategyIds, watch, intervalSeconds: Number(intervalSeconds), overrides };
    return { mode, profileId, symbol: pairs[0] ?? "", strategyId: strategyIds[0] ?? "", autoTrade, intervalSeconds: Number(intervalSeconds), confirmed: confirmed as true, overrides: riskCap ? { RISK_MAX_GROSS_EXPOSURE: riskCap, RISK_MAX_ORDER_NOTIONAL: riskCap, LIVE_MAX_GROSS_EXPOSURE: riskCap } : {} };
  };
  const riskLimit = config.wallex?.liveMaxGrossExposure ?? config.risk?.maxGrossExposure ?? "0";
  const activeRuns = managedRuns.filter((run) => ["starting", "running", "waiting", "stopping"].includes(run.state));
  const changeMode = (next: "backtest" | "shadow" | "live") => {
    setMode(next); setShowConfirmation(false);
    if (next === "live") setStrategyIds((current) => [current[0] ?? strategies[0]?.id].filter((id): id is string => Boolean(id)));
  };
  const toggleStrategy = (id: string) => setStrategyIds((current) => mode === "live" ? [id] : current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const selectedPairs = symbols.split(",").map((pair) => pair.trim()).filter(Boolean);
  const validLivePair = selectedPairs.length === 1;
  const startForm = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "live" && !validLivePair) { notify(locale === "fa" ? "برای معامله واقعی دقیقاً یک جفت‌ارز وارد کنید." : "Enter exactly one market for live trading."); return; }
    if (mode === "live") { setShowConfirmation(true); return; }
    startMutation.mutate(makeRequest(false));
  };

  return <><PageHeading title={t.runTitle} description={locale === "fa" ? "حالت اجرا، جفت‌ها، استراتژی‌ها و محدودیت‌ها را انتخاب کنید. بک‌تست و شبیه‌سازی سرمایه واقعی مصرف نمی‌کنند." : "Choose the execution mode, markets, strategies, and limits. Backtest and shadow modes never use real funds."} />
    <div className="run-layout"><Card className="run-form-card"><div className="mode-tabs" role="tablist" aria-label={locale === "fa" ? "حالت اجرا" : "Run mode"}>{(["backtest", "shadow", "live"] as const).map((item, index, items) => <div className="mode-tab-item" role="presentation" key={item}><button id={`run-mode-${item}`} type="button" role="tab" aria-label={t[item]} aria-controls="run-mode-panel" aria-selected={mode === item} tabIndex={mode === item ? 0 : -1} className={`mode-tab ${mode === item ? "active" : ""} ${item}`} onKeyDown={(event) => {
      const direction = locale === "fa" ? -1 : 1;
      const nextIndex = event.key === "ArrowRight" ? (index + direction + items.length) % items.length : event.key === "ArrowLeft" ? (index - direction + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
      if (nextIndex >= 0) { event.preventDefault(); const next = items[nextIndex]!; changeMode(next); document.getElementById(`run-mode-${next}`)?.focus(); }
    }} onClick={() => changeMode(item)}><span aria-hidden="true">{item === "backtest" ? <BarChart3 size={16}/> : item === "shadow" ? <CirclePlay size={16}/> : <WalletCards size={16}/>}</span>{t[item]}{item === "live" && <small>REAL</small>}</button><InfoTooltip className="mode-help" label={t[item]} help={modeHelp(item, locale)}/></div>)}</div>
      <div id="run-mode-panel" role="tabpanel" aria-labelledby={`run-mode-${mode}`} tabIndex={0}>
      <div className={`mode-intro ${mode}`}><span>{mode === "live" ? <AlertTriangle size={17}/> : mode === "shadow" ? <Shield size={17}/> : <BarChart3 size={17}/>}</span><p>{t[`${mode}Hint`]}</p></div>
      <form onSubmit={startForm} className="run-form">
        <div className="field-row"><div className="field-label"><FieldLabelInfo label={t.profile} help={locale === "fa" ? "پروفایل فعال، مدل‌ها، جفت‌های مجاز، محدودیت‌ها و تنظیمات عامل‌ها را برای اجرای جدید تعیین می‌کند." : "The active profile supplies model routes, market allowlist, risk limits, and agent settings for this run."}/><div className="profile-readonly"><span className="profile-initial">{(selectedProfile?.name ?? profileId).slice(0, 1).toUpperCase()}</span><b>{selectedProfile?.name ?? profileId}</b><small>{locale === "fa" ? "برای تغییر، پروفایل فعال را از نوار بالا انتخاب کنید." : "Change the active profile from the top bar."}</small></div></div>
          <label className="field-label"><FieldLabelInfo label={t.interval} help={locale === "fa" ? "فاصله میان چرخه‌های ارزیابی زنده برحسب ثانیه؛ باید ۱۰ تا ۸۶۴۰۰ باشد. برای shadow یک دقیقه برابر ۶۰ ثانیه است." : "Delay between live evaluation cycles, in seconds; valid range is 10–86,400. For a one-minute shadow cadence use 60."}/><input type="number" min="10" max="86400" step="1" value={intervalSeconds} onChange={(event) => setIntervalSeconds(event.target.value)} disabled={mode === "backtest"}/></label></div>
        <label className="field-label"><FieldLabelInfo label={mode === "live" ? t.symbol : t.symbols} help={mode === "live" ? (locale === "fa" ? "در هر اجرای واقعی فقط یک بازار والکس مجاز است. نماد باید در فهرست مجاز پروفایل و بازارهای بسته اعتباری باشد." : "A live run accepts exactly one Wallex market. It must be in the profile allowlist and the active credit package.") : (locale === "fa" ? "یک یا چند نماد مجاز والکس را با کاما جدا کنید. هر استراتژی برای هر نماد انتخاب‌شده ارزیابی می‌شود." : "Enter one or more allowlisted Wallex symbols, comma-separated. Each selected strategy is evaluated for every market.")}/><input required value={symbols} onChange={(event) => setSymbols(event.target.value.toUpperCase())} placeholder="BTCTMN, ETHTMN"/><small>{locale === "fa" ? `فهرست مجاز فعلی: ${(config.wallex?.allowedMarkets ?? []).join(", ") || "تنظیم نشده"}${mode === "live" && !validLivePair ? " · برای LIVE فقط یک نماد" : ""}` : `Current allowlist: ${(config.wallex?.allowedMarkets ?? []).join(", ") || "not configured"}${mode === "live" && !validLivePair ? " · one symbol required for live" : ""}`}</small></label>
        <fieldset className="strategy-selector"><legend><FieldLabelInfo label={t.strategies} help={locale === "fa" ? "استراتژی‌ها سیاست و حداقل اطمینان هر پیشنهاد را مشخص می‌کنند؛ همه پیشنهادها از دروازه قطعی ریسک عبور می‌کنند. بک‌تست و shadow چند استراتژی می‌پذیرند؛ live یک استراتژی در هر اجرا دارد." : "Strategies set proposal policy and minimum confidence; every proposal still passes deterministic risk gates. Backtest and shadow allow multiple strategies; live uses one strategy per run."}/></legend><div className="strategy-chips">{strategies.map((strategy) => <div className="strategy-option" key={strategy.id}><label className={`strategy-chip ${strategyIds.includes(strategy.id) ? "selected" : ""}`}><input type={mode === "live" ? "radio" : "checkbox"} name={mode === "live" ? "live-strategy" : undefined} checked={strategyIds.includes(strategy.id)} onChange={() => toggleStrategy(strategy.id)}/><span><b>{strategyTitle(strategy, locale)}</b><small>{strategy.id}</small></span></label><InfoTooltip label={strategyTitle(strategy, locale)} help={strategyHelp(strategy, locale)}/></div>)}</div></fieldset>
        {mode === "backtest" && <div className="field-row"><label className="field-label"><FieldLabelInfo label={t.from} help={locale === "fa" ? "روز شروع بازپخش تاریخی بر مبنای UTC. داده کندلی باید در بازه والکس در دسترس باشد." : "UTC start date for historical replay; candles must be available from Wallex for this period."}/><input required type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label><label className="field-label"><FieldLabelInfo label={t.to} help={locale === "fa" ? "روز پایان بازپخش تاریخی بر مبنای UTC؛ باید هم‌زمان یا بعد از تاریخ شروع باشد." : "UTC end date for historical replay; it must be on or after the start date."}/><input required type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label></div>}
        {mode !== "backtest" && <div className="toggle-stack">{mode === "shadow" ? <label className="toggle-row"><span><FieldLabelInfo label={t.watch} help={locale === "fa" ? "چرخه shadow را پس از ارزیابی اول زنده نگه می‌دارد و در بازه انتخاب‌شده، پرتفوی مجازی را با داده‌های جدید به‌روزرسانی می‌کند." : "Keep the shadow run active after its first evaluation and update its virtual portfolio at the configured interval."}/><small>{locale === "fa" ? "پس از هر چرخه، پرتفوی مجازی به‌روزرسانی می‌شود." : "Keep the virtual portfolio running between cycles."}</small></span><input type="checkbox" checked={watch} onChange={(event) => setWatch(event.target.checked)}/></label> : <label className="toggle-row live-toggle"><span><FieldLabelInfo label={t.auto} help={locale === "fa" ? "پس از پایان هر چرخه، اجرای زنده را با همان بازار و استراتژی تکرار می‌کند. برای اجرای پیوسته، اجازه معامله خودکار و تأیید صریح شروع زنده لازم هستند." : "Repeats live evaluations using this market and strategy. Automated runs require this option and explicit confirmation before starting live."}/><small>{locale === "fa" ? "برای اجرای پیوسته، اجازه معامله خودکار را در تنظیمات پروفایل فعال کنید." : "Enable automated trading in profile settings before starting."}</small></span><input type="checkbox" checked={autoTrade} onChange={(event) => setAutoTrade(event.target.checked)}/></label>}</div>}
        <details className="advanced-run"><summary><SlidersHorizontal size={15}/>{locale === "fa" ? "محدودیت‌ها و فرض‌های پیشرفته برای این اجرا" : "Advanced limits and assumptions for this run"}<InfoTooltip label={locale === "fa" ? "محدودیت‌ها و فرض‌ها" : "Run limits and assumptions"} help={locale === "fa" ? "این تنظیم‌ها فقط برای همین اجرا هستند. مقدارهای سرمایه، کارمزد و لغزش صرفاً برای پرتفوی مجازی‌اند؛ سقف مواجهه مجازی یا زنده، محدودیت‌های ریسک پروفایل را برای این اجرا سخت‌تر می‌کند." : "These values apply only to this run. Cash, fee, and slippage inputs affect the virtual portfolio; exposure overrides tighten the profile's risk limits for this run."}/></summary><div className="advanced-grid">{mode !== "live" && <><label><FieldLabelInfo label={locale === "fa" ? "سرمایه مجازی اولیه" : "Virtual starting cash"} help={locale === "fa" ? "مانده مجازی ابتدای این پرتفوی جدید در ارز بازار پایه؛ عدد مثبت و بدون اثر روی موجودی واقعی." : "Initial quote-currency balance for this new virtual portfolio. Must be positive and never affects actual funds."}/><input inputMode="decimal" placeholder={String(config.paperInitialCash ?? "profile default")} value={startingCash} onChange={(event) => setStartingCash(event.target.value)}/></label><label><FieldLabelInfo label={locale === "fa" ? "کارمزد (bps)" : "Fees (bps)"} help={locale === "fa" ? "کارمزد فرضی هر سمت اجرا برحسب basis point؛ ۱۰۰ bps برابر ۱٪ است." : "Assumed fee per fill side in basis points; 100 bps equals 1%."}/><input inputMode="decimal" placeholder={String(config.backtestAssumptions?.feeBps ?? "profile default")} value={feeBps} onChange={(event) => setFeeBps(event.target.value)}/></label><label><FieldLabelInfo label={locale === "fa" ? "لغزش قیمت (bps)" : "Slippage (bps)"} help={locale === "fa" ? "لغزش فرضی هر اجرا برحسب basis point؛ دفتر سفارش تاریخی را بازسازی نمی‌کند." : "Assumed execution slippage in basis points; it does not reconstruct historical order books."}/><input inputMode="decimal" placeholder={String(config.backtestAssumptions?.slippageBps ?? "profile default")} value={slippageBps} onChange={(event) => setSlippageBps(event.target.value)}/></label></>}
          <label><FieldLabelInfo label={mode === "live" ? (locale === "fa" ? "سقف ریسک سخت‌تر این اجرا" : "Tighter per-run risk cap") : (locale === "fa" ? "سقف مواجهه اختیاری" : "Optional gross exposure cap")} help={locale === "fa" ? "حد اسمی مواجهه برای همین اجرا برحسب ارز بازار پایه. مقدار live فقط می‌تواند سقف پروفایل را کاهش دهد؛ هیچ سقفی تضمین نمی‌کند که زیان از آن بیشتر نشود." : "Per-run notional exposure cap in quote currency. Live overrides may only reduce the profile cap; no cap guarantees losses cannot exceed it."}/><input inputMode="decimal" placeholder={String(riskLimit)} value={riskCap} onChange={(event) => setRiskCap(event.target.value)}/><small>{mode === "live" ? (locale === "fa" ? "سقف زنده فقط می‌تواند کمتر یا مساوی مقدار پروفایل باشد." : "Live limits can only be tightened relative to the profile.") : (locale === "fa" ? "این مقدار جایگزین محدودیت‌های متناظر در این اجرا می‌شود." : "Overrides the corresponding profile limit for this run.")}</small></label></div></details>
        {mode === "live" && <div className="notice danger"><span className="notice-icon"><AlertTriangle size={18}/></span><div><b>{locale === "fa" ? "حالت واقعی — امکان ارسال سفارش واقعی" : "Live mode — real orders may be submitted"}</b><p>{locale === "fa" ? "ارسال سفارش فقط برای پیشنهاد تأییدشده در دروازه ریسک، پس از بررسی حساب، امکان‌پذیر است." : "An order is only possible after a proposal passes engine risk gates and account reconciliation."}</p></div></div>}
        <div className="run-submit-row"><span className="muted small-text">{mode === "live" ? `${t.exposure}: ${money(riskLimit, config.wallex?.quoteCurrency ?? "TMN", locale)}` : `${t.virtual}: ${money(config.paperInitialCash, config.wallex?.quoteCurrency ?? "TMN", locale)}`}</span><button className={`button ${mode === "live" ? "danger-button" : "primary"}`} disabled={startMutation.isPending || strategyIds.length === 0 || (mode === "live" && !validLivePair)}><CirclePlay size={16}/>{startMutation.isPending ? (locale === "fa" ? "در حال شروع…" : "Starting…") : t.start}</button></div>
      </form>
      </div>
    </Card>
    <div className="run-side"><Card><div className="card-heading"><div><h2>{locale === "fa" ? "اجراهای مدیریت‌شده" : "Managed runs"}</h2></div><span className="count-pill">{activeRuns.length}</span></div>{activeRuns.length === 0 ? <Empty text={locale === "fa" ? "اجرای فعالی وجود ندارد." : "No active managed runs."}/> : <div className="managed-run-list">{activeRuns.map((run) => <div className="managed-run" key={run.id}><div className="run-badges"><span className={`mode-badge ${run.mode}`}>{modeTitle(run.mode, locale)}</span><span className={statusClass(run.state)}>{statusTitle(run.state, locale)}</span></div><div className="run-market"><CurrencyPairAvatar symbol={run.symbols[0] ?? "?"} quoteCurrency={config.wallex?.quoteCurrency} assetIcons={assetIcons}/><div><strong>{run.symbols.join(", ")}</strong><small>{run.strategyIds.join(", ")}</small></div></div><p>{run.message}</p><button className="button danger-outline full" disabled={run.state === "stopping"} onClick={() => void stopRun(run.id)}><CircleStop size={15}/>{run.state === "stopping" ? t.stopPending : t.stop}</button></div>)}</div>}</Card>
      <Card><div className="card-heading"><div><h2>{locale === "fa" ? "اجراهای اخیر" : "Recent runs"}</h2></div></div>{runs.slice(0, 8).length === 0 ? <Empty text={t.noRuns}/> : <div className="managed-run-list">{runs.slice(0, 8).map((run) => { const runConfig = object(run.config); const symbolsForRun = runSymbols(runConfig); const symbol = symbolsForRun[0] ?? run.id.slice(0, 8); const strategyLabels = runStrategies(runConfig); return <div className="recent-job" key={run.id}><CurrencyPairAvatar symbol={symbol} quoteCurrency={config.wallex?.quoteCurrency} assetIcons={assetIcons}/><div className="recent-job-content"><div className="run-badges"><span className={`mode-badge ${run.mode}`}>{modeTitle(run.mode, locale)}</span><span className={statusClass(run.status)}>{statusTitle(run.status, locale)}</span></div><b dir="ltr">{symbolsForRun.join(", ") || run.id.slice(0, 8)}</b><small>{dateLabel(run.startedAt, locale)}{strategyLabels.length ? ` · ${strategyLabels.join(", ")}` : ""}</small>{run.mode === "backtest" && run.status === "failed" && <button className="button secondary small-button" onClick={() => void resumeRun(run)}><RefreshCw size={13}/>{locale === "fa" ? "بازیابی از نقطه توقف" : "Resume checkpoint"}</button>}</div></div>; })}</div>}</Card>
      <Card><div className="card-heading"><div><h2>{locale === "fa" ? "رفتار هر حالت" : "Mode behavior"}</h2></div></div><div className="mode-explain"><p><b>{modeTitle("backtest", locale)}</b><span>{locale === "fa" ? "بازپخش تاریخی با کارمزد و لغزش مشخص؛ پرتفوی مجازی." : "Historical replay with explicit fees and slippage; virtual portfolio."}</span></p><p><b>{modeTitle("shadow", locale)}</b><span>{locale === "fa" ? "داده زنده، سفارش فرضی، ثبت پرتفوی مجازی و هیچ دسترسی نوشتن والکس." : "Live data, hypothetical execution, virtual portfolio, no Wallex write capability."}</span></p><p><b>{modeTitle("live", locale)}</b><span>{locale === "fa" ? "چرخه یک‌باره یا خودکار؛ سفارش واقعی با مجوز و تأیید جداگانه." : "One live cycle or autonomous loop; real orders require separate enablement and confirmation."}</span></p></div></Card></div></div>
    {showConfirmation && <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="live-confirm-title"><button className="icon-button modal-close" onClick={() => setShowConfirmation(false)} aria-label={t.cancel}><X size={17}/></button><span className="warning-mark"><AlertTriangle size={20}/></span><h2 id="live-confirm-title">{t.liveConfirmTitle}</h2><p className="muted">{t.liveConfirmBody}</p><dl className="confirm-details"><div><dt>{t.profileLabel}</dt><dd>{selectedProfile?.name}</dd></div><div><dt>{t.pairLabel}</dt><dd>{symbols}</dd></div><div><dt>{t.strategies}</dt><dd>{strategyIds.join(", ")}</dd></div><div><dt>{t.exposure}</dt><dd>{money(riskCap || riskLimit, config.wallex?.quoteCurrency ?? "TMN", locale)}</dd></div><div><dt>{locale === "fa" ? "حالت" : "Mode"}</dt><dd>{autoTrade ? `${t.live} · ${t.auto}` : `${t.live} · ${locale === "fa" ? "یک چرخه" : "one cycle"}`}</dd></div></dl><label className="checkbox-row confirm-check"><input type="checkbox" checked={understandsRisk} onChange={(event) => setUnderstandsRisk(event.target.checked)}/>{t.acknowledge}</label><label className="field-label confirm-word">{t.typeTrade}<input autoFocus value={confirmationText} onChange={(event) => setConfirmationText(event.target.value.toUpperCase())} autoComplete="off"/></label><div className="modal-actions"><button className="button secondary" onClick={() => setShowConfirmation(false)}>{t.cancel}</button><button className="button danger-button" disabled={!understandsRisk || confirmationText !== "LIVE" || startMutation.isPending} onClick={() => startMutation.mutate(makeRequest(true))}><WalletCards size={15}/>{t.confirmLive}</button></div></section></div>}
  </>;
}

function ReportsView({ t, locale, runs, notify }: { t: Record<string, string>; locale: Locale; runs: Run[]; notify: (message: string) => void }) {
  const [selectedRunId, setSelectedRunId] = useState("");
  const runId = selectedRunId || runs.find((run) => run.report)?.id || "";
  const query = useQuery({ queryKey: ["reports", runId], queryFn: () => api<{ runs: Audit[]; reports: JsonMap[]; comparison: JsonMap[] }>(`/api/reports?limit=30${runId ? `&runId=${encodeURIComponent(runId)}` : ""}`), enabled: runs.length > 0 });
  const benchmarkQuery = useQuery({ queryKey: ["benchmarks"], queryFn: () => api<{ comparison: JsonMap[]; sampledRuns: number; limit: number }>("/api/benchmarks?limit=1000"), enabled: runs.length > 0 });
  const [expandedDecision, setExpandedDecision] = useState("");
  const report = query.data?.runs[0] ?? { run: {}, decisions: [], riskOutcomes: [], orders: [], decisionMemories: [], portfolioHistory: [], sourceSnapshots: [], aiModelCalls: [] };
  if (query.data && query.data.runs.length === 0) return <><PageHeading title={t.reportsTitle}/><Card><Empty text={locale === "fa" ? "ممیزی این اجرا در دسترس نیست." : "The selected run audit is unavailable."}/></Card></>;
  const run = report?.run;
  const metrics = object(run?.report);
  const decisions = report?.decisions ?? [];
  const modelCalls = report?.aiModelCalls ?? [];
  const orders = report?.orders ?? [];
  const memory = report?.decisionMemories ?? [];
  const points = report?.portfolioHistory ?? metrics.equityCurve ?? [];
  const comparisonRows = benchmarkQuery.data?.comparison ?? [];
  const exportHtml = async () => {
    try { await downloadReport(`/api/reports/export?${runId ? `runId=${encodeURIComponent(runId)}` : "limit=30"}`); notify(locale === "fa" ? "گزارش HTML دانلود شد." : "HTML report downloaded."); }
    catch (error) { notify(error instanceof Error ? error.message : "Export failed."); }
  };
  const executionWasAttempted = Number(metrics.acceptedProposals ?? metrics.tradeCount ?? 0) > 0;
  const reliabilityValue = executionWasAttempted && metrics.executionReliabilityPct !== null && metrics.executionReliabilityPct !== undefined
    ? percent(metrics.executionReliabilityPct)
    : "—";
  const drawdownTone = Number(metrics.maxDrawdownPct) > 0 ? "down" : "plain";
  return <><PageHeading title={t.reportsTitle} description={locale === "fa" ? "عملکرد، تصمیم‌ها، داده‌های مبنا، ریسک، معاملات شبیه‌سازی‌شده و فراخوانی مدل برای هر اجرا." : "Inspect performance, agent decisions, source evidence, risk checks, fills, and model activity for each run."} action={<button className="button secondary" onClick={() => void exportHtml()} disabled={runs.length === 0}><ArrowDownToLine size={15}/>{t.export}</button>} />
    <Card className="benchmark-card"><div className="card-heading"><div><h2>{locale === "fa" ? "مقایسه جفت‌ارز و استراتژی" : "Pair & strategy comparison"}</h2><small className="muted">{locale === "fa" ? `بر پایه ${benchmarkQuery.data?.sampledRuns ?? 0} گزارش اخیر؛ چرخه‌های ${modeTitle("shadow", locale)} برای هر جفت و استراتژی تجمیع شده‌اند.` : `Based on up to ${benchmarkQuery.data?.sampledRuns ?? 0} recent reports; shadow cycles are grouped by pair and strategy.`}</small></div><button className="icon-button" onClick={() => void benchmarkQuery.refetch()} aria-label={t.refresh}><RefreshCw size={15}/></button></div>
      {benchmarkQuery.isError ? <div className="inline-error"><p className="error-text">{locale === "fa" ? "مقایسه گزارش‌ها بارگیری نشد." : "Could not load report comparisons."}</p><details><summary>{locale === "fa" ? "جزئیات فنی" : "Technical details"}</summary><small dir="auto">{benchmarkQuery.error.message}</small></details></div> : comparisonRows.length === 0 ? <Empty text={locale === "fa" ? "برای مقایسه، گزارش تکمیل‌شده‌ای وجود ندارد." : "No completed reports are available to compare."}/> : <div className="table-wrap"><table aria-label={locale === "fa" ? "جدول مقایسه عملکرد" : "Performance comparison table"}><thead><tr><th>#</th><th>{locale === "fa" ? "حالت" : "Mode"}</th><th>{t.symbol}</th><th>{t.strategies}</th><th>{locale === "fa" ? "سود/زیان خالص" : "Net P&L"}</th><th>{t.return}</th><th>{t.drawdown}</th><th>{t.trades}</th><th>{locale === "fa" ? "قابلیت اطمینان" : "Reliability"}</th></tr></thead><tbody>{comparisonRows.map((row, index) => <tr key={`${row.runId}-${row.mode}-${row.symbol}-${row.strategyId}`}><td>{index + 1}</td><td><span className={`mode-badge ${row.mode}`}>{modeTitle(row.mode, locale)}</span></td><td><code>{row.symbol}</code></td><td>{strategyIdTitle(String(row.strategyId), locale)}</td><td className={pnlClass(row.netPnl)}>{money(row.netPnl, row.quoteCurrency, locale)}</td><td className={pnlClass(row.netReturnPct)}>{percent(row.netReturnPct)}</td><td>{percent(row.maxDrawdownPct)}</td><td>{row.tradeCount}</td><td>{Number(row.acceptedProposals ?? row.tradeCount ?? 0) === 0 || row.executionReliabilityPct === null || row.executionReliabilityPct === undefined ? "—" : percent(row.executionReliabilityPct)}</td></tr>)}</tbody></table></div>}
    </Card>
    <Card className="report-select-card"><div className="report-run-picker"><label><FieldLabelInfo label={locale === "fa" ? "انتخاب اجرا" : "Select run"} help={locale === "fa" ? "یک اجرای ذخیره‌شده را برای مرور معیارها، تصمیم‌ها، داده‌های منبع، کنترل ریسک و فراخوانی مدل انتخاب کنید." : "Choose a persisted run to inspect metrics, decisions, source snapshots, risk outcomes, and model calls."}/><AppSelect ariaLabel={locale === "fa" ? "انتخاب اجرا" : "Select run"} value={runId} onValueChange={setSelectedRunId} locale={locale} options={runs.map((item) => ({ value: item.id, label: `${modeTitle(item.mode, locale)} · ${runSymbols(object(item.config)).join(", ") || item.id.slice(0, 8)} · ${dateLabel(item.startedAt, locale)}`, detail: statusTitle(item.status, locale) }))}/></label><div className="run-metadata"><span className={`mode-badge ${run?.mode ?? "shadow"}`}>{run?.mode ? modeTitle(run.mode, locale) : "—"}</span><span className={statusClass(run?.status ?? "unknown")}>{run?.status ? statusTitle(run.status, locale) : "—"}</span><small className="muted">{run?.startedAt ? dateLabel(run.startedAt, locale) : ""}</small></div></div></Card>
    {runs.length === 0 ? <Card><Empty text={t.noRuns}/></Card> : query.isPending ? <Card><div className="loading-line"><LoaderCircle className="spin" size={18}/>{locale === "fa" ? "در حال دریافت ممیزی…" : "Loading audit…"}</div></Card> : query.isError ? <Card><div className="inline-error"><p className="error-text">{locale === "fa" ? "ممیزی این اجرا بارگیری نشد." : "Could not load this run audit."}</p><details><summary>{locale === "fa" ? "جزئیات فنی" : "Technical details"}</summary><small dir="auto">{query.error.message}</small></details></div></Card> : <>
      {(() => { const returnTone = pnlTone(metrics.netReturnPct); return <div className="metric-grid report-metrics"><Metric label={t.return} value={percent(metrics.netReturnPct)} note={`${money(metrics.finalEquity, metrics.quoteCurrency, locale)} · ${locale === "fa" ? "سرمایه نهایی" : "final equity"}`} icon={returnTone === "up" ? TrendingUp : returnTone === "down" ? TrendingDown : Activity} tone={returnTone}/><Metric label={t.drawdown} value={percent(metrics.maxDrawdownPct)} note={locale === "fa" ? "افت از بیشینه ثبت‌شده" : "from peak equity"} icon={drawdownTone === "down" ? TrendingDown : Activity} tone={drawdownTone}/><Metric label={t.trades} value={String(metrics.tradeCount ?? 0)} note={`${money(metrics.volume, metrics.quoteCurrency, locale)} ${locale === "fa" ? "حجم معاملات" : "volume"}`} icon={ArrowLeftRight}/><Metric label={locale === "fa" ? "قابلیت اطمینان اجرا" : "Execution reliability"} value={reliabilityValue} note={`${metrics.acceptedProposals ?? 0} ${locale === "fa" ? "پیشنهاد پذیرفته‌شده" : "accepted proposals"}`} icon={Gauge}/></div>; })()}
      <div className="overview-grid"><Card className="chart-card"><div className="card-heading"><div><h2>{t.virtual} · {metrics.quoteCurrency ?? "TMN"}</h2></div></div><EquityChart points={points} label={`${t.equity} · ${metrics.symbol ?? ""}`} locale={locale}/><div className="assumption-list"><p><b>{locale === "fa" ? "فرض‌های این گزارش" : "Report assumptions"}</b></p>{(metrics.assumptions ?? []).map((item: string) => <small key={item}>{reportAssumptionText(item, locale)}</small>)}</div></Card>
        <Card><div className="card-heading"><div><h2>{locale === "fa" ? "خلاصه اجرا" : "Run summary"}</h2></div><span className="mode-badge">{metrics.strategyId ?? "—"}</span></div><dl className="audit-summary"><div><dt>{t.symbol}</dt><dd>{metrics.symbol ?? object(run?.config).symbol ?? "—"}</dd></div><div><dt>{t.strategies}</dt><dd>{metrics.strategyId ?? object(object(run?.config).strategy).id ?? "—"}</dd></div><div><dt>{locale === "fa" ? "سرمایه آغازین" : "Initial equity"}</dt><dd>{money(metrics.initialEquity, metrics.quoteCurrency, locale)}</dd></div><div><dt>{locale === "fa" ? "ارزش نهایی" : "Final equity"}</dt><dd>{money(metrics.finalEquity, metrics.quoteCurrency, locale)}</dd></div><div><dt>{locale === "fa" ? "میانگین اندازه معامله" : "Average trade size"}</dt><dd>{money(metrics.averageTradeSize, metrics.quoteCurrency, locale)}</dd></div><div><dt>{locale === "fa" ? "کارمزد" : "Fees"}</dt><dd>{metrics.fees ?? "—"}</dd></div><div><dt>{locale === "fa" ? "لغزش قیمت" : "Slippage"}</dt><dd>{metrics.slippage ?? "—"}</dd></div><div><dt>{locale === "fa" ? "بازده خرید و نگهداری" : "Buy & hold return"}</dt><dd>{percent(metrics.buyAndHoldReturnPct)}</dd></div><div><dt>{locale === "fa" ? "بازده مازاد" : "Excess return"}</dt><dd>{percent(metrics.excessReturnPct)}</dd></div></dl></Card></div>
      <Card className="decision-audit-card"><div className="card-heading"><div><h2>{t.decisionsTitle}</h2><small className="muted">{decisions.length} {t.decisions}</small></div></div>{decisions.length === 0 ? <Empty text={locale === "fa" ? "این اجرا تصمیمی ثبت نکرده است." : "No decisions were saved for this run."}/> : <div className="decision-list">{decisions.map((decision) => {
        const proposal = object(decision.proposal), risk = object(decision.risk), expanded = expandedDecision === decision.id;
        return <article className="decision-row" key={decision.id}><button className="decision-summary" onClick={() => setExpandedDecision(expanded ? "" : decision.id)} aria-expanded={expanded}><span className={`action-badge ${String(proposal.action ?? "HOLD").toLowerCase()}`}>{actionTitle(String(proposal.action ?? "HOLD"), locale)}</span><span className="decision-main"><b>{decision.symbol}</b><small>{dateLabel(decision.decidedAt, locale)} · {Number(proposal.confidence ?? 0) * 100}% {locale === "fa" ? "اطمینان" : "confidence"}</small></span><span className={risk.approved ? "status status-completed" : "status status-warning"}>{risk.approved ? (locale === "fa" ? "ریسک تأیید کرد" : "risk approved") : (locale === "fa" ? "رد / نگه‌داری" : "rejected / hold")}</span><ChevronDown className={expanded ? "rotated" : ""} size={16}/></button>
          {expanded && <div className="decision-detail"><div className="decision-columns"><div><h3>{locale === "fa" ? "دلیل ثبت‌شدهٔ پیشنهاد" : "Recorded proposal rationale"}</h3><p dir="auto">{proposal.rationale ?? proposal.reasoning ?? (locale === "fa" ? "دلیل متنی ثبت نشده است." : "No rationale recorded.")}</p><h3>{locale === "fa" ? "پیشنهاد و بررسی ریسک" : "Proposal & risk result"}</h3><pre>{pretty({ proposal, risk })}</pre></div><div><h3>{locale === "fa" ? "یافته‌های عامل‌ها" : "Agent findings"}</h3>{(decision.findings ?? []).map((finding: JsonMap, index: number) => <div className="finding" key={`${finding.role}-${index}`}><b>{agentTitle(String(finding.role ?? ""), locale)}</b><small className="technical-id" dir="ltr">{finding.role}</small><p dir="auto">{finding.summary ?? finding.content ?? finding.finding ?? pretty(finding)}</p><small>{finding.confidence ? `${Math.round(finding.confidence * 100)}% ${locale === "fa" ? "اطمینان" : "confidence"}` : ""}</small></div>)}<h3>{t.evidence}</h3><pre>{pretty(decision.evidence)}</pre></div></div></div>}
        </article>;
      })}</div>}</Card>
      <details className="audit-disclosure"><summary><div><b>{locale === "fa" ? "فراخوانی مدل و بررسی ریسک" : "Model calls and risk checks"}</b><small>{modelCalls.length} {locale === "fa" ? "فراخوانی مدل" : "model calls"} · {report.riskOutcomes.length} {locale === "fa" ? "بررسی ریسک" : "risk checks"}</small></div><ChevronDown size={16}/></summary>
      <div className="overview-grid audit-grid"><Card><div className="card-heading"><div><h2>{t.modelCalls}</h2><small className="muted">{modelCalls.length} {locale === "fa" ? "درخواست مدل" : "model calls"}</small></div></div>{modelCalls.length === 0 ? <Empty text={locale === "fa" ? "فراخوانی مدلی ثبت نشده است." : "No AI calls were recorded."}/> : <div className="table-wrap"><table><thead><tr><th>{locale === "fa" ? "نقش" : "Role"}</th><th>{locale === "fa" ? "ارائه‌دهنده / مدل" : "Provider / model"}</th><th>{locale === "fa" ? "عملیات" : "Operation"}</th><th>{locale === "fa" ? "توکن" : "Tokens"}</th><th>{locale === "fa" ? "نتیجه" : "Result"}</th></tr></thead><tbody>{modelCalls.map((call: JsonMap) => <tr key={call.id}><td><span>{agentTitle(String(call.role ?? ""), locale)}</span><small className="technical-id" dir="ltr">{call.role}</small></td><td dir="ltr">{call.provider} / {call.modelId}</td><td>{operationTitle(String(call.operation ?? ""), locale)}</td><td>{call.totalTokens ?? "—"}</td><td><span className={statusClass(call.status)}>{statusTitle(String(call.status ?? "unknown"), locale)}</span>{call.errorMessage && <details><summary>{locale === "fa" ? "خطای درخواست" : "Request error"}</summary><small dir="auto">{call.errorMessage}</small></details>}</td></tr>)}</tbody></table></div>}</Card>
        <Card><div className="card-heading"><div><h2>{t.riskChecks}</h2><small className="muted">{report.riskOutcomes.length}</small></div></div>{report.riskOutcomes.length === 0 ? <Empty text={locale === "fa" ? "بررسی ریسکی ثبت نشده است." : "No risk results were recorded."}/> : <div className="risk-list">{report.riskOutcomes.map((risk: JsonMap) => <div className="risk-row" key={risk.id}><span className={risk.approved ? "status status-completed" : "status status-warning"}>{risk.approved ? (locale === "fa" ? "مجاز" : "PASS") : (locale === "fa" ? "مسدود" : "BLOCK")}</span><div><small>{dateLabel(risk.checkedAt, locale)}</small><p dir="auto">{(risk.reasons ?? []).map((reason: string) => riskReasonText(reason, locale)).join(" · ") || (locale === "fa" ? "بدون مانع" : "No blocking reasons")}</p></div></div>)}</div>}</Card></div></details>
      <details className="audit-disclosure"><summary><div><b>{locale === "fa" ? "سفارش‌ها، منابع داده و حافظه تصمیم" : "Orders, data evidence, and decision memory"}</b><small>{orders.length} {locale === "fa" ? "سفارش" : "orders"} · {report.sourceSnapshots.length} {locale === "fa" ? "منبع داده" : "source snapshots"} · {memory.length} {locale === "fa" ? "رکورد حافظه" : "memory records"}</small></div><ChevronDown size={16}/></summary>
      <div className="overview-grid audit-grid"><Card><div className="card-heading"><div><h2>{t.orderTitle}</h2></div></div>{orders.length === 0 ? <Empty text={locale === "fa" ? "سفارشی برای این اجرا ثبت نشده است." : "No order intents in this run."}/> : <div className="table-wrap"><table><thead><tr><th>{t.symbol}</th><th>{locale === "fa" ? "سمت / نوع" : "Side / type"}</th><th>{locale === "fa" ? "وضعیت" : "State"}</th><th>{locale === "fa" ? "پرشدن" : "Fills"}</th><th>{locale === "fa" ? "حجم" : "Quantity"}</th></tr></thead><tbody>{orders.map((order: JsonMap) => <tr key={order.clientOrderId}><td>{order.order?.symbol}</td><td>{orderValueTitle(String(order.order?.side ?? ""), locale)} / {orderValueTitle(String(order.order?.type ?? ""), locale)}</td><td><span className={statusClass(order.state)}>{statusTitle(order.state, locale)}</span></td><td>{order.fills?.length ?? 0}</td><td>{order.order?.quantity ?? "—"}</td></tr>)}</tbody></table></div>}</Card>
        <Card><div className="card-heading"><div><h2>{t.evidence}</h2></div></div><div className="snapshot-list">{report.sourceSnapshots.slice(0, 12).map((snapshot: JsonMap) => <details className="snapshot" key={snapshot.id}><summary><b>{auditCategoryTitle(String(snapshot.category ?? ""), locale)}</b><span>{snapshot.source}</span><small>{dateLabel(snapshot.observedAt, locale)}</small></summary><pre>{pretty(snapshot.payload)}</pre></details>)}{memory.length > 0 && <div className="memory-audit"><h3>{locale === "fa" ? "حافظه و بازتاب" : "Memory & reflection"}</h3>{memory.map((item: JsonMap) => <div className="finding" key={item.decisionId}><b>{actionTitle(String(item.action ?? ""), locale)} · {item.symbol} · {statusTitle(String(item.status ?? "unknown"), locale)}</b><small className="model-output-label">{locale === "fa" ? "متن ثبت‌شدهٔ تصمیم و بازتاب" : "Recorded model-generated rationale and reflection"}</small><p dir="auto">{item.decisionText}</p><small>Alpha {percent(item.alphaReturn)} · {item.benchmarkSymbol}</small>{item.reflection && <p dir="auto">{item.reflection}</p>}</div>)}</div>}{report.sourceSnapshots.length === 0 && memory.length === 0 && <Empty text={locale === "fa" ? "منبع و حافظه‌ای ثبت نشده است." : "No source snapshots or memory records."}/>}</div></Card></div></details>
      <details className="raw-run-audit"><summary><TerminalSquare size={15}/>{locale === "fa" ? "پیکربندی و ممیزی کامل اجرا" : "Full run configuration & audit JSON"}</summary><pre>{pretty(run)}</pre></details>
    </>}
  </>;
}

function OrdersView({ t, locale, notify }: { t: Record<string, string>; locale: Locale; notify: (message: string) => void }) {
  const [openOnly, setOpenOnly] = useState(false);
  const [cancelId, setCancelId] = useState("");
  const [cancelText, setCancelText] = useState("");
  const queryClient = useQueryClient();
  const ordersQuery = useQuery({ queryKey: ["orders", openOnly], queryFn: () => api<{ orders: JsonMap[] }>(`/api/orders?open=${openOnly}`) });
  const cancel = async (clientOrderId: string) => {
    if (cancelText !== "CANCEL") return;
    try { await api("/api/orders/cancel", { method: "POST", body: JSON.stringify({ clientOrderId, confirmed: true }) }); setCancelId(""); setCancelText(""); await queryClient.invalidateQueries({ queryKey: ["orders"] }); notify(locale === "fa" ? "درخواست لغو به والکس ارسال و وضعیت سفارش همگام شد." : "Cancellation confirmed and the Wallex order state reconciled."); }
    catch (error) { notify(error instanceof Error ? error.message : "Cancellation failed."); }
  };
  const rows = ordersQuery.data?.orders ?? [];
  return <><PageHeading title={t.orders} description={locale === "fa" ? "سفارش‌های زنده، نیت‌های سفارش پایدار، وضعیت لغو و پرشدن‌ها. سفارش‌های مجازی قابل لغو در والکس نیستند." : "Review persisted order intents, live exchange state, cancellations, and fills. Simulated orders cannot be canceled on Wallex."} action={<button className="button secondary" onClick={() => void ordersQuery.refetch()} disabled={ordersQuery.isFetching}><RefreshCw size={15} className={ordersQuery.isFetching ? "spin" : ""}/>{t.refresh}</button>} />
    <Card><div className="market-toolbar"><label className="checkbox-row"><input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)}/>{locale === "fa" ? "فقط سفارش‌های باز" : "Open orders only"}</label><span className="count-pill">{rows.length} {t.orders}</span></div>{ordersQuery.isError && <div className="notice warning"><AlertTriangle size={16}/><p>{ordersQuery.error.message}</p></div>}{rows.length === 0 && !ordersQuery.isPending ? <Empty text={locale === "fa" ? "سفارشی ثبت نشده است." : "No recorded orders."}/> : <div className="table-wrap"><table><thead><tr><th>{locale === "fa" ? "حالت" : "Mode"}</th><th>{t.symbol}</th><th>{locale === "fa" ? "شناسه کارخواه" : "Client order ID"}</th><th>{locale === "fa" ? "سمت / نوع" : "Side / type"}</th><th>{locale === "fa" ? "وضعیت" : "State"}</th><th>{locale === "fa" ? "پرشدن / کارمزد" : "Fills / fees"}</th><th>{locale === "fa" ? "ایجاد" : "Created"}</th><th>{locale === "fa" ? "عملیات" : "Action"}</th></tr></thead><tbody>{rows.map((order) => <tr key={order.clientOrderId}><td><span className={`mode-badge ${order.mode}`}>{modeTitle(order.mode, locale)}</span></td><td>{order.symbol}</td><td><code className="order-id">{order.clientOrderId}</code></td><td>{orderValueTitle(String(order.order?.side ?? ""), locale)} / {orderValueTitle(String(order.order?.type ?? ""), locale)}</td><td><span className={statusClass(order.state)}>{statusTitle(order.state, locale)}</span></td><td>{order.fills?.length ?? 0}{order.fills?.length ? ` · ${order.fills.map((fill: JsonMap) => `${fill.fee} ${fill.feeAsset}`).join(", ")}` : ""}</td><td>{dateLabel(order.createdAt, locale)}</td><td>{order.mode === "live" && ["pending", "submitted", "reconciling", "NEW", "PARTIALLY_FILLED"].includes(order.state) ? <button className="button danger-outline small-button" onClick={() => { setCancelId(order.clientOrderId); setCancelText(""); }}>{locale === "fa" ? "لغو" : "Cancel"}</button> : <span className="muted">—</span>}</td></tr>)}</tbody></table></div>}</Card>
    {cancelId && <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title"><button className="icon-button modal-close" onClick={() => setCancelId("")} aria-label={t.cancel}><X size={17}/></button><span className="warning-mark"><AlertTriangle size={20}/></span><h2 id="cancel-title">{locale === "fa" ? "لغو سفارش واقعی؟" : "Cancel live order?"}</h2><p className="muted">{locale === "fa" ? "موتور قبل از لغو، وضعیت سفارش را از والکس بازیابی می‌کند." : "The engine reconciles exchange state before requesting cancellation."}</p><label className="field-label">{locale === "fa" ? "برای تأیید CANCEL را وارد کنید" : "Type CANCEL to confirm"}<input autoFocus value={cancelText} onChange={(event) => setCancelText(event.target.value.toUpperCase())}/></label><div className="modal-actions"><button className="button secondary" onClick={() => setCancelId("")}>{t.cancel}</button><button className="button danger-button" disabled={cancelText !== "CANCEL"} onClick={() => void cancel(cancelId)}><CircleStop size={15}/>{locale === "fa" ? "لغو سفارش" : "Cancel order"}</button></div></section></div>}
  </>;
}

function SystemView({ t, locale, profileId, profiles, config, fields, database, notify, onRefresh }: { t: Record<string, string>; locale: Locale; profileId: string; profiles: Profile[]; config: JsonMap; fields: Field[]; database: { url: string }; notify: (message: string) => void; onRefresh: () => void }) {
  const [mode, setMode] = useState<"backtest" | "shadow" | "live">("shadow");
  const [checkWallex, setCheckWallex] = useState(false);
  const [diagnostics, setDiagnostics] = useState<JsonMap | null>(null);
  const [validation, setValidation] = useState<JsonMap | null>(null);
  const [loading, setLoading] = useState("");
  const [actionError, setActionError] = useState("");
  const [showOverrides, setShowOverrides] = useState(false);
  const checks: JsonMap[] = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
  const failedCount = checks.filter((check) => check.status === "fail").length;
  const skippedCount = checks.filter((check) => check.status === "skip").length;
  const passedCount = checks.filter((check) => check.status === "pass").length;
  const clearResults = () => { setActionError(""); setDiagnostics(null); setValidation(null); };
  const runDoctor = async () => {
    setActionError(""); setLoading("doctor");
    try { const result = await api<JsonMap>(`/api/diagnostics?profileId=${encodeURIComponent(profileId)}`, { method: "POST", body: JSON.stringify({ mode, checkWallex }) }); setDiagnostics(result); notify(locale === "fa" ? "بررسی سلامت کامل شد." : "Health checks completed."); }
    catch (error) { setActionError(error instanceof Error ? error.message : (locale === "fa" ? "بررسی سلامت ناموفق بود." : "Health checks failed.")); }
    finally { setLoading(""); }
  };
  const validate = async () => {
    setActionError(""); setLoading("validate");
    try { setValidation(await api<JsonMap>(`/api/validate?mode=${mode}&profileId=${encodeURIComponent(profileId)}`)); }
    catch (error) { setActionError(error instanceof Error ? error.message : (locale === "fa" ? "اعتبارسنجی تنظیمات ناموفق بود." : "Configuration validation failed.")); }
    finally { setLoading(""); }
  };
  const migrate = async () => {
    if (!window.confirm(locale === "fa" ? "مهاجرت‌های پایگاه داده اعمال شوند؟" : "Apply database migrations?")) return;
    setActionError(""); setLoading("migrate");
    try { await api("/api/db/migrate", { method: "POST", body: "{}" }); onRefresh(); notify(locale === "fa" ? "مهاجرت‌ها اجرا شدند." : "Database migrations completed."); }
    catch (error) { setActionError(error instanceof Error ? error.message : (locale === "fa" ? "مهاجرت پایگاه داده ناموفق بود." : "Database migration failed.")); }
    finally { setLoading(""); }
  };
  const secretStatuses = profileSecretRows(profiles.find((item) => item.id === profileId));
  const dbPath = database.url.replace(/^file:/i, "");
  const dbName = dbPath.split(/[\\/]/).filter(Boolean).at(-1) || (locale === "fa" ? "پایگاه داده محلی" : "Local database");
  return <><PageHeading title={t.system} description={locale === "fa" ? "آمادگی اجرای هر حالت، دسترسی والکس، پایگاه داده و منشأ تنظیمات را از اینجا بررسی کنید." : "Check mode readiness, Wallex read access, database status, and configuration sources from one place."} />
    <div className="overview-grid health-overview"><Card className="health-check-card"><div className="card-heading"><div><h2>{locale === "fa" ? "آمادگی موتور" : "Engine readiness"}</h2><small className="muted">{locale === "fa" ? "این بررسی‌ها مدل هوش مصنوعی را فراخوانی نمی‌کنند و سفارش نمی‌فرستند." : "These checks do not call an AI model or submit exchange orders."}</small></div><Gauge size={18}/></div>
      <div className={`health-summary ${diagnostics ? (failedCount ? "has-failures" : skippedCount ? "has-skips" : "all-clear") : "not-run"}`} role="status" aria-live="polite"><span className="health-summary-mark">{diagnostics ? (failedCount ? <AlertTriangle size={18}/> : skippedCount ? <CircleHelp size={18}/> : <Check size={18}/>) : <Activity size={18}/>}</span><div><b>{!diagnostics ? (locale === "fa" ? "بررسی هنوز اجرا نشده" : "Checks have not run yet") : failedCount ? (locale === "fa" ? "نیاز به رسیدگی دارد" : "Needs attention") : skippedCount ? (locale === "fa" ? "برخی موارد بررسی نشده‌اند" : "Some checks were skipped") : (locale === "fa" ? "همه بررسی‌ها موفق بودند" : "All checks passed")}</b><small>{diagnostics ? `${passedCount} ${locale === "fa" ? "موفق" : "passed"} · ${failedCount} ${locale === "fa" ? "نیازمند رسیدگی" : "need attention"} · ${skippedCount} ${locale === "fa" ? "بررسی‌نشده" : "not checked"}` : (locale === "fa" ? "حالت اجرا را انتخاب کنید، سپس اعتبارسنجی یا بررسی سلامت را اجرا کنید." : "Choose a run mode, then validate settings or run health checks.")}</small></div></div>
      <div className="field-row"><label className="field-label"><FieldLabelInfo label={locale === "fa" ? "حالت مورد بررسی" : "Mode to check"} help={locale === "fa" ? "الزامات تنظیمات برای این حالت سنجیده می‌شوند. این کار اجرا را شروع یا سفارش ارسال نمی‌کند." : "Checks configuration requirements for this mode. It does not start a run or submit orders."}/><AppSelect ariaLabel={locale === "fa" ? "حالت مورد بررسی" : "Mode to check"} value={mode} onValueChange={(value) => { setMode(value as typeof mode); clearResults(); }} locale={locale} options={marketModeOptions(locale)}/></label></div>
      <label className="health-wallex-option"><input type="checkbox" checked={checkWallex} onChange={(event) => { setCheckWallex(event.target.checked); setDiagnostics(null); }}/><span><b>{locale === "fa" ? "بررسی اتصال خواندنی والکس" : "Check Wallex read access"}</b><small>{locale === "fa" ? "درخواست خواندنی برای دریافت بازارهای فعال؛ هیچ تغییری در حساب ایجاد نمی‌شود." : "Read-only request for active markets; it does not change your account."}</small></span></label>
      <div className="button-row"><button className="button secondary" onClick={() => void validate()} disabled={Boolean(loading)}>{loading === "validate" ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/>}{loading === "validate" ? (locale === "fa" ? "در حال اعتبارسنجی…" : "Validating…") : (locale === "fa" ? "اعتبارسنجی تنظیمات" : "Validate settings")}</button><button className="button primary" onClick={() => void runDoctor()} disabled={Boolean(loading)}>{loading === "doctor" ? <LoaderCircle className="spin" size={15}/> : <Activity size={15}/>}{loading === "doctor" ? (locale === "fa" ? "در حال بررسی…" : "Checking…") : (locale === "fa" ? "اجرای بررسی سلامت" : "Run health checks")}</button></div>
      {actionError && <div className="notice warning health-action-error" role="alert"><AlertTriangle size={16}/><div><b>{locale === "fa" ? "عملیات انجام نشد" : "The operation did not complete"}</b><p>{locale === "fa" ? "اتصال سرویس را بررسی و دوباره تلاش کنید. جزئیات فنی در ادامه آمده است." : "Check the service connection and try again. Technical details are available below."}</p><details><summary>{locale === "fa" ? "جزئیات فنی" : "Technical details"}</summary><small dir="auto">{actionError}</small></details></div></div>}
      {validation && <div className={`validation-box ${validation.valid ? "success" : "failure"}`} role="status"><b>{validation.valid ? (locale === "fa" ? "تنظیمات این حالت معتبر است" : "Settings are valid for this mode") : (locale === "fa" ? "تنظیمات این حالت نیاز به اصلاح دارد" : "Settings need attention for this mode")}</b>{validation.errors?.length > 0 && <ul>{validation.errors.map((error: string) => <li key={error}>{issueText(error, locale)}<details><summary>{locale === "fa" ? "جزئیات فنی" : "Technical detail"}</summary><small dir="auto">{error}</small></details></li>)}</ul>}</div>}
      {diagnostics && <div className="diagnostic-list"><div className="diagnostic-list-heading"><h3>{locale === "fa" ? "نتیجه بررسی‌ها" : "Check results"}</h3><small>{dateLabel(Date.now(), locale)}</small></div>{checks.map((check: JsonMap) => <div className="diagnostic-row" key={check.name}><span className={statusClass(check.status === "fail" ? "failed" : check.status)}>{statusTitle(String(check.status), locale)}</span><div><b>{diagnosticTitle(String(check.name), locale)}</b><small>{diagnosticDetailText(check.name, check.status, check.detail, locale)}</small><details><summary>{locale === "fa" ? "جزئیات فنی" : "Technical details"}</summary><small dir="auto">{check.detail}</small></details></div></div>)}</div>}
    </Card>
      <Card className="database-health-card"><div className="card-heading"><div><h2><Database size={17}/>{locale === "fa" ? "پایگاه داده محلی" : "Local database"}</h2><small className="muted">{locale === "fa" ? "اطلاعات اجراها، پروفایل‌ها و گزارش‌ها در همین دستگاه نگهداری می‌شوند." : "Runs, profiles, and reports are stored on this device."}</small></div><span className="status status-neutral">SQLite</span></div><dl className="audit-summary"><div><dt>{locale === "fa" ? "فایل پایگاه داده" : "Database file"}</dt><dd><code className="path-value">{dbName}</code></dd></div><div><dt>{locale === "fa" ? "ذخیره‌سازی" : "Storage"}</dt><dd>{locale === "fa" ? "تک‌فرآیند · ژورنال WAL · اعتبارنامه‌های رمزگذاری‌شده" : "Single process · WAL journaling · encrypted credentials"}</dd></div><div><dt>{locale === "fa" ? "ساختار داده" : "Schema"}</dt><dd>{locale === "fa" ? "نسخه‌بندی‌شده و قابل مهاجرت" : "Versioned and migratable"}</dd></div></dl>
        <details className="health-path"><summary>{locale === "fa" ? "نمایش مسیر کامل برای عیب‌یابی" : "Show full path for troubleshooting"}</summary><code dir="ltr">{database.url}</code></details>
        <button className="button secondary full" onClick={() => void migrate()} disabled={Boolean(loading)}>{loading === "migrate" ? <LoaderCircle className="spin" size={15}/> : <Database size={15}/>}{loading === "migrate" ? (locale === "fa" ? "در حال بررسی و مهاجرت…" : "Checking and migrating…") : t.migrate}</button>
        <div className="security-callout"><LockKeyhole size={16}/><p>{locale === "fa" ? "تنظیمات و کلیدهای پروفایل در پایگاه داده ذخیره می‌شوند. کلید اصلی رمزنگاری جداگانه نگهداری می‌شود؛ در صورت گم‌شدن آن، اعتبارنامه‌های رمزگذاری‌شده بازیابی‌پذیر نیستند." : "Profile settings and credentials are stored in the database. The encryption key is held separately; encrypted credentials cannot be recovered if that key is lost."}</p></div>
      </Card></div>
    <details className="health-disclosure"><summary><div><h2>{locale === "fa" ? "منشأ تنظیمات مؤثر" : "Where effective settings come from"}<small>{locale === "fa" ? "مقادیر پروفایل و پیش‌فرض‌ها؛ اعتبارنامه‌ها پنهان می‌مانند." : "Profile values and defaults; credentials remain hidden."}</small></h2></div><ChevronDown size={16}/></summary>
      <div className="source-summary"><span><i className="source-dot profile"/>{t.profileSource} <b>{fields.filter((field) => field.source === "profile" && !field.secret).length}</b></span><span><i className="source-dot default"/>{t.default} <b>{fields.filter((field) => field.source === "default" && !field.secret).length}</b></span></div>
      <div className="table-wrap"><table><thead><tr><th>{locale === "fa" ? "تنظیم" : "Setting"}</th><th>{t.value}</th><th>{t.source}</th><th>{locale === "fa" ? "قابلیت ویرایش" : "Access"}</th></tr></thead><tbody>{fields.filter((field) => showOverrides || field.source !== "default").map((field) => <tr key={field.key}><td><span>{settingTitle(field.key, locale)}</span><small className="technical-id" dir="ltr">{field.key}</small></td><td>{field.secret ? <span className="muted">{secretStatuses[field.key] ? (locale === "fa" ? "رمزگذاری‌شده · پنهان" : "Encrypted · hidden") : (locale === "fa" ? "ثبت نشده" : "Not set")}</span> : <code className="value-preview">{field.value || "—"}</code>}</td><td><span className={`source-tag source-${field.source}`}>{sourceTitle(field.source, locale)}</span></td><td>{field.writable ? (locale === "fa" ? "قابل ویرایش" : "Editable") : (locale === "fa" ? "فقط خواندنی" : "Read-only")}</td></tr>)}</tbody></table></div>
      <button className="text-button" onClick={() => setShowOverrides((value) => !value)}>{showOverrides ? (locale === "fa" ? "نمایش فقط مقادیر پروفایل" : "Show profile values only") : (locale === "fa" ? "نمایش پیش‌فرض‌ها هم" : "Include defaults")}<ChevronDown size={14}/></button>
    </details>
    <Card className="access-boundaries-card"><div className="card-heading"><div><h2>{locale === "fa" ? "حفاظت داده و دسترسی" : "Data and access boundaries"}</h2><small className="muted">{locale === "fa" ? "ویژگی‌های محلی که در همه صفحات و حالت‌ها برقرارند." : "Local protections that apply across the dashboard and run modes."}</small></div></div><div className="security-grid"><div><Shield size={17}/><b>{locale === "fa" ? "محدود به همین دستگاه" : "This device only"}</b><small>{locale === "fa" ? "داشبورد روی نشانی محلی اجرا می‌شود و درخواست‌های وب بررسی می‌شوند." : "The dashboard listens locally and validates browser requests."}</small></div><div><LockKeyhole size={17}/><b>{locale === "fa" ? "اعتبارنامه‌های رمزگذاری‌شده" : "Encrypted credentials"}</b><small>{locale === "fa" ? "کلیدها در رابط، گزارش‌ها و پاسخ‌های معمول نمایش داده نمی‌شوند." : "Credentials are hidden from the interface, reports, and routine API responses."}</small></div><div><CirclePause size={17}/><b>{locale === "fa" ? "پرتفوی مجازی در شبیه‌سازی" : "Virtual portfolio in simulation"}</b><small>{locale === "fa" ? "بک‌تست و شبیه‌سازی زنده موجودی کیف پول والکس را تغییر نمی‌دهند." : "Backtests and live simulations cannot change the Wallex wallet."}</small></div></div></Card>
  </>;
}

function profileSecretRows(profile?: Profile): Record<string, boolean> {
  const secrets = profile?.secrets ?? {};
  const provider = secrets.providerKeys ?? {};
  return {
    AI_API_KEY: Boolean(secrets.aiApiKey), WALLEX_API_KEY: Boolean(secrets.wallexApiKey), WALLEX_SUB_ACCOUNT_CLIENT_ID: Boolean(secrets.subAccountClientId),
    RESEARCH_ENDPOINTS_JSON: Boolean(secrets.researchEndpoints), MARKET_QUOTE_FALLBACKS_JSON: Boolean(secrets.marketQuoteFallbacks),
    AI_PROVIDER_KEYS_JSON: Object.values(provider).some(Boolean),
    ...Object.fromEntries(Object.entries(provider).map(([id, configured]) => [`AI_PROVIDER_KEY:${id}`, Boolean(configured)])),
  };
}
