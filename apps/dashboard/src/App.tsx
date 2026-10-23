import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowLeftRight, ArrowUpRight, BarChart3, Blocks, Check, ChevronDown,
  CircleHelp, CirclePause, CirclePlay, CircleStop, Cpu, Database, FileClock, Gauge, Globe2, KeyRound,
  LayoutDashboard, ListFilter, LoaderCircle, LockKeyhole, LogOut, Moon, Plus, RefreshCw, Search, Settings2,
  Shield, SlidersHorizontal, Sparkles, TerminalSquare, Trash2, TrendingDown, TrendingUp, WalletCards, X,
} from "lucide-react";
import { api, downloadReport, getToken } from "./api";
import { AppSelect, CurrencyPairAvatar, FieldLabelInfo, InfoTooltip, MoneyInput, SegmentedTabs } from "./ui-primitives";
import { EndpointListEditor } from "./EndpointListEditor";
import { RoleRouteEditor } from "./RoleRouteEditor";
import { PairLimitsEditor } from "./PairLimitsEditor";
import { AgentWorkspace } from "./AgentWorkspace";
import { agentTitle } from "./agent-catalog";
import { SetupWizard, setupNeeded } from "./SetupWizard";

type Locale = "fa" | "en";
type JsonMap = Record<string, any>;
type Profile = { id: string; name: string; active: boolean; settings: Record<string, string>; createdAt: number; updatedAt: number; secrets: JsonMap; secretState: JsonMap };
type Field = { key: string; group: string; value: string; source: "profile" | "default"; writable: boolean; secret: boolean };
type Run = { id: string; mode: string; status: string; startedAt: number; endedAt?: number | null; config?: JsonMap; report?: JsonMap | null; failureName?: string | null; failureMessage?: string | null };
type ManagedRun = { id: string; mode: string; profileId: string; state: string; phase: "setup" | "engine"; message: string; startedAt: number; updatedAt: number; symbols: string[]; strategyIds: string[]; error?: string; workflow?: WorkflowProgress };
type Bootstrap = { profiles: Profile[]; activeProfileId: string; selectedProfileId: string; config: JsonMap; fields: Field[]; strategies: Strategy[]; runs: Run[]; managedRuns: ManagedRun[]; database: { url: string } };
type Strategy = { id: string; name: string; mandate: string; minConfidence: number; allowedOrderTypes: Array<"MARKET" | "LIMIT">; maxOrderNotional?: string; maxPositionNotional?: string; maxGrossExposure?: string };
type Audit = { run: JsonMap; decisions: JsonMap[]; riskOutcomes: JsonMap[]; orders: JsonMap[]; decisionMemories: JsonMap[]; portfolioHistory: Array<{ timestamp: number; equity: string; cash: string; positions: unknown[] }>; sourceSnapshots: JsonMap[]; aiModelCalls: JsonMap[] };
type WorkflowStageId = "preparation" | "market_data" | "research" | "analysts" | "research_debate" | "trader_proposal" | "risk_review" | "final_gate" | "outcome";
type WorkflowStageState = { status: "active" | "completed" | "skipped" | "failed"; startedAt: number; updatedAt: number; detail?: string };
type WorkflowProgress = {
  engineRunId: string; mode: string; symbol: string; cycle: number; currentStage: WorkflowStageId;
  stages: Partial<Record<WorkflowStageId, WorkflowStageState>>;
  activeAgents: Array<{ id: string; role: string; startedAt: number }>;
  completedAgentTasks: number; totalAgentTasks: number; updatedAt: number;
};

const copy: Record<Locale, Record<string, string>> = {
  fa: {
    setup: "راه‌اندازی سریع", overview: "نمای کلی", runLab: "آزمایش و اجرا", profiles: "پروفایل‌ها و تنظیمات", strategies: "دستیارها و استراتژی‌ها",
    markets: "بازارها", reports: "گزارش و بررسی", orders: "سفارش‌ها", system: "سلامت سیستم", refresh: "به‌روزرسانی",
    operator: "میزکار", activeProfile: "پروفایل فعال", virtual: "سرمایه مجازی", actual: "موجودی واقعی والکس",
    runs: "اجراها", decisions: "تصمیم‌ها", noData: "هنوز داده‌ای برای نمایش نیست", recent: "آخرین اجراها",
    equity: "ارزش دارایی‌ها", return: "بازده خالص", drawdown: "بیشترین افت سرمایه", trades: "معاملات انجام‌شده",
    runTitle: "اجرای استراتژی", backtest: "آزمایش با داده‌های گذشته", shadow: "شبیه‌سازی با قیمت زنده", live: "معاملهٔ واقعی",
    backtestHint: "داده‌های گذشتهٔ والکس را بررسی می‌کند؛ سفارش فرضی زودتر از بازهٔ یک‌دقیقه‌ای بعدی انجام نمی‌شود.",
    shadowHint: "قیمت‌ها زنده‌اند و نتیجه در سبد مجازی ثبت می‌شود؛ در این حالت سفارشی به والکس فرستاده نمی‌شود.",
    liveHint: "به حساب واقعی والکس وصل می‌شود. پیش از ارسال هر سفارش، محدودیت‌های ریسک بررسی می‌شوند.",
    symbol: "جفت‌ارز", symbols: "جفت‌ارزها", from: "از تاریخ", to: "تا تاریخ",
    watch: "ادامهٔ خودکار شبیه‌سازی", interval: "فاصلهٔ بررسی‌ها (ثانیه)", auto: "ادامهٔ خودکار معاملهٔ واقعی", start: "شروع اجرا",
    stop: "توقف ایمن", stopPending: "درخواست توقف ثبت شد", profile: "پروفایل", settings: "تنظیمات",
    save: "ذخیره تغییرات", create: "ساخت پروفایل", activate: "فعال‌کردن", delete: "حذف", import: "ورود تنظیمات از فایل .env",
    key: "تنظیم", value: "مقدار", source: "منبع تنظیم", ai: "هوش مصنوعی و دستیارها", wallex: "والکس",
    risk: "ریسک و ایمنی", simulation: "شبیه‌سازی", memory: "یادگیری از نتیجه‌ها", dataSources: "منابع داده", advanced: "پیشرفته",
    profileSource: "پروفایل", default: "پیش‌فرض", secrets: "کلیدهای دسترسی",
    configured: "ثبت شده", missing: "ثبت نشده", keyHint: "کلیدها رمزگذاری می‌شوند و پس از ذخیره دیگر نمایش داده نمی‌شوند.",
    marketsTitle: "بازارهای فعال والکس", allMarkets: "نمایش همه بازارها", allowlist: "جفت‌ارز انتخاب‌شده",
    search: "جست‌وجو", apply: "ذخیره بازارهای مجاز", reportsTitle: "عملکرد و گزارش اجراها",
    export: "دریافت گزارش HTML", modelCalls: "فعالیت هوش مصنوعی", evidence: "شواهد و منابع", riskChecks: "بررسی‌های ریسک",
    decisionsTitle: "تصمیم‌های دستیارها", orderTitle: "سفارش‌ها", details: "جزئیات", noRuns: "هنوز اجرایی برای نمایش ثبت نشده است.",
    liveConfirmTitle: "تأیید معاملهٔ واقعی", liveConfirmBody: "با ادامه، درخواست معامله به والکس می‌رسد و ممکن است از اعتبار واقعی شما استفاده شود.",
    profileLabel: "پروفایل انتخاب‌شده", pairLabel: "جفت‌ارزهای مجاز", exposure: "حداکثر ارزش موقعیت‌ها", typeTrade: "برای تأیید، عبارت «شروع معامله واقعی» را وارد کنید",
    acknowledge: "ریسک استفاده از اعتبار واقعی را می‌پذیرم.", confirmLive: "تأیید و شروع معامله واقعی", cancel: "انصراف",
    diagnostics: "بررسی سلامت", validate: "بررسی تنظیمات", checkWallex: "بررسی دسترسی به والکس", migrate: "به‌روزرسانی پایگاه داده",
    encryption: "حفاظت از کلیدهای دسترسی", generateKey: "ساخت کلید اصلی", rotateKey: "تعویض کلید اصلی", oldKey: "کلید فعلی", newKey: "کلید تازه",
    importPath: "مسیر فایل .env روی همین دستگاه", profileName: "نام پروفایل جدید", copied: "کپی شد",
  },
  en: {
    setup: "Quick setup", overview: "Overview", runLab: "Run lab", profiles: "Profiles & settings", strategies: "Agents & strategies",
    markets: "Markets", reports: "Reports & audit", orders: "Orders", system: "System health", refresh: "Refresh",
    operator: "Operator workspace", activeProfile: "Active profile", virtual: "Virtual capital", actual: "Actual Wallex balance",
    runs: "Runs", decisions: "Decisions", noData: "Nothing to show yet", recent: "Recent runs",
    equity: "Portfolio equity", return: "Net return", drawdown: "Maximum drawdown", trades: "Trades",
    runTitle: "Run a strategy", backtest: "Backtest", shadow: "Live simulation", live: "Live trading",
    backtestHint: "Replay completed Wallex candles; simulated execution starts no earlier than the next bar.",
    shadowHint: "Live prices and a virtual portfolio. This mode has no order submission path.",
    liveHint: "Connects to your real account. Every proposal passes deterministic risk checks before submission.",
    symbol: "Pair", symbols: "Pairs", from: "From", to: "To",
    watch: "Repeat evaluations", interval: "Evaluation interval (seconds)", auto: "Continuous autonomous trading", start: "Start run",
    stop: "Stop safely", stopPending: "Stop requested", profile: "Profile", settings: "Settings",
    save: "Save changes", create: "Create profile", activate: "Activate", delete: "Delete", import: "Secure dotenv import",
    key: "Key", value: "Effective value", source: "Value source", ai: "AI & agents", wallex: "Wallex",
    risk: "Risk & safety", simulation: "Simulation", memory: "Memory", dataSources: "Data sources", advanced: "Advanced",
    profileSource: "Profile", default: "Default", secrets: "Credentials & keys",
    configured: "Configured", missing: "Not set", keyHint: "Credentials are encrypted and never displayed after saving.",
    marketsTitle: "Active Wallex markets", allMarkets: "Show all markets", allowlist: "selected pairs",
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
  ["setup", Sparkles], ["overview", LayoutDashboard], ["runLab", Activity], ["profiles", Settings2], ["strategies", Blocks],
  ["markets", ArrowLeftRight], ["reports", BarChart3], ["orders", WalletCards], ["system", Gauge],
] as const;

function sourceTitle(source: string, locale: Locale) {
  return source === "profile" ? copy[locale].profileSource : copy[locale].default;
}
function settingsGroupTitle(group: string, locale: Locale) {
  const titles: Record<string, { fa: string; en: string }> = {
    All: { fa: "همه", en: "All" }, Advanced: { fa: "پیشرفته", en: "Advanced" },
    Wallex: { fa: "والکس", en: "Wallex" }, "AI & agents": { fa: "هوش مصنوعی و دستیارها", en: "AI & agents" },
    Strategies: { fa: "استراتژی‌ها", en: "Strategies" }, Memory: { fa: "یادگیری از نتیجه‌ها", en: "Decision memory" },
    Simulation: { fa: "شبیه‌سازی", en: "Simulation" }, "Risk & safety": { fa: "ریسک و ایمنی", en: "Risk & safety" },
    "Data sources": { fa: "منابع داده", en: "Data sources" },
  };
  return titles[group]?.[locale] ?? group;
}

function settingTitle(key: string, locale: Locale): string {
  const titles: Record<string, { fa: string; en: string }> = {
    LOG_LEVEL: { fa: "جزئیات گزارش موتور", en: "Engine log detail" }, ENGINE_MODE: { fa: "حالت پیش‌فرض اجرا", en: "Default run mode" },
    WALLEX_BASE_URL: { fa: "نشانی سرویس والکس", en: "Wallex API address" }, WALLEX_WS_URL: { fa: "نشانی داده زنده والکس", en: "Wallex live-data address" },
    WALLEX_ENABLE_LIVE_TRADING: { fa: "اجازه ارسال سفارش واقعی", en: "Allow real order submission" }, WALLEX_ENABLE_AUTOTRADING: { fa: "اجازه تکرار خودکار معامله", en: "Allow automated trading" },
    WALLEX_ALLOWED_MARKETS: { fa: "جفت‌ارزهای مجاز", en: "Allowed markets" }, WALLEX_PACKAGE_ID: { fa: "شناسهٔ بستهٔ اعتبار معاملاتی والکس", en: "Wallex credit package ID" }, WALLEX_QUOTE_CURRENCY: { fa: "ارز بازار پایه", en: "Quote and account currency" },
    LIVE_MAX_GROSS_EXPOSURE: { fa: "حداکثر ارزش موقعیت در معاملهٔ واقعی", en: "Live total exposure cap" }, AI_PROVIDER: { fa: "سرویس هوش مصنوعی پیش‌فرض", en: "Default AI provider" }, AI_MODEL: { fa: "مدل پیش‌فرض", en: "Default AI model" },
    AI_API_KEY: { fa: "کلید سرویس هوش مصنوعی پیش‌فرض", en: "Default provider API key" }, AI_BASE_URL: { fa: "نشانی سرویس سازگار با OpenAI", en: "OpenAI-compatible service URL" }, OPENROUTER_BASE_URL: { fa: "نشانی سرویس OpenRouter", en: "OpenRouter service URL" }, BOXAPI_BASE_URL: { fa: "نشانی سرویس BoxAPI", en: "BoxAPI service URL" }, LIARA_BASE_URL: { fa: "نشانی سرویس Liara", en: "Liara service URL" }, LIARA_WORKSPACE_ID: { fa: "شناسه فضای کاری Liara", en: "Liara workspace ID" },
  AI_REQUEST_TIMEOUT_SECONDS: { fa: "مهلت پاسخ مدل (ثانیه)", en: "Model request timeout" }, AI_TOOL_TIMEOUT_SECONDS: { fa: "مهلت اجرای ابزارها (ثانیه)", en: "Tool execution timeout" }, AI_TIMEOUT_RETRIES: { fa: "تلاش دوباره پس از مهلت مدل", en: "Timeout retries" }, AI_PROVIDER_KEYS_JSON: { fa: "کلیدهای سرویس‌های هوش مصنوعی", en: "Model provider keys" }, AI_ROLE_MODELS_JSON: { fa: "مدل جداگانه برای هر دستیار", en: "Model route per agent" }, AI_ROLE_INSTRUCTIONS_JSON: { fa: "راهنمای تکمیلی دستیارها", en: "Additional agent instructions" }, AI_ROLE_MAX_TOOL_STEPS_JSON: { fa: "دفعات بررسی مجاز برای هر دستیار", en: "Agent tool-step limits" }, AI_DISABLED_AGENTS_JSON: { fa: "دستیارهای اختیاری خاموش", en: "Disabled optional agents" },
    ENGINE_STRATEGIES_JSON: { fa: "تعریف استراتژی‌ها", en: "Strategy definitions" }, ENGINE_MAX_DEBATE_ROUNDS: { fa: "دفعات بررسی دیدگاه‌های موافق و مخالف", en: "Bull/bear debate rounds" }, ENGINE_MAX_RISK_DISCUSS_ROUNDS: { fa: "دورهای بررسی ریسک", en: "Risk review rounds" }, MEMORY_HOLDING_PERIOD_BARS: { fa: "بازه ارزیابی دوبارهٔ تصمیم", en: "Memory evaluation horizon" }, MEMORY_BENCHMARK_SYMBOL: { fa: "جفت‌ارز معیار برای مقایسه", en: "Memory benchmark pair" },
    RESEARCH_REDDIT_ENABLED: { fa: "جست‌وجوی عمومی ردیت", en: "Public Reddit discussion" }, RESEARCH_STOCKTWITS_ENABLED: { fa: "پیام‌های عمومی StockTwits", en: "Public StockTwits stream" }, RESEARCH_ENDPOINTS_JSON: { fa: "منابع پژوهشی سفارشی", en: "Custom research sources" }, MARKET_QUOTE_FALLBACKS_JSON: { fa: "منابع جایگزین قیمت بازار", en: "Fallback market-price sources" }, PAPER_INITIAL_CASH: { fa: "سرمایهٔ اولیهٔ مجازی", en: "Starting virtual capital" }, BACKTEST_FEE_BPS: { fa: "کارمزد فرضی آزمایش تاریخی", en: "Backtest fee assumption" }, BACKTEST_SLIPPAGE_BPS: { fa: "اختلاف قیمت فرضی در آزمایش تاریخی", en: "Backtest slippage assumption" },
    RISK_PAIR_LIMITS_JSON: { fa: "محدودیت‌های هر جفت‌ارز", en: "Per-pair limits" }, RISK_MAX_ORDER_NOTIONAL: { fa: "بیشترین ارزش هر سفارش", en: "Per-order value cap" }, RISK_MAX_POSITION_NOTIONAL: { fa: "بیشترین ارزش هر جفت‌ارز در سبد دارایی", en: "Per-position value cap" }, RISK_MAX_GROSS_EXPOSURE: { fa: "سقف مجموع سرمایه درگیر در سبد دارایی", en: "Portfolio gross-exposure cap" }, RISK_MAX_DRAWDOWN_PCT: { fa: "حداکثر افت از اوج سرمایه", en: "Maximum drawdown" }, RISK_MAX_DAILY_LOSS: { fa: "حداکثر زیان روزانه", en: "Maximum daily loss" }, RISK_MAX_DATA_AGE_SECONDS: { fa: "تازگی داده‌های بازار (ثانیه)", en: "Maximum market-data age" }, RISK_FEE_BUFFER_BPS: { fa: "حاشیه احتیاط برای کارمزد", en: "Fee safety buffer" }, RISK_MAX_MARKET_SLIPPAGE_BPS: { fa: "بیشترین اختلاف قیمت مجاز سفارش بازار", en: "Maximum market-order slippage" }, RISK_KILL_SWITCH: { fa: "توقف سفارش‌های جدید", en: "Block new trading" },
  };
  return titles[key]?.[locale] ?? (locale === "fa" ? "تنظیم پیشرفته" : key.replaceAll("_", " ").toLocaleLowerCase("en-US"));
}

const settingHelp: Record<string, { fa: string; en: string }> = {
  LOG_LEVEL: { fa: "میزان جزئیاتی که در گزارش‌های فنی ثبت می‌شود. برای استفاده معمول، مقدار پیش‌فرض مناسب است.", en: "Engine log verbosity: debug, info, warn, or error. The default is info." },
  ENGINE_MODE: { fa: "حالت پیش‌فرض برنامه هنگام اجرا از خط فرمان است. انتخاب «معامله واقعی» به‌تنهایی اجازهٔ ثبت سفارش نمی‌دهد.", en: "Default CLI mode: backtest, shadow, or live. Selecting live here does not by itself enable live trading." },
  WALLEX_BASE_URL: { fa: "نشانی سرویس والکس. اگر تنظیم اختصاصی ندارید، مقدار پیش‌فرض را تغییر ندهید.", en: "HTTPS base URL for Wallex REST. Keep the official default for normal operation." },
  WALLEX_WS_URL: { fa: "نشانی ارتباط زنده والکس برای دریافت قیمت و تغییرات دفتر سفارش. معمولاً نیازی به تغییر آن نیست.", en: "WSS endpoint for Wallex Centrifugo public price and order-book updates." },
  WALLEX_ENABLE_LIVE_TRADING: { fa: "اجازهٔ پایه برای ارسال سفارش واقعی. شروع هر معاملهٔ واقعی همچنان به انتخاب حالت و تأیید جداگانه نیاز دارد.", en: "Engine-side permission for live order writes. It does not replace choosing live mode and explicitly confirming each live start." },
  WALLEX_ENABLE_AUTOTRADING: { fa: "اجازه می‌دهد پس از هر چرخه، ارزیابی معاملهٔ واقعی دوباره انجام شود. فقط اگر اجرای پیوسته می‌خواهید این گزینه را روشن کنید.", en: "Separate permission for repeated live cycles. Enable it only when you want ongoing automated execution." },
  WALLEX_ALLOWED_MARKETS: { fa: "جفت‌ارزهای مجاز را با ویرگول جدا کنید؛ مانند BTCTMN,ETHTMN. هر جفت باید در والکس فعال و برای بسته اعتبار شما قابل معامله باشد.", en: "Comma-separated market symbols, for example BTCTMN,ETHTMN. A market must also be active on Wallex and available in the credit package." },
  WALLEX_PACKAGE_ID: { fa: "شناسه بسته اعتبار معاملاتی والکس؛ برای بررسی بازارهای غیرقابل معامله بسته استفاده می‌شود، نه به‌عنوان شناسه حساب یا کلید API.", en: "Wallex trade-credit package ID used to check unavailable markets. It is not an account ID or API key." },
  WALLEX_QUOTE_CURRENCY: { fa: "ارزی که قیمت جفت‌ارزها و ارزش سبد دارایی با آن نمایش داده می‌شود؛ مثل TMN یا USDT. باید با جفت‌ارزهای انتخاب‌شده هماهنگ باشد.", en: "Portfolio denomination and quote currency, such as TMN or USDT. It must match the selected markets." },
  LIVE_MAX_GROSS_EXPOSURE: { fa: "سقف مجموع ارزش موقعیت‌های باز در معاملهٔ واقعی، برحسب ارز بازار پایه. این سقف اندازهٔ معامله را محدود می‌کند، اما حداکثر زیان را تضمین نمی‌کند.", en: "Hard cap on total live exposure in the quote currency. Use a non-negative amount; live mode requires a value above zero. This is not a guaranteed loss cap." },
  AI_PROVIDER: { fa: "سرویس هوش مصنوعی پیش‌فرض دستیارها. اگر برای دستیاری مدل جداگانه‌ای انتخاب کنید، همان تنظیم به کار می‌رود.", en: "Default model provider: openai, anthropic, google, compatible, boxapi, or liara. A role-specific route takes precedence when configured." },
  AI_MODEL: { fa: "نام دقیق مدل در سرویس انتخاب‌شده؛ این نام باید در حساب شما در دسترس باشد.", en: "Exact model ID on the selected provider. It must be available to your account and service URL." },
  AI_API_KEY: { fa: "کلید دسترسی سرویس هوش مصنوعی پیش‌فرض. پس از ذخیره پنهان می‌شود و امکان بازیابی آن از داشبورد وجود ندارد.", en: "Default AI provider credential. Provider-specific keys can also be configured for role-based model routing." },
  AI_BASE_URL: { fa: "نشانی سرویس هوش مصنوعی سازگار با OpenAI؛ فقط برای همان سرویس استفاده می‌شود. برای سرویس‌های اینترنتی، نشانی HTTPS لازم است.", en: "Base URL for an OpenAI-compatible service. Used only with the compatible provider; HTTPS is required except for localhost during development." },
  BOXAPI_BASE_URL: { fa: "نشانی سرویس BoxAPI. در صورت استفاده از مقدار رسمی، آن را تغییر ندهید.", en: "Base URL for BoxAPI." },
  OPENROUTER_BASE_URL: { fa: "نشانی سرویس OpenRouter. مقدار پیش‌فرض برای سرویس رسمی درست است؛ نام مدل‌ها به شکل vendor/model است.", en: "Base URL for OpenRouter. The default is right for the official service; model IDs use the vendor/model form." },
  LIARA_BASE_URL: { fa: "نشانی سرویس هوش مصنوعی Liara. در صورت استفاده از مقدار پیش‌فرض، آن را تغییر ندهید.", en: "Base URL for Liara." },
  LIARA_WORKSPACE_ID: { fa: "شناسه فضای کاری Liara که مدل‌ها و کلید دسترسی شما به آن تعلق دارند.", en: "Liara workspace ID used by the configured model provider." },
  AI_PROVIDER_KEYS_JSON: { fa: "کلیدهای دسترسی جداگانه برای سرویس‌های هوش مصنوعی. برای ویرایش امن، از بخش کلیدهای دسترسی استفاده کنید.", en: "Provider-specific model API keys. Use the credential editor rather than editing raw JSON." },
  AI_REQUEST_TIMEOUT_SECONDS: { fa: "حداکثر زمان انتظار برای هر درخواست مدل؛ بین ۵ تا ۳۰۰ ثانیه.", en: "Maximum time to wait for each model request. Valid values are 5 through 300 seconds." },
  AI_TOOL_TIMEOUT_SECONDS: { fa: "اجرای هر ابزار در اختیار دستیار، از جمله ابزارهای خواندن بازار، حداکثر تا این زمان ادامه می‌یابد.", en: "Bounds each agent tool call, including external market reads." },
  AI_TIMEOUT_RETRIES: { fa: "اگر یک درخواست مدل در مهلت تعیین‌شده پاسخ ندهد، با مکث کوتاه و حداکثر به این تعداد دوباره اجرا می‌شود؛ بین صفر تا دو بار.", en: "If a model operation times out, retry it with a short backoff. Valid values are 0 through 2." },
  AI_ROLE_MODELS_JSON: { fa: "برای هر دستیار می‌توانید سرویس و مدل جداگانه‌ای انتخاب کنید. از صفحهٔ دستیارها و استراتژی‌ها استفاده کنید؛ ویرایش JSON برای کاربران آشنا با تنظیمات فنی است.", en: "Optional role-to-model routes. Use provider:model values, for example boxapi:gpt-model. Each provider and model ID must be supported." },
  ENGINE_MAX_DEBATE_ROUNDS: { fa: "تعداد نوبت‌هایی که تحلیل‌گر سناریوی صعودی و نزولی دیدگاهشان را بررسی می‌کنند؛ از ۱ تا ۱۰. تعداد بیشتر، درخواست مدل و هزینه را افزایش می‌دهد.", en: "Sequential bull/bear debate cycles; integer from 1 to 10. More rounds increase model calls, latency, and cost." },
  ENGINE_MAX_RISK_DISCUSS_ROUNDS: { fa: "تعداد دورهای بررسی ریسک تهاجمی، محتاط و بی‌طرف؛ عدد صحیح ۱ تا ۱۰.", en: "Rounds of aggressive, conservative, and neutral risk review; integer from 1 to 10." },
  ENGINE_STRATEGIES_JSON: { fa: "فهرستی فنی از استراتژی‌هاست؛ هر مورد شناسه، نام، راهنمای تصمیم، حداقل اطمینان، نوع سفارش مجاز و سقف‌های اختیاری دارد. تغییر آن از ویرایشگر استراتژی‌ها ساده‌تر است.", en: "JSON array of strategy profiles with ID, name, mandate, minimum confidence, allowed order types, and optional caps. Prefer the Agents & strategies editor." },
  MEMORY_HOLDING_PERIOD_BARS: { fa: "مدت انتظار پیش از سنجش نتیجهٔ تصمیم؛ هر بازهٔ کامل یک دقیقه طول می‌کشد. برای نمونه، ۳۰ بازه حدود نیم ساعت است.", en: "Decision-memory outcome horizon in completed one-minute bars; integer from 1 to 100,000. For example, 30 is about 30 minutes." },
  MEMORY_BENCHMARK_SYMBOL: { fa: "جفت‌ارزی که برای مقایسهٔ بازده به‌عنوان معیار استفاده می‌شود. خالی بماند تا BTC با همان ارز پایه انتخاب شود.", en: "Benchmark symbol for memory alpha. Leave blank to infer BTC in the same quote currency." },
  RESEARCH_REDDIT_ENABLED: { fa: "جست‌وجوی عمومی در بحث‌های اخیر انجمن‌های رمزارزی ردیت، بدون نیاز به کلید دسترسی. این نوشته‌ها دیدگاه کاربران‌اند، نه خبر تأییدشده؛ در شبیه‌سازی زنده و معاملهٔ واقعی دریافت می‌شوند و در آزمایش با داده‌های گذشته به کار نمی‌روند.", en: "Search recent public crypto-community discussions on Reddit without an API key. Posts are opinions; fetched only for live simulation and live runs, never historical backtests." },
  RESEARCH_STOCKTWITS_ENABLED: { fa: "دریافت پیام‌های عمومی نماد در StockTwits بدون کلید API. دسترسی به این سرویس ممکن است به شبکه و محدودیت نرخ درخواست وابسته باشد؛ پیش‌فرض خاموش است.", en: "Fetch public symbol-stream messages from StockTwits without an API key. Availability can depend on network access and rate limits; this source is off by default." },
  PAPER_INITIAL_CASH: { fa: "سرمایهٔ مجازی آغاز هر سبد دارایی آزمایشی، برحسب ارز بازار پایه. این مبلغ واقعی نیست و باید مثبت باشد.", en: "Starting virtual cash for a new backtest or shadow portfolio, denominated in the quote currency." },
  BACKTEST_FEE_BPS: { fa: "کارمزد فرضی هر خرید یا فروش در آزمایش تاریخی است. هر ۱۰۰ واحد پایه برابر با ۱٪ است.", en: "Assumed fee per simulated fill side in basis points; 100 bps equals 1%." },
  BACKTEST_SLIPPAGE_BPS: { fa: "اختلاف احتمالی قیمت اجرای سفارش در آزمایش تاریخی. هر ۱۰۰ واحد پایه برابر با ۱٪ است؛ دفتر سفارش گذشته در دسترس نیست.", en: "Assumed simulated price slippage in basis points; 100 bps equals 1%. It does not reconstruct historical order books." },
  RISK_MAX_ORDER_NOTIONAL: { fa: "بیشترین ارزش مجاز برای یک سفارش، برحسب ارز بازار پایه.", en: "Maximum notional value for one proposed order, in the quote currency." },
  RISK_MAX_POSITION_NOTIONAL: { fa: "بیشترین ارزش مجاز موقعیت یک جفت‌ارز پس از اجرای سفارش.", en: "Maximum allowed notional for one market position after the proposed order." },
  RISK_MAX_GROSS_EXPOSURE: { fa: "بیشترین ارزش مجموع موقعیت‌های سبد دارایی برحسب ارز بازار پایه. محدودیت معاملهٔ واقعی یا استراتژی ممکن است این سقف را کمتر کند.", en: "Maximum aggregate marked position exposure in quote currency. Live and strategy-specific caps may tighten it further." },
  RISK_MAX_DRAWDOWN_PCT: { fa: "بیشترین افت مجاز از بالاترین ارزش ثبت‌شدهٔ سبد دارایی. با رسیدن به این حد، سفارش تازه متوقف می‌شود؛ موقعیت باز خودکار فروخته نمی‌شود.", en: "Maximum permitted drawdown from the equity high-water mark, in percent. It blocks new orders; it does not liquidate positions." },
  RISK_MAX_DAILY_LOSS: { fa: "حد زیان روزانه برحسب ارز بازار پایه؛ با رسیدن زیان ثبت‌شده به حد، سفارش جدید رد می‌شود.", en: "Daily loss threshold in quote currency. New orders are rejected once tracked loss reaches the limit." },
  RISK_MAX_DATA_AGE_SECONDS: { fa: "قیمت و اطلاعات دفتر سفارش تا چند ثانیه تازگی دارند که برای تصمیم و سفارش معتبر بمانند.", en: "Maximum age for quote and required order-book depth, in positive integer seconds." },
  RISK_FEE_BUFFER_BPS: { fa: "حاشیه‌ای برای پوشش کارمزد هنگام بررسی کافی‌بودن موجودی خرید. هر ۱۰۰ واحد پایه برابر با ۱٪ است.", en: "Extra fee reserve used when checking available cash for buys, in basis points." },
  RISK_MAX_MARKET_SLIPPAGE_BPS: { fa: "بیشترین اختلاف نامطلوب قیمت سفارش بازار با قیمت دیده‌شده. هر ۱۰۰ واحد پایه برابر با ۱٪ است.", en: "Maximum accepted adverse market-order slippage versus the quote, in basis points." },
  RISK_PAIR_LIMITS_JSON: { fa: "برای هر جفت‌ارز: مقداری از دارایی پایه که هرگز فروخته نمی‌شود، سقف یک فروش (درصد یا مقدار) و بودجهٔ یک خرید. دروازهٔ ریسک این‌ها را قطعی اعمال می‌کند.", en: "Per pair: a base-asset reserve that is never sold, a cap on one sell (percent or quantity), and a budget for one buy. Enforced deterministically by the risk gate." },
  RISK_KILL_SWITCH: { fa: "با روشن‌کردن این گزینه، سفارش‌های تازه متوقف می‌شوند؛ موقعیت‌های باز خودکار بسته نمی‌شوند.", en: "Trading kill switch. When enabled, the engine rejects new orders but does not close existing positions." },
};

function fieldHelp(key: string, group: string, locale: Locale): string {
  const detail = settingHelp[key];
  if (detail) return detail[locale];
  return locale === "fa"
    ? `این گزینه رفتار ${settingsGroupTitle(group, locale)} را تغییر می‌دهد. توضیح این فیلد را بخوانید و اگر با کاربردش آشنا نیستید، مقدار پیش‌فرض را نگه دارید.`
    : `${settingsGroupTitle(group, locale)} engine setting. Use a value matching this field's type and engine schema, then validate the profile before running.`;
}

function diagnosticTitle(name: string, locale: Locale): string {
  if (locale !== "fa") return name;
  const names: Record<string, string> = { Configuration: "پیکربندی", "Mode safety": "آمادگی حالت اجرا", Database: "پایگاه داده", "Wallex read API": "دسترسی خواندنی والکس", "Order write safety": "ایمنی ارسال سفارش" };
  return names[name] ?? "بررسی دیگر";
}

function issueText(message: string, locale: Locale): string {
  if (locale !== "fa") return message;
  const translations: Array<[RegExp, string]> = [
    [/^WALLEX_ENABLE_LIVE_TRADING must be true for live mode\.$/, "برای معامله واقعی، اجازه ارسال سفارش واقعی را در تنظیمات پروفایل فعال کنید."],
    [/^WALLEX_API_KEY is required for live mode\.$/, "کلید دسترسی والکس برای این پروفایل ثبت نشده است. آن را در بخش کلیدهای دسترسی وارد کنید."],
    [/^WALLEX_SUB_ACCOUNT_CLIENT_ID is required for credit-account spot trading\.$/, "شناسهٔ مشتریِ حساب فرعی والکس را در بخش کلیدهای دسترسی وارد کنید."],
    [/^WALLEX_PACKAGE_ID is required to enforce package market restrictions\.$/, "شناسهٔ بستهٔ اعتباری والکس را وارد کنید تا بازارهای مجاز این بسته مشخص شوند."],
    [/^WALLEX_ALLOWED_MARKETS must list approved symbols\.$|^Add approved markets to WALLEX_ALLOWED_MARKETS\.$/, "ابتدا دست‌کم یک جفت‌ارز فعال و مجاز را در صفحه بازارها انتخاب کنید."],
    [/^RISK_KILL_SWITCH is enabled; live execution cannot start\.$/, "توقف سفارش‌های جدید فعال است؛ برای شروع معاملهٔ واقعی ابتدا این محدودیت را در تنظیمات ریسک بررسی کنید."],
    [/^An API key is required for AI provider (.+?) \(AI_PROVIDER_KEYS_JSON or AI_API_KEY\)\.$/, "کلید دسترسی سرویس هوش مصنوعی «$1» در تنظیمات کلیدهای دسترسی ثبت نشده است."],
    [/^AI_BASE_URL is required for an OpenAI-compatible provider\.$/, "برای این سرویس هوش مصنوعی، نشانی اتصال را در تنظیمات وارد کنید."],
    [/^WALLEX_API_KEY is required to refresh challenge package market restrictions\.$/, "برای دریافت محدودیت‌های بسته اعتبار والکس، کلید خواندنی همان حساب را تنظیم کنید."],
    [/^Inactive allowlisted markets: (.+)\.$/, "این جفت‌ارزها در حال حاضر در والکس فعال نیستند: $1"],
    [/^(\d+) active spot markets received\.$/, "$1 بازار فعال نقدی از والکس دریافت شد."],
    [/^Not checked\. Enable the read-only connection check to test Wallex\.$/, "بررسی نشده است. فعال‌کردن گزینه اتصال، فقط فهرست بازارهای والکس را به‌صورت خواندنی دریافت می‌کند."],
    [/^Required providers and safety gates are configured\.$/, "سرویس‌های لازم و محدودیت‌های ایمنی این حالت آماده‌اند."],
    [/^(.+) settings parsed successfully\.$/, "تنظیمات پروفایل و حالت انتخاب‌شده با موفقیت خوانده شدند."],
    [/^SQLite is available and migrations are current\.$/, "پایگاه داده در دسترس است و به‌روز است."],
    [/^Diagnostics never submits or cancels exchange orders\.$/, "بررسی سلامت هیچ سفارش صرافی را ارسال یا لغو نمی‌کند."],
  ];
  for (const [pattern, translated] of translations) if (pattern.test(message)) return message.replace(pattern, translated);
  return "برای ادامه، تنظیمات این اجرا را بررسی کنید. اگر مشکل ادامه داشت، جزئیات فنی را ببینید.";
}

function errorText(message: string, locale: Locale): string {
  if (locale !== "fa") return message;
  if (/[\u0600-\u06ff]/.test(message)) return message;
  const known = issueText(message, locale);
  if (!known.startsWith("برای ادامه، تنظیمات این اجرا")) return known;
  if (/returned no structured result after \d+ model step/i.test(message)) return "یکی از دستیارها پس از استفاده از گام‌های مجاز برای بررسی داده‌ها، جمع‌بندی ساختارمند ارائه نکرد. برای جلوگیری از تصمیم‌گیری با تحلیل ناقص، اجرا متوقف شد؛ جزئیات فنی درخواست را ببینید.";
  if (/wallex returned non-json/i.test(message)) return "پاسخ والکس در قالب قابل‌خواندن دریافت نشد. دوباره تلاش کنید؛ اگر مشکل ادامه داشت، جزئیات فنی را ببینید.";
  if (/all quote providers failed/i.test(message)) return "هیچ‌یک از منابع قیمت پاسخ قابل استفاده‌ای ندادند. اتصال و تنظیمات منبع داده را بررسی کنید.";
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) return "ارتباط با سرویس برقرار نشد. اتصال را بررسی کنید و دوباره تلاش کنید.";
  const status = message.match(/(?:Request failed|HTTP|status)\D{0,8}(\d{3})/i);
  if (status) {
    const statusText: Record<string, string> = {
      "400": "اطلاعات واردشده پذیرفته نشد.", "401": "دسترسی لازم تأیید نشد.", "403": "این عملیات مجاز نیست.",
      "404": "اطلاعات درخواستی پیدا نشد.", "409": "این تغییر با وضعیت فعلی سازگار نیست.",
      "422": "برخی مقدارها معتبر نیستند.", "429": "درخواست‌ها بیش از حد مجاز بوده‌اند.",
      "500": "سرویس هنگام انجام این کار با مشکل روبه‌رو شد.", "502": "سرویس پاسخ معتبری دریافت نکرد.", "503": "سرویس موقتاً در دسترس نیست.",
    };
    if (statusText[status[1]!]) return `${statusText[status[1]!]} دوباره تلاش کنید.`;
  }
  if (/required|invalid|must be|not configured|does not exist/i.test(message)) return "یکی از اطلاعات لازم وارد نشده یا درست نیست. مقدارهای این بخش را بررسی کنید.";
  return "این کار انجام نشد. تنظیم مربوط یا اتصال سرویس را بررسی کنید و دوباره تلاش کنید.";
}

/** Settings that hold an amount in the quote currency and get the formatted money input. */
const amountSettingKeys = new Set(["PAPER_INITIAL_CASH", "LIVE_MAX_GROSS_EXPOSURE", "RISK_MAX_ORDER_NOTIONAL", "RISK_MAX_POSITION_NOTIONAL", "RISK_MAX_GROSS_EXPOSURE", "RISK_MAX_DAILY_LOSS"]);

type NavigateOptions = { group?: string; runId?: string };
type ErrorGuidance = { text: string; hint?: string; target?: { view: string } & NavigateOptions; targetLabel?: string };

/** Explain a service error in plain words and point at the page where it can be fixed. */
function errorGuidance(message: string, locale: Locale): ErrorGuidance[] {
  const fa = locale === "fa";
  const risk = { view: "profiles", group: "Risk" }, wallex = { view: "profiles", group: "Wallex" }, ai = { view: "profiles", group: "AI" }, markets = { view: "markets" }, runLab = { view: "runLab" };
  const labels = {
    risk: fa ? "باز کردن تنظیمات ریسک" : "Open risk settings", wallex: fa ? "باز کردن تنظیمات والکس" : "Open Wallex settings", ai: fa ? "باز کردن تنظیمات هوش مصنوعی" : "Open AI settings",
    credentials: fa ? "باز کردن کلیدهای دسترسی" : "Open credentials", markets: fa ? "باز کردن بازارها" : "Open markets", runLab: fa ? "مشاهدهٔ اجراهای در جریان" : "Show managed runs",
  };
  return message.split("\n").map((line) => line.trim()).filter(Boolean).map((line): ErrorGuidance => {
    const text = errorText(line, locale);
    let match = line.match(/^Live per-run override '([A-Z_]+)' cannot exceed the selected profile's risk limit\.$/);
    if (match) {
      const key = match[1]!, title = settingTitle(key, locale);
      // The live ceiling is a Wallex setting; the other caps live under Risk & safety.
      const liveCap = key === "LIVE_MAX_GROSS_EXPOSURE";
      const groupName = liveCap ? (fa ? "والکس" : "Wallex") : (fa ? "ریسک و ایمنی" : "Risk & safety");
      return { text, target: liveCap ? wallex : risk, targetLabel: liveCap ? labels.wallex : labels.risk, hint: fa
        ? `سقفی که برای این اجرا وارد کرده‌اید از «${title}» در پروفایل بیشتر است. در معاملهٔ واقعی، سقف هر اجرا فقط می‌تواند کمتر از سقف پروفایل باشد: مقدار کمتری وارد کنید، یا «${title}» را در بخش «${groupName}» پروفایل بالاتر ببرید.`
        : `The per-run cap you entered is above the profile's "${title}". In live mode a per-run cap can only tighten the profile limit: enter a smaller value, or raise "${title}" under the profile's ${groupName} settings.` };
    }
    if (/^Live per-run override 'RISK_PAIR_LIMITS_JSON' (cannot loosen|must keep)/.test(line)) return { text, target: risk, targetLabel: labels.risk, hint: fa ? "محدودیت‌های هر جفت‌ارز در اجرای واقعی فقط می‌توانند سخت‌گیرانه‌تر از پروفایل باشند: نگه‌داشت بیشتر، سقف فروش کمتر، بودجهٔ خرید کمتر. مقدار پروفایل را در بخش «ریسک و ایمنی» تغییر دهید." : "Per-pair limits in a live run can only be tighter than the profile's: a larger reserve, a smaller sell cap, a smaller buy budget. Change the profile value under Risk & safety." };
    if (/^Live per-run override '[A-Z_]+' is not permitted/.test(line)) return { text, target: risk, targetLabel: labels.risk, hint: fa ? "در معاملهٔ واقعی فقط می‌توان محدودیت‌های ریسک را سخت‌گیرانه‌تر کرد. سرمایهٔ مجازی، کارمزد و لغزش فقط در آزمایش و شبیه‌سازی معنا دارند." : "Live runs accept only risk-limit overrides. Virtual cash, fee, and slippage apply to backtests and simulations only." };
    if (/^A per-run setting cannot disable the profile kill switch\.$|^RISK_KILL_SWITCH is enabled/.test(line)) return { text, target: risk, targetLabel: labels.risk, hint: fa ? "کلید توقف سفارش‌های جدید در پروفایل روشن است و از فرم اجرا خاموش نمی‌شود. آن را در بخش «ریسک و ایمنی» پروفایل تغییر دهید." : "The profile's kill switch is on and cannot be turned off from the run form. Change it under the profile's Risk & safety settings." };
    match = line.match(/^Markets must be allowlisted in this profile: (.+)\.$/);
    if (match) return { text, target: markets, targetLabel: labels.markets, hint: fa ? `این جفت‌ارزها در فهرست مجاز پروفایل نیستند: ${match[1]}. آن‌ها را در صفحهٔ بازارها اضافه کنید یا جفت دیگری انتخاب کنید.` : `These markets are not on the profile's allowlist: ${match[1]}. Add them on the Markets page or choose an allowed pair.` };
    if (/WALLEX_ALLOWED_MARKETS/.test(line)) return { text, target: markets, targetLabel: labels.markets, hint: fa ? "هنوز جفت‌ارزی برای این پروفایل مجاز نشده است. در صفحهٔ بازارها دست‌کم یک جفت فعال را انتخاب و ذخیره کنید." : "No market is allowed for this profile yet. Select and save at least one active pair on the Markets page." };
    if (/^WALLEX_ENABLE_LIVE_TRADING must be true/.test(line)) return { text, target: wallex, targetLabel: labels.wallex, hint: fa ? "معاملهٔ واقعی برای این پروفایل خاموش است. در تنظیمات والکس گزینهٔ «اجازه ارسال سفارش واقعی» را روشن کنید؛ سپس همین اجرا را دوباره شروع کنید." : "Live trading is off for this profile. Turn on \"Allow real order submission\" under the Wallex settings, then start this run again." };
    if (/^WALLEX_API_KEY|^WALLEX_SUB_ACCOUNT_CLIENT_ID/.test(line)) return { text, target: wallex, targetLabel: labels.credentials, hint: fa ? "اطلاعات دسترسی حساب اعتباری والکس (کلید API و شناسهٔ مشتری) در بخش کلیدهای دسترسی پروفایل ثبت می‌شود." : "The Wallex credit-account credentials (API key and sub-account client ID) are saved in the profile's Credentials section." };
    if (/^WALLEX_PACKAGE_ID/.test(line)) return { text, target: wallex, targetLabel: labels.wallex, hint: fa ? "شناسهٔ بستهٔ اعتباری را در تنظیمات والکس وارد کنید؛ این شناسه از فهرست بسته‌های فعال والکس می‌آید، نه مبلغ وام یا شناسهٔ حساب." : "Enter the credit package ID under the Wallex settings; it comes from Wallex's active packages list, not the loan amount or client ID." };
    if (/^LIVE_MAX_GROSS_EXPOSURE must be greater than zero/.test(line)) return { text, target: wallex, targetLabel: labels.wallex, hint: fa ? "پیش از معاملهٔ واقعی باید سقف ارزش موقعیت‌های باز را تعیین کنید. در تنظیمات والکس مقدار «حداکثر ارزش موقعیت در معاملهٔ واقعی» را بزرگ‌تر از صفر بگذارید." : "Set a live exposure ceiling before trading for real: give \"Live total exposure cap\" a value above zero under the Wallex settings." };
    if (/^An API key is required for AI provider|^AI_BASE_URL is required|^LIARA_WORKSPACE_ID is required/.test(line)) return { text, target: ai, targetLabel: labels.ai, hint: fa ? "سرویس هوش مصنوعی این پروفایل کامل پیکربندی نشده است. کلید، نشانی یا شناسهٔ فضای کاری را در تنظیمات هوش مصنوعی یا کلیدهای دسترسی وارد کنید. راه‌اندازی سریع هم همین‌ها را می‌پرسد." : "The AI provider for this profile is not fully configured. Add the key, service URL, or workspace ID under the AI settings or Credentials; Quick setup asks for the same values." };
    if (/WALLEX_ENABLE_AUTOTRADING/.test(line)) return { text, target: wallex, targetLabel: labels.wallex, hint: fa ? "ادامهٔ خودکار معاملهٔ واقعی به یک مجوز جداگانه نیاز دارد. در تنظیمات والکس «اجازه تکرار خودکار معامله» را روشن کنید." : "Repeated live trading needs its own permission. Turn on \"Allow automated trading\" under the Wallex settings." };
    if (/^Another process currently holds the live-execution lease\.$/.test(line)) return { text, target: runLab, targetLabel: labels.runLab, hint: fa ? "اجرای واقعی یا سایهٔ دیگری در حال کار است. ابتدا آن را از فهرست اجراهای در جریان متوقف کنید." : "Another live or shadow run is active. Stop it from the managed runs list first." };
    if (/^A run matrix is limited to 32/.test(line)) return { text, hint: fa ? "تعداد جفت‌ارزها ضرب در تعداد استراتژی‌ها نباید از ۳۲ بیشتر شود. جفت‌ها یا استراتژی‌های کمتری انتخاب کنید." : "Pairs multiplied by strategies must not exceed 32. Choose fewer pairs or strategies." };
    return { text };
  });
}

function diagnosticDetailText(name: string, status: string, detail: string, locale: Locale): string {
  if (locale !== "fa") return detail;
  if (name === "Mode safety" && status === "fail") return detail.split(/;\s*/).map((issue) => issueText(issue, locale)).join(" · ");
  if (status === "pass" && detail === "Required providers and safety gates are configured.") return "سرویس‌های لازم و محدودیت‌های ایمنی این حالت آماده‌اند.";
  if (status === "pass" && detail === "SQLite is available and migrations are current.") return "ذخیره‌سازی اطلاعات در دسترس و به‌روز است.";
  if (status === "pass" && detail === "Diagnostics never submits or cancels exchange orders.") return "این بررسی هیچ سفارشی را در والکس ثبت یا لغو نمی‌کند.";
  if (status === "skip" && detail.startsWith("Not checked.")) return "این مورد بررسی نشد. برای بررسی اتصال والکس، گزینهٔ مربوط را فعال کنید.";
  if (status === "fail") return errorText(detail, locale);
  if (status === "skip") return "این مورد بررسی نشد.";
  if (status === "pass") return "این بررسی با موفقیت انجام شد.";
  return issueText(detail, locale);
}

function riskReasonText(reason: string, locale: Locale): string {
  if (locale !== "fa") return reason;
  const known: Record<string, string> = {
    "Portfolio manager returned HOLD; no order is eligible.": "مدیر سبد دارایی پیشنهاد «فعلاً معامله نکن» داد؛ سفارشی برای اجرا تأیید نشد.",
    "No order was proposed.": "هیچ سفارشی پیشنهاد نشد.",
    "Kill switch is enabled.": "ارسال سفارش‌های جدید فعلاً متوقف است.",
    "Market is not allowlisted.": "این جفت‌ارز در فهرست مجاز پروفایل نیست.",
    "Market data is stale.": "داده بازار قدیمی است و برای سفارش‌گذاری پذیرفته نمی‌شود.",
  };
  if (known[reason]) return known[reason]!;
  const minimumConfidence = reason.match(/^Proposal confidence ([\d.]+) is below the (.+) minimum of ([\d.]+)\.$/);
  if (minimumConfidence) return `اطمینان پیشنهاد (${Math.round(Number(minimumConfidence[1]) * 100)}٪) از حداقل لازم برای «${minimumConfidence[2]}» (${Math.round(Number(minimumConfidence[3]) * 100)}٪) کمتر بود.`;
  const reserved = reason.match(/^Sell would leave less than the reserved ([\d.]+) (\S+) holding for (\S+)\.$/);
  if (reserved) return `این فروش دارایی ${reserved[2]} را به کمتر از مقدار نگه‌داشت‌شده (${reserved[1]}) می‌رساند؛ سفارش رد شد.`;
  const sellCap = reason.match(/^Sell quantity exceeds the per-cycle sell limit for (\S+) \(([\d.]+) (\S+)\)\.$/);
  if (sellCap) return `مقدار فروش از سقف فروش هر چرخه برای ${sellCap[1]} (${sellCap[2]} ${sellCap[3]}) بیشتر است.`;
  const buyBudget = reason.match(/^Buy value exceeds the per-pair buy budget for (\S+) \(([\d.]+) (\S+)\)\.$/);
  if (buyBudget) return `ارزش خرید از بودجهٔ خرید این جفت‌ارز (${buyBudget[2]} ${buyBudget[3]}) بیشتر است.`;
  if (/insufficient.*balance|insufficient.*fund/i.test(reason)) return "موجودی کافی برای این سفارش در حساب پیدا نشد.";
  if (/spread|slippage/i.test(reason)) return "فاصلهٔ قیمت خرید و فروش یا اختلاف قیمت هنگام سفارش از حد مجاز بیشتر بود.";
  if (/stale|expired|age/i.test(reason)) return "قیمت یا اطلاعات بازار به‌اندازهٔ کافی تازه نبود.";
  return "این پیشنهاد با محدودیت‌های ریسک سازگار نبود.";
}

function strategyIdTitle(id: string, locale: Locale): string {
  if (locale !== "fa") return id;
  const labels: Record<string, string> = { "agentic-balanced": "تحلیل متعادل", momentum: "پیروی از روند", "mean-reversion": "بازگشت قیمت به میانگین", "capital-preservation": "اولویت حفظ سرمایه" };
  return labels[id] ?? "استراتژی سفارشی";
}

function strategyTitle(strategy: Strategy, locale: Locale): string {
  if (locale !== "fa") return strategy.name;
  const defaultNames: Record<string, string> = {
    "agentic-balanced": "Agentic balanced", momentum: "Momentum", "mean-reversion": "Mean reversion", "capital-preservation": "Capital preservation",
  };
  if (defaultNames[strategy.id] && strategy.name !== defaultNames[strategy.id]) return strategy.name;
  const titles: Record<string, string> = {
    "agentic-balanced": "تحلیل متعادل", momentum: "پیروی از روند", "mean-reversion": "بازگشت قیمت به میانگین", "capital-preservation": "اولویت حفظ سرمایه",
  };
  return titles[strategy.id] ?? strategy.name;
}

function failureTitle(name: string | null | undefined, locale: Locale, message?: string | null): string {
  if (locale !== "fa") return name || "Run error";
  if (message && /all quote providers failed/i.test(message)) return "دریافت اطلاعات قیمت ناموفق بود";
  const labels: Record<string, string> = {
    AggregateError: "چند بخش اجرا با مشکل روبه‌رو شد",
    TimeoutError: "پاسخی در زمان مقرر دریافت نشد",
    AbortError: "اجرا پیش از پایان متوقف شد",
    TypeError: "داده با قالب مورد انتظار سازگار نبود",
    Error: "خطای اجرا",
  };
  return name ? labels[name] ?? "موتور اجرا با مشکل روبه‌رو شد" : "خطای اجرا";
}
function strategyHelp(strategy: Strategy, locale: Locale): string {
  const limits = [strategy.maxOrderNotional && `${locale === "fa" ? "سقف سفارش" : "order cap"}: ${strategy.maxOrderNotional}`, strategy.maxPositionNotional && `${locale === "fa" ? "سقف موقعیت" : "position cap"}: ${strategy.maxPositionNotional}`, strategy.maxGrossExposure && `${locale === "fa" ? "سقف کل" : "gross cap"}: ${strategy.maxGrossExposure}`].filter(Boolean).join(" · ");
  const confidence = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 0 }).format(strategy.minConfidence * 100);
  const allowedOrders = strategy.allowedOrderTypes.map((type) => orderValueTitle(type, locale)).join(locale === "fa" ? "، " : ", ");
  const rules = `${locale === "fa" ? "حداقل اطمینان" : "Minimum confidence"}: ${confidence}% · ${locale === "fa" ? "سفارش مجاز" : "Allowed orders"}: ${allowedOrders}${limits ? ` · ${limits}` : ""}`;
  if (locale === "fa") {
    const builtIn: Record<string, string> = {
      "agentic-balanced": "قیمت، خبر و دیدگاه بازار را کنار هم می‌گذارد و ریسک را می‌سنجد. اگر شواهد کافی یا هم‌جهت نباشند، پیشنهاد می‌کند فعلاً معامله‌ای انجام نشود.",
      momentum: "به حرکت پیوستهٔ قیمت و تأیید آن با حجم توجه می‌کند. پس از رشد یا افت شدید برای ورود عجله نمی‌کند و بدون تأیید روند معامله‌ای پیشنهاد نمی‌دهد.",
      "mean-reversion": "به‌دنبال حرکت‌های تند و نشانه‌های بازگشت قیمت است. فقط سفارش محدود پیشنهاد می‌دهد؛ یک نشانه به‌تنهایی برای تأیید بازگشت کافی نیست.",
      "capital-preservation": "حفظ سرمایه را در اولویت می‌گذارد و فقط با شواهد قوی و هم‌جهت پیشنهاد می‌دهد. در صورت ابهام معامله نمی‌کند و فقط سفارش محدود می‌پذیرد.",
    };
    return `${builtIn[strategy.id] ?? strategy.mandate} ${rules}. این تنظیم شیوهٔ پیشنهاد را مشخص می‌کند و سود را تضمین نمی‌کند.`;
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
    { value: "backtest", label: copy[locale].backtest, detail: locale === "fa" ? "داده‌های گذشته · سرمایهٔ مجازی" : "Historical candles · virtual portfolio" },
    { value: "shadow", label: copy[locale].shadow, detail: locale === "fa" ? "داده زنده · بدون سفارش واقعی" : "Live data · no real orders" },
    { value: "live", label: copy[locale].live, detail: locale === "fa" ? "سفارش واقعی والکس" : "Real Wallex orders" },
  ];
}
function modeHelp(mode: "backtest" | "shadow" | "live", locale: Locale) {
  const details: Record<typeof mode, { fa: string; en: string }> = {
    backtest: { fa: "عملکرد استراتژی را با داده‌های گذشتهٔ والکس می‌سنجد. هر تصمیم فقط بر پایهٔ اطلاعات همان زمان گرفته می‌شود و سفارش فرضی زودتر از آغاز بازهٔ یک‌دقیقه‌ای بعدی انجام نمی‌شود.", en: "Replays completed historical Wallex candles. Decisions only see data available at that point; simulated fills occur no earlier than the next candle, with explicit fee and slippage assumptions." },
    shadow: { fa: "قیمت زنده را می‌خواند، اما دارایی مجازی را به کار می‌برد. هیچ سفارش واقعی به والکس نمی‌فرستد و موجودی حساب را تغییر نمی‌دهد.", en: "Uses live prices with an isolated virtual portfolio. Orders are hypothetical; Wallex order submission and cancellation are unavailable in this mode." },
    live: { fa: "به حساب واقعی والکس وصل می‌شود. پس از تأیید شروع، هر پیشنهاد باید از بررسی موجودی و محدودیت‌های ریسک بگذرد. در صورت روشن‌کردن تکرار خودکار، چرخه‌ها ادامه پیدا می‌کنند.", en: "Connects to the real Wallex credit account. Orders require explicit start confirmation, deterministic risk checks, and account reconciliation. Autonomous cycles need separate enablement." },
  };
  return details[mode][locale];
}
function money(value?: string | number, currency = "TMN", locale: Locale = "fa") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 2 }).format(number)} ${currency}`;
}
function numberLabel(value: number | string, locale: Locale) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(number) : String(value);
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
    completed: { fa: "انجام شد", en: "Completed" }, failed: { fa: "ناموفق", en: "Failed" }, rejected: { fa: "رد شد", en: "Rejected" },
    blocked: { fa: "مجاز نشد", en: "Blocked" }, running: { fa: "در حال اجرا", en: "Running" }, starting: { fa: "در حال آماده‌سازی", en: "Starting" },
    waiting: { fa: "در انتظار نوبت بعد", en: "Waiting" }, stopping: { fa: "در حال توقف", en: "Stopping" }, stopped: { fa: "متوقف شد", en: "Stopped" },
    pending: { fa: "در صف", en: "Pending" }, submitted: { fa: "ارسال‌شده", en: "Submitted" }, pass: { fa: "مجاز", en: "Passed" },
    new: { fa: "جدید", en: "New" }, open: { fa: "باز", en: "Open" }, partially_filled: { fa: "بخشی از سفارش انجام شد", en: "Partially filled" },
    filled: { fa: "انجام شد", en: "Filled" }, canceled: { fa: "لغو شد", en: "Canceled" }, cancelled: { fa: "لغو شد", en: "Canceled" },
    reconciling: { fa: "در حال به‌روزرسانی وضعیت از والکس", en: "Reconciling" }, cancel_pending: { fa: "در انتظار لغو", en: "Cancellation pending" },
    accepted: { fa: "تأیید شد", en: "Accepted" }, resolved: { fa: "رسیدگی شد", en: "Resolved" }, settled: { fa: "نهایی شد", en: "Settled" },
    warning: { fa: "هشدار", en: "Warning" }, unknown: { fa: "نامشخص", en: "Unknown" },
    fail: { fa: "نیازمند رسیدگی", en: "Needs attention" }, skip: { fa: "بررسی نشده", en: "Not checked" },
  };
  const key = value.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  return labels[key]?.[locale] ?? (locale === "fa" ? "نیازمند بررسی" : value.replaceAll("_", " "));
}
function modeTitle(mode: string, locale: Locale) { return copy[locale][mode] ?? (locale === "fa" ? "حالت دیگر" : mode); }

function managedRunMessage(message: string, state: string, mode: string, locale: Locale): string {
  if (locale !== "fa") return message;
  if (/[\u0600-\u06ff]/.test(message)) return message;
  const count = new Intl.NumberFormat("fa-IR");
  const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^Validating the selected profile and run settings\.$/, () => "در حال بررسی پروفایل و تنظیمات اجرا."],
    [/^Recovering checkpoint for (.+)\.$/, (m) => `در حال بازیابی اجرای نیمه‌تمام ${m[1]}.`],
    [/^Stop requested; completing the current safe operation\.$/, () => "درخواست توقف ثبت شد؛ مرحلهٔ جاری با ایمنی کامل می‌شود."],
    [/^Stopped safely\. Backtest checkpoints are available for recovery\.$/, () => "اجرا با ایمنی متوقف شد؛ امکان ادامه از آخرین نقطهٔ ذخیره‌شده وجود دارد."],
    [/^Run failed; inspect the audit and diagnostics for details\.$/, () => "اجرا ناموفق بود؛ برای دیدن دلیل، گزارش اجرا را باز کنید."],
    [/^Live run is preparing its pre-trade checks\.$/, () => "در حال بررسی شرایط پیش از معاملهٔ واقعی."],
    [/^Running (backtest|shadow|live) for (.+)\.$/, (m) => `در حال اجرای ${modeTitle(m[1]!, locale)} برای ${m[2]}.`],
    [/^Completed (\d+) of (\d+) backtest cases\.$/, (m) => `${count.format(Number(m[1]))} مورد از ${count.format(Number(m[2]))} آزمایش تاریخی انجام شد.`],
    [/^(\d+) backtest case\(s\) completed\.$/, (m) => `${count.format(Number(m[1]))} آزمایش تاریخی انجام شد.`],
    [/^Stopped safely; the most recent completed bar is checkpointed for recovery\.$/, () => "اجرا با ایمنی متوقف شد؛ امکان ادامه از آخرین بازهٔ کامل‌شده وجود دارد."],
    [/^Completed (\d+) of (\d+) shadow cycle\(s\)\.$/, (m) => `${count.format(Number(m[1]))} چرخه از ${count.format(Number(m[2]))} چرخهٔ شبیه‌سازی انجام شد.`],
    [/^Cycle complete\. Next cycle in (\d+) seconds\.$/, (m) => `این چرخه تمام شد؛ شبیه‌سازی ${count.format(Number(m[1]))} ثانیهٔ دیگر دوباره اجرا می‌شود.`],
    [/^Live cycle complete\. Next evaluation in (\d+) seconds\.$/, (m) => `این چرخه تمام شد؛ ارزیابی بعدی ${count.format(Number(m[1]))} ثانیهٔ دیگر انجام می‌شود.`],
  ];
  for (const [pattern, render] of patterns) { const match = message.match(pattern); if (match) return render(match); }
  if (message === "Shadow run completed successfully.") return "شبیه‌سازی با موفقیت پایان یافت.";
  if (message === "Live cycle completed; no further order is submitted unless the next risk-gated proposal passes.") return "این چرخه تمام شد. در چرخهٔ بعد، فقط پیشنهادی که بررسی ریسک را بگذراند قابل ارسال است.";
  if (message === "Run completed successfully.") return "اجرا با موفقیت پایان یافت.";
  if (state === "failed") return "اجرا ناموفق بود؛ برای دیدن دلیل، گزارش اجرا را باز کنید.";
  if (state === "waiting") return "این چرخه تمام شد؛ در انتظار ارزیابی بعدی.";
  if (state === "starting") return "در حال آماده‌سازی اجرا.";
  if (state === "running") return `در حال اجرای ${modeTitle(mode, locale)}.`;
  return "وضعیت اجرا به‌روزرسانی شد.";
}
function reportAssumptionText(value: string, locale: Locale): string {
  if (locale !== "fa") return value;
  const translations: Record<string, string> = {
    "Live Wallex market data; no order-write adapter is constructed in shadow mode.": "داده‌های بازار والکس زنده هستند؛ در حالت شبیه‌سازی زنده امکان ارسال سفارش وجود ندارد.",
    "Virtual portfolio is isolated from the exchange wallet.": "سبد دارایی مجازی از کیف پول صرافی جداست و موجودی واقعی را تغییر نمی‌دهد.",
    "Paper fills are estimates from the visible depth snapshot; configured slippage and fees are applied.": "مقدار قابل‌انجام سفارش شبیه‌سازی‌شده از روی عمق قابل‌مشاهدهٔ بازار برآورد می‌شود و کارمزد و اختلاف قیمت تنظیم‌شده در محاسبه می‌آیند.",
    "Paper fills walk the same fresh visible book checked by the shadow risk gate; configured slippage and fees are applied.": "سفارش شبیه‌سازی‌شده بر اساس همان دفتر سفارش تازه‌ای برآورد می‌شود که در بررسی ریسک دیده شده است؛ کارمزد و اختلاف قیمت تنظیم‌شده هم محاسبه می‌شوند.",
    "Shadow fills do not model queue priority, exchange latency, hidden liquidity, actual order acceptance, or market impact beyond configured slippage; shadow results do not guarantee live execution or returns.": "این شبیه‌سازی جایگاه سفارش در صف، تأخیر صرافی، نقدینگی پنهان، پذیرش واقعی سفارش یا اثر بازار فراتر از اختلاف قیمت تنظیم‌شده را در نظر نمی‌گیرد؛ بنابراین نتیجه آن اجرای سفارش یا سود در بازار واقعی را تضمین نمی‌کند.",
    "Market decisions use completed Wallex 1-minute bars only.": "تصمیم‌های بازار فقط بر پایهٔ بازه‌های یک‌دقیقه‌ای کامل‌شدهٔ والکس گرفته می‌شوند.",
    "External news, sentiment, tokenomics, and on-chain feeds are not replayed historically because current feeds would introduce lookahead bias.": "خبرها، جو بازار، وضعیت پروژهٔ رمزارز و داده‌های درون‌زنجیره‌ای در گذشته بازپخش نمی‌شوند؛ چون استفاده از اطلاعات امروز در تحلیل گذشته نتیجه را گمراه‌کننده می‌کند.",
    "Simulated fills occur at the next bar open at earliest.": "سفارش فرضی زودتر از آغاز بازهٔ یک‌دقیقه‌ای بعدی انجام‌شده فرض نمی‌شود.",
    "Historical candles do not reproduce historical order-book depth or queue position.": "داده‌های تاریخی، عمق سفارش‌های بازار و جایگاه سفارش در صف را نشان نمی‌دهند.",
    "Wallex credit-account spot execution.": "سفارش واقعی در بازار نقدی حساب اعتباری والکس ثبت می‌شود.",
    "Sub-account-specific API key and sub-account-client-id are required.": "برای این حساب، کلید دسترسی و شناسهٔ مشتریِ حساب فرعی لازم است.",
    "The exchange order and fill records are authoritative.": "وضعیت نهایی سفارش و مقدار انجام‌شده بر اساس سوابق والکس تعیین می‌شود.",
    "Wallex historical OHLCV; completed-bar decisions; next-bar-open fills": "دادهٔ تاریخی والکس شامل قیمت آغاز، بیشینه، کمینه، پایانی و حجم است؛ تصمیم پس از کامل‌شدن هر بازه گرفته می‌شود و سفارش از بازهٔ بعدی شبیه‌سازی می‌شود.",
  };
  if (translations[value]) return translations[value]!;
  if (value.startsWith("Live Wallex market data;")) return "داده‌های بازار والکس زنده هستند؛ در حالت شبیه‌سازی، ارسال سفارش واقعی در دسترس نیست.";
  if (value.startsWith("Virtual portfolio is isolated")) return "سبد دارایی مجازی مستقل از کیف پول صرافی است و موجودی واقعی را تغییر نمی‌دهد.";
  const fee = value.match(/^Fee: ([\d.]+) bps; slippage: ([\d.]+) bps\.$/);
  if (fee) return `کارمزد فرضی: ${fee[1]} واحد پایه؛ اختلاف احتمالی قیمت هنگام سفارش: ${fee[2]} واحد پایه (هر ۱۰۰ واحد پایه برابر ۱٪ است).`;
  return "این فرض فنی در جزئیات کامل اجرا ثبت شده است.";
}
function operationTitle(operation: string, locale: Locale) {
  const labels: Record<string, { fa: string; en: string }> = {
    analyze: { fa: "تحلیل", en: "Analysis" }, propose: { fa: "پیشنهاد", en: "Proposal" },
    reflect: { fa: "مرور نتیجه", en: "Reflection" }, tool: { fa: "ابزار پژوهش", en: "Research tool" },
  };
  return labels[operation.toLowerCase()]?.[locale] ?? (locale === "fa" ? "عملیات دیگر" : operation.replaceAll("_", " "));
}
function orderValueTitle(value: string, locale: Locale) {
  const normalized = value.toUpperCase();
  const labels: Record<string, { fa: string; en: string }> = {
    BUY: { fa: "خرید", en: "Buy" }, SELL: { fa: "فروش", en: "Sell" }, MARKET: { fa: "سفارش فوری با قیمت بازار", en: "Market order" }, LIMIT: { fa: "سفارش با قیمت تعیین‌شده", en: "Limit order" },
  };
  return labels[normalized]?.[locale] ?? (locale === "fa" ? "نوع دیگر" : value);
}
function actionTitle(value: string, locale: Locale) {
  const labels: Record<string, { fa: string; en: string }> = {
    BUY: { fa: "خرید", en: "Buy" }, SELL: { fa: "فروش", en: "Sell" }, HOLD: { fa: "فعلاً معامله نکن", en: "Hold" },
  };
  return labels[value.toUpperCase()]?.[locale] ?? value;
}
function liveConfirmationPhrase(locale: Locale) { return locale === "fa" ? "شروع معامله واقعی" : "LIVE"; }
function cancelConfirmationPhrase(locale: Locale) { return locale === "fa" ? "لغو سفارش واقعی" : "CANCEL"; }
function auditCategoryTitle(category: string, locale: Locale) {
  const role = agentTitle(category, locale);
  if (role !== category) return role;
  const labels: Record<string, { fa: string; en: string }> = {
    market_data: { fa: "اطلاعات بازار", en: "Market data" }, market_quote: { fa: "قیمت بازار", en: "Market quote" }, candles: { fa: "نمودار قیمت", en: "Price candles" },
    news: { fa: "خبر", en: "News" }, sentiment: { fa: "دیدگاه کاربران", en: "Market sentiment" },
    tokenomics: { fa: "عرضه و اقتصاد رمزارز", en: "Tokenomics" }, on_chain: { fa: "داده‌های شبکه و صرافی‌های غیرمتمرکز", en: "On-chain and DEX data" },
    research_coverage: { fa: "وضعیت پوشش منابع پژوهش", en: "Research source coverage" }, provider_warning: { fa: "هشدار منبع داده", en: "Data source warning" },
    fundamentals: { fa: "عرضه و اقتصاد رمزارز", en: "Tokenomics" }, technical: { fa: "تحلیل نمودار و شاخص‌ها", en: "Technical analysis" },
  };
  return labels[category.toLowerCase()]?.[locale] ?? (locale === "fa" ? "دادهٔ دیگر" : category.replaceAll("_", " "));
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
function snapshotSourceHref(payload: unknown): string | undefined {
  const value = object(payload).sourceUrl;
  if (typeof value !== "string") return undefined;
  try { const url = new URL(value); return url.protocol === "https:" ? url.toString() : undefined; }
  catch { return undefined; }
}

type ToastAction = { label: string; onClick: () => void };
function useToast() {
  const [toast, setToast] = useState<{ message: string; action?: ToastAction } | null>(null);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), toast.action ? 9_000 : 4_500); return () => clearTimeout(id); }, [toast]);
  const notify = (message: string, action?: ToastAction) => setToast(message ? { message, ...(action ? { action } : {}) } : null);
  return { toast, notify };
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section>; }
function PageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{description && <p className="muted intro">{description}</p>}</div>{action}</div>;
}
function Empty({ text }: { text: string }) { return <div className="empty"><span className="empty-mark"><FileClock size={20} /></span><p>{text}</p></div>; }
function InlineError({ message, locale, text }: { message: string; locale: Locale; text: string }) {
  return <div className="inline-error" role="alert"><p className="error-text">{text}</p><details><summary>{locale === "fa" ? "جزئیات فنی" : "Technical details"}</summary><pre dir="auto">{message}</pre></details></div>;
}
function Metric({ label, value, note, icon: Icon, tone = "plain" }: { label: ReactNode; value: string; note?: string; icon: typeof Activity; tone?: "plain" | "up" | "down" }) {
  return <Card className="metric-card"><div className="metric-head"><p className="metric-label">{label}</p><span className={`metric-icon ${tone}`}><Icon size={17} /></span></div><strong className={tone}>{value}</strong>{note && <small>{note}</small>}</Card>;
}
function EquityChart({ points, label, locale }: { points: Array<{ timestamp?: number; equity?: string | number }>; label: string; locale: Locale }) {
  const values = points.map((point) => Number(point.equity)).filter(Number.isFinite);
  if (values.length < 2) return <div className="chart-empty"><BarChart3 size={22} /><span>{label}</span></div>;
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const coords = values.map((value, index) => `${(index / (values.length - 1)) * 100},${92 - ((value - min) / range) * 84}`).join(" ");
  const first = values[0]!, last = values.at(-1)!;
  if (max - min <= Math.max(0.000001, Math.abs(first) * 0.000001)) return <div className="chart-empty"><BarChart3 size={22} /><span>{label}</span><small>{locale === "fa" ? "ارزش سبد دارایی در این اجرا هنوز تغییر معناداری نکرده است." : "Equity has not changed materially in this run yet."}</small></div>;
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
        source.onerror = () => {
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
        if (!cancelled) reconnectTimer = setTimeout(() => void connect(true), 1500);
      }
    };
    void connect();
    return () => { cancelled = true; if (reconnectTimer) clearTimeout(reconnectTimer); source?.close(); };
  }, [profileId, queryClient, selectedProfileId]);

  const activateMutation = useMutation({
    mutationFn: (id: string) => api(`/api/profiles/${encodeURIComponent(id)}/activate`, { method: "POST", body: "{}" }),
    onSuccess: (_result, id) => { setSelectedProfileId(id); void queryClient.invalidateQueries(); notify(locale === "fa" ? "پروفایل فعال شد." : "Profile activated."); },
    onError: (error) => notify(errorText(error.message, locale)),
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
  // Cross-page guidance: error hints open the settings group that fixes them, and a started run opens its report.
  const [profilesGroup, setProfilesGroup] = useState("");
  const [focusRunId, setFocusRunId] = useState("");
  const navigate = (target: string, options?: NavigateOptions) => {
    if (options?.group) setProfilesGroup(options.group);
    if (options?.runId) setFocusRunId(options.runId);
    if (target === "strategies") setStrategySection("strategies");
    setView(target);
  };
  // First run: open the quick-setup wizard until the profile has an AI key and at least one allowed market, unless the user skipped it.
  const needsSetup = setupNeeded(bootstrap?.config);
  const [autoRouted, setAutoRouted] = useState(false);
  useEffect(() => {
    if (!bootstrap || !profileId || autoRouted) return;
    setAutoRouted(true);
    let dismissed = false;
    try { dismissed = Boolean(localStorage.getItem(`trex-setup-dismissed:${profileId}`)); } catch { /* storage unavailable */ }
    if (needsSetup && !dismissed) setView("setup");
  }, [bootstrap, profileId, needsSetup, autoRouted]);

  if (bootQuery.isPending) return <div className="boot-screen"><span className="brand-mark"><Activity size={21} /></span><LoaderCircle className="spin" size={20} /><p>{locale === "fa" ? "در حال آماده‌سازی فضای اپراتور…" : "Preparing operator workspace…"}</p></div>;
  if (bootQuery.isError || !bootstrap) return <div className="boot-screen"><AlertTriangle size={28} /><h1>{locale === "fa" ? "اتصال به داشبورد برقرار نشد" : "Dashboard service unavailable"}</h1><p>{bootQuery.error ? errorText(bootQuery.error.message, locale) : (locale === "fa" ? "سرویس پاسخ نداد. دوباره تلاش کنید." : "The service did not respond. Try again.")}</p><button className="button primary" onClick={() => void bootQuery.refetch()}><RefreshCw size={16} />{t.refresh}</button></div>;

  const renderView = () => {
    if (view === "setup") return <SetupWizard locale={locale} profileId={profileId} profileName={profile?.name ?? ""} fields={bootstrap.fields} secrets={profile?.secrets ?? {}} helpers={{ errorText, issueText, diagnosticTitle, diagnosticDetailText, statusTitle }} notify={notify} onRefresh={refresh}
      teamStep={<StrategiesView embedded t={t} locale={locale} profileId={profileId} config={bootstrap.config} fields={bootstrap.fields} strategies={bootstrap.strategies} section={strategySection} onSectionChange={setStrategySection} notify={notify} onRefresh={refresh} />}
      onFinish={() => setView("runLab")} onDismiss={() => { try { localStorage.setItem(`trex-setup-dismissed:${profileId}`, String(Date.now())); } catch { /* storage unavailable */ } setView("overview"); }} />;
    if (view === "overview") return <OverviewView t={t} locale={locale} config={bootstrap.config} runs={runs} managedRuns={managedRuns} latestReport={latestReport} assetIcons={assetIconsQuery.data ?? {}} onNavigate={navigate} />;
    if (view === "runLab") return <RunLabView t={t} locale={locale} profileId={profileId} profiles={bootstrap.profiles} config={bootstrap.config} strategies={bootstrap.strategies} runs={runs} managedRuns={managedRuns} assetIcons={assetIconsQuery.data ?? {}} notify={notify} onRefresh={refresh} onNavigate={navigate} />;
    if (view === "profiles") return <ProfilesView t={t} locale={locale} profile={profile} profiles={bootstrap.profiles} profileId={profileId} fields={bootstrap.fields} initialGroup={profilesGroup} encryptionConfigured={Boolean((bootstrap as JsonMap).encryptionKeyConfigured)} encryptionKeySource={String((bootstrap as JsonMap).encryptionKeySource ?? "")} encryptionKeyPath={typeof (bootstrap as JsonMap).encryptionKeyPath === "string" ? String((bootstrap as JsonMap).encryptionKeyPath) : ""} onSelect={setSelectedProfileId} onNavigate={(target) => { if (target === "strategies") setStrategySection("strategies"); setView(target); }} notify={notify} onRefresh={refresh} />;
    if (view === "strategies") return <StrategiesView t={t} locale={locale} profileId={profileId} config={bootstrap.config} fields={bootstrap.fields} strategies={bootstrap.strategies} section={strategySection} onSectionChange={setStrategySection} notify={notify} onRefresh={refresh} />;
    if (view === "markets") return <MarketsView t={t} locale={locale} profileId={profileId} configured={bootstrap.config?.wallex?.allowedMarkets ?? []} notify={notify} onRefresh={refresh} />;
    if (view === "reports") return <ReportsView t={t} locale={locale} runs={runs} managedRuns={managedRuns} notify={notify} focusRunId={focusRunId} />;
    if (view === "orders") return <OrdersView t={t} locale={locale} notify={notify} />;
    return <SystemView t={t} locale={locale} profileId={profileId} profiles={bootstrap.profiles} config={bootstrap.config} fields={bootstrap.fields} database={bootstrap.database} notify={notify} onRefresh={refresh} />;
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Activity size={19} /></span><span><strong>Trex</strong><small>TRADING SYSTEM</small></span></div>
      <div className="side-label">{locale === "fa" ? "میز کار" : "WORKSPACE"}</div>
      <nav aria-label={locale === "fa" ? "ناوبری اصلی" : "Primary navigation"}>
        {nav.map(([id, Icon]) => <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => { if (id === "strategies") setStrategySection("agents"); setView(id); }} aria-current={view === id ? "page" : undefined}>
          <Icon size={17} strokeWidth={1.8} /><span>{t[id]}</span>{id === "runLab" && managedRuns.some((run) => ["running", "waiting", "starting"].includes(run.state)) && <i className="live-dot" />}{id === "setup" && needsSetup && <i className="live-dot attention" />}
        </button>)}
      </nav>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumbs"><span>{t.operator}</span><span className="crumb-separator">/</span><strong>{navTitle}</strong></div>
        <div className="top-actions">
          <div className="profile-select"><span>{t.activeProfile}</span><AppSelect ariaLabel={t.activeProfile} value={profileId} locale={locale} onValueChange={(id) => activateMutation.mutate(id)} options={bootstrap.profiles.map((item) => ({ value: item.id, label: item.name, ...(item.active ? { detail: locale === "fa" ? "پروفایل فعال" : "Active profile" } : {}) }))}/></div>
          <button className="icon-button language-toggle" onClick={() => setLocale(locale === "fa" ? "en" : "fa")} aria-label={locale === "fa" ? "تغییر زبان به انگلیسی" : "تغییر زبان به فارسی"}><Globe2 size={17} /><span>{locale === "fa" ? "EN" : "فا"}</span></button>
          <button className="icon-button" onClick={refresh} aria-label={t.refresh}><RefreshCw size={16} /></button>
        </div>
      </header>
      <main className="page-content" id="main-content">{renderView()}</main>
    </div>
    {toast && <div className="toast" role="status"><span><Check size={16} /></span>{toast.message}{toast.action && <button type="button" className="toast-action" onClick={() => { toast.action?.onClick(); notify(""); }}>{toast.action.label}</button>}<button onClick={() => notify("")} aria-label={locale === "fa" ? "بستن پیام" : "Dismiss message"}><X size={15} /></button></div>}
  </div>;
}

function OverviewView({ t, locale, config, runs, managedRuns, latestReport, assetIcons, onNavigate }: { t: Record<string, string>; locale: Locale; config: JsonMap; runs: Run[]; managedRuns: ManagedRun[]; latestReport: JsonMap; assetIcons: Record<string, string>; onNavigate: (view: string, options?: NavigateOptions) => void }) {
  const hasVirtual = runs.some((run) => ["shadow", "backtest"].includes(run.mode));
  const portfolio = object(latestReport);
  // Real balances load automatically once the Wallex credit-account credentials exist; the request is read-only.
  const credentialsReady = Boolean(config.wallex?.apiKeyConfigured && config.wallex?.subAccountConfigured);
  const actualQuery = useQuery({ queryKey: ["account-balance"], queryFn: () => api<{ portfolio: JsonMap; observedAt: number; label: string }>("/api/account"), enabled: credentialsReady, retry: false, staleTime: 60_000 });
  const alive = managedRuns.filter((run) => ["starting", "running", "waiting", "stopping"].includes(run.state));
  const chartPoints = Array.isArray(portfolio.equityCurve) ? portfolio.equityCurve : [];
  const returnTone = pnlTone(portfolio.netReturnPct);
  return <>
    <PageHeading title={t.overview} description={locale === "fa" ? "اجراهای جاری، نتیجهٔ آخرین تحلیل‌ها و گزارش‌ها را یک‌جا ببینید." : "See current runs, the latest analysis results, and reports in one place."} action={<button className="button primary" onClick={() => onNavigate("runLab")}><Plus size={16} />{t.start}</button>} />
    <div className="notice info"><span className="notice-icon"><Shield size={17} /></span><div><b>{locale === "fa" ? "برای شروع، اول شبیه‌سازی کنید" : "Start with a simulation"}</b><p>{locale === "fa" ? "آزمایش تاریخی و شبیه‌سازی زنده با سرمایهٔ مجازی انجام می‌شوند و روی موجودی واقعی والکس اثری ندارند." : "Historical tests and live simulations use virtual capital and cannot affect your Wallex balance."}</p></div><button className="text-button" onClick={() => onNavigate("runLab")}>{locale === "fa" ? "شروع شبیه‌سازی" : "Start a simulation"}<span>←</span></button></div>
    <div className="metric-grid">
      <Metric label={t.runs} value={numberLabel(runs.length, locale)} note={locale === "fa" ? `${numberLabel(alive.length, locale)} اجرای فعال` : `${numberLabel(alive.length, locale)} active now`} icon={Activity} />
      <Metric label={locale === "fa" ? "تصمیم‌های پذیرفته‌شده" : t.decisions} value={numberLabel(runs.reduce((sum, run) => sum + Number(object(run.report).acceptedProposals ?? 0), 0), locale)} note={locale === "fa" ? "در همهٔ اجراها" : "accepted across runs"} icon={Cpu} />
      <Metric label={t.return} value={percent(portfolio.netReturnPct)} note={portfolio.mode === "live" ? (locale === "fa" ? "معاملهٔ واقعی · آخرین گزارش" : "Live trading · latest report") : locale === "fa" ? "عملکرد آخرین گزارش" : "latest report"} icon={returnTone === "up" ? TrendingUp : returnTone === "down" ? TrendingDown : Activity} tone={returnTone} />
      <Metric label={t.trades} value={numberLabel(portfolio.tradeCount ?? 0, locale)} note={locale === "fa" ? "در آخرین گزارش" : "filled in latest report"} icon={ArrowLeftRight} />
    </div>
    <div className="overview-grid">
      <Card className="chart-card"><div className="card-heading"><div><h2>{t.equity}</h2><small className="muted">{hasVirtual ? `${t.virtual} · ${portfolio.quoteCurrency ?? config.wallex?.quoteCurrency ?? "TMN"}` : t.noData}</small></div><button className="icon-button" onClick={() => onNavigate("reports")} aria-label={t.reports}><BarChart3 size={17} /></button></div><EquityChart points={chartPoints} label={t.equity} locale={locale} /></Card>
      <Card className="active-runs-card"><div className="card-heading"><div><h2>{locale === "fa" ? "اجراهای فعال" : "Active runs"}</h2></div><span className="count-pill">{numberLabel(alive.length, locale)}</span></div>
        {alive.length === 0 ? <Empty text={locale === "fa" ? "در حال حاضر اجرای فعالی ندارید." : "No active run right now."} /> : <div className="active-list">{alive.map((run) => <div className="active-row" key={run.id}><span className={`mode-badge ${run.mode}`}>{modeTitle(run.mode, locale)}</span><div className="active-copy"><strong>{run.symbols.join(", ")}</strong><small>{managedRunMessage(run.message, run.state, run.mode, locale)}</small></div><span className={statusClass(run.state)}>{statusTitle(run.state, locale)}</span></div>)}</div>}
        <div className="button-row"><button className="text-button" onClick={() => onNavigate("runLab")}>{locale === "fa" ? "مدیریت اجراها" : "Manage runs"}<span>←</span></button><button className="text-button" onClick={() => onNavigate("reports")}>{locale === "fa" ? "مشاهدهٔ گزارش زنده" : "View live report"}<span>←</span></button></div>
      </Card>
    </div>
    <div className="overview-grid lower">
      <Card><div className="card-heading"><div><h2>{t.recent}</h2></div><button className="text-button" onClick={() => onNavigate("reports")}>{t.reports}<span>←</span></button></div>
        {runs.length === 0 ? <Empty text={t.noRuns} /> : <div className="table-wrap"><table><thead><tr><th>{locale === "fa" ? "حالت" : "Mode"}</th><th>{t.symbol}</th><th>{locale === "fa" ? "وضعیت" : "Status"}</th><th>{t.return}</th><th>{locale === "fa" ? "زمان" : "Time"}</th></tr></thead><tbody>{runs.slice(0, 6).map((run) => <tr key={run.id}><td><span className={`mode-badge ${run.mode}`}>{modeTitle(run.mode, locale)}</span></td><td>{object(run.config).symbol ?? "—"}</td><td><span className={statusClass(run.status)}>{statusTitle(run.status, locale)}</span></td><td className={pnlClass(object(run.report).netReturnPct)}>{percent(object(run.report).netReturnPct)}</td><td>{dateLabel(run.startedAt, locale)}</td></tr>)}</tbody></table></div>}
      </Card>
      <Card className="balance-card"><div className="card-heading"><div><h2>{t.actual}</h2><small className="muted">{locale === "fa" ? "دارایی‌های حساب اعتباری والکس. دستیارها اندازهٔ سفارش را با همین موجودی‌ها و جفت‌ارز انتخاب‌شده می‌سنجند؛ این بخش فقط می‌خواند." : "Assets in the Wallex credit account. The agents size orders against these balances for the selected pair; this view is read-only."}</small></div><span className="secure-mark"><LockKeyhole size={16} /></span></div>
        {!credentialsReady ? <div className="balance-setup"><p className="muted">{locale === "fa" ? "برای نمایش دارایی‌های واقعی، کلید API والکس و شناسهٔ حساب اعتباری را در پروفایل ثبت کنید. آزمایش و شبیه‌سازی بدون آن کار می‌کنند." : "Add the Wallex API key and sub-account client ID to the profile to see real assets. Backtests and simulations work without them."}</p><button className="button secondary" onClick={() => onNavigate("profiles", { group: "Wallex" })}><KeyRound size={15}/>{locale === "fa" ? "ثبت دسترسی والکس" : "Add Wallex access"}</button></div>
          : actualQuery.isPending ? <div className="loading-line"><LoaderCircle className="spin" size={18}/>{locale === "fa" ? "در حال دریافت دارایی‌ها…" : "Fetching assets…"}</div>
          : actualQuery.isError ? <div className="balance-setup"><p className="error-text">{errorText(actualQuery.error.message, locale)}</p><button className="button secondary" onClick={() => void actualQuery.refetch()}><RefreshCw size={15}/>{locale === "fa" ? "تلاش دوباره" : "Try again"}</button></div>
          : (() => {
            const account = actualQuery.data.portfolio, quote = String(account.quoteCurrency ?? config.wallex?.quoteCurrency ?? "TMN"), allowed: string[] = config.wallex?.allowedMarkets ?? [];
            const quantity = (value: unknown) => new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 8 }).format(Number(value ?? 0));
            const positions = ((account.positions ?? []) as JsonMap[]).map((position) => ({ symbol: String(position.symbol ?? ""), asset: String(position.symbol ?? "").replace(new RegExp(`${quote}$`), ""), quantity: String(position.quantity ?? "0"), available: String(position.availableQuantity ?? position.quantity ?? "0"), value: Number(position.quantity ?? 0) * Number(position.markPrice ?? position.averageEntryPrice ?? 0) })).sort((a, b) => b.value - a.value);
            return <>
              <div className="balance-value"><strong>{money(account.equity, quote, locale)}</strong><small>{locale === "fa" ? "ارزش کل دارایی‌ها" : "total equity"} · {dateLabel(actualQuery.data.observedAt, locale)} <button type="button" className="text-button inline" onClick={() => void actualQuery.refetch()} disabled={actualQuery.isFetching}><RefreshCw size={12} className={actualQuery.isFetching ? "spin" : ""}/>{locale === "fa" ? "به‌روزرسانی" : "refresh"}</button></small></div>
              <div className="asset-list">
                <div className="asset-row"><span className="asset-avatar">{assetIcons[quote] ? <img src={assetIcons[quote]} alt=""/> : quote.slice(0, 2)}</span><span className="asset-copy"><b>{quote}</b><small>{locale === "fa" ? "نقد در دسترس برای خرید" : "cash available for buys"}</small></span><span className="asset-amount" dir="ltr">{money(account.cash, quote, locale)}</span></div>
                {positions.map((position) => <div className="asset-row" key={position.symbol}><CurrencyPairAvatar symbol={position.symbol} quoteCurrency={quote} assetIcons={assetIcons}/><span className="asset-copy"><b>{position.asset}</b><small>{quantity(position.quantity)} {position.asset}{position.available !== position.quantity ? ` · ${quantity(position.available)} ${locale === "fa" ? "در دسترس" : "available"}` : ""}</small></span><span className="asset-amount" dir="ltr">{money(position.value, quote, locale)}</span>{allowed.includes(position.symbol) ? <span className="status status-completed">{locale === "fa" ? "در فهرست مجاز" : "allowed"}</span> : <button type="button" className="status status-warning asset-allow" onClick={() => onNavigate("markets")} title={locale === "fa" ? "این جفت‌ارز در فهرست مجاز نیست؛ برای افزودن کلیک کنید" : "Not on the allowlist; click to add it"}>{locale === "fa" ? "مجاز نشده" : "not allowed"}</button>}</div>)}
                {positions.length === 0 && <p className="muted small-text">{locale === "fa" ? "جز وجه نقد، دارایی دیگری در این حساب نیست." : "No assets besides cash in this account."}</p>}
              </div>
            </>;
          })()}
      </Card>
    </div>
  </>;
}

function ProfilesView({ t, locale, profile, profiles, profileId, fields, encryptionConfigured, encryptionKeySource, encryptionKeyPath, initialGroup, onSelect, onNavigate, notify, onRefresh }: {
  t: Record<string, string>; locale: Locale; profile: Profile | undefined; profiles: Profile[]; profileId: string; fields: Field[];
  encryptionConfigured: boolean; encryptionKeySource: string; encryptionKeyPath: string; initialGroup?: string; onSelect: (id: string) => void; onNavigate: (view: string) => void; notify: (message: string) => void; onRefresh: () => void;
}) {
  const managedKeyFile = encryptionKeySource === "file";
  const [newName, setNewName] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("AI & agents");
  const [search, setSearch] = useState("");
  // A guided error can open this page on the group that holds the offending setting.
  useEffect(() => { if (initialGroup) { const group = fields.find((field) => field.group === initialGroup || field.group.startsWith(initialGroup))?.group; if (group) setSelectedGroup(group); } }, [initialGroup, fields]);
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
  const settingValue = (key: string, fallback: string) => draft[key] ?? fields.find((field) => field.key === key)?.value ?? fallback;
  const wallexBaseUrl = settingValue("WALLEX_BASE_URL", "https://api.wallex.ir");
  const quoteCurrency = settingValue("WALLEX_QUOTE_CURRENCY", "TMN");
  const redditEnabled = settingValue("RESEARCH_REDDIT_ENABLED", "true").toLowerCase() === "true";
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
    } catch (error) { notify(error instanceof Error ? errorText(error.message, locale) : "Profile could not be created."); }
  };
  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    const updates = Object.fromEntries(fields.filter((field) => field.writable && !field.secret && draft[field.key] !== field.value).map((field) => [field.key, draft[field.key] ?? ""]));
    if (!Object.keys(updates).length) { notify(locale === "fa" ? "تغییری برای ذخیره نیست." : "No settings changed."); return; }
    setSavingSettings(true);
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ profileId, settings: updates }) });
      onRefresh(); notify(locale === "fa" ? `${Object.keys(updates).length} تنظیم ذخیره شد.` : `${Object.keys(updates).length} settings saved.`);
    } catch (error) { notify(error instanceof Error ? errorText(error.message, locale) : (locale === "fa" ? "ذخیره تنظیمات ناموفق بود." : "Settings could not be saved.")); }
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
    if (!Object.keys(secrets).length) { notify(locale === "fa" ? "کلید تازه‌ای وارد نشده یا موردی برای پاک‌کردن انتخاب نشده است." : "Enter a new credential or select one to clear."); return; }
    try {
      await api(`/api/profiles/${encodeURIComponent(profileId)}`, { method: "PUT", body: JSON.stringify({ secrets }) });
      setSecretDraft({}); setClearSecrets({}); setSecretEditorRevision((revision) => revision + 1); onRefresh(); notify(locale === "fa" ? "کلیدها به صورت رمزگذاری‌شده ذخیره شدند." : "Credentials saved encrypted.");
    } catch (error) { notify(error instanceof Error ? errorText(error.message, locale) : "Credentials could not be saved."); }
  };
  const importDotenv = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await api<{ profile: Profile; removedConfigurationAssignments: number; file: string }>("/api/profiles/import-dotenv", { method: "POST", body: JSON.stringify({ path: dotenvPath, name: importTarget === "new" ? importName.trim() || "Imported profile" : profile?.name ?? "Imported profile", ...(importTarget === "replace" && profileId ? { profileId } : {}) }) });
      setDotenvPath(""); setImportName(""); onSelect(result.profile.id); onRefresh();
      notify(locale === "fa" ? `${result.file} وارد شد؛ ${result.removedConfigurationAssignments} تنظیم قدیمی از فایل پاک شد.` : `Imported ${result.file}; removed ${result.removedConfigurationAssignments} legacy configuration assignments.`);
    } catch (error) { notify(error instanceof Error ? errorText(error.message, locale) : "Import failed."); }
  };
  const rotateKey = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await api<{ reencryptedSecretCount: number; keyFileUpdated?: boolean }>("/api/secrets/rekey", { method: "POST", body: JSON.stringify(managedKeyFile ? {} : { previousKey, replacementKey }) });
      setPreviousKey(""); setReplacementKey(""); onRefresh();
      notify(result.keyFileUpdated
        ? (locale === "fa" ? `${result.reencryptedSecretCount} مقدار بازرمزگذاری شد و فایل کلید به‌روز شد؛ نسخهٔ پشتیبان آن را تازه کنید.` : `Re-encrypted ${result.reencryptedSecretCount} values and updated the key file. Refresh your backup copy of it.`)
        : (locale === "fa" ? `${result.reencryptedSecretCount} مقدار بازرمزگذاری شد؛ کلید جایگزین را در secret manager ذخیره کنید.` : `Re-encrypted ${result.reencryptedSecretCount} values. Store the replacement key in your secret manager.`));
    } catch (error) { notify(error instanceof Error ? errorText(error.message, locale) : "Key rotation failed."); }
  };

  return <>
    <PageHeading title={t.profiles} description={locale === "fa" ? "هر پروفایل مجموعه‌ای جدا از تنظیمات، دستیارها و کلیدهای دسترسی دارد. کلیدها رمزگذاری می‌شوند و پس از ذخیره دیگر نمایش داده نمی‌شوند." : "Each profile keeps its own settings, agents, and credentials. Credentials are encrypted and hidden after saving."} />
    <div className="profile-layout">
      <Card className="profile-list-card"><div className="card-heading"><div><h2>{locale === "fa" ? "پروفایل‌ها" : "Profiles"}</h2></div><span className="count-pill">{numberLabel(profiles.length, locale)}</span></div>
        <div className="profile-list">{profiles.map((item) => <div className={`profile-row ${item.id === profileId ? "selected" : ""}`} key={item.id}><button className="profile-pick" onClick={() => onSelect(item.id)}><span className="profile-avatar">{item.name.slice(0, 1).toUpperCase()}</span><span><b>{item.name}</b><small>{item.active ? (locale === "fa" ? "فعال" : "Active") : (locale === "fa" ? "غیرفعال" : "Inactive")}</small></span></button>{item.active && <Check size={15} className="positive" />}<button className="icon-button tiny" title={t.delete} disabled={item.active || profiles.length <= 1} onClick={async () => { if (!window.confirm(locale === "fa" ? `پروفایل «${item.name}» حذف شود؟` : `Delete profile “${item.name}”?`)) return; try { await api(`/api/profiles/${encodeURIComponent(item.id)}`, { method: "DELETE" }); onRefresh(); notify(locale === "fa" ? "پروفایل حذف شد." : "Profile deleted."); } catch (error) { notify(error instanceof Error ? errorText(error.message, locale) : "Delete failed."); } }}><Trash2 size={14}/></button></div>)}</div>
        <form className="create-profile-form" onSubmit={createProfile}><label className="sr-only" htmlFor="new-profile-name">{t.profileName}</label><input id="new-profile-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t.profileName} maxLength={80} required/><FieldLabelInfo className="compact-info" label={locale === "fa" ? "کپی تنظیمات از" : "Copy settings from"} help={locale === "fa" ? "برای کپی تنظیمات و کلیدهای دسترسی، یک پروفایل را انتخاب کنید. اگر پیش‌فرض‌ها را می‌خواهید، گزینهٔ زیر را انتخاب کنید." : "Copy settings and credentials from another profile, or choose the defaults below."}/><AppSelect ariaLabel={locale === "fa" ? "کپی تنظیمات از" : "Copy settings from"} value={copyFrom || "__trex_empty__"} onValueChange={setCopyFrom} locale={locale} placeholder={locale === "fa" ? "استفاده از پیش‌فرض‌ها" : "Use defaults"} options={[{ value: "__trex_empty__", label: locale === "fa" ? "استفاده از پیش‌فرض‌ها" : "Use defaults" }, ...profiles.map((item) => ({ value: item.id, label: item.name }))]}/><button className="button secondary full"><Plus size={15}/>{t.create}</button></form>
      </Card>
      <div className="profile-content">
        <Card><div className="card-heading"><div><h2>{profile?.name ?? t.profile}</h2><small className="muted">{profile?.active ? (locale === "fa" ? "پروفایل فعال موتور" : "Active engine profile") : (locale === "fa" ? "پیش‌نمایش پروفایل" : "Profile preview")}</small></div>{profile && !profile.active && <button className="button secondary" onClick={async () => { try { await api(`/api/profiles/${encodeURIComponent(profile.id)}/activate`, { method: "POST" }); onSelect(profile.id); onRefresh(); notify(locale === "fa" ? "پروفایل فعال شد." : "Profile activated."); } catch (error) { notify(error instanceof Error ? errorText(error.message, locale) : "Activation failed."); } }}><Check size={15}/>{t.activate}</button>}</div>
          <div className="segmented-scroll" role="tablist" aria-label={t.settings}>{["All", ...groups].map((group, index) => <button id={`settings-tab-${index}`} aria-controls="settings-tab-panel" role="tab" tabIndex={selectedGroup === group ? 0 : -1} aria-selected={selectedGroup === group} className={selectedGroup === group ? "selected" : ""} key={group} onKeyDown={(event) => {
            const tabs = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]") ?? [])];
            const direction = locale === "fa" ? -1 : 1;
            const nextIndex = event.key === "ArrowRight" ? (index + direction + tabs.length) % tabs.length : event.key === "ArrowLeft" ? (index - direction + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
            if (nextIndex >= 0) { event.preventDefault(); tabs[nextIndex]?.focus(); setSelectedGroup(["All", ...groups][nextIndex]!); }
          }} onClick={() => setSelectedGroup(group)}>{settingsGroupTitle(group, locale)}</button>)}</div>
          <div id="settings-tab-panel" role="tabpanel" aria-labelledby={`settings-tab-${["All", ...groups].indexOf(selectedGroup)}`} tabIndex={0}>
          <div className="field-toolbar"><label className="field-search"><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.search}/></label><span className="muted small-text">{locale === "fa" ? "مقدارها پیش از ذخیره بررسی می‌شوند." : "Values are checked before saving."}</span></div>
          <form onSubmit={saveSettings}><div className="settings-groups">{groups.filter((group) => selectedGroup === "All" || group === selectedGroup).map((group) => {
            const visible = fields.filter((field) => !field.secret && field.group === group && `${settingTitle(field.key, locale)} ${field.key} ${field.group}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
            if (!visible.length) return null;
            return <section className="settings-group" key={group}><h3>{settingsGroupTitle(group, locale)}</h3><div className="settings-fields">{visible.map((field) => {
              const value = draft[field.key] ?? field.value, boolean = ["true", "false"].includes(value.toLowerCase()), jsonValue = field.key.endsWith("_JSON");
              const numericBounds = field.key === "AI_REQUEST_TIMEOUT_SECONDS" ? { min: 5, max: 300 } : field.key === "AI_TOOL_TIMEOUT_SECONDS" ? { min: 1, max: 120 } : field.key === "AI_TIMEOUT_RETRIES" ? { min: 0, max: 2 } : undefined;
              const update = (next: string) => setDraft((prev) => ({ ...prev, [field.key]: next }));
              const settingLabel = <span className="setting-meta"><FieldLabelInfo className="setting-field-label" label={settingTitle(field.key, locale)} help={fieldHelp(field.key, field.group, locale)}/><small className={`source-tag source-${field.source}`}>{sourceTitle(field.source, locale)}</small></span>;
              const effectiveHint = locale === "fa" ? "برای این سرویس فقط خواندنی است." : "Read-only for this service.";
              return <div className={`setting-field ${jsonValue ? "setting-wide" : ""}`} key={field.key}>{settingLabel}
                {field.key === "RISK_PAIR_LIMITS_JSON" ? <PairLimitsEditor value={value} disabled={!field.writable} locale={locale} pairs={settingValue("WALLEX_ALLOWED_MARKETS", "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean)} quoteCurrency={quoteCurrency} onChange={update}/>
                : field.key === "AI_PROVIDER" ? <AppSelect ariaLabel={settingTitle(field.key, locale)} value={value} disabled={!field.writable} locale={locale} onValueChange={update} options={[
                  { value: "openai", label: "OpenAI", detail: locale === "fa" ? "مدل‌های OpenAI" : "OpenAI models" },
                  { value: "anthropic", label: "Anthropic", detail: locale === "fa" ? "مدل‌های Claude" : "Claude models" },
                  { value: "google", label: "Google", detail: locale === "fa" ? "مدل‌های Gemini" : "Gemini models" },
                  { value: "compatible", label: locale === "fa" ? "سرویس سازگار با OpenAI" : "OpenAI-compatible", detail: locale === "fa" ? "نشانی و مدل سرویس دلخواه" : "Custom provider URL and model" },
                  { value: "boxapi", label: "BoxAPI", detail: locale === "fa" ? "مدل از مسیر BoxAPI" : "Models through BoxAPI" },
                  { value: "openrouter", label: "OpenRouter", detail: locale === "fa" ? "صدها مدل با یک کلید" : "Hundreds of models with one key" },
                  { value: "liara", label: "Liara", detail: locale === "fa" ? "مدل از مسیر Liara" : "Models through Liara" },
                ]}/> : boolean ? <AppSelect ariaLabel={settingTitle(field.key, locale)} value={value.toLowerCase()} disabled={!field.writable} locale={locale} onValueChange={update} options={[{ value: "true", label: locale === "fa" ? "فعال" : "Enabled" }, { value: "false", label: locale === "fa" ? "غیرفعال" : "Disabled" }]}/> : ["AI_ROLE_MODELS_JSON", "AI_ROLE_INSTRUCTIONS_JSON", "AI_ROLE_MAX_TOOL_STEPS_JSON", "AI_DISABLED_AGENTS_JSON"].includes(field.key) ? <><p className="field-hint route-note">{locale === "fa" ? "برای تنظیم ساده‌تر دستیارها، از صفحهٔ دستیارها و استراتژی‌ها استفاده کنید." : "Use the visual agent workspace for guided editing and validation."}<button type="button" className="text-button" onClick={() => onNavigate("strategies")}>{locale === "fa" ? "مدیریت دستیارها" : "Open agent settings"}<ArrowLeftRight size={13}/></button></p><details className="advanced-json"><summary>{locale === "fa" ? "ویرایش فنی" : "Advanced raw JSON editor"}</summary>{field.key === "AI_ROLE_MODELS_JSON" ? <RoleRouteEditor value={value} disabled={!field.writable} locale={locale} onChange={update}/> : <textarea rows={3} value={value} disabled={!field.writable} spellCheck={false} onChange={(event) => update(event.target.value)}/>}</details></> : field.key === "ENGINE_STRATEGIES_JSON" ? <><p className="field-hint route-note">{locale === "fa" ? "برای ویرایش معمول، از صفحهٔ دستیارها و استراتژی‌ها استفاده کنید." : "For normal edits, use the Agents & strategies workspace."}<button type="button" className="text-button" onClick={() => onNavigate("strategies")}>{locale === "fa" ? "مدیریت استراتژی‌ها" : "Manage strategies"}<ArrowLeftRight size={13}/></button></p><details className="advanced-json"><summary>{locale === "fa" ? "ویرایش فنی" : "Advanced raw JSON editor"}</summary><textarea rows={3} value={value} disabled={!field.writable} spellCheck={false} onChange={(event) => update(event.target.value)}/></details></> : jsonValue ? <textarea rows={3} value={value} disabled={!field.writable} spellCheck={false} onChange={(event) => update(event.target.value)}/> : amountSettingKeys.has(field.key) ? <MoneyInput ariaLabel={settingTitle(field.key, locale)} value={value} currency={quoteCurrency} locale={locale} disabled={!field.writable} onChange={update}/> : <input type={numericBounds ? "number" : "text"} {...(numericBounds ?? {})} step={numericBounds ? 1 : undefined} inputMode={numericBounds ? "numeric" : undefined} value={value} disabled={!field.writable} onChange={(event) => update(event.target.value)}/>}
                {!field.writable && <small className="field-hint">{effectiveHint}</small>}
              </div>;
            })}</div></section>;
          })}</div><div className="form-footer"><small className={hasUnsavedSettings ? "unsaved-note" : "muted"} role="status">{hasUnsavedSettings ? (locale === "fa" ? "تغییرات ذخیره‌نشده · مقدارهای ورودی پیش از ثبت اعتبارسنجی می‌شوند." : "Unsaved changes · values are validated before saving.") : (locale === "fa" ? "همه تغییرات ذخیره شده‌اند. مقادیر پیش از ثبت اعتبارسنجی می‌شوند." : "All changes are saved. Values are validated before saving.")}</small><button className="button primary" disabled={!hasUnsavedSettings || savingSettings}>{savingSettings && <LoaderCircle className="spin" size={15}/>}<Check size={15}/>{savingSettings ? (locale === "fa" ? "در حال ذخیره…" : "Saving…") : t.save}</button></div></form>
          </div>
        </Card>
        <Card><div className="card-heading"><div><h2><KeyRound size={17}/>{t.secrets}</h2><small className="muted">{t.keyHint}</small></div><span className={`status ${encryptionConfigured ? "status-completed" : "status-warning"}`}>{encryptionConfigured ? t.configured : t.missing}</span></div>
          {!encryptionConfigured && <div className="notice warning"><span className="notice-icon"><AlertTriangle size={17}/></span><div><b>{locale === "fa" ? "کلید اصلی هنوز ساخته نشده است" : "Encryption master key is not configured"}</b><p>{locale === "fa" ? "برای نگهداری امن کلیدهای دسترسی، یک کلید اصلی لازم است. پس از ساخت، آن را در تنظیم امن سرویس ثبت کنید؛ اگر این کلید گم شود، کلیدهای ذخیره‌شده قابل بازیابی نیستند." : "A master key protects stored credentials. After generating it, save it in the service's secure settings; if lost, stored credentials cannot be recovered."}</p></div><button className="button secondary" onClick={async () => { try { const result = await api<{ key: string }>("/api/secrets/generate-key", { method: "POST", body: "{}" }); setGeneratedKey(result.key); } catch (error) { notify(error instanceof Error ? errorText(error.message, locale) : "Key generation failed."); } }}><Sparkles size={15}/>{t.generateKey}</button></div>}
          {generatedKey && <div className="generated-key"><code>{generatedKey}</code><button className="button secondary" onClick={() => { void navigator.clipboard.writeText(generatedKey); notify(t.copied); }}>{locale === "fa" ? "کپی کلید" : "Copy key"}</button><button className="icon-button" onClick={() => setGeneratedKey("")} aria-label={t.cancel}><X size={15}/></button></div>}
          <form onSubmit={saveSecrets}><div className="secret-grid">
            <SecretControl label="AI_API_KEY" id="aiApiKey" configured={profile?.secrets?.aiApiKey} value={secretDraft.aiApiKey ?? ""} cleared={clearSecrets.aiApiKey} onValue={(value) => setSecretDraft((prev) => ({ ...prev, aiApiKey: value }))} onClear={(value) => setClearSecrets((prev) => ({ ...prev, aiApiKey: value }))} locale={locale}/>
            {(["openai", "anthropic", "google", "compatible", "boxapi", "liara", "openrouter"] as const).map((provider) => <SecretControl key={provider} label={`${provider.toUpperCase()} API key`} id={`provider:${provider}`} configured={profile?.secrets?.providerKeys?.[provider]} value={secretDraft[`provider:${provider}`] ?? ""} cleared={clearSecrets[`provider:${provider}`]} onValue={(value) => setSecretDraft((prev) => ({ ...prev, [`provider:${provider}`]: value }))} onClear={(value) => setClearSecrets((prev) => ({ ...prev, [`provider:${provider}`]: value }))} locale={locale}/>)}
            <SecretControl label="WALLEX_API_KEY" id="wallexApiKey" configured={profile?.secrets?.wallexApiKey} value={secretDraft.wallexApiKey ?? ""} cleared={clearSecrets.wallexApiKey} onValue={(value) => setSecretDraft((prev) => ({ ...prev, wallexApiKey: value }))} onClear={(value) => setClearSecrets((prev) => ({ ...prev, wallexApiKey: value }))} locale={locale}/>
            <SecretControl label="WALLEX_SUB_ACCOUNT_CLIENT_ID" id="subAccountClientId" configured={profile?.secrets?.subAccountClientId} value={secretDraft.subAccountClientId ?? ""} cleared={clearSecrets.subAccountClientId} onValue={(value) => setSecretDraft((prev) => ({ ...prev, subAccountClientId: value }))} onClear={(value) => setClearSecrets((prev) => ({ ...prev, subAccountClientId: value }))} locale={locale}/>
            <SecretControl label="TRONSCAN_API_KEY" id="tronscanApiKey" configured={profile?.secrets?.tronscanApiKey} value={secretDraft.tronscanApiKey ?? ""} cleared={clearSecrets.tronscanApiKey} onValue={(value) => setSecretDraft((prev) => ({ ...prev, tronscanApiKey: value }))} onClear={(value) => setClearSecrets((prev) => ({ ...prev, tronscanApiKey: value }))} locale={locale} help={locale === "fa" ? "برای دریافت دادهٔ مستقیم شبکهٔ ترون دربارهٔ عرضه، سوزاندن، سهام‌گذاری، رأی‌گیری و فعالیت روزانه؛ کلید باید از پرتال توسعه‌دهندگان TronScan گرفته و رمزگذاری‌شده ذخیره شود." : "Required for direct TRON mainnet supply, burn, staking, governance, and daily activity data. Get a key from the TronScan API portal; it is stored encrypted."}/>
            <EndpointListEditor key={`${profileId}:research:${secretEditorRevision}`} kind="research" configured={profile?.secrets?.researchEndpoints} value={secretDraft.researchEndpoints ?? ""} cleared={clearSecrets.researchEndpoints} onValue={(value) => setSecretDraft((prev) => ({ ...prev, researchEndpoints: value }))} onClear={(value) => setClearSecrets((prev) => ({ ...prev, researchEndpoints: value }))} locale={locale} wallexBaseUrl={wallexBaseUrl} quoteCurrency={quoteCurrency} redditEnabled={redditEnabled}/>
            <EndpointListEditor key={`${profileId}:quote:${secretEditorRevision}`} kind="quote" configured={profile?.secrets?.marketQuoteFallbacks} value={secretDraft.marketQuoteFallbacks ?? ""} cleared={clearSecrets.marketQuoteFallbacks} onValue={(value) => setSecretDraft((prev) => ({ ...prev, marketQuoteFallbacks: value }))} onClear={(value) => setClearSecrets((prev) => ({ ...prev, marketQuoteFallbacks: value }))} locale={locale} wallexBaseUrl={wallexBaseUrl} quoteCurrency={quoteCurrency}/>
          </div><div className="form-footer"><small className="muted"><LockKeyhole size={13}/>{locale === "fa" ? "کلیدها، شناسه حساب و هدرهای منبع داده در پایگاه داده رمز می‌شوند." : "Provider keys, account identifiers, and data-source credentials are encrypted before persistence."}</small><button className="button primary" disabled={!encryptionConfigured}><LockKeyhole size={15}/>{t.save}</button></div></form>
        </Card>
        <Card><div className="card-heading"><div><h2>{t.import}</h2><small className="muted">{locale === "fa" ? "پس از اعتبارسنجی و تأیید رمزگشایی، کلیدهای واردشده از فایل محلی حذف می‌شوند." : "Imported values are validated and decrypt-checked before their secret assignments are removed from the local file."}</small></div></div>
          <form className="import-form" onSubmit={importDotenv}><label><FieldLabelInfo label={t.importPath} help={locale === "fa" ? "مسیر محلی روی همین رایانه‌ای که سرویس TREX اجرا می‌شود. تنظیمات و رازهای شناخته‌شده پس از واردسازی معتبر از فایل حذف می‌شوند؛ کلید اصلی رمزنگاری وارد نمی‌شود." : "Local path on the computer running TREX. Recognized runtime settings and secrets are removed after successful import; the encryption master key is never imported."}/><input required value={dotenvPath} onChange={(event) => setDotenvPath(event.target.value)} placeholder="D:\\trex\\.env.test"/></label><label><FieldLabelInfo label={locale === "fa" ? "مقصد واردسازی" : "Import destination"} help={locale === "fa" ? "پروفایل مستقل جدید می‌سازد یا تنظیمات پروفایل انتخاب‌شده را جایگزین می‌کند." : "Create an isolated profile or replace the selected profile's settings."}/><AppSelect ariaLabel={locale === "fa" ? "مقصد واردسازی" : "Import destination"} value={importTarget} onValueChange={(value) => setImportTarget(value as "new" | "replace")} locale={locale} options={[{ value: "new", label: locale === "fa" ? "ساخت پروفایل جدید" : "Create a new profile" }, { value: "replace", label: locale === "fa" ? `جایگزینی «${profile?.name ?? ""}»` : `Replace “${profile?.name ?? ""}”` }]}/></label>{importTarget === "new" && <label><FieldLabelInfo label={t.profileName} help={locale === "fa" ? "نام قابل‌شناسایی برای پروفایل واردشده، حداکثر ۸۰ نویسه." : "A recognizable name for the imported profile, up to 80 characters."}/><input required value={importName} onChange={(event) => setImportName(event.target.value)} placeholder={locale === "fa" ? "مثلاً آزمایش شبیه‌سازی" : "e.g. Shadow testing"}/></label>}<button className="button secondary"><ArrowDownToLine size={15}/>{locale === "fa" ? "واردسازی، اعتبارسنجی و پاک‌سازی" : "Import, verify, and scrub configuration"}</button></form>
        </Card>
        <Card><div className="card-heading"><div><h2>{t.encryption} · {t.rotateKey}</h2><small className="muted">{managedKeyFile
          ? (locale === "fa" ? `کلید اصلی به‌صورت خودکار در فایل ${encryptionKeyPath} کنار پایگاه داده نگهداری می‌شود. از این فایل نسخهٔ پشتیبان بگیرید؛ تعویض کلید، کلید تازه‌ای می‌سازد و همان فایل را به‌روز می‌کند.` : `Trex keeps the master key automatically in ${encryptionKeyPath}, next to the database. Back up that file; rotating generates a new key and updates the file for you.`)
          : (locale === "fa" ? "ابتدا کلید جایگزین را خارج از برنامه تنظیم کنید؛ سپس کلید قبلی را برای بازرمزگذاری وارد کنید." : "Run the service with the replacement key, then provide the previous key to re-encrypt stored credentials.")}</small></div></div>{managedKeyFile ? <form className="rekey-form" onSubmit={rotateKey}><button className="button secondary"><KeyRound size={15}/>{t.rotateKey}</button></form> : <form className="rekey-form" onSubmit={rotateKey}><label><FieldLabelInfo label={t.oldKey} help={locale === "fa" ? "کلید رمزنگاری فعلی که محرمانه‌ها با آن رمز شده‌اند. فقط هنگام چرخش وارد شود و در مرورگر ذخیره نمی‌شود." : "Current external encryption key used for stored credentials. Enter only during rotation; it is not saved by the browser."}/><input type="password" value={previousKey} onChange={(event) => setPreviousKey(event.target.value)} autoComplete="off" required/></label><label><FieldLabelInfo label={t.newKey} help={locale === "fa" ? "کلید جدید ۳۲ بایتی که سرویس با آن اجرا شده است؛ باید با کلید فعال فرایند یکسان باشد." : "New 32-byte key already configured for the service process; it must match the active key."}/><input type="password" value={replacementKey} onChange={(event) => setReplacementKey(event.target.value)} autoComplete="off" required/></label><button className="button secondary"><KeyRound size={15}/>{t.rotateKey}</button></form>}</Card>
      </div>
    </div>
  </>;
}

function SecretControl({ label, id, configured, value, cleared, onValue, onClear, locale, help: helpText }: { label: string; id: string; configured?: boolean; value: string; cleared?: boolean; onValue: (value: string) => void; onClear: (value: boolean) => void; locale: Locale; help?: string }) {
  const titles: Record<string, { fa: string; en: string }> = {
    AI_API_KEY: { fa: "کلید مدل پیش‌فرض", en: "Default model API key" },
    "OPENAI API key": { fa: "کلید OpenAI", en: "OpenAI API key" },
    "ANTHROPIC API key": { fa: "کلید Anthropic", en: "Anthropic API key" },
    "GOOGLE API key": { fa: "کلید Google", en: "Google API key" },
    "COMPATIBLE API key": { fa: "کلید سرویس سازگار", en: "Compatible service API key" },
    "BOXAPI API key": { fa: "کلید BoxAPI", en: "BoxAPI API key" }, "OPENROUTER API key": { fa: "کلید OpenRouter", en: "OpenRouter API key" },
    "LIARA API key": { fa: "کلید Liara", en: "Liara API key" },
    WALLEX_API_KEY: { fa: "کلید دسترسی والکس", en: "Wallex API key" },
    WALLEX_SUB_ACCOUNT_CLIENT_ID: { fa: "شناسهٔ مشتریِ حساب فرعی والکس", en: "Wallex sub-account client ID" },
    TRONSCAN_API_KEY: { fa: "کلید داده‌های شبکه ترون", en: "TronScan data API key" },
  };
  const title = titles[label]?.[locale] ?? label;
  const help = helpText ?? (label === "WALLEX_SUB_ACCOUNT_CLIENT_ID"
    ? (locale === "fa" ? "شناسهٔ مشتریِ حساب فرعی فعال برای بستهٔ اعتباری والکس؛ باید همراه کلید دسترسی همان حساب استفاده شود. پس از ثبت، این شناسه نمایش داده نمی‌شود." : "Client ID for the active Wallex credit sub-account. It must be paired with that sub-account's API key and is never displayed after saving.")
    : label === "WALLEX_API_KEY"
      ? (locale === "fa" ? "کلید API حساب فرعی اعتبار معاملاتی والکس با دسترسی فقط خواندن و معامله. مجوز برداشت را فعال نکنید." : "API key for the Wallex credit sub-account, with read and trade permissions only. Do not enable withdrawals.")
      : label.includes("API key")
        ? (locale === "fa" ? `کلید ارائه‌دهنده ${label.replace(" API key", "")} برای نقش‌های مدل. مقدار فعلی قابل بازیابی یا نمایش نیست.` : `${label.replace(" API key", "")} provider credential for model requests. The stored value cannot be read back or displayed.`)
        : (locale === "fa" ? "کلید ارائه‌دهنده پیش‌فرض هوش مصنوعی. برای مسیر نقش‌محور می‌توان کلید جداگانه ارائه‌دهنده را نیز تعریف کرد." : "Default AI provider credential. Provider-specific keys can also be configured for role-based model routing."));
  return <div className="secret-field"><div className="secret-label"><FieldLabelInfo label={title} htmlFor={id} help={help}/><small className={configured ? "configured-text" : "muted"}>{configured ? (locale === "fa" ? "ذخیره‌شده" : "Stored") : (locale === "fa" ? "خالی" : "Not set")}</small></div><input id={id} type="password" value={value} onChange={(event) => { onClear(false); onValue(event.target.value); }} autoComplete="new-password" placeholder={configured ? (locale === "fa" ? "مقدار فعلی پنهان است" : "Stored value hidden") : (locale === "fa" ? "مقدار جدید" : "Enter new value")}/><label className="clear-secret"><input type="checkbox" checked={Boolean(cleared)} onChange={(event) => onClear(event.target.checked)}/>{locale === "fa" ? "پاک‌سازی مقدار ذخیره‌شده" : "Clear stored value"}</label></div>;
}

function StrategiesView({ t, locale, profileId, config, fields, strategies, section, onSectionChange, notify, onRefresh, embedded = false }: { t: Record<string, string>; locale: Locale; profileId: string; config: JsonMap; fields: Field[]; strategies: Strategy[]; section: "agents" | "strategies"; onSectionChange: (section: "agents" | "strategies") => void; notify: (message: string) => void; onRefresh: () => void; embedded?: boolean }) {
  const quote = String(config.wallex?.quoteCurrency ?? "TMN");
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
    catch (error) { notify(error instanceof Error ? errorText(error.message, locale) : (locale === "fa" ? "تنظیمات استراتژی معتبر نیست." : "Strategy settings are invalid.")); }
    finally { setSaving(false); }
  };
  const addStrategy = () => setDraft((current) => [...current, { id: `custom-${Math.random().toString(36).slice(2, 8)}`, name: locale === "fa" ? "استراتژی جدید" : "New strategy", mandate: locale === "fa" ? "شواهد لازم برای خرید یا فروش، نشانه‌هایی که تحلیل را بی‌اعتبار می‌کنند، خطرهای مهم و زمان مناسب برای انجام‌ندادن معامله را بنویسید." : "Describe the evidence, entry conditions, invalidation conditions, and when to prefer HOLD.", minConfidence: 0.65, allowedOrderTypes: ["LIMIT"] }]);
  const filtered = draft.filter((strategy) => `${strategy.id} ${strategyTitle(strategy, locale)} ${strategy.mandate}`.toLowerCase().includes(filter.toLowerCase()));
  const description = section === "agents"
    ? (locale === "fa" ? "مراحل تحلیل و تصمیم‌گیری را ببینید و مدل و راهنمای تکمیلی هر دستیار را برای این پروفایل تنظیم کنید." : "Inspect the engine’s analysis and decision workflow, then configure model routes, role guidance, and optional agents per profile.")
    : (locale === "fa" ? "استراتژی‌ها شیوهٔ پیشنهاد دستیارها را مشخص می‌کنند. دستیارها سفارش نمی‌فرستند؛ بررسی ریسک و اجرای سفارش را سامانه انجام می‌دهد." : "Strategies constrain agent proposals. Agents cannot submit orders; risk and execution remain controlled by the engine.");
  return <>{embedded ? <p className="muted small-text">{description}</p> : <PageHeading title={t.strategies} description={description} action={section === "strategies" ? <button className="button secondary" onClick={addStrategy}><Plus size={16}/>{locale === "fa" ? "استراتژی جدید" : "Add strategy"}</button> : undefined} />}
    <SegmentedTabs id="agent-management" label={locale === "fa" ? "مدیریت دستیارها و استراتژی‌ها" : "Agent and strategy management"} value={section} locale={locale} onValueChange={(value) => onSectionChange(value as "agents" | "strategies")} options={[{ value: "agents", label: locale === "fa" ? "تیم دستیارها" : "Agent team" }, { value: "strategies", label: locale === "fa" ? "استراتژی‌ها" : "Strategies" }]} />
    <div id="agent-management-panel" role="tabpanel" aria-labelledby={`agent-management-tab-${section}`} tabIndex={0}>
    {section === "agents" ? <AgentWorkspace profileId={profileId} config={config} fields={fields} locale={locale} notify={notify} onRefresh={onRefresh} /> : <>
    <div className="strategy-toolbar"><div className="field-search"><Search size={15}/><input aria-label={t.search} placeholder={t.search} value={filter} onChange={(event) => setFilter(event.target.value)}/></div><span className="count-pill">{draft.length} {t.strategies}</span><small className={`strategy-save-state ${dirty ? "dirty" : ""}`} role="status">{dirty ? (locale === "fa" ? "تغییرات ذخیره‌نشده" : "Unsaved changes") : (locale === "fa" ? "همگام با پروفایل" : "In sync with profile")}</small><button className="button primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/>}{saving ? (locale === "fa" ? "در حال ذخیره…" : "Saving…") : t.save}</button></div>
    <div className="strategy-grid">{filtered.map((strategy, index) => <details className="strategy-card card" key={`${profileId}:${strategy.id}`} open={strategy.id === "agentic-balanced"}><summary className="strategy-summary"><span className="strategy-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span className="strategy-summary-copy"><b>{strategyTitle(strategy, locale)}</b><small>{locale === "fa" ? <>حداقل اطمینان {new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(strategy.minConfidence * 100)}٪</> : <><code>{strategy.id}</code> · Min confidence {new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(strategy.minConfidence * 100)}%</>}</small></span><span className="strategy-summary-orders">{strategy.allowedOrderTypes.map((type) => orderValueTitle(type, locale)).join(" · ") || (locale === "fa" ? "بدون نوع سفارش" : "No order types")}</span><ChevronDown size={16} className="strategy-chevron"/></summary><div className="strategy-editor"><div className="strategy-head"><span className="tag">{locale === "fa" ? "تنظیمات استراتژی" : "Strategy settings"}</span><button type="button" className="icon-button tiny" disabled={["agentic-balanced", "momentum", "mean-reversion", "capital-preservation"].includes(strategy.id)} title={t.delete} aria-label={`${t.delete}: ${strategyTitle(strategy, locale)}`} onClick={() => setDraft((current) => current.filter((item) => item.id !== strategy.id))}><Trash2 size={14}/></button></div>
      <label className="setting-field"><FieldLabelInfo label={locale === "fa" ? "نام نمایشی" : "Display name"} help={locale === "fa" ? "این نام در فرم اجرا و گزارش‌ها دیده می‌شود." : "Display name used in run forms and reports."}/><input value={strategyTitle(strategy, locale)} onChange={(event) => updateStrategy(strategy.id, { name: event.target.value })}/></label>
      <label className="setting-field"><FieldLabelInfo label={locale === "fa" ? "شناسهٔ فنی" : "Strategy ID"} help={locale === "fa" ? "شناسهٔ مورد استفاده در گزارش‌ها و اتصال به اجراها. برای استفادهٔ معمول نیازی به تغییر آن نیست." : "Stable ID referenced by runs and reports. Most users do not need to change it."}/><input dir="ltr" value={strategy.id} disabled={strategy.id.startsWith("agentic-") || ["momentum", "mean-reversion", "capital-preservation"].includes(strategy.id)} onChange={(event) => updateStrategy(strategy.id, { id: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}/></label>
      <label className="setting-field"><FieldLabelInfo label={locale === "fa" ? "دستور ارسالی به مدل" : "Instructions sent to model"} help={locale === "fa" ? "این متن مستقیماً به مدل فرستاده می‌شود و در گزارش ثبت خواهد شد. دستور پیش‌فرض انگلیسی است؛ می‌توانید آن را ویرایش کنید یا به فارسی بنویسید. کلید یا اطلاعات محرمانه وارد نکنید. بین ۲۰ تا ۲۰۰۰ نویسه." : "This text is sent to the model and recorded in the run report. The built-in instructions are in English; you may edit them in either language. Do not include credentials or secrets. Length must be 20–2,000 characters."}/><textarea rows={4} value={strategy.mandate} onChange={(event) => updateStrategy(strategy.id, { mandate: event.target.value })}/></label>
      <div className="strategy-bottom"><label className="setting-field"><span><FieldLabelInfo label={locale === "fa" ? "حداقل اطمینان لازم" : "Minimum confidence"} help={locale === "fa" ? "اگر اطمینان مدل از این درصد کمتر باشد، پیشنهاد خرید یا فروش کنار گذاشته می‌شود و نتیجه «فعلاً معامله نکن» خواهد بود. اطمینان مدل احتمال موفقیت معامله نیست." : "Below this threshold, buy or sell proposals are discarded. Confidence is not a probability of profit."}/><b>{new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 0 }).format(strategy.minConfidence * 100)}{locale === "fa" ? "٪" : "%"}</b></span><input type="range" min="0" max="1" step="0.01" value={strategy.minConfidence} onChange={(event) => updateStrategy(strategy.id, { minConfidence: Number(event.target.value) })}/></label>
        <fieldset className="order-types"><legend><FieldLabelInfo label={locale === "fa" ? "روش سفارش مجاز" : "Allowed order types"} help={locale === "fa" ? "نوع سفارشی که این استراتژی می‌تواند پیشنهاد دهد. هر پیشنهاد همچنان از بررسی بازار و محدودیت‌های ریسک می‌گذرد." : "Order types this strategy may propose. Every proposal still passes engine market and risk gates."}/></legend>{(["MARKET", "LIMIT"] as const).map((type) => <label key={type}><input type="checkbox" checked={strategy.allowedOrderTypes.includes(type)} onChange={(event) => updateStrategy(strategy.id, { allowedOrderTypes: event.target.checked ? [...strategy.allowedOrderTypes, type] : strategy.allowedOrderTypes.filter((item) => item !== type) })}/>{orderValueTitle(type, locale)}</label>)}</fieldset></div>
      <div className="strategy-limits"><label><FieldLabelInfo label={locale === "fa" ? "بیشترین ارزش هر سفارش" : "Max order notional"} help={locale === "fa" ? "بیشترین مبلغ برای یک سفارش از این استراتژی. اگر خالی بماند، سقف ریسک پروفایل اعمال می‌شود." : "Per-order notional cap in quote currency for this strategy. Blank uses the profile risk cap."}/><MoneyInput value={strategy.maxOrderNotional ?? ""} currency={quote} locale={locale} placeholder={locale === "fa" ? "استفاده از سقف پروفایل" : "Use profile limit"} onChange={(raw) => updateLimit(strategy.id, "maxOrderNotional", raw)}/></label><label><FieldLabelInfo label={locale === "fa" ? "بیشترین ارزش در هر جفت‌ارز" : "Max position"} help={locale === "fa" ? "سقف ارزش موقعیت این استراتژی در یک جفت‌ارز. اگر خالی بماند، سقف پروفایل اعمال می‌شود." : "Maximum position notional in one market. Blank uses the profile cap."}/><MoneyInput value={strategy.maxPositionNotional ?? ""} currency={quote} locale={locale} placeholder={locale === "fa" ? "استفاده از سقف پروفایل" : "Use profile limit"} onChange={(raw) => updateLimit(strategy.id, "maxPositionNotional", raw)}/></label><label><FieldLabelInfo label={locale === "fa" ? "سقف مجموع موقعیت‌های باز" : "Max gross exposure"} help={locale === "fa" ? "حداکثر ارزش همهٔ موقعیت‌های باز این استراتژی. این مقدار نمی‌تواند سقف کلی ریسک پروفایل را بیشتر کند." : "Total exposure cap for this strategy in quote currency. Must be positive and can only tighten the global risk limit."}/><MoneyInput value={strategy.maxGrossExposure ?? ""} currency={quote} locale={locale} placeholder={locale === "fa" ? "استفاده از سقف پروفایل" : "Use profile limit"} onChange={(raw) => updateLimit(strategy.id, "maxGrossExposure", raw)}/></label></div>
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
    catch (error) { notify(error instanceof Error ? errorText(error.message, locale) : "Allowlist could not be saved."); }
  };
  return <><PageHeading title={t.marketsTitle} description={locale === "fa" ? "جفت‌ارزهای انتخاب‌شده برای اجراها در دسترس خواهند بود. پیش از انتخاب، از فعال‌بودن هر جفت در والکس و امکان معامله با بستهٔ اعتباری‌تان مطمئن شوید." : "The configured allowlist gates markets in every mode. Check your Wallex credit package restrictions before enabling a pair."} action={<button className="button secondary" onClick={() => void marketsQuery.refetch()} disabled={marketsQuery.isFetching}><RefreshCw size={15} className={marketsQuery.isFetching ? "spin" : ""}/>{t.refresh}</button>} />
    <Card><div className="market-toolbar"><div className="field-search"><Search size={15}/><input aria-label={t.search} placeholder={t.search} value={search} onChange={(event) => setSearch(event.target.value)}/></div><label className="checkbox-row"><input type="checkbox" checked={all} onChange={(event) => setAll(event.target.checked)}/>{t.allMarkets}</label><span className="count-pill">{selected.length} {t.allowlist}</span><button className="button primary" onClick={() => void save()}><Check size={15}/>{t.apply}</button></div>
      <div className="table-wrap market-table-wrap"><table><thead><tr><th>{locale === "fa" ? "مجاز" : "Allow"}</th><th>{t.symbol}</th><th>{locale === "fa" ? "ارز پایه" : "Base asset"}</th><th>{locale === "fa" ? "بازار پایه" : "Quote asset"}</th><th>{locale === "fa" ? "وضعیت" : "Status"}</th><th><FieldLabelInfo label={locale === "fa" ? "دقت قیمت / مقدار" : "Price / quantity precision"} help={locale === "fa" ? "تعداد رقم اعشار مجاز برای قیمت و مقدار سفارش در این بازار والکس. سفارش‌هایی که از این دقت بیشتر داشته باشند پذیرفته نمی‌شوند." : "Maximum decimal places allowed for order prices and quantities on this Wallex market. Orders with more precision are rejected."}/></th></tr></thead><tbody>{filtered.map((market) => <tr key={market.symbol}><td><input type="checkbox" aria-label={`${market.symbol} allowlist`} checked={selected.includes(market.symbol)} onChange={() => toggle(market.symbol)}/></td><td><b>{market.symbol}</b></td><td>{market.baseAsset}</td><td>{market.quoteAsset}</td><td><span className={market.spotEnabled ? "status status-completed" : "status status-failed"}>{market.spotEnabled ? (locale === "fa" ? "فعال" : "Active") : (locale === "fa" ? "غیرفعال" : "Inactive")}</span></td><td>{market.pricePrecision ?? "—"} / {market.quantityPrecision ?? "—"}</td></tr>)}</tbody></table></div>
      {marketsQuery.isError && <InlineError message={marketsQuery.error.message} locale={locale} text={locale === "fa" ? "بازارها بارگیری نشدند. اتصال والکس را بررسی کنید و دوباره تلاش کنید." : "Could not load markets. Check the Wallex connection and try again."}/>}
      {marketsQuery.isPending && <div className="loading-line"><LoaderCircle className="spin" size={18}/>{locale === "fa" ? "در حال دریافت بازارهای والکس…" : "Fetching Wallex markets…"}</div>}
      {!marketsQuery.isPending && !marketsQuery.isError && filtered.length === 0 && <Empty text={t.noData}/>}
    </Card>
    <p className="form-caption"><Shield size={14}/>{locale === "fa" ? "انتخاب جفت‌ارز در این صفحه فقط اجازهٔ استفاده از آن را در اجراها می‌دهد؛ سفارشی ثبت نمی‌کند." : "Selecting a market only makes it available to a run; it does not place an order."}</p>
  </>;
}

/** Searchable picker over the profile's allowlisted pairs; single-select in live mode. */
function PairPicker({ options, selected, single, quoteCurrency, assetIcons, locale, onChange, onNavigate }: { options: string[]; selected: string[]; single: boolean; quoteCurrency: string; assetIcons: Record<string, string>; locale: Locale; onChange: (next: string[]) => void; onNavigate: (view: string, options?: NavigateOptions) => void }) {
  const [query, setQuery] = useState("");
  const fa = locale === "fa";
  const label = (symbol: string) => symbol.endsWith(quoteCurrency) && symbol.length > quoteCurrency.length ? `${symbol.slice(0, -quoteCurrency.length)}/${quoteCurrency}` : symbol;
  const visible = options.filter((symbol) => !query || symbol.toLowerCase().includes(query.toLowerCase()) || label(symbol).toLowerCase().includes(query.toLowerCase()));
  const toggle = (symbol: string) => onChange(single ? [symbol] : selected.includes(symbol) ? selected.filter((item) => item !== symbol) : [...selected, symbol]);
  if (options.length === 0) return <div className="notice warning pair-picker-empty"><span className="notice-icon"><AlertTriangle size={16}/></span><div><b>{fa ? "هنوز جفت‌ارزی برای این پروفایل مجاز نشده است" : "No markets are allowed for this profile yet"}</b><p>{fa ? "در صفحهٔ بازارها دست‌کم یک جفت فعال را انتخاب و ذخیره کنید؛ سپس همین‌جا آن را برای اجرا برگزینید." : "Select and save at least one active pair on the Markets page, then pick it here for the run."}</p><button type="button" className="button secondary" onClick={() => onNavigate("markets")}><ArrowUpRight size={14}/>{fa ? "باز کردن بازارها" : "Open markets"}</button></div></div>;
  return <div className="pair-picker">
    <div className="pair-picker-toolbar"><span className="field-search"><Search size={15}/><input aria-label={fa ? "جست‌وجوی جفت‌ارز" : "Search pairs"} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={fa ? "جست‌وجو در جفت‌ارزهای مجاز" : "Search allowed pairs"}/></span><span className="count-pill">{single ? (selected[0] ? label(selected[0]) : (fa ? "انتخاب نشده" : "none selected")) : `${numberLabel(selected.length, locale)} ${fa ? "انتخاب‌شده" : "selected"}`}</span>{!single && selected.length > 0 && <button type="button" className="text-button" onClick={() => onChange([])}>{fa ? "پاک کردن" : "Clear"}</button>}</div>
    <div className="pair-picker-grid" role={single ? "radiogroup" : "group"}>{visible.map((symbol) => { const active = selected.includes(symbol); return <button type="button" key={symbol} className={`pair-option ${active ? "selected" : ""}`} role={single ? "radio" : "checkbox"} aria-checked={active} onClick={() => toggle(symbol)}><CurrencyPairAvatar symbol={symbol} quoteCurrency={quoteCurrency} assetIcons={assetIcons}/><span className="pair-option-copy"><b>{label(symbol)}</b><small dir="ltr">{symbol}</small></span>{active && <Check size={14}/>}</button>; })}{visible.length === 0 && <p className="muted small-text">{fa ? "جفت‌ارزی با این جست‌وجو پیدا نشد." : "No allowed pair matches this search."}</p>}</div>
    <small className="muted pair-picker-note">{fa ? "فقط جفت‌ارزهای فهرست مجاز پروفایل نمایش داده می‌شوند." : "Only the profile's allowlisted pairs are shown."} <button type="button" className="text-button inline" onClick={() => onNavigate("markets")}>{fa ? "افزودن جفت‌ارز" : "Add pairs"}<ArrowUpRight size={12}/></button></small>
  </div>;
}

function RunLabView({ t, locale, profileId, profiles, config, strategies, runs, managedRuns, assetIcons, notify, onRefresh, onNavigate }: { t: Record<string, string>; locale: Locale; profileId: string; profiles: Profile[]; config: JsonMap; strategies: Strategy[]; runs: Run[]; managedRuns: ManagedRun[]; assetIcons: Record<string, string>; notify: (message: string, action?: ToastAction) => void; onRefresh: () => void; onNavigate: (view: string, options?: NavigateOptions) => void }) {
  const [startError, setStartError] = useState<ErrorGuidance[]>([]);
  const [mode, setMode] = useState<"backtest" | "shadow" | "live">("shadow");
  const [symbols, setSymbols] = useState<string>((config.wallex?.allowedMarkets ?? [])[0] ?? "");
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
  // Live-only per-pair limits for the selected pair; they can only tighten what the profile already has.
  const [reservedBase, setReservedBase] = useState("");
  const [maxSellPct, setMaxSellPct] = useState("");
  const [maxBuyBudget, setMaxBuyBudget] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [understandsRisk, setUnderstandsRisk] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const queryClient = useQueryClient();
  const selectedProfile = profiles.find((item) => item.id === profileId);
  const startMutation = useMutation({
    mutationFn: (body: JsonMap) => api<{ run: ManagedRun }>("/api/runs", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: ({ run }) => {
      setShowConfirmation(false); setConfirmationText(""); setUnderstandsRisk(false); setStartError([]);
      void queryClient.invalidateQueries({ queryKey: ["runs"] }); onRefresh();
      // Take the user to the run's report, where progress, decisions, and orders appear as the engine works.
      notify(locale === "fa" ? `اجرای ${run.id.slice(0, 8)} آغاز شد؛ پیشرفت آن در «گزارش و بررسی» نمایش داده می‌شود.` : `Run ${run.id.slice(0, 8)} started. Its progress is shown in Reports.`);
      onNavigate("reports", { runId: run.id });
    },
    onError: (error) => { setStartError(errorGuidance(error.message, locale)); notify(errorText(error.message.split("\n")[0] ?? error.message, locale)); },
  });
  const stopRun = async (runId: string) => {
    try { await api(`/api/managed-runs/${encodeURIComponent(runId)}/stop`, { method: "POST", body: JSON.stringify({}) }); void queryClient.invalidateQueries({ queryKey: ["runs"] }); notify(t.stopPending); }
    catch (error) { notify(error instanceof Error ? errorText(error.message, locale) : "Could not stop this run."); }
  };
  const resumeRun = async (run: Run) => {
    try { await api(`/api/runs/${encodeURIComponent(run.id)}/resume`, { method: "POST", body: JSON.stringify({ profileId }) }); onRefresh(); notify(locale === "fa" ? "ادامهٔ آزمایش تاریخی آغاز شد." : "Backtest recovery started."); }
    catch (error) { notify(error instanceof Error ? errorText(error.message, locale) : "Recovery could not start."); }
  };
  const overrideValues = () => ({
    ...(startingCash ? { PAPER_INITIAL_CASH: startingCash } : {}),
    ...(feeBps ? { BACKTEST_FEE_BPS: feeBps } : {}),
    ...(slippageBps ? { BACKTEST_SLIPPAGE_BPS: slippageBps } : {}),
    ...(riskCap ? { RISK_MAX_GROSS_EXPOSURE: riskCap, RISK_MAX_ORDER_NOTIONAL: riskCap, LIVE_MAX_GROSS_EXPOSURE: riskCap } : {}),
  });
  const liveOverrides = (pair: string | undefined): Record<string, string> => {
    const result: Record<string, string> = riskCap ? { RISK_MAX_GROSS_EXPOSURE: riskCap, RISK_MAX_ORDER_NOTIONAL: riskCap, LIVE_MAX_GROSS_EXPOSURE: riskCap } : {};
    if (pair && (reservedBase || maxSellPct || maxBuyBudget)) {
      // Merge into the profile's limits so the server's "only tighten" rule sees every existing pair.
      const all: Record<string, JsonMap> = { ...object(config.risk?.pairLimits) };
      all[pair] = { ...object(all[pair]), ...(reservedBase ? { reservedBase } : {}), ...(maxSellPct ? { maxSellPct } : {}), ...(maxBuyBudget ? { maxBuyNotional: maxBuyBudget } : {}) };
      result.RISK_PAIR_LIMITS_JSON = JSON.stringify(all);
    }
    return result;
  };
  const makeRequest = (confirmed: boolean) => {
    const pairs = symbols.split(",").map((pair) => pair.trim().toUpperCase()).filter(Boolean);
    const overrides = overrideValues();
    if (mode === "backtest") return { mode, profileId, symbols: pairs, strategyIds, from: Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000), to: Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000), overrides };
    if (mode === "shadow") return { mode, profileId, symbols: pairs, strategyIds, watch, intervalSeconds: Number(intervalSeconds), overrides };
    return { mode, profileId, symbol: pairs[0] ?? "", strategyId: strategyIds[0] ?? "", autoTrade, intervalSeconds: Number(intervalSeconds), confirmed: confirmed as true, overrides: liveOverrides(pairs[0]) };
  };
  const riskLimit = config.wallex?.liveMaxGrossExposure ?? config.risk?.maxGrossExposure ?? "0";
  const activeRuns = managedRuns.filter((run) => ["starting", "running", "waiting", "stopping"].includes(run.state));
  const changeMode = (next: "backtest" | "shadow" | "live") => {
    setMode(next); setShowConfirmation(false);
    if (next === "live") {
      setStrategyIds((current) => [current[0] ?? strategies[0]?.id].filter((id): id is string => Boolean(id)));
      setSymbols((current) => current.split(",").map((pair) => pair.trim()).filter(Boolean)[0] ?? "");
    }
  };
  const toggleStrategy = (id: string) => setStrategyIds((current) => mode === "live" ? [id] : current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const selectedPairs = symbols.split(",").map((pair) => pair.trim()).filter(Boolean);
  const validLivePair = selectedPairs.length === 1;
  const startForm = (event: FormEvent) => {
    event.preventDefault();
    if (selectedPairs.length === 0) { notify(locale === "fa" ? "دست‌کم یک جفت‌ارز انتخاب کنید." : "Select at least one pair."); return; }
    if (mode === "live" && !validLivePair) { notify(locale === "fa" ? "برای معامله واقعی دقیقاً یک جفت‌ارز انتخاب کنید." : "Select exactly one market for live trading."); return; }
    // Catch the most common live mistake before the request: a per-run cap above the profile limit.
    if (mode === "live" && riskCap && Number(riskCap) > Number(riskLimit)) { setStartError(errorGuidance("Live per-run override 'LIVE_MAX_GROSS_EXPOSURE' cannot exceed the selected profile's risk limit.", locale)); return; }
    setStartError([]);
    if (mode === "live") { setShowConfirmation(true); return; }
    startMutation.mutate(makeRequest(false));
  };

  return <><PageHeading title={t.runTitle} description={locale === "fa" ? "حالت اجرا، جفت‌ارزها، استراتژی‌ها و محدودیت‌ها را انتخاب کنید. آزمایش تاریخی و شبیه‌سازی با قیمت زنده از سرمایهٔ واقعی استفاده نمی‌کنند." : "Choose the execution mode, markets, strategies, and limits. Backtest and shadow modes never use real funds."} />
    <div className="run-layout"><Card className="run-form-card"><div className="mode-tabs" role="tablist" aria-label={locale === "fa" ? "حالت اجرا" : "Run mode"}>{(["backtest", "shadow", "live"] as const).map((item, index, items) => <div className="mode-tab-item" role="presentation" key={item}><button id={`run-mode-${item}`} type="button" role="tab" aria-label={t[item]} aria-controls="run-mode-panel" aria-selected={mode === item} tabIndex={mode === item ? 0 : -1} className={`mode-tab ${mode === item ? "active" : ""} ${item}`} onKeyDown={(event) => {
      const direction = locale === "fa" ? -1 : 1;
      const nextIndex = event.key === "ArrowRight" ? (index + direction + items.length) % items.length : event.key === "ArrowLeft" ? (index - direction + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
      if (nextIndex >= 0) { event.preventDefault(); const next = items[nextIndex]!; changeMode(next); document.getElementById(`run-mode-${next}`)?.focus(); }
    }} onClick={() => changeMode(item)}><span aria-hidden="true">{item === "backtest" ? <BarChart3 size={16}/> : item === "shadow" ? <CirclePlay size={16}/> : <WalletCards size={16}/>}</span>{t[item]}{item === "live" && <small>{locale === "fa" ? "واقعی" : "REAL"}</small>}</button><InfoTooltip className="mode-help" label={t[item]} help={modeHelp(item, locale)}/></div>)}</div>
      <div id="run-mode-panel" role="tabpanel" aria-labelledby={`run-mode-${mode}`} tabIndex={0}>
      <div className={`mode-intro ${mode}`}><span>{mode === "live" ? <AlertTriangle size={17}/> : mode === "shadow" ? <Shield size={17}/> : <BarChart3 size={17}/>}</span><p>{t[`${mode}Hint`]}</p></div>
      {startError.length > 0 && <div className="notice warning run-error" role="alert"><span className="notice-icon"><AlertTriangle size={17}/></span><div><b>{locale === "fa" ? "اجرا شروع نشد" : "The run could not start"}</b>{startError.map((item, index) => <div className="run-error-item" key={index}><p>{item.text}</p>{item.hint && <p className="run-error-hint">{item.hint}</p>}{item.target && <button type="button" className="button secondary" onClick={() => onNavigate(item.target!.view, item.target)}><ArrowUpRight size={14}/>{item.targetLabel}</button>}</div>)}</div><button type="button" className="icon-button tiny" onClick={() => setStartError([])} aria-label={locale === "fa" ? "بستن" : "Dismiss"}><X size={14}/></button></div>}
      <form onSubmit={startForm} className="run-form">
        <div className="field-row"><div className="field-label"><FieldLabelInfo label={t.profile} help={locale === "fa" ? "پروفایل فعال، مدل‌ها، جفت‌های مجاز، محدودیت‌ها و تنظیمات دستیارها را برای اجرای جدید تعیین می‌کند." : "The active profile supplies model routes, market allowlist, risk limits, and agent settings for this run."}/><div className="profile-readonly"><span className="profile-initial">{(selectedProfile?.name ?? profileId).slice(0, 1).toUpperCase()}</span><b>{selectedProfile?.name ?? profileId}</b><small>{locale === "fa" ? "برای تغییر، پروفایل فعال را از نوار بالا انتخاب کنید." : "Change the active profile from the top bar."}</small></div></div>
          <label className="field-label"><FieldLabelInfo label={t.interval} help={locale === "fa" ? "فاصلهٔ زمانی میان ارزیابی‌ها برحسب ثانیه است و باید بین ۱۰ تا ۸۶٬۴۰۰ باشد. برای ارزیابی هر یک دقیقه، عدد ۶۰ را وارد کنید." : "Delay between live evaluation cycles, in seconds; valid range is 10–86,400. For a one-minute shadow cadence use 60."}/><input type="number" min="10" max="86400" step="1" value={intervalSeconds} onChange={(event) => setIntervalSeconds(event.target.value)} disabled={mode === "backtest"}/></label></div>
        <label className="field-label"><FieldLabelInfo label={mode === "live" ? t.symbol : t.symbols} help={mode === "live" ? (locale === "fa" ? "برای معاملهٔ واقعی یک جفت‌ارز انتخاب کنید. این جفت‌ارز باید در والکس فعال و در فهرست مجاز این پروفایل باشد." : "A live run uses exactly one Wallex market. It must be in the profile allowlist and the active credit package.") : (locale === "fa" ? "یک یا چند جفت‌ارز را از فهرست مجاز پروفایل انتخاب کنید. هر استراتژی برای هر جفت جداگانه بررسی می‌شود." : "Pick one or more pairs from the profile's allowlist. Each selected strategy is evaluated for every market.")}/><PairPicker options={config.wallex?.allowedMarkets ?? []} selected={selectedPairs} single={mode === "live"} quoteCurrency={config.wallex?.quoteCurrency ?? "TMN"} assetIcons={assetIcons} locale={locale} onChange={(next) => setSymbols(next.join(","))} onNavigate={onNavigate}/>{mode === "live" && !validLivePair && selectedPairs.length > 1 && <small className="error-text">{locale === "fa" ? "برای معاملهٔ واقعی فقط یک جفت‌ارز انتخاب کنید." : "Live trading uses exactly one pair."}</small>}</label>
        <fieldset className="strategy-selector"><legend><FieldLabelInfo label={t.strategies} help={locale === "fa" ? "استراتژی مشخص می‌کند دستیارها چگونه شواهد را جمع‌بندی و چه نوع پیشنهادی را بررسی کنند. برای آزمایش و شبیه‌سازی می‌توانید چند استراتژی انتخاب کنید؛ در معامله واقعی یکی را برگزینید. همهٔ پیشنهادها از بررسی ریسک می‌گذرند." : "Strategies set proposal policy and minimum confidence; every proposal still passes deterministic risk gates. Backtest and shadow allow multiple strategies; live uses one strategy per run."}/></legend><div className="strategy-chips">{strategies.map((strategy) => <div className="strategy-option" key={strategy.id}><label className={`strategy-chip ${strategyIds.includes(strategy.id) ? "selected" : ""}`}><input type={mode === "live" ? "radio" : "checkbox"} name={mode === "live" ? "live-strategy" : undefined} checked={strategyIds.includes(strategy.id)} onChange={() => toggleStrategy(strategy.id)}/><span><b>{strategyTitle(strategy, locale)}</b>{locale === "en" && <small>{strategy.id}</small>}</span></label><InfoTooltip label={strategyTitle(strategy, locale)} help={strategyHelp(strategy, locale)}/></div>)}</div></fieldset>
        {mode === "backtest" && <div className="field-row"><label className="field-label"><FieldLabelInfo label={t.from} help={locale === "fa" ? "روز شروع آزمایش تاریخی بر پایهٔ زمان هماهنگ جهانی (UTC). دادهٔ قیمت باید از والکس برای این بازه در دسترس باشد." : "UTC start date for historical replay; candles must be available from Wallex for this period."}/><input required type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label><label className="field-label"><FieldLabelInfo label={t.to} help={locale === "fa" ? "روز پایان آزمایش تاریخی بر پایهٔ UTC؛ باید هم‌زمان یا پس از تاریخ شروع باشد." : "UTC end date for historical replay; it must be on or after the start date."}/><input required type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label></div>}
        {mode !== "backtest" && <div className="toggle-stack">{mode === "shadow" ? <label className="toggle-row"><span><FieldLabelInfo label={t.watch} help={locale === "fa" ? "پس از ارزیابی اول، شبیه‌سازی را فعال نگه می‌دارد و در فاصله‌های انتخاب‌شده، سبد مجازی را با داده‌های تازه به‌روز می‌کند." : "Keep the shadow run active after its first evaluation and update its virtual portfolio at the configured interval."}/><small>{locale === "fa" ? "پس از هر چرخه، سبد دارایی مجازی به‌روز می‌شود." : "Keep the virtual portfolio running between cycles."}</small></span><input type="checkbox" checked={watch} onChange={(event) => setWatch(event.target.checked)}/></label> : <label className="toggle-row live-toggle"><span><FieldLabelInfo label={t.auto} help={locale === "fa" ? "پس از پایان هر چرخه، ارزیابی را با همین جفت‌ارز و استراتژی تکرار می‌کند. برای ادامهٔ خودکار، اجازهٔ معاملهٔ خودکار باید در تنظیمات پروفایل فعال باشد." : "Repeats live evaluations using this market and strategy. Automated runs require this option and explicit confirmation before starting live."}/><small>{locale === "fa" ? "برای اجرای پیوسته، اجازهٔ معاملهٔ خودکار را در تنظیمات پروفایل فعال کنید." : "Enable automated trading in profile settings before starting."}</small></span><input type="checkbox" checked={autoTrade} onChange={(event) => setAutoTrade(event.target.checked)}/></label>}</div>}
        <details className="advanced-run"><summary><SlidersHorizontal size={15}/>{locale === "fa" ? "محدودیت‌ها و فرض‌های پیشرفته برای این اجرا" : "Advanced limits and assumptions for this run"}<InfoTooltip label={locale === "fa" ? "محدودیت‌ها و فرض‌ها" : "Run limits and assumptions"} help={locale === "fa" ? "این تنظیم‌ها فقط برای همین اجرا هستند. سرمایه، کارمزد و اختلاف احتمالی قیمت فقط در سبد مجازی اثر دارند. سقف سرمایهٔ درگیر می‌تواند محدودیت ریسک پروفایل را سخت‌گیرانه‌تر کند." : "These values apply only to this run. Cash, fee, and slippage inputs affect the virtual portfolio; exposure overrides tighten the profile's risk limits for this run."}/></summary><div className="advanced-grid">{mode !== "live" && <><label><FieldLabelInfo label={locale === "fa" ? "سرمایهٔ مجازی اولیه" : "Virtual starting cash"} help={locale === "fa" ? "موجودی مجازی آغاز این اجرا، به ارز بازار پایه. این مبلغ واقعی نیست و باید بیشتر از صفر باشد." : "Initial quote-currency balance for this new virtual portfolio. Must be positive and never affects actual funds."}/><MoneyInput value={startingCash} currency={config.wallex?.quoteCurrency ?? "TMN"} locale={locale} placeholder={String(config.paperInitialCash ?? (locale === "fa" ? "مقدار پیش‌فرض پروفایل" : "profile default"))} onChange={setStartingCash}/><span className="field-limit-note">{locale === "fa" ? "پیش‌فرض پروفایل:" : "Profile default:"} <b>{money(config.paperInitialCash, config.wallex?.quoteCurrency ?? "TMN", locale)}</b></span></label><label><FieldLabelInfo label={locale === "fa" ? "کارمزد فرضی (واحد پایه)" : "Fees (bps)"} help={locale === "fa" ? "کارمزد هر بار خرید یا فروش در سبد مجازی؛ هر ۱۰۰ واحد پایه برابر ۱٪ است." : "Assumed fee per fill side in basis points; 100 bps equals 1%."}/><input inputMode="decimal" placeholder={String(config.backtestAssumptions?.feeBps ?? (locale === "fa" ? "مقدار پیش‌فرض پروفایل" : "profile default"))} value={feeBps} onChange={(event) => setFeeBps(event.target.value)}/></label><label><FieldLabelInfo label={locale === "fa" ? "اختلاف احتمالی قیمت (واحد پایه)" : "Slippage (bps)"} help={locale === "fa" ? "برآورد اختلاف قیمت ثبت‌شده با قیمت مورد انتظار؛ هر ۱۰۰ واحد پایه برابر ۱٪ است. در داده‌های گذشته فهرست سفارش‌ها در دسترس نیست." : "Assumed execution slippage in basis points; it does not reconstruct historical order books."}/><input inputMode="decimal" placeholder={String(config.backtestAssumptions?.slippageBps ?? (locale === "fa" ? "مقدار پیش‌فرض پروفایل" : "profile default"))} value={slippageBps} onChange={(event) => setSlippageBps(event.target.value)}/></label></>}
          <label><FieldLabelInfo label={mode === "live" ? (locale === "fa" ? "حداکثر مبلغ مجاز در این اجرا" : "Tighter per-run risk cap") : (locale === "fa" ? "سقف سرمایهٔ درگیر" : "Optional gross exposure cap")} help={locale === "fa" ? "حداکثر ارزش دارایی‌ای که در این اجرا می‌تواند در بازار درگیر شود، برحسب ارز بازار پایه. در معاملهٔ واقعی، این مقدار فقط می‌تواند سقف پروفایل را کاهش دهد. تعیین سقف به‌معنای محدودشدن قطعی زیان نیست." : "Per-run notional exposure cap in quote currency. Live overrides may only reduce the profile cap; no cap guarantees losses cannot exceed it."}/><MoneyInput value={riskCap} currency={config.wallex?.quoteCurrency ?? "TMN"} locale={locale} placeholder={String(riskLimit)} onChange={setRiskCap}/><span className="field-limit-note">{mode === "live" ? (locale === "fa" ? "سقف پروفایل:" : "Profile limit:") : (locale === "fa" ? "سقف فعلی پروفایل:" : "Current profile limit:")} <b>{money(riskLimit, config.wallex?.quoteCurrency ?? "TMN", locale)}</b></span><small>{mode === "live" ? (locale === "fa" ? "این سقف نمی‌تواند از سقف تعیین‌شده در پروفایل بیشتر باشد؛ «حداکثر ارزش موقعیت در معاملهٔ واقعی» در تنظیمات والکس پروفایل تغییر می‌کند." : "Live limits can only be tightened relative to the profile; change \"Live total exposure cap\" under the profile's Wallex settings.") : (locale === "fa" ? "این مقدار جایگزین محدودیت‌های متناظر در این اجرا می‌شود." : "Overrides the corresponding profile limit for this run.")}</small>{mode === "live" && riskCap && Number(riskCap) > Number(riskLimit) && <small className="error-text">{locale === "fa" ? "از سقف پروفایل بیشتر است." : "Above the profile limit."}</small>}</label>
          {mode === "live" && selectedPairs[0] && (() => {
            const pair = selectedPairs[0]!, quote = String(config.wallex?.quoteCurrency ?? "TMN"), base = pair.endsWith(quote) && pair.length > quote.length ? pair.slice(0, -quote.length) : pair;
            const current = object(object(config.risk?.pairLimits)[pair]);
            return <>
              <label><FieldLabelInfo label={locale === "fa" ? `نگه‌داشت ${base} (هرگز فروخته نمی‌شود)` : `Reserved ${base} (never sold)`} help={locale === "fa" ? "مقداری از دارایی پایه که دستیارها هرگز نمی‌توانند بفروشند. فقط می‌تواند بیشتر از مقدار پروفایل باشد." : "Base-asset quantity the agents can never sell. Can only be larger than the profile's value."}/><input dir="ltr" inputMode="decimal" value={reservedBase} placeholder={String(current.reservedBase ?? "0")} onChange={(event) => setReservedBase(event.target.value.replace(/[^0-9.]/g, ""))}/><span className="field-limit-note">{locale === "fa" ? "پروفایل:" : "Profile:"} <b>{String(current.reservedBase ?? "0")} {base}</b></span></label>
              <label><FieldLabelInfo label={locale === "fa" ? "حداکثر فروش در هر چرخه (٪ دارایی)" : "Max sell per cycle (% of holding)"} help={locale === "fa" ? "بیشترین سهمی از دارایی فعلی که یک فروش می‌تواند بردارد. فقط می‌تواند کمتر از مقدار پروفایل باشد." : "The largest share of the current holding one sell may take. Can only be smaller than the profile's value."}/><input type="number" min="0" max="100" step="1" value={maxSellPct} placeholder={String(current.maxSellPct ?? "100")} onChange={(event) => setMaxSellPct(event.target.value)}/><span className="field-limit-note">{locale === "fa" ? "پروفایل:" : "Profile:"} <b>{String(current.maxSellPct ?? (locale === "fa" ? "بدون محدودیت" : "no limit"))}{current.maxSellPct ? "%" : ""}</b></span></label>
              <label><FieldLabelInfo label={locale === "fa" ? `بودجهٔ خرید ${base}` : `Buy budget for ${base}`} help={locale === "fa" ? "بیشترین ارزشی که یک خرید می‌تواند به این جفت‌ارز اضافه کند. فقط می‌تواند کمتر از مقدار پروفایل باشد." : "The most one buy may add to this pair. Can only be smaller than the profile's value."}/><MoneyInput value={maxBuyBudget} currency={quote} locale={locale} placeholder={String(current.maxBuyNotional ?? "")} onChange={setMaxBuyBudget}/><span className="field-limit-note">{locale === "fa" ? "پروفایل:" : "Profile:"} <b>{current.maxBuyNotional ? money(current.maxBuyNotional, quote, locale) : (locale === "fa" ? "بدون محدودیت" : "no limit")}</b></span></label>
            </>;
          })()}</div></details>
        {mode === "live" && <div className="notice danger"><span className="notice-icon"><AlertTriangle size={18}/></span><div><b>{locale === "fa" ? "معاملهٔ واقعی — امکان ثبت سفارش" : "Live mode — real orders may be submitted"}</b><p>{locale === "fa" ? "سفارش فقط پس از تأیید پیشنهاد در بررسی ریسک و بررسی دوبارهٔ حساب ثبت می‌شود." : "An order is only possible after a proposal passes engine risk gates and account reconciliation."}</p></div></div>}
        <div className="run-submit-row"><span className="muted small-text">{mode === "live" ? `${t.exposure}: ${money(riskLimit, config.wallex?.quoteCurrency ?? "TMN", locale)}` : `${t.virtual}: ${money(config.paperInitialCash, config.wallex?.quoteCurrency ?? "TMN", locale)}`}</span><button className={`button ${mode === "live" ? "danger-button" : "primary"}`} disabled={startMutation.isPending || strategyIds.length === 0 || (mode === "live" && !validLivePair)}><CirclePlay size={16}/>{startMutation.isPending ? (locale === "fa" ? "در حال آماده‌سازی…" : "Starting…") : locale === "fa" ? (mode === "backtest" ? "شروع آزمایش تاریخی" : mode === "shadow" ? "شروع شبیه‌سازی" : "بررسی و تأیید معاملهٔ واقعی") : t.start}</button></div>
      </form>
      </div>
    </Card>
    <div className="run-side"><Card><div className="card-heading"><div><h2>{locale === "fa" ? "اجراهای در جریان" : "Managed runs"}</h2></div><span className="count-pill">{numberLabel(activeRuns.length, locale)}</span></div>{activeRuns.length === 0 ? <Empty text={locale === "fa" ? "در حال حاضر اجرای فعالی ندارید." : "No active managed runs."}/> : <div className="managed-run-list">{activeRuns.map((run) => <div className="managed-run" key={run.id}><div className="run-badges"><span className={`mode-badge ${run.mode}`}>{modeTitle(run.mode, locale)}</span><span className={statusClass(run.state)}>{statusTitle(run.state, locale)}</span></div><div className="run-market"><CurrencyPairAvatar symbol={run.symbols[0] ?? "?"} quoteCurrency={config.wallex?.quoteCurrency} assetIcons={assetIcons}/><div><strong>{run.symbols.join(", ")}</strong><small>{run.strategyIds.map((id) => strategyIdTitle(id, locale)).join("، ")}</small></div></div><p>{managedRunMessage(run.message, run.state, run.mode, locale)}</p><button className="button danger-outline full" disabled={run.state === "stopping"} onClick={() => void stopRun(run.id)}><CircleStop size={15}/>{run.state === "stopping" ? t.stopPending : t.stop}</button></div>)}</div>}</Card>
      <Card><div className="card-heading"><div><h2>{locale === "fa" ? "اجراهای اخیر" : "Recent runs"}</h2></div></div>{runs.slice(0, 8).length === 0 ? <Empty text={t.noRuns}/> : <div className="managed-run-list">{runs.slice(0, 8).map((run) => { const runConfig = object(run.config); const symbolsForRun = runSymbols(runConfig); const symbol = symbolsForRun[0] ?? run.id.slice(0, 8); const strategyLabels = runStrategies(runConfig); return <div className="recent-job" key={run.id}><CurrencyPairAvatar symbol={symbol} quoteCurrency={config.wallex?.quoteCurrency} assetIcons={assetIcons}/><div className="recent-job-content"><div className="run-badges"><span className={`mode-badge ${run.mode}`}>{modeTitle(run.mode, locale)}</span><span className={statusClass(run.status)}>{statusTitle(run.status, locale)}</span></div><b dir="ltr">{symbolsForRun.join(", ") || run.id.slice(0, 8)}</b><small>{dateLabel(run.startedAt, locale)}{strategyLabels.length ? ` · ${strategyLabels.map((id) => strategyIdTitle(id, locale)).join("، ")}` : ""}</small>{run.mode === "backtest" && run.status === "failed" && <button className="button secondary small-button" onClick={() => void resumeRun(run)}><RefreshCw size={13}/>{locale === "fa" ? "ادامه از آخرین نقطهٔ ذخیره‌شده" : "Resume checkpoint"}</button>}</div></div>; })}</div>}</Card>
      <Card><div className="card-heading"><div><h2>{locale === "fa" ? "تفاوت حالت‌های اجرا" : "Mode behavior"}</h2></div></div><div className="mode-explain"><p><b>{modeTitle("backtest", locale)}</b><span>{locale === "fa" ? "آزمایش با داده‌های گذشته و محاسبهٔ کارمزد و اختلاف قیمت؛ بدون استفاده از موجودی واقعی." : "Historical replay with explicit fees and slippage; virtual portfolio."}</span></p><p><b>{modeTitle("shadow", locale)}</b><span>{locale === "fa" ? "قیمت زنده و سبد مجازی؛ هیچ سفارشی به والکس فرستاده نمی‌شود." : "Live data, hypothetical execution, virtual portfolio, no Wallex write capability."}</span></p><p><b>{modeTitle("live", locale)}</b><span>{locale === "fa" ? "سفارش واقعی فقط پس از فعال‌سازی و تأیید جداگانه ارسال می‌شود." : "One live cycle or autonomous loop; real orders require separate enablement and confirmation."}</span></p></div></Card></div></div>
    {showConfirmation && <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="live-confirm-title"><button className="icon-button modal-close" onClick={() => setShowConfirmation(false)} aria-label={t.cancel}><X size={17}/></button><span className="warning-mark"><AlertTriangle size={20}/></span><h2 id="live-confirm-title">{t.liveConfirmTitle}</h2><p className="muted">{t.liveConfirmBody}</p><dl className="confirm-details"><div><dt>{t.profileLabel}</dt><dd>{selectedProfile?.name}</dd></div><div><dt>{t.pairLabel}</dt><dd dir="ltr">{symbols}</dd></div><div><dt>{t.strategies}</dt><dd>{strategyIds.map((id) => strategyIdTitle(id, locale)).join("، ")}</dd></div><div><dt>{t.exposure}</dt><dd>{money(riskCap || riskLimit, config.wallex?.quoteCurrency ?? "TMN", locale)}</dd></div><div><dt>{locale === "fa" ? "حالت اجرا" : "Mode"}</dt><dd>{autoTrade ? `${t.live} · ${t.auto}` : `${t.live} · ${locale === "fa" ? "یک‌بار" : "one cycle"}`}</dd></div></dl><label className="checkbox-row confirm-check"><input type="checkbox" checked={understandsRisk} onChange={(event) => setUnderstandsRisk(event.target.checked)}/>{t.acknowledge}</label><label className="field-label confirm-word">{t.typeTrade}<input autoFocus value={confirmationText} onChange={(event) => setConfirmationText(locale === "fa" ? event.target.value : event.target.value.toUpperCase())} autoComplete="off"/></label><div className="modal-actions"><button className="button secondary" onClick={() => setShowConfirmation(false)}>{t.cancel}</button><button className="button danger-button" disabled={!understandsRisk || confirmationText !== liveConfirmationPhrase(locale) || startMutation.isPending} onClick={() => startMutation.mutate(makeRequest(true))}><WalletCards size={15}/>{t.confirmLive}</button></div></section></div>}
  </>;
}

function ReportsView({ t, locale, runs, managedRuns, notify, focusRunId }: { t: Record<string, string>; locale: Locale; runs: Run[]; managedRuns: ManagedRun[]; notify: (message: string) => void; focusRunId?: string }) {
  const [selectedRunId, setSelectedRunId] = useState("");
  // Run lab hands over the run it just started so its report opens directly.
  useEffect(() => { if (focusRunId) setSelectedRunId(focusRunId); }, [focusRunId]);
  const history = [...runs.map((run) => ({ id: run.id, mode: run.mode, state: run.status, startedAt: run.startedAt, config: run.config, managed: false as const })), ...managedRuns.map((run) => ({ id: run.id, mode: run.mode, state: run.state, startedAt: run.startedAt, config: { symbol: run.symbols[0], symbols: run.symbols, strategyIds: run.strategyIds }, managed: true as const }))].sort((a, b) => b.startedAt - a.startedAt);
  const activeManagedRun = managedRuns.find((item) => ["starting", "running", "waiting", "stopping"].includes(item.state));
  // A managed attempt (what Run lab hands over) stores its decisions under the engine run it spawned, so resolve to that run whenever it exists.
  const resolvedSelection = (() => {
    if (!selectedRunId) return "";
    if (runs.some((run) => run.id === selectedRunId)) return selectedRunId;
    const attempt = managedRuns.find((run) => run.id === selectedRunId);
    const engineRunId = attempt?.workflow?.engineRunId;
    if (engineRunId && runs.some((run) => run.id === engineRunId)) return engineRunId;
    return attempt ? selectedRunId : "";
  })();
  const runId = resolvedSelection || activeManagedRun?.workflow?.engineRunId || activeManagedRun?.id || history[0]?.id || "";
  const storedRun = runs.find((run) => run.id === runId);
  const selectedAttempt = managedRuns.find((run) => run.id === runId);
  const pipelineAttempt = selectedAttempt ?? managedRuns.find((item) => item.workflow?.engineRunId === runId);
  const workflow = pipelineAttempt?.workflow;
  const query = useQuery({ queryKey: ["reports", runId], queryFn: () => api<{ runs: Audit[]; reports: JsonMap[]; comparison: JsonMap[] }>(`/api/reports?runId=${encodeURIComponent(runId)}`), enabled: Boolean(storedRun) });
  const benchmarkQuery = useQuery({ queryKey: ["benchmarks"], queryFn: () => api<{ comparison: JsonMap[]; sampledRuns: number; limit: number }>("/api/benchmarks?limit=1000"), enabled: runs.length > 0 });
  const [expandedDecision, setExpandedDecision] = useState("");
  const [benchmarkSearch, setBenchmarkSearch] = useState("");
  const [benchmarkMode, setBenchmarkMode] = useState("all");
  const [benchmarkSymbol, setBenchmarkSymbol] = useState("all");
  const [benchmarkStrategy, setBenchmarkStrategy] = useState("all");
  const report = query.data?.runs[0] ?? { run: {}, decisions: [], riskOutcomes: [], orders: [], decisionMemories: [], portfolioHistory: [], sourceSnapshots: [], aiModelCalls: [] };
  if (query.data && query.data.runs.length === 0) return <><PageHeading title={t.reportsTitle}/><Card><Empty text={locale === "fa" ? "گزارشی برای این اجرا در دسترس نیست." : "The selected run audit is unavailable."}/></Card></>;
  const run = report?.run;
  const metrics = object(run?.report);
  const reportStrategyId = String(metrics.strategyId ?? object(object(run?.config).strategy).id ?? "");
  const reportStrategyTitle = reportStrategyId ? strategyIdTitle(reportStrategyId, locale) : "—";
  const decisions = report?.decisions ?? [];
  const modelCalls = report?.aiModelCalls ?? [];
  const orders = report?.orders ?? [];
  const memory = report?.decisionMemories ?? [];
  const points = report?.portfolioHistory ?? metrics.equityCurve ?? [];
  const comparisonRows = benchmarkQuery.data?.comparison ?? [];
  const benchmarkLocale = locale === "fa" ? "fa-IR" : "en-US";
  const benchmarkPairs = [...new Set(comparisonRows.map((row) => String(row.symbol ?? "").trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, benchmarkLocale));
  const benchmarkStrategies = [...new Set(comparisonRows.map((row) => String(row.strategyId ?? "").trim()).filter(Boolean))].sort((left, right) => strategyIdTitle(left, locale).localeCompare(strategyIdTitle(right, locale), benchmarkLocale));
  const benchmarkModes = (["backtest", "shadow", "live"] as const).filter((mode) => comparisonRows.some((row) => row.mode === mode));
  const normalizedBenchmarkSearch = benchmarkSearch.trim().toLocaleLowerCase(benchmarkLocale);
  const filteredBenchmarkRows = comparisonRows.filter((row) => {
    const strategyId = String(row.strategyId ?? "");
    const symbol = String(row.symbol ?? "");
    const matchesSearch = !normalizedBenchmarkSearch || [symbol, row.quoteCurrency, strategyId, strategyIdTitle(strategyId, locale), modeTitle(String(row.mode ?? ""), locale)]
      .some((value) => String(value ?? "").toLocaleLowerCase(benchmarkLocale).includes(normalizedBenchmarkSearch));
    return matchesSearch
      && (benchmarkMode === "all" || row.mode === benchmarkMode)
      && (benchmarkSymbol === "all" || symbol === benchmarkSymbol)
      && (benchmarkStrategy === "all" || strategyId === benchmarkStrategy);
  });
  const hasBenchmarkFilters = Boolean(benchmarkSearch.trim()) || benchmarkMode !== "all" || benchmarkSymbol !== "all" || benchmarkStrategy !== "all";
  const resetBenchmarkFilters = () => {
    setBenchmarkSearch("");
    setBenchmarkMode("all");
    setBenchmarkSymbol("all");
    setBenchmarkStrategy("all");
  };
  const exportHtml = async () => {
    try { await downloadReport(`/api/reports/export?${runId ? `runId=${encodeURIComponent(runId)}` : "limit=30"}`); notify(locale === "fa" ? "گزارش HTML دانلود شد." : "HTML report downloaded."); }
    catch (error) { notify(error instanceof Error ? errorText(error.message, locale) : "Export failed."); }
  };
  const executionWasAttempted = Number(metrics.acceptedProposals ?? metrics.tradeCount ?? 0) > 0;
  const reliabilityValue = executionWasAttempted && metrics.executionReliabilityPct !== null && metrics.executionReliabilityPct !== undefined
    ? percent(metrics.executionReliabilityPct)
    : "—";
  const drawdownTone = Number(metrics.maxDrawdownPct) > 0 ? "down" : "plain";
  // The newest decision of this run is the headline: what the agents concluded and whether the risk gate let it through.
  const finalDecision = [...decisions].sort((a, b) => Number(b.decidedAt ?? 0) - Number(a.decidedAt ?? 0))[0];
  const finalProposal = object(finalDecision?.proposal), finalRisk = object(finalDecision?.risk);
  const finalAction = String(finalProposal.action ?? "HOLD").toUpperCase();
  const runInProgress = Boolean(pipelineAttempt && ["starting", "running", "waiting", "stopping"].includes(pipelineAttempt.state)) || run?.status === "running";
  const showDecisionDetails = () => { if (finalDecision) setExpandedDecision(finalDecision.id); document.querySelector(".decision-audit-card")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const decisionBanner = finalDecision
    ? <Card className={`final-decision ${finalAction.toLowerCase()}`}><div className="final-decision-main"><span className={`action-badge large ${finalAction.toLowerCase()}`}>{actionTitle(finalAction, locale)}</span><div><h2>{locale === "fa" ? "تصمیم نهایی دستیارها" : "Final agent decision"}</h2>
        <p>{finalDecision.symbol} · {new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 0 }).format(Number(finalProposal.confidence ?? 0) * 100)}{locale === "fa" ? "٪ اطمینان مدل" : "% model confidence"} · {finalRisk.approved ? (locale === "fa" ? "بررسی ریسک تأیید کرد" : "risk gate approved") : finalAction === "HOLD" ? (locale === "fa" ? "سفارشی لازم نبود" : "no order needed") : (locale === "fa" ? "بررسی ریسک رد کرد؛ سفارشی ثبت نشد" : "risk gate rejected; no order placed")} · {dateLabel(finalDecision.decidedAt, locale)}{decisions.length > 1 ? ` · ${locale === "fa" ? `آخرین از ${numberLabel(decisions.length, locale)} تصمیم` : `latest of ${decisions.length} decisions`}` : ""}</p>
        {(finalProposal.rationale ?? finalProposal.reasoning) && <p className="rationale" dir="auto">{String(finalProposal.rationale ?? finalProposal.reasoning).slice(0, 320)}{String(finalProposal.rationale ?? finalProposal.reasoning).length > 320 ? "…" : ""}</p>}</div>
        <button className="button secondary" onClick={showDecisionDetails}><ChevronDown size={15}/>{locale === "fa" ? "جزئیات تصمیم" : "Decision details"}</button></div></Card>
    : storedRun ? <Card className={`final-decision ${runInProgress ? "pending" : "none"}`}><div className="final-decision-main"><span className="action-badge large">{runInProgress ? (locale === "fa" ? "در انتظار" : "PENDING") : "—"}</span><div><h2>{runInProgress ? (locale === "fa" ? "دستیارها هنوز در حال تحلیل‌اند" : "The agents are still working") : (locale === "fa" ? "تصمیمی برای این اجرا ثبت نشده است" : "No decision was recorded for this run")}</h2>
        <p>{runInProgress ? (locale === "fa" ? "تصمیم نهایی (خرید، فروش یا نگه‌داری) پس از پایان این چرخه همین‌جا نمایش داده می‌شود." : "The final BUY, SELL, or HOLD decision appears here as soon as this cycle completes.") : run?.status === "failed" ? (locale === "fa" ? "اجرا پیش از تصمیم‌گیری متوقف شد؛ دلیل آن در ادامه آمده است." : "The run stopped before a decision was made; the reason is shown below.") : (locale === "fa" ? "این اجرا بدون تصمیم ثبت‌شده به پایان رسید." : "This run finished without a recorded decision.")}</p></div></div></Card>
    : null;
  return <><PageHeading title={t.reportsTitle} description={locale === "fa" ? "عملکرد، تصمیم‌ها، اطلاعات بازار، بررسی‌های ریسک، سفارش‌ها و درخواست‌های هوش مصنوعی هر اجرا را ببینید." : "Inspect performance, agent decisions, source evidence, risk checks, fills, and model activity for each run."} action={<button className="button secondary" onClick={() => void exportHtml()} disabled={!storedRun}><ArrowDownToLine size={15}/>{t.export}</button>} />
    <Card className="report-select-card"><div className="report-run-picker"><label><FieldLabelInfo label={locale === "fa" ? "انتخاب اجرا" : "Select run"} help={locale === "fa" ? "اجراهای موتور و تلاش‌های مدیریت‌شده، از جمله خطاهای پیش از شروع دستیارها، در این فهرست هستند." : "Engine runs and managed attempts appear here, including setup failures that happened before agents started."}/><AppSelect ariaLabel={locale === "fa" ? "انتخاب اجرا" : "Select run"} value={runId} onValueChange={setSelectedRunId} locale={locale} options={history.map((item) => ({ value: item.id, label: `${modeTitle(item.mode, locale)} · ${runSymbols(object(item.config)).join(", ") || item.id.slice(0, 8)} · ${dateLabel(item.startedAt, locale)}`, detail: `${statusTitle(item.state, locale)}${item.managed ? (locale === "fa" ? " · تلاش اجرا" : " · managed attempt") : ""}` }))}/></label><div className="run-metadata"><span className={`mode-badge ${run?.mode ?? pipelineAttempt?.mode ?? "shadow"}`}>{run?.mode ? modeTitle(run.mode, locale) : pipelineAttempt ? modeTitle(pipelineAttempt.mode, locale) : "—"}</span><span className={statusClass(pipelineAttempt?.state ?? run?.status ?? "unknown")}>{pipelineAttempt ? statusTitle(pipelineAttempt.state, locale) : run?.status ? statusTitle(run.status, locale) : "—"}</span><small className="muted">{run?.startedAt ? dateLabel(run.startedAt, locale) : pipelineAttempt ? dateLabel(pipelineAttempt.startedAt, locale) : ""}</small></div></div></Card>
    {decisionBanner}
    <WorkflowCanvas locale={locale} progress={workflow} run={run} audit={report} attempt={pipelineAttempt} />
    <Card className="benchmark-card">
      <div className="card-heading">
        <div>
          <h2>{locale === "fa" ? "مقایسهٔ جفت‌ارزها و استراتژی‌ها" : "Pair & strategy comparison"}</h2>
          <small className="muted">{locale === "fa" ? "بر پایهٔ " + numberLabel(benchmarkQuery.data?.sampledRuns ?? 0, locale) + " گزارش اخیر؛ چرخه‌های " + modeTitle("shadow", locale) + " برای هر جفت و استراتژی تجمیع شده‌اند." : "Based on up to " + (benchmarkQuery.data?.sampledRuns ?? 0) + " recent reports; shadow cycles are grouped by pair and strategy."}</small>
        </div>
        <button className="icon-button" onClick={() => void benchmarkQuery.refetch()} aria-label={t.refresh}><RefreshCw size={15}/></button>
      </div>
      {benchmarkQuery.isError ? <div className="inline-error"><p className="error-text">{locale === "fa" ? "مقایسهٔ گزارش‌ها بارگیری نشد." : "Could not load report comparisons."}</p><details><summary>{locale === "fa" ? "جزئیات فنی" : "Technical details"}</summary><small dir="auto">{benchmarkQuery.error.message}</small></details></div>
        : comparisonRows.length === 0 ? <Empty text={locale === "fa" ? "هنوز گزارشی برای مقایسه وجود ندارد." : "No completed reports are available to compare."}/>
        : <>
          <div className="benchmark-toolbar">
            <label className="benchmark-search">
              <span>{locale === "fa" ? "جست‌وجو" : "Search"}</span>
              <span className="benchmark-search-control">
                <Search size={15} aria-hidden="true"/>
                <input type="search" value={benchmarkSearch} onChange={(event) => setBenchmarkSearch(event.target.value)} placeholder={locale === "fa" ? "جفت‌ارز یا استراتژی…" : "Pair or strategy…"} aria-label={locale === "fa" ? "جست‌وجوی مقایسه‌ها" : "Search comparisons"}/>
              </span>
            </label>
            <div className="benchmark-filter">
              <span>{locale === "fa" ? "حالت اجرا" : "Run mode"}</span>
              <AppSelect ariaLabel={locale === "fa" ? "فیلتر حالت اجرا" : "Filter by run mode"} value={benchmarkMode} onValueChange={setBenchmarkMode} locale={locale} options={[{ value: "all", label: locale === "fa" ? "همهٔ حالت‌ها" : "All modes" }, ...benchmarkModes.map((mode) => ({ value: mode, label: modeTitle(mode, locale) }))]}/>
            </div>
            <div className="benchmark-filter">
              <span>{locale === "fa" ? "جفت‌ارز" : "Pair"}</span>
              <AppSelect ariaLabel={locale === "fa" ? "فیلتر جفت‌ارز" : "Filter by pair"} value={benchmarkSymbol} onValueChange={setBenchmarkSymbol} locale={locale} options={[{ value: "all", label: locale === "fa" ? "همهٔ جفت‌ارزها" : "All pairs" }, ...benchmarkPairs.map((symbol) => ({ value: symbol, label: symbol }))]}/>
            </div>
            <div className="benchmark-filter">
              <span>{locale === "fa" ? "استراتژی" : "Strategy"}</span>
              <AppSelect ariaLabel={locale === "fa" ? "فیلتر استراتژی" : "Filter by strategy"} value={benchmarkStrategy} onValueChange={setBenchmarkStrategy} locale={locale} options={[{ value: "all", label: locale === "fa" ? "همهٔ استراتژی‌ها" : "All strategies" }, ...benchmarkStrategies.map((strategyId) => ({ value: strategyId, label: strategyIdTitle(strategyId, locale), ...(locale === "fa" ? { detail: strategyId } : {}) }))]}/>
            </div>
            <div className="benchmark-results" aria-live="polite">
              <span>{locale === "fa" ? "نمایش " + numberLabel(filteredBenchmarkRows.length, locale) + " از " + numberLabel(comparisonRows.length, locale) + " مقایسه" : "Showing " + filteredBenchmarkRows.length + " of " + comparisonRows.length + " comparisons"}</span>
              {hasBenchmarkFilters && <button type="button" className="text-button" onClick={resetBenchmarkFilters}>{locale === "fa" ? "پاک‌کردن فیلترها" : "Clear filters"}<X size={13}/></button>}
            </div>
          </div>
          {filteredBenchmarkRows.length === 0 ? <Empty text={locale === "fa" ? "با این جست‌وجو و فیلترها موردی پیدا نشد." : "No comparisons match this search and these filters."}/>
            : <div className="table-wrap"><table aria-label={locale === "fa" ? "جدول مقایسهٔ عملکرد" : "Performance comparison table"}><thead><tr><th>#</th><th>{locale === "fa" ? "حالت اجرا" : "Mode"}</th><th>{t.symbol}</th><th>{t.strategies}</th><th>{locale === "fa" ? "سود یا زیان خالص" : "Net P&L"}</th><th>{t.return}</th><th>{t.drawdown}</th><th>{t.trades}</th><th>{locale === "fa" ? <span className="metric-label-help">درصد ثبت سفارش<InfoTooltip label="درصد ثبت سفارش" help="از میان پیشنهادهایی که بررسی ریسک آن‌ها را تأیید کرده، چند درصد به ثبت سفارش یا انجام بخشی از آن رسیده‌اند. این عدد سودآوری یا اجرای سفارش‌های بعدی را تضمین نمی‌کند." /></span> : "Reliability"}</th></tr></thead><tbody>{filteredBenchmarkRows.map((row, index) => <tr key={[row.runId, row.mode, row.symbol, row.strategyId].join("-")}><td>{index + 1}</td><td><span className={"mode-badge " + row.mode}>{modeTitle(row.mode, locale)}</span></td><td><code>{row.symbol}</code></td><td>{strategyIdTitle(String(row.strategyId), locale)}</td><td className={pnlClass(row.netPnl)}>{money(row.netPnl, row.quoteCurrency, locale)}</td><td className={pnlClass(row.netReturnPct)}>{percent(row.netReturnPct)}</td><td>{percent(row.maxDrawdownPct)}</td><td>{numberLabel(row.tradeCount, locale)}</td><td>{Number(row.acceptedProposals ?? row.tradeCount ?? 0) === 0 || row.executionReliabilityPct === null || row.executionReliabilityPct === undefined ? "—" : percent(row.executionReliabilityPct)}</td></tr>)}</tbody></table></div>}
        </>}
    </Card>
    {selectedAttempt && !storedRun ? <ManagedAttemptAudit attempt={selectedAttempt} locale={locale}/> : runs.length === 0 ? <Card><Empty text={t.noRuns}/></Card> : query.isPending ? <Card><div className="loading-line"><LoaderCircle className="spin" size={18}/>{locale === "fa" ? "در حال آماده‌سازی گزارش…" : "Loading audit…"}</div></Card> : query.isError ? <Card><div className="inline-error"><p className="error-text">{locale === "fa" ? "گزارش این اجرا بارگیری نشد." : "Could not load this run audit."}</p><details><summary>{locale === "fa" ? "جزئیات فنی" : "Technical details"}</summary><small dir="auto">{query.error.message}</small></details></div></Card> : <>
      {run?.status === "failed" && <Card className="managed-attempt-audit"><div className="card-heading"><div><h2>{locale === "fa" ? "اجرای موتور ناموفق بود" : "Engine run failed"}</h2><small className="muted">{locale === "fa" ? "دلیل و جزئیات این اجرا" : "Failure captured in the engine audit"}</small></div><span className={statusClass("failed")}>{statusTitle("failed", locale)}</span></div><div className="notice warning managed-attempt-error" role="alert"><span className="notice-icon"><AlertTriangle size={17}/></span><div><b>{failureTitle(run.failureName, locale, run.failureMessage)}</b><p dir="auto">{run.failureMessage ? errorText(run.failureMessage, locale) : (locale === "fa" ? "جزئیات علت خطا ثبت نشده است." : "No failure detail was recorded.")}</p>{(run.failureMessage || run.failureName) && <details><summary>{locale === "fa" ? "جزئیات فنی خطا" : "Show full technical error"}</summary><pre dir="auto">{pretty({ name: run.failureName, message: run.failureMessage })}</pre></details>}</div></div></Card>}
      {(() => { const returnTone = pnlTone(metrics.netReturnPct); return <div className="metric-grid report-metrics"><Metric label={t.return} value={percent(metrics.netReturnPct)} note={`${money(metrics.finalEquity, metrics.quoteCurrency, locale)} · ${locale === "fa" ? "سرمایه نهایی" : "final equity"}`} icon={returnTone === "up" ? TrendingUp : returnTone === "down" ? TrendingDown : Activity} tone={returnTone}/><Metric label={t.drawdown} value={percent(metrics.maxDrawdownPct)} note={locale === "fa" ? "افت از بیشینه ثبت‌شده" : "from peak equity"} icon={drawdownTone === "down" ? TrendingDown : Activity} tone={drawdownTone}/><Metric label={t.trades} value={numberLabel(metrics.tradeCount ?? 0, locale)} note={`${money(metrics.volume, metrics.quoteCurrency, locale)} ${locale === "fa" ? "حجم معاملات" : "volume"}`} icon={ArrowLeftRight}/><Metric label={locale === "fa" ? <span className="metric-label-help">درصد ثبت سفارش<InfoTooltip label="درصد ثبت سفارش" help="از میان پیشنهادهایی که از بررسی ریسک عبور کرده‌اند، چند درصد به سفارش ثبت‌شده یا دست‌کم بخشی از سفارش انجام‌شده رسیده‌اند. این عدد تضمین سود یا اجرای سفارش‌های بعدی نیست." /></span> : "Execution reliability"} value={reliabilityValue} note={`${numberLabel(metrics.acceptedProposals ?? 0, locale)} ${locale === "fa" ? "پیشنهاد مجاز" : "accepted proposals"}`} icon={Gauge}/></div>; })()}
      <div className="overview-grid"><Card className="chart-card"><div className="card-heading"><div><h2>{t.virtual} · {metrics.quoteCurrency ?? "TMN"}</h2></div></div><EquityChart points={points} label={`${t.equity} · ${metrics.symbol ?? ""}`} locale={locale}/><div className="assumption-list"><p><b>{locale === "fa" ? "روش محاسبه و فرض‌ها" : "Report assumptions"}</b></p>{(metrics.assumptions ?? []).map((item: string) => <small key={item}>{reportAssumptionText(item, locale)}</small>)}</div></Card>
        <Card><div className="card-heading"><div><h2>{locale === "fa" ? "خلاصهٔ اجرا" : "Run summary"}</h2></div><span className="mode-badge">{reportStrategyTitle}</span></div><dl className="audit-summary"><div><dt>{t.symbol}</dt><dd>{metrics.symbol ?? object(run?.config).symbol ?? "—"}</dd></div><div><dt>{t.strategies}</dt><dd>{reportStrategyTitle}</dd></div><div><dt>{locale === "fa" ? "سرمایهٔ اولیه" : "Initial equity"}</dt><dd>{money(metrics.initialEquity, metrics.quoteCurrency, locale)}</dd></div><div><dt>{locale === "fa" ? "ارزش نهایی" : "Final equity"}</dt><dd>{money(metrics.finalEquity, metrics.quoteCurrency, locale)}</dd></div><div><dt>{locale === "fa" ? "میانگین ارزش هر معامله" : "Average trade size"}</dt><dd>{money(metrics.averageTradeSize, metrics.quoteCurrency, locale)}</dd></div><div><dt>{locale === "fa" ? "کارمزد" : "Fees"}</dt><dd>{metrics.fees ?? "—"}</dd></div><div><dt>{locale === "fa" ? "لغزش قیمت" : "Slippage"}</dt><dd>{metrics.slippage ?? "—"}</dd></div><div><dt>{locale === "fa" ? "بازده خرید و نگه‌داری" : "Buy & hold return"}</dt><dd>{percent(metrics.buyAndHoldReturnPct)}</dd></div><div><dt>{locale === "fa" ? "بازده مازاد" : "Excess return"}</dt><dd>{percent(metrics.excessReturnPct)}</dd></div></dl></Card></div>
      <Card className="decision-audit-card"><div className="card-heading"><div><h2>{t.decisionsTitle}</h2><small className="muted">{numberLabel(decisions.length, locale)} {t.decisions}</small></div></div>{decisions.length === 0 ? <Empty text={locale === "fa" ? "این اجرا تصمیمی ثبت نکرده است." : "No decisions were saved for this run."}/> : <div className="decision-list">{decisions.map((decision) => {
        const proposal = object(decision.proposal), risk = object(decision.risk), expanded = expandedDecision === decision.id;
        return <article className="decision-row" key={decision.id}><button className="decision-summary" onClick={() => setExpandedDecision(expanded ? "" : decision.id)} aria-expanded={expanded}><span className={`action-badge ${String(proposal.action ?? "HOLD").toLowerCase()}`}>{actionTitle(String(proposal.action ?? "HOLD"), locale)}</span><span className="decision-main"><b>{decision.symbol}</b><small>{dateLabel(decision.decidedAt, locale)} · {new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 0 }).format(Number(proposal.confidence ?? 0) * 100)}{locale === "fa" ? "٪ اطمینان مدل" : "% confidence"}</small></span><span className={risk.approved ? "status status-completed" : "status status-warning"}>{risk.approved ? (locale === "fa" ? "پیشنهاد تأیید شد" : "risk approved") : (locale === "fa" ? "اجرا نشد" : "rejected / hold")}</span><ChevronDown className={expanded ? "rotated" : ""} size={16}/></button>
          {expanded && <div className="decision-detail"><div className="decision-columns"><div><h3>{locale === "fa" ? "دلیل ثبت‌شدهٔ پیشنهاد" : "Recorded proposal rationale"}</h3><p dir="auto">{proposal.rationale ?? proposal.reasoning ?? (locale === "fa" ? "دلیل متنی ثبت نشده است." : "No rationale recorded.")}</p><h3>{locale === "fa" ? "پیشنهاد و بررسی ریسک" : "Proposal & risk result"}</h3><pre>{pretty({ proposal, risk })}</pre></div><div><h3>{locale === "fa" ? "یافته‌های دستیارها" : "Agent findings"}</h3>{(decision.findings ?? []).map((finding: JsonMap, index: number) => <div className="finding" key={`${finding.role}-${index}`}><b>{agentTitle(String(finding.role ?? ""), locale)}</b><small className="technical-id" dir="ltr">{finding.role}</small><p dir="auto">{finding.summary ?? finding.content ?? finding.finding ?? pretty(finding)}</p><small>{finding.confidence ? `${Math.round(finding.confidence * 100)}% ${locale === "fa" ? "اطمینان" : "confidence"}` : ""}</small></div>)}<h3>{t.evidence}</h3><pre>{pretty(decision.evidence)}</pre></div></div></div>}
        </article>;
      })}</div>}</Card>
      <details className="audit-disclosure"><summary><div><b>{locale === "fa" ? "فعالیت هوش مصنوعی و بررسی ریسک" : "Model calls and risk checks"}</b><small>{numberLabel(modelCalls.length, locale)} {locale === "fa" ? "درخواست هوش مصنوعی" : "model calls"} · {numberLabel(report.riskOutcomes.length, locale)} {locale === "fa" ? "بررسی ریسک" : "risk checks"}</small></div><ChevronDown size={16}/></summary>
      <div className="overview-grid audit-grid"><Card><div className="card-heading"><div><h2>{t.modelCalls}</h2><small className="muted">{numberLabel(modelCalls.length, locale)} {locale === "fa" ? "درخواست هوش مصنوعی" : "model calls"}</small></div></div>{modelCalls.length === 0 ? <Empty text={locale === "fa" ? "درخواستی برای هوش مصنوعی ثبت نشده است." : "No AI calls were recorded."}/> : <div className="table-wrap"><table><thead><tr><th>{locale === "fa" ? "نقش" : "Role"}</th><th>{locale === "fa" ? "ارائه‌دهنده / مدل" : "Provider / model"}</th><th>{locale === "fa" ? "نوع درخواست" : "Operation"}</th><th>{locale === "fa" ? <FieldLabelInfo label="واحدهای متنی" help="تعداد بخش‌های متنیِ فرستاده‌شده به مدل و دریافت‌شده از آن؛ این عدد ممکن است بر هزینهٔ سرویس اثر بگذارد."/> : "Tokens"}</th><th>{locale === "fa" ? "نتیجه" : "Result"}</th></tr></thead><tbody>{modelCalls.map((call: JsonMap) => <tr key={call.id}><td><span>{agentTitle(String(call.role ?? ""), locale)}</span><small className="technical-id" dir="ltr">{call.role}</small></td><td dir="ltr">{call.provider} / {call.modelId}</td><td>{operationTitle(String(call.operation ?? ""), locale)}</td><td>{call.totalTokens ?? "—"}</td><td><span className={statusClass(call.status)}>{statusTitle(String(call.status ?? "unknown"), locale)}</span>{call.errorMessage && <details><summary>{locale === "fa" ? "جزئیات خطای درخواست" : "Request error"}</summary><small dir="auto">{errorText(String(call.errorMessage), locale)}</small><details><summary>{locale === "fa" ? "متن فنی کامل" : "Raw error"}</summary><pre dir="auto">{call.errorMessage}</pre></details></details>}</td></tr>)}</tbody></table></div>}</Card>
        <Card><div className="card-heading"><div><h2>{t.riskChecks}</h2><small className="muted">{numberLabel(report.riskOutcomes.length, locale)}</small></div></div>{report.riskOutcomes.length === 0 ? <Empty text={locale === "fa" ? "نتیجه‌ای از بررسی ریسک ثبت نشده است." : "No risk results were recorded."}/> : <div className="risk-list">{report.riskOutcomes.map((risk: JsonMap) => <div className="risk-row" key={risk.id}><span className={risk.approved ? "status status-completed" : "status status-warning"}>{risk.approved ? (locale === "fa" ? "مجاز" : "PASS") : (locale === "fa" ? "مسدود" : "BLOCK")}</span><div><small>{dateLabel(risk.checkedAt, locale)}</small><p dir="auto">{(risk.reasons ?? []).map((reason: string) => riskReasonText(reason, locale)).join(" · ") || (locale === "fa" ? "بدون مانع" : "No blocking reasons")}</p></div></div>)}</div>}</Card></div></details>
      <details className="audit-disclosure"><summary><div><b>{locale === "fa" ? "سفارش‌ها، داده‌ها و سابقهٔ یادگیری" : "Orders, data evidence, and decision memory"}</b><small>{numberLabel(orders.length, locale)} {locale === "fa" ? "سفارش" : "orders"} · {numberLabel(report.sourceSnapshots.length, locale)} {locale === "fa" ? "منبع داده" : "source snapshots"} · {numberLabel(memory.length, locale)} {locale === "fa" ? "یادداشت یادگیری" : "memory records"}</small></div><ChevronDown size={16}/></summary>
      <div className="overview-grid audit-grid"><Card><div className="card-heading"><div><h2>{t.orderTitle}</h2></div></div>{orders.length === 0 ? <Empty text={locale === "fa" ? "سفارشی برای این اجرا ثبت نشده است." : "No order intents in this run."}/> : <div className="table-wrap"><table><thead><tr><th>{t.symbol}</th><th>{locale === "fa" ? "سمت / نوع" : "Side / type"}</th><th>{locale === "fa" ? "وضعیت" : "State"}</th><th>{locale === "fa" ? "انجام سفارش" : "Fills"}</th><th>{locale === "fa" ? "حجم" : "Quantity"}</th></tr></thead><tbody>{orders.map((order: JsonMap) => <tr key={order.clientOrderId}><td>{order.order?.symbol}</td><td>{orderValueTitle(String(order.order?.side ?? ""), locale)} / {orderValueTitle(String(order.order?.type ?? ""), locale)}</td><td><span className={statusClass(order.state)}>{statusTitle(order.state, locale)}</span></td><td>{numberLabel(order.fills?.length ?? 0, locale)}</td><td>{order.order?.quantity ?? "—"}</td></tr>)}</tbody></table></div>}</Card>
        <Card><div className="card-heading"><div><h2>{t.evidence}</h2></div></div><div className="snapshot-list">{[...report.sourceSnapshots].sort((a: JsonMap, b: JsonMap) => Number(b.category === "research_coverage") - Number(a.category === "research_coverage")).slice(0, 20).map((snapshot: JsonMap) => <details className="snapshot" key={snapshot.id}><summary><b>{auditCategoryTitle(String(snapshot.category ?? ""), locale)}</b><span>{snapshot.source}</span><small>{dateLabel(snapshot.observedAt, locale)}</small></summary>{snapshotSourceHref(snapshot.payload) && <a href={snapshotSourceHref(snapshot.payload)} target="_blank" rel="noopener noreferrer">{locale === "fa" ? "رفتن به منبع" : "Open source"}</a>}<pre>{pretty(snapshot.payload)}</pre></details>)}{memory.length > 0 && <div className="memory-audit"><h3>{locale === "fa" ? "یادگیری از نتیجه‌های قبلی" : "Memory & reflection"}</h3>{memory.map((item: JsonMap) => <div className="finding" key={item.decisionId}><b>{actionTitle(String(item.action ?? ""), locale)} · {item.symbol} · {statusTitle(String(item.status ?? "unknown"), locale)}</b><small className="model-output-label">{locale === "fa" ? "توضیح ثبت‌شدهٔ تصمیم و مرور نتیجه" : "Recorded model-generated rationale and reflection"}</small><p dir="auto">{item.decisionText}</p><small>{locale === "fa" ? `بازده نسبت به ${item.benchmarkSymbol}: ${percent(item.alphaReturn)}` : `Alpha ${percent(item.alphaReturn)} · ${item.benchmarkSymbol}`}</small>{item.reflection && <p dir="auto">{item.reflection}</p>}</div>)}</div>}{report.sourceSnapshots.length === 0 && memory.length === 0 && <Empty text={locale === "fa" ? "هیچ منبع یا سابقه‌ای برای این اجرا ثبت نشده است." : "No source snapshots or memory records."}/>}</div></Card></div></details>
      <details className="raw-run-audit"><summary><TerminalSquare size={15}/>{locale === "fa" ? "جزئیات فنی کامل اجرا" : "Full run configuration & audit JSON"}</summary><pre>{pretty(run)}</pre></details>
    </>}
  </>;
}

const workflowStageOrder: WorkflowStageId[] = ["preparation", "market_data", "research", "analysts", "research_debate", "trader_proposal", "risk_review", "final_gate", "outcome"];
const workflowStageCopy: Record<Locale, Record<WorkflowStageId, { title: string; description: string }>> = {
  fa: {
    preparation: { title: "آماده‌سازی و کنترل‌ها", description: "پروفایل، بازار مجاز، محدودیت ریسک و آمادگی مسیر اجرا بررسی می‌شوند." },
    market_data: { title: "دریافت اطلاعات بازار", description: "قیمت، نمودارهای یک‌دقیقه‌ای کامل‌شده و داده‌های لازم برای این حالت دریافت می‌شوند." },
    research: { title: "پژوهش و شواهد", description: "منابع فعال و شاخص‌های فنی به شواهد قابل استناد تبدیل می‌شوند." },
    analysts: { title: "تحلیل دستیارها", description: "تحلیل فنی، خبرها، جو بازار و وضعیت پروژهٔ رمزارز را بررسی می‌کنند." },
    research_debate: { title: "بررسی دیدگاه‌های متفاوت", description: "دیدگاه‌های موافق و مخالف سنجیده می‌شوند و مدیر پژوهش نتیجه را جمع‌بندی می‌کند." },
    trader_proposal: { title: "پیشنهاد معامله", description: "دستیار معامله‌گر پیشنهاد اولیه را آماده می‌کند؛ در این مرحله سفارشی ارسال نمی‌شود." },
    risk_review: { title: "بررسی ریسک", description: "دستیارهای ریسک اندازه و جهت پیشنهاد را با محدودیت‌ها می‌سنجند." },
    final_gate: { title: "تصمیم نهایی و کنترل ریسک", description: "مدیر سبد دارایی پیشنهاد نهایی را می‌دهد و سامانه محدودیت‌های از پیش تعیین‌شده را اعمال می‌کند." },
    outcome: { title: "نتیجه و گزارش", description: "اگر پیشنهاد با محدودیت‌ها سازگار باشد، اجرا ثبت می‌شود؛ در غیر این صورت دلیل انجام‌نشدن معامله در گزارش می‌آید." },
  },
  en: {
    preparation: { title: "Preparation & checks", description: "The profile, allowed market, risk limits, and execution readiness are checked." },
    market_data: { title: "Market data", description: "Prices, completed candles, and mode-specific inputs are gathered." },
    research: { title: "Research & evidence", description: "Enabled sources and technical indicators become traceable evidence." },
    analysts: { title: "Agent analysis", description: "Technical, news, sentiment, and tokenomics analysts review the market." },
    research_debate: { title: "Debate & synthesis", description: "Bull and bear researchers challenge each other before the research manager summarizes." },
    trader_proposal: { title: "Trade proposal", description: "The trader creates a candidate proposal; this step never submits an order." },
    risk_review: { title: "Risk review", description: "Risk agents examine proposal size, direction, and potential blockers." },
    final_gate: { title: "Decision & risk gate", description: "The portfolio manager decides, then deterministic engine limits are applied." },
    outcome: { title: "Outcome & report", description: "An eligible proposal is handled; otherwise the hold or block reason is recorded." },
  },
};

function workflowStageIcon(stage: WorkflowStageId) {
  switch (stage) {
    case "preparation": return <Shield size={15}/>;
    case "market_data": return <Activity size={15}/>;
    case "research": return <Search size={15}/>;
    case "analysts": return <Cpu size={15}/>;
    case "research_debate": return <Blocks size={15}/>;
    case "trader_proposal": return <TrendingUp size={15}/>;
    case "risk_review": return <Gauge size={15}/>;
    case "final_gate": return <Shield size={15}/>;
    case "outcome": return <FileClock size={15}/>;
  }
}

function workflowDetailText(detail: string, locale: Locale): string {
  if (locale === "en") return detail;
  let match = detail.match(/^(\d+) evidence items available$/);
  if (match) return `${match[1]} مدرک پژوهشی آماده شد`;
  match = detail.match(/^(\d+) analyst reviews completed$/);
  if (match) return `${match[1]} تحلیل‌گر بررسی خود را کامل کردند`;
  match = detail.match(/^(\d+) debate reviews and manager synthesis completed$/);
  if (match) return `${match[1]} بررسی دیدگاه‌ها و جمع‌بندی مدیر پژوهش انجام شد`;
  match = detail.match(/^Candidate action: (.+)$/);
  if (match) return `پیشنهاد اولیه: ${actionTitle(match[1]!, locale)}`;
  match = detail.match(/^Decision recorded: (.+)$/);
  if (match) return `تصمیم ${actionTitle(match[1]!, locale)} ثبت شد`;
  match = detail.match(/^No order proposed \((.+)\); no order will be sent$/);
  if (match) return `پیشنهاد ${actionTitle(match[1]!, locale)} بود؛ هیچ سفارشی ارسال نمی‌شود`;
  match = detail.match(/^Decision (BUY|SELL|HOLD); no (?:virtual )?order was (?:sent|filled)\. (?:Run )?report recorded\.?$/i);
  if (match) return `تصمیم ${actionTitle(match[1]!.toUpperCase(), locale)} بود؛ سفارشی ارسال یا شبیه‌سازی نشد و گزارش ثبت شد`;
  if (/returned no structured result after \d+ model step/i.test(detail)) return "یکی از دستیارها پس از استفاده از گام‌های مجاز برای بررسی داده‌ها، جمع‌بندی ساختارمند ارائه نکرد. برای جلوگیری از تصمیم‌گیری با تحلیل ناقص، اجرا متوقف شد.";
  match = detail.match(/^Historical candle (\d+) of (\d+) (?:ready)?$/);
  if (match) return `بازهٔ قیمت تاریخی ${match[1]} از ${match[2]} آماده شد`;
  match = detail.match(/^(\d+) historical candles loaded$/);
  if (match) return `${match[1]} بازهٔ قیمت تاریخی دریافت شد`;
  match = detail.match(/^(\d+) completed candles loaded$/);
  if (match) return `${match[1]} بازهٔ کامل‌شدهٔ قیمت دریافت شد`;
  if (detail.includes("deterministic risk gate")) return detail.includes("passed") ? "پیشنهاد از بررسی نهایی ریسک گذشت" : "بررسی نهایی ریسک اجازهٔ اجرای پیشنهاد را نداد";
  if (detail.includes("Final risk recheck")) return detail.includes("passed") ? "بررسی نهایی ریسک موفق بود" : "بررسی نهایی ریسک پیشنهاد را مسدود کرد";
  if (detail.includes("no order was sent")) return "هیچ سفارشی ارسال نشد؛ تصمیم و گزارش اجرا ثبت شد";
  if (detail.includes("no virtual order was filled")) return "سفارش شبیه‌سازی‌شده انجام نشد؛ تصمیم و گزارش ثبت شد";
  if (detail.includes("report recorded") || detail.includes("report and final portfolio recorded")) return "گزارش اجرا و وضعیت نهایی سبد دارایی ثبت شد";
  if (detail.includes("Rechecking account")) return "در حال بررسی دوبارهٔ حساب، قیمت و محدودیت‌ها پیش از اجرا";
  if (detail.includes("latest quote and order book")) return "در حال بررسی آخرین قیمت و سفارش‌های خریدوفروش پیش از شبیه‌سازی";
  if (detail.includes("visible order book")) return "در حال برآورد مقدار قابل‌انجام بر اساس سفارش‌های خریدوفروش بازار";
  if (detail.includes("Submitting the approved order")) return "در حال ارسال سفارش تأییدشده و تطبیق نتیجه با والکس";
  if (detail.includes("Preparing the final performance report")) return "در حال آماده‌سازی گزارش نهایی عملکرد";
  if (detail.includes("Backtest report and final portfolio")) return "گزارش آزمایش تاریخی و سبد دارایی نهایی ثبت شدند";
  if (detail.includes("Virtual fill and report")) return "نتیجهٔ سفارش شبیه‌سازی‌شده و گزارش ثبت شدند";
  if (detail.includes("Order outcome and run report")) return "نتیجهٔ سفارش و گزارش اجرا ثبت شدند";
  return /[\u0600-\u06ff]/.test(detail) ? detail : "جزئیات این مرحله در گزارش فنی اجرا ثبت شده است.";
}

function WorkflowCanvas({ locale, progress, run, audit, attempt }: {
  locale: Locale; progress: WorkflowProgress | undefined; run: JsonMap; audit: Audit; attempt: ManagedRun | undefined;
}) {
  const runKey = progress?.engineRunId || String(run.id ?? attempt?.id ?? "empty");
  const defaultStage: WorkflowStageId = progress?.currentStage ?? (run.status === "completed" ? "outcome" : attempt?.phase === "setup" ? "preparation" : "market_data");
  const [manualSelection, setManualSelection] = useState<{ runKey: string; stage: WorkflowStageId } | null>(null);
  const selectedStage = manualSelection?.runKey === runKey ? manualSelection.stage : defaultStage;

  const calls: JsonMap[] = audit.aiModelCalls ?? [];
  const snapshots: JsonMap[] = audit.sourceSnapshots ?? [];
  const decisions: JsonMap[] = audit.decisions ?? [];
  const runStatus = String(attempt?.state ?? run?.status ?? "unknown");
  const live = ["starting", "running", "waiting", "stopping"].includes(runStatus);
  const waitingForCycle = runStatus === "waiting";
  const latestFailedCall = calls.find((call) => call.status === "failed");
  const roleSet = new Set(calls.map((call) => String(call.role)));
  const hasMarketData = snapshots.some((snapshot) => ["market_quote", "candles", "backtest_dataset"].includes(String(snapshot.category)));
  const hasResearch = snapshots.some((snapshot) => !["market_quote", "candles", "backtest_dataset", "memory_benchmark_dataset"].includes(String(snapshot.category)));
  const auditCompleted = runStatus === "completed";
  const inferred: Partial<Record<WorkflowStageId, WorkflowStageState>> = {};
  const markInferred = (stage: WorkflowStageId, condition: boolean) => {
    if (condition) inferred[stage] = { status: "completed", startedAt: Number(run.startedAt ?? 0), updatedAt: Number(run.endedAt ?? run.startedAt ?? 0) };
  };
  markInferred("preparation", Boolean(run.id) || Boolean(attempt && attempt.phase === "engine"));
  markInferred("market_data", hasMarketData || (calls.length > 0 && auditCompleted));
  markInferred("research", hasResearch || (calls.length > 0 && auditCompleted));
  markInferred("analysts", ["market_technical_analyst", "news_analyst", "sentiment_analyst", "tokenomics_analyst"].some((role) => roleSet.has(role)));
  markInferred("research_debate", ["bull_researcher", "bear_researcher", "research_manager"].some((role) => roleSet.has(role)));
  markInferred("trader_proposal", roleSet.has("trader"));
  markInferred("risk_review", ["aggressive_risk_analyst", "conservative_risk_analyst", "neutral_risk_analyst"].some((role) => roleSet.has(role)));
  markInferred("final_gate", decisions.length > 0 || roleSet.has("portfolio_manager"));
  markInferred("outcome", auditCompleted);
  if (latestFailedCall) {
    const failedRole = String(latestFailedCall.role);
    const failedStage: WorkflowStageId = failedRole === "trader" ? "trader_proposal"
      : failedRole === "portfolio_manager" ? "final_gate"
        : ["bull_researcher", "bear_researcher", "research_manager"].includes(failedRole) ? "research_debate"
          : ["aggressive_risk_analyst", "conservative_risk_analyst", "neutral_risk_analyst"].includes(failedRole) ? "risk_review" : "analysts";
    inferred[failedStage] = { status: "failed", startedAt: Number(latestFailedCall.startedAt ?? 0), updatedAt: Number(latestFailedCall.endedAt ?? 0), ...(latestFailedCall.errorMessage ? { detail: String(latestFailedCall.errorMessage) } : {}) };
  }
  if (!progress && attempt?.phase === "setup") inferred.preparation = {
    status: attempt.state === "failed" ? "failed" : "active", startedAt: attempt.startedAt, updatedAt: attempt.updatedAt,
    ...(attempt.error ? { detail: attempt.error } : {}),
  };

  const activeIndex = progress ? workflowStageOrder.indexOf(progress.currentStage) : -1;
  const statusFor = (stage: WorkflowStageId, index: number): WorkflowStageState["status"] | "pending" | "unknown" => {
    const recorded = progress?.stages[stage] ?? inferred[stage];
    if (recorded) return recorded.status;
    if (progress && activeIndex >= 0) return index < activeIndex ? "completed" : "pending";
    if (attempt?.phase === "engine" && !progress && ["starting", "running", "stopping"].includes(attempt.state)) return index === 0 ? "completed" : index === 1 ? "active" : "pending";
    return "unknown";
  };
  const stageMeta = workflowStageCopy[locale];
  const selectedMeta = stageMeta[selectedStage];
  const selectedState = progress?.stages[selectedStage] ?? inferred[selectedStage];
  const activeAgents = progress?.activeAgents ?? [];
  const activeStage = progress?.currentStage;
  const isKnown = Boolean(progress || run.id || attempt);
  const isRunning = live || Boolean(progress && progress.stages[progress.currentStage]?.status === "active");
  const flowPositions = [1, 2, 3, 3, 2, 1, 1, 2, 3];
  const centersX = locale === "fa" ? [750, 450, 150] : [150, 450, 750];
  const centersY = [60, 180, 300];
  const edges = workflowStageOrder.slice(0, -1).map((stage, index) => {
    const sourceColumn = flowPositions[index]!;
    const targetColumn = flowPositions[index + 1]!;
    const sourceX = centersX[sourceColumn - 1]!;
    const targetX = centersX[targetColumn - 1]!;
    const sourceY = centersY[Math.floor(index / 3)]!;
    const targetY = centersY[Math.floor((index + 1) / 3)]!;
    const horizontal = sourceY === targetY;
    const direction = Math.sign(targetX - sourceX);
    const x1 = horizontal ? sourceX + direction * 140 : sourceX;
    const y1 = horizontal ? sourceY : sourceY + 48;
    const x2 = horizontal ? targetX - direction * 140 : targetX;
    const y2 = horizontal ? targetY : targetY - 48;
    const sourceState = statusFor(stage, index);
    const targetState = statusFor(workflowStageOrder[index + 1]!, index + 1);
    return { d: `M ${x1} ${y1} L ${x2} ${y2}`, completed: sourceState === "completed", active: targetState === "active" };
  });
  const symbol = progress?.symbol ?? attempt?.symbols?.[0] ?? object(run.config).symbol ?? object(object(run.report).symbol).value ?? "";
  const cycleLabel = progress ? locale === "fa" ? (progress.cycle > 0 ? `چرخهٔ ${new Intl.NumberFormat("fa-IR").format(progress.cycle)}` : "هنوز چرخه‌ای آغاز نشده") : `Cycle ${progress.cycle}` : "";
  const title = locale === "fa" ? "مراحل اجرای دستیارها" : "Live agent workflow";
  const fallbackMessage = !isKnown
    ? locale === "fa" ? "با شروع یا انتخاب یک اجرا، مراحل واقعی آن را اینجا می‌بینید." : "Start or select a run to see its actual processing and audit path here."
    : !progress && attempt?.phase === "setup" && ["starting", "running"].includes(attempt.state)
      ? locale === "fa" ? "در حال بررسی تنظیمات اجرا؛ پس از آماده‌شدن موتور، گام‌های دقیق به‌صورت زنده نمایش داده می‌شوند." : "Run settings are being checked; detailed live stages appear once the engine is ready."
    : !progress && !auditCompleted
      ? locale === "fa" ? "این اجرا پیش از ثبت جزئیات مرحله‌ای ایجاد شده است؛ اطلاعات موجود در گزارش نمایش داده می‌شوند." : "This run predates detailed stage telemetry; only recorded audit evidence is shown."
      : "";
  const completedLabel = locale === "fa" ? "تکمیل‌شده" : "Completed";
  const statusLabel = (status: ReturnType<typeof statusFor>) => status === "active" ? (locale === "fa" ? "در حال انجام" : "In progress")
    : status === "completed" ? completedLabel
      : status === "failed" ? (locale === "fa" ? "ناموفق" : "Failed")
        : status === "skipped" ? (locale === "fa" ? "انجام نشد" : "Not needed")
          : status === "pending" ? (locale === "fa" ? "در انتظار" : "Up next")
            : (locale === "fa" ? "ثبت نشده" : "Not recorded");
  const selectedStatus = statusFor(selectedStage, workflowStageOrder.indexOf(selectedStage));
  const agentProgress = progress && progress.totalAgentTasks > 0
    ? `${numberLabel(progress.completedAgentTasks, locale)} / ${numberLabel(progress.totalAgentTasks, locale)} ${locale === "fa" ? "وظیفهٔ دستیار" : "agent tasks"}`
    : calls.length ? `${numberLabel(calls.length, locale)} ${locale === "fa" ? "درخواست ثبت‌شده به هوش مصنوعی" : "recorded model calls"}` : "";

  return <Card className="workflow-card">
    <div className="workflow-card-heading"><div><span className="eyebrow">{locale === "fa" ? "نمای زندهٔ مراحل اجرا" : "LIVE PIPELINE VIEW"}</span><h2>{title}</h2><p>{locale === "fa" ? "وضعیت هر مرحله با رخدادهای واقعی همین اجرا به‌روز می‌شود." : "Each stage is updated from real engine events and this run’s audit data."}</p></div>
      <div className={`workflow-live-state ${waitingForCycle ? "is-waiting" : isRunning ? "is-live" : runStatus === "failed" ? "is-failed" : ""}`} role="status" aria-live="polite"><i/>{waitingForCycle ? (locale === "fa" ? "در انتظار چرخهٔ بعد" : "Waiting for next cycle") : runStatus === "stopping" ? (locale === "fa" ? "در حال توقف ایمن" : "Stopping safely") : isRunning ? (locale === "fa" ? "در حال پردازش" : "Processing") : runStatus === "failed" ? (locale === "fa" ? "اجرا با خطا متوقف شد" : "Run stopped") : runStatus === "completed" ? (locale === "fa" ? "اجرا پایان یافت" : "Run completed") : (locale === "fa" ? "منتظر اجرا" : "Waiting for a run")}</div>
    </div>
    {(symbol || cycleLabel || agentProgress) && <div className="workflow-context"><span>{symbol && <code dir="ltr">{symbol}</code>}{cycleLabel && <small>{cycleLabel}</small>}</span>{agentProgress && <span>{activeAgents.length > 0 && <LoaderCircle className="spin" size={13}/>}<small>{agentProgress}</small></span>}</div>}
    <div className="workflow-board" dir={locale === "fa" ? "rtl" : "ltr"}>
      <svg className="workflow-connectors" viewBox="0 0 900 360" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="workflow-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z"/></marker></defs>{edges.map((edge, index) => <path key={index} className={`workflow-edge ${edge.completed ? "is-completed" : ""} ${edge.active ? "is-active" : ""}`} d={edge.d} markerEnd="url(#workflow-arrow)"/>)}</svg>
      <ol className="workflow-node-grid" aria-label={locale === "fa" ? "مراحل اجرای معامله" : "Workflow stages"}>
        {workflowStageOrder.map((stage, index) => {
          const status = statusFor(stage, index);
          const column = flowPositions[index]!;
          const row = Math.floor(index / 3) + 1;
          const titleText = stageMeta[stage].title;
          const activeNode = stage === activeStage && status === "active";
          return <li key={stage} style={{ gridColumn: column, gridRow: row }}><button type="button" className={`workflow-node ${status} ${selectedStage === stage ? "is-selected" : ""}`} onClick={() => setManualSelection({ runKey, stage })} aria-label={`${index + 1}. ${titleText} — ${statusLabel(status)}`} aria-pressed={selectedStage === stage} aria-current={activeNode ? "step" : undefined}>
            <span className="workflow-node-icon">{workflowStageIcon(stage)}</span><span className="workflow-node-copy"><b>{titleText}</b><small>{statusLabel(status)}</small></span><span className="workflow-node-number">{String(index + 1).padStart(2, "0")}</span>
          </button></li>;
        })}
      </ol>
    </div>
    <section className={`workflow-stage-detail ${selectedStatus}`} aria-live="polite" aria-label={locale === "fa" ? "جزئیات مرحلهٔ انتخاب‌شده" : "Selected stage details"}>
      <span className="workflow-node-icon">{workflowStageIcon(selectedStage)}</span><div className="workflow-detail-copy"><div><h3>{selectedMeta.title}</h3><span className={`workflow-stage-status ${selectedStatus}`}>{statusLabel(selectedStatus)}</span></div><p>{selectedMeta.description}</p>
        {selectedStage === "analysts" || selectedStage === "research_debate" || selectedStage === "trader_proposal" || selectedStage === "risk_review" || selectedStage === "final_gate" ? <div className="workflow-agents">
          {activeAgents.filter((agent) => {
            const role = agent.role;
            if (selectedStage === "analysts") return ["market_technical_analyst", "news_analyst", "sentiment_analyst", "tokenomics_analyst"].includes(role);
            if (selectedStage === "research_debate") return ["bull_researcher", "bear_researcher", "research_manager"].includes(role);
            if (selectedStage === "trader_proposal") return role === "trader";
            if (selectedStage === "risk_review") return ["aggressive_risk_analyst", "conservative_risk_analyst", "neutral_risk_analyst"].includes(role);
            return role === "portfolio_manager";
          }).map((agent) => <span className="workflow-agent-chip" key={agent.id}><LoaderCircle className="spin" size={12}/>{agentTitle(agent.role, locale)}</span>)}
          {selectedStage === "final_gate" && statusFor(selectedStage, workflowStageOrder.indexOf(selectedStage)) === "active" && !activeAgents.some((agent) => agent.role === "portfolio_manager") && <span className="workflow-agent-chip engine"><Shield size={12}/>{locale === "fa" ? "کنترل قطعی موتور" : "Deterministic engine gate"}</span>}
        </div> : null}
        {(selectedState?.detail || progress?.updatedAt || calls.length > 0) && <details className="workflow-telemetry-detail"><summary>{locale === "fa" ? "جزئیات این مرحله" : "Recorded details"}</summary><div>{selectedState?.detail && <><p dir="auto">{workflowDetailText(selectedState.detail, locale)}</p>{locale === "fa" && /[A-Za-z]/.test(selectedState.detail) && <details><summary>متن فنی رویداد</summary><pre dir="auto">{selectedState.detail}</pre></details>}</>}{selectedStage === "final_gate" && decisions.at(-1) && <p>{locale === "fa" ? `آخرین تصمیم: ${actionTitle(String(object(decisions.at(-1)?.proposal).action ?? "HOLD"), locale)} · ${object(decisions.at(-1)?.risk).approved ? "بررسی ریسک آن را تأیید کرد" : "بررسی ریسک اجازهٔ اجرا نداد یا دستیارها معامله‌ای پیشنهاد نکردند"}` : `Latest decision: ${actionTitle(String(object(decisions.at(-1)?.proposal).action ?? "HOLD"), locale)} · ${object(decisions.at(-1)?.risk).approved ? "risk passed" : "risk blocked or proposal held"}`}</p>}{selectedStage === "analysts" && <p>{locale === "fa" ? `برای تحلیل، ${numberLabel(calls.filter((call) => ["market_technical_analyst", "news_analyst", "sentiment_analyst", "tokenomics_analyst"].includes(String(call.role))).length, locale)} درخواست از هوش مصنوعی ثبت شده است.` : `${calls.filter((call) => ["market_technical_analyst", "news_analyst", "sentiment_analyst", "tokenomics_analyst"].includes(String(call.role))).length} analyst model calls recorded in the audit.`}</p>}{progress?.updatedAt && <small>{locale === "fa" ? "آخرین رویداد" : "Last event"}: {dateLabel(progress.updatedAt, locale)}</small>}{latestFailedCall && <div className="workflow-error-detail"><p>{errorText(String(latestFailedCall.errorMessage ?? ""), locale)}</p><details><summary>{locale === "fa" ? "جزئیات فنی خطای درخواست" : "Show full request error"}</summary><pre dir="auto">{latestFailedCall.errorMessage}</pre></details></div>}</div></details>}
      </div>
    </section>
    {fallbackMessage && <p className="workflow-note"><CircleHelp size={14}/>{fallbackMessage}</p>}
  </Card>;
}

function ManagedAttemptAudit({ attempt, locale }: { attempt: ManagedRun; locale: Locale }) {
  const isSetupFailure = attempt.state === "failed" && attempt.phase === "setup";
  return <Card className="managed-attempt-audit">
    <div className="card-heading"><div><h2>{locale === "fa" ? "جزئیات این اجرا" : "Run attempt audit"}</h2><small className="muted">{locale === "fa" ? "وضعیت اجرا و دلیل احتمالی توقف" : "Run coordinator status and failure details"}</small></div><span className={statusClass(attempt.state)}>{statusTitle(attempt.state, locale)}</span></div>
    <dl className="audit-summary"><div><dt>{locale === "fa" ? "شناسه تلاش" : "Attempt ID"}</dt><dd><code dir="ltr">{attempt.id}</code></dd></div><div><dt>{locale === "fa" ? "جفت‌ارزها" : "Pairs"}</dt><dd dir="ltr">{attempt.symbols.join(", ") || "—"}</dd></div><div><dt>{locale === "fa" ? "استراتژی‌ها" : "Strategies"}</dt><dd dir="ltr">{attempt.strategyIds.join(", ") || "—"}</dd></div><div><dt>{locale === "fa" ? "زمان شروع" : "Started"}</dt><dd>{dateLabel(attempt.startedAt, locale)}</dd></div><div><dt>{locale === "fa" ? "آخرین وضعیت" : "Last update"}</dt><dd>{dateLabel(attempt.updatedAt, locale)}</dd></div><div><dt>{locale === "fa" ? "مرحله" : "Stage"}</dt><dd>{attempt.phase === "setup" ? (locale === "fa" ? "بررسی تنظیمات و آماده‌سازی" : "Configuration and preparation") : (locale === "fa" ? "اجرای موتور" : "Engine execution")}</dd></div></dl>
    {attempt.error ? <div className="notice warning managed-attempt-error" role="alert"><span className="notice-icon"><AlertTriangle size={17}/></span><div><b>{locale === "fa" ? (isSetupFailure ? "چرا اجرا شروع نشد؟" : "علت توقف اجرا") : "Failure reason"}</b><p dir="auto">{(isSetupFailure ? issueText(attempt.error, locale) : errorText(attempt.error, locale))}</p><details><summary>{locale === "fa" ? "جزئیات فنی" : "Show full technical error"}</summary><pre dir="auto">{attempt.error}</pre></details></div></div> : <p>{managedRunMessage(attempt.message, attempt.state, attempt.mode, locale)}</p>}
    {isSetupFailure && <p className="muted">{locale === "fa" ? "این اجرا پیش از آغاز تحلیل متوقف شد؛ بنابراین هیچ تصمیم، درخواست هوش مصنوعی یا سفارشی برای آن ثبت نشده است." : "This attempt stopped before agent evaluation began, so it has no decisions, model calls, or orders of its own."}</p>}
    <p className="muted">{locale === "fa" ? "معیارهای سود و زیان فقط پس از شروع چرخهٔ موتور و ثبت سبد دارایی قابل محاسبه‌اند." : "Profit and loss metrics are available only after an engine cycle starts and records portfolio state."}</p>
  </Card>;
}

function OrdersView({ t, locale, notify }: { t: Record<string, string>; locale: Locale; notify: (message: string) => void }) {
  const [openOnly, setOpenOnly] = useState(false);
  const [cancelId, setCancelId] = useState("");
  const [cancelText, setCancelText] = useState("");
  const queryClient = useQueryClient();
  const ordersQuery = useQuery({ queryKey: ["orders", openOnly], queryFn: () => api<{ orders: JsonMap[] }>(`/api/orders?open=${openOnly}`) });
  const cancel = async (clientOrderId: string) => {
    if (cancelText !== cancelConfirmationPhrase(locale)) return;
    try { await api("/api/orders/cancel", { method: "POST", body: JSON.stringify({ clientOrderId, confirmed: true }) }); setCancelId(""); setCancelText(""); await queryClient.invalidateQueries({ queryKey: ["orders"] }); notify(locale === "fa" ? "درخواست لغو به والکس ارسال و وضعیت سفارش همگام شد." : "Cancellation confirmed and the Wallex order state reconciled."); }
    catch (error) { notify(error instanceof Error ? errorText(error.message, locale) : "Cancellation failed."); }
  };
  const rows = ordersQuery.data?.orders ?? [];
  return <><PageHeading title={t.orders} description={locale === "fa" ? "وضعیت سفارش‌های واقعی و شبیه‌سازی‌شده، تعداد بخش‌های انجام‌شده و کارمزدها را ببینید. فقط سفارش واقعیِ باز را می‌توان از والکس لغو کرد." : "Review live and simulated orders, executed quantities, and fees. Only an open live order can be canceled on Wallex."} action={<button className="button secondary" onClick={() => void ordersQuery.refetch()} disabled={ordersQuery.isFetching}><RefreshCw size={15} className={ordersQuery.isFetching ? "spin" : ""}/>{t.refresh}</button>} />
    <Card><div className="market-toolbar"><label className="checkbox-row"><input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)}/>{locale === "fa" ? "فقط سفارش‌های باز" : "Open orders only"}</label><span className="count-pill">{locale === "fa" ? `تعداد سفارش‌ها: ${new Intl.NumberFormat("fa-IR").format(rows.length)}` : `${rows.length} orders`}</span></div>{ordersQuery.isError && <InlineError message={ordersQuery.error.message} locale={locale} text={locale === "fa" ? "سفارش‌ها بارگیری نشدند. اتصال سرویس را بررسی کنید و دوباره تلاش کنید." : "Could not load orders. Check the service connection and try again."}/>}{rows.length === 0 && !ordersQuery.isPending && !ordersQuery.isError ? <Empty text={locale === "fa" ? "سفارشی ثبت نشده است." : "No recorded orders."}/> : <div className="table-wrap"><table><thead><tr><th>{locale === "fa" ? "حالت" : "Mode"}</th><th>{t.symbol}</th><th>{locale === "fa" ? "شناسهٔ سفارش" : "Client order ID"}</th><th>{locale === "fa" ? "سمت / نوع" : "Side / type"}</th><th>{locale === "fa" ? "وضعیت" : "State"}</th><th>{locale === "fa" ? "بخش‌های انجام‌شده / کارمزد" : "Fills / fees"}</th><th>{locale === "fa" ? "زمان ثبت" : "Created"}</th><th>{locale === "fa" ? "عملیات" : "Action"}</th></tr></thead><tbody>{rows.map((order) => <tr key={order.clientOrderId}><td><span className={`mode-badge ${order.mode}`}>{modeTitle(order.mode, locale)}</span></td><td>{order.symbol}</td><td><code className="order-id">{order.clientOrderId}</code></td><td>{orderValueTitle(String(order.order?.side ?? ""), locale)} / {orderValueTitle(String(order.order?.type ?? ""), locale)}</td><td><span className={statusClass(order.state)}>{statusTitle(order.state, locale)}</span></td><td>{numberLabel(order.fills?.length ?? 0, locale)}{order.fills?.length ? ` · ${order.fills.map((fill: JsonMap) => `${fill.fee} ${fill.feeAsset}`).join(", ")}` : ""}</td><td>{dateLabel(order.createdAt, locale)}</td><td>{order.mode === "live" && ["pending", "submitted", "reconciling", "NEW", "PARTIALLY_FILLED"].includes(order.state) ? <button className="button danger-outline small-button" onClick={() => { setCancelId(order.clientOrderId); setCancelText(""); }}>{locale === "fa" ? "لغو" : "Cancel"}</button> : <span className="muted">—</span>}</td></tr>)}</tbody></table></div>}</Card>
    {cancelId && <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title"><button className="icon-button modal-close" onClick={() => setCancelId("")} aria-label={t.cancel}><X size={17}/></button><span className="warning-mark"><AlertTriangle size={20}/></span><h2 id="cancel-title">{locale === "fa" ? "لغو سفارش واقعی؟" : "Cancel live order?"}</h2><p className="muted">{locale === "fa" ? "موتور قبل از لغو، وضعیت سفارش را از والکس بازیابی می‌کند." : "The engine reconciles exchange state before requesting cancellation."}</p><label className="field-label">{locale === "fa" ? "برای تأیید، عبارت «لغو سفارش واقعی» را وارد کنید" : "Type CANCEL to confirm"}<input autoFocus value={cancelText} onChange={(event) => setCancelText(locale === "fa" ? event.target.value : event.target.value.toUpperCase())}/></label><div className="modal-actions"><button className="button secondary" onClick={() => setCancelId("")}>{t.cancel}</button><button className="button danger-button" disabled={cancelText !== cancelConfirmationPhrase(locale)} onClick={() => void cancel(cancelId)}><CircleStop size={15}/>{locale === "fa" ? "لغو سفارش" : "Cancel order"}</button></div></section></div>}
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
    catch (error) { setActionError(error instanceof Error ? error.message : (locale === "fa" ? "بررسی تنظیمات ناموفق بود." : "Configuration validation failed.")); }
    finally { setLoading(""); }
  };
  const migrate = async () => {
    if (!window.confirm(locale === "fa" ? "به‌روزرسانی‌های لازم برای پایگاه داده انجام شوند؟" : "Apply database migrations?")) return;
    setActionError(""); setLoading("migrate");
    try { await api("/api/db/migrate", { method: "POST", body: "{}" }); onRefresh(); notify(locale === "fa" ? "پایگاه داده به‌روز شد." : "Database migrations completed."); }
    catch (error) { setActionError(error instanceof Error ? error.message : (locale === "fa" ? "به‌روزرسانی پایگاه داده انجام نشد." : "Database migration failed.")); }
    finally { setLoading(""); }
  };
  const secretStatuses = profileSecretRows(profiles.find((item) => item.id === profileId));
  const dbPath = database.url.replace(/^file:/i, "");
  const dbName = dbPath.split(/[\\/]/).filter(Boolean).at(-1) || (locale === "fa" ? "پایگاه داده محلی" : "Local database");
  return <><PageHeading title={t.system} description={locale === "fa" ? "پیش از اجرا، تنظیمات و دسترسی‌های لازم را بررسی کنید و اگر مشکلی بود، دلیل و راه‌حل را ببینید." : "Check mode readiness, Wallex read access, database status, and configuration sources from one place."} />
    <div className="overview-grid health-overview"><Card className="health-check-card"><div className="card-heading"><div><h2>{locale === "fa" ? "بررسی پیش از اجرا" : "Engine readiness"}</h2><small className="muted">{locale === "fa" ? "این بررسی‌ها به مدل هوش مصنوعی درخواست نمی‌فرستند و هیچ سفارشی در والکس ثبت نمی‌کنند." : "These checks do not call an AI model or submit exchange orders."}</small></div><Gauge size={18}/></div>
      <div className={`health-summary ${diagnostics ? (failedCount ? "has-failures" : skippedCount ? "has-skips" : "all-clear") : "not-run"}`} role="status" aria-live="polite"><span className="health-summary-mark">{diagnostics ? (failedCount ? <AlertTriangle size={18}/> : skippedCount ? <CircleHelp size={18}/> : <Check size={18}/>) : <Activity size={18}/>}</span><div><b>{!diagnostics ? (locale === "fa" ? "هنوز بررسی‌ای انجام نشده" : "Checks have not run yet") : failedCount ? (locale === "fa" ? "نیاز به رسیدگی دارد" : "Needs attention") : skippedCount ? (locale === "fa" ? "برخی موارد بررسی نشده‌اند" : "Some checks were skipped") : (locale === "fa" ? "همهٔ بررسی‌ها موفق بودند" : "All checks passed")}</b><small>{diagnostics ? `${locale === "fa" ? "موفق" : "Passed"}: ${numberLabel(passedCount, locale)} · ${locale === "fa" ? "نیازمند رسیدگی" : "Need attention"}: ${numberLabel(failedCount, locale)} · ${locale === "fa" ? "بررسی‌نشده" : "Not checked"}: ${numberLabel(skippedCount, locale)}` : (locale === "fa" ? "حالت اجرا را انتخاب کنید و بررسی تنظیمات یا سلامت را بزنید." : "Choose a run mode, then validate settings or run health checks.")}</small></div></div>
      <div className="field-row"><label className="field-label"><FieldLabelInfo label={locale === "fa" ? "حالت مورد بررسی" : "Mode to check"} help={locale === "fa" ? "تنظیمات لازم برای این حالت بررسی می‌شوند. با این کار اجرا شروع نمی‌شود و سفارشی هم ثبت نمی‌شود." : "Checks configuration requirements for this mode. It does not start a run or submit orders."}/><AppSelect ariaLabel={locale === "fa" ? "حالت مورد بررسی" : "Mode to check"} value={mode} onValueChange={(value) => { setMode(value as typeof mode); clearResults(); }} locale={locale} options={marketModeOptions(locale)}/></label></div>
      <label className="health-wallex-option"><input type="checkbox" checked={checkWallex} onChange={(event) => { setCheckWallex(event.target.checked); setDiagnostics(null); }}/><span><b>{locale === "fa" ? "بررسی اتصال به والکس" : "Check Wallex read access"}</b><small>{locale === "fa" ? "فهرست بازارهای فعال را می‌خواند و چیزی در حساب تغییر نمی‌دهد." : "Read-only request for active markets; it does not change your account."}</small></span></label>
      <div className="button-row"><button className="button secondary" onClick={() => void validate()} disabled={Boolean(loading)}>{loading === "validate" ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/>}{loading === "validate" ? (locale === "fa" ? "در حال اعتبارسنجی…" : "Validating…") : (locale === "fa" ? "بررسی تنظیمات" : "Validate settings")}</button><button className="button primary" onClick={() => void runDoctor()} disabled={Boolean(loading)}>{loading === "doctor" ? <LoaderCircle className="spin" size={15}/> : <Activity size={15}/>}{loading === "doctor" ? (locale === "fa" ? "در حال بررسی…" : "Checking…") : (locale === "fa" ? "بررسی سلامت سیستم" : "Run health checks")}</button></div>
      {actionError && <div className="notice warning health-action-error" role="alert"><AlertTriangle size={16}/><div><b>{locale === "fa" ? "عملیات انجام نشد" : "The operation did not complete"}</b><p>{locale === "fa" ? errorText(actionError, locale) : "Check the service connection and try again. Technical details are available below."}</p><details><summary>{locale === "fa" ? "جزئیات فنی" : "Technical details"}</summary><small dir="auto">{actionError}</small></details></div></div>}
      {validation && <div className={`validation-box ${validation.valid ? "success" : "failure"}`} role="status"><b>{validation.valid ? (locale === "fa" ? "تنظیمات این حالت معتبر است" : "Settings are valid for this mode") : (locale === "fa" ? "تنظیمات این حالت نیاز به اصلاح دارد" : "Settings need attention for this mode")}</b>{validation.errors?.length > 0 && <ul>{validation.errors.map((error: string) => <li key={error}>{issueText(error, locale)}<details><summary>{locale === "fa" ? "جزئیات فنی" : "Technical detail"}</summary><small dir="auto">{error}</small></details></li>)}</ul>}</div>}
      {diagnostics && <div className="diagnostic-list"><div className="diagnostic-list-heading"><h3>{locale === "fa" ? "نتیجه بررسی‌ها" : "Check results"}</h3><small>{dateLabel(Date.now(), locale)}</small></div>{checks.map((check: JsonMap) => <div className="diagnostic-row" key={check.name}><span className={statusClass(check.status === "fail" ? "failed" : check.status)}>{statusTitle(String(check.status), locale)}</span><div><b>{diagnosticTitle(String(check.name), locale)}</b><small>{diagnosticDetailText(check.name, check.status, check.detail, locale)}</small><details><summary>{locale === "fa" ? "جزئیات فنی" : "Technical details"}</summary><small dir="auto">{check.detail}</small></details></div></div>)}</div>}
    </Card>
      <Card className="database-health-card"><div className="card-heading"><div><h2><Database size={17}/>{locale === "fa" ? "اطلاعات ذخیره‌شده روی این دستگاه" : "Local database"}</h2><small className="muted">{locale === "fa" ? "اجراها، پروفایل‌ها و گزارش‌ها روی همین دستگاه نگهداری می‌شوند." : "Runs, profiles, and reports are stored on this device."}</small></div></div><dl className="audit-summary"><div><dt>{locale === "fa" ? "محل نگهداری" : "Storage location"}</dt><dd>{locale === "fa" ? "همین دستگاه" : "This device"}</dd></div><div><dt>{locale === "fa" ? "حفاظت از کلیدها" : "Credential protection"}</dt><dd>{locale === "fa" ? "رمزگذاری‌شده" : "Encrypted"}</dd></div></dl>
        <details className="health-path"><summary>{locale === "fa" ? "نمایش مسیر پایگاه داده برای عیب‌یابی" : "Show database path for troubleshooting"}</summary><code dir="ltr">{database.url}</code></details>
        <details className="health-db-maintenance"><summary>{locale === "fa" ? "نگهداری فنی" : "Technical maintenance"}</summary><small>{locale === "fa" ? `فایل داده: ${dbName}` : `Database file: ${dbName}`}</small><button className="button secondary full" onClick={() => void migrate()} disabled={Boolean(loading)}>{loading === "migrate" ? <LoaderCircle className="spin" size={15}/> : <Database size={15}/>}{loading === "migrate" ? (locale === "fa" ? "در حال به‌روزرسانی…" : "Checking and migrating…") : t.migrate}</button></details>
        <div className="security-callout"><LockKeyhole size={16}/><p>{locale === "fa" ? "تنظیمات و کلیدهای دسترسی در پایگاه داده ذخیره می‌شوند. کلید اصلی رمزگذاری را جداگانه و در جای امن نگه دارید؛ اگر گم شود، کلیدهای ذخیره‌شده بازیابی نمی‌شوند." : "Profile settings and credentials are stored in the database. The encryption key is held separately; encrypted credentials cannot be recovered if that key is lost."}</p></div>
      </Card></div>
    <details className="health-disclosure"><summary><div><h2>{locale === "fa" ? "منشأ تنظیمات مؤثر" : "Where effective settings come from"}<small>{locale === "fa" ? "مقادیر پروفایل و پیش‌فرض‌ها؛ اعتبارنامه‌ها پنهان می‌مانند." : "Profile values and defaults; credentials remain hidden."}</small></h2></div><ChevronDown size={16}/></summary>
      <div className="source-summary"><span><i className="source-dot profile"/>{t.profileSource} <b>{numberLabel(fields.filter((field) => field.source === "profile" && !field.secret).length, locale)}</b></span><span><i className="source-dot default"/>{t.default} <b>{numberLabel(fields.filter((field) => field.source === "default" && !field.secret).length, locale)}</b></span></div>
      <div className="table-wrap"><table><thead><tr><th>{locale === "fa" ? "تنظیم" : "Setting"}</th><th>{t.value}</th><th>{t.source}</th><th>{locale === "fa" ? "قابلیت ویرایش" : "Access"}</th></tr></thead><tbody>{fields.filter((field) => showOverrides || field.source !== "default").map((field) => <tr key={field.key}><td><span>{settingTitle(field.key, locale)}</span><small className="technical-id" dir="ltr">{field.key}</small></td><td>{field.secret ? <span className="muted">{secretStatuses[field.key] ? (locale === "fa" ? "رمزگذاری‌شده · پنهان" : "Encrypted · hidden") : (locale === "fa" ? "ثبت نشده" : "Not set")}</span> : <code className="value-preview">{field.value || "—"}</code>}</td><td><span className={`source-tag source-${field.source}`}>{sourceTitle(field.source, locale)}</span></td><td>{field.writable ? (locale === "fa" ? "قابل ویرایش" : "Editable") : (locale === "fa" ? "فقط خواندنی" : "Read-only")}</td></tr>)}</tbody></table></div>
      <button className="text-button" onClick={() => setShowOverrides((value) => !value)}>{showOverrides ? (locale === "fa" ? "نمایش فقط مقادیر پروفایل" : "Show profile values only") : (locale === "fa" ? "نمایش پیش‌فرض‌ها هم" : "Include defaults")}<ChevronDown size={14}/></button>
    </details>
    <Card className="access-boundaries-card"><div className="card-heading"><div><h2>{locale === "fa" ? "حفاظت داده و دسترسی" : "Data and access boundaries"}</h2><small className="muted">{locale === "fa" ? "این محدودیت‌ها در همهٔ صفحه‌ها و حالت‌های اجرا برقرارند." : "Local protections that apply across the dashboard and run modes."}</small></div></div><div className="security-grid"><div><Shield size={17}/><b>{locale === "fa" ? "محدود به همین دستگاه" : "This device only"}</b><small>{locale === "fa" ? "داشبورد فقط از همین دستگاه قابل استفاده است." : "The dashboard listens locally and validates browser requests."}</small></div><div><LockKeyhole size={17}/><b>{locale === "fa" ? "کلیدهای رمزگذاری‌شده" : "Encrypted credentials"}</b><small>{locale === "fa" ? "کلیدهای دسترسی در صفحه‌ها و گزارش‌ها پنهان می‌مانند و در پاسخ‌های معمول نمایش داده نمی‌شوند." : "Credentials are hidden from the interface, reports, and routine API responses."}</small></div><div><CirclePause size={17}/><b>{locale === "fa" ? "سرمایهٔ مجازی در شبیه‌سازی" : "Virtual portfolio in simulation"}</b><small>{locale === "fa" ? "آزمایش با داده‌های گذشته و شبیه‌سازی با قیمت زنده، موجودی کیف پول والکس را تغییر نمی‌دهند." : "Backtests and live simulations cannot change the Wallex wallet."}</small></div></div></Card>
  </>;
}

function profileSecretRows(profile?: Profile): Record<string, boolean> {
  const secrets = profile?.secrets ?? {};
  const provider = secrets.providerKeys ?? {};
  return {
    AI_API_KEY: Boolean(secrets.aiApiKey), WALLEX_API_KEY: Boolean(secrets.wallexApiKey), WALLEX_SUB_ACCOUNT_CLIENT_ID: Boolean(secrets.subAccountClientId),
    RESEARCH_ENDPOINTS_JSON: Boolean(secrets.researchEndpoints), MARKET_QUOTE_FALLBACKS_JSON: Boolean(secrets.marketQuoteFallbacks), TRONSCAN_API_KEY: Boolean(secrets.tronscanApiKey),
    AI_PROVIDER_KEYS_JSON: Object.values(provider).some(Boolean),
    ...Object.fromEntries(Object.entries(provider).map(([id, configured]) => [`AI_PROVIDER_KEY:${id}`, Boolean(configured)])),
  };
}
