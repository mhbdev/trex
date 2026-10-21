import {
  Activity, Brain, CandlestickChart, ClipboardList, Coins, Gauge, MessageCircle, Newspaper,
  Scale, ShieldAlert, ShieldCheck, TrendingDown, TrendingUp, WalletCards,
} from "lucide-react";

export type AgentStage = "analysis" | "debate" | "decision" | "risk" | "memory";
export type AgentDefinition = {
  role: string;
  icon: typeof Activity;
  stage: AgentStage;
  required: boolean;
  tools: boolean;
  name: { fa: string; en: string };
  remit: { fa: string; en: string };
};

export const agentDefinitions: AgentDefinition[] = [
  {
    role: "market_technical_analyst", icon: CandlestickChart, stage: "analysis", required: true, tools: true,
    name: { fa: "تحلیل‌گر بازار و تکنیکال", en: "Market & technical analyst" },
    remit: { fa: "قیمت والکس، کندل‌های تکمیل‌شده یک‌دقیقه‌ای و شاخص‌های محاسبه‌شده را بررسی می‌کند؛ داده دیده‌نشده را حدس نمی‌زند.", en: "Reads Wallex prices, completed one-minute candles, and computed indicators. It must not infer unseen market data." },
  },
  {
    role: "news_analyst", icon: Newspaper, stage: "analysis", required: false, tools: true,
    name: { fa: "تحلیل‌گر خبر", en: "News analyst" },
    remit: { fa: "خبرهای رمز‌ارز و بازار را از منابع تنظیم‌شده بررسی می‌کند و واقعیت گزارش‌شده را از برداشت جدا نگه می‌دارد.", en: "Reviews configured crypto and market news sources, separating reported facts from interpretation." },
  },
  {
    role: "sentiment_analyst", icon: MessageCircle, stage: "analysis", required: false, tools: true,
    name: { fa: "تحلیل‌گر احساسات", en: "Sentiment analyst" },
    remit: { fa: "شواهد احساسات اجتماعی را با توجه به تازگی، اعتبار منبع و احتمال دست‌کاری ارزیابی می‌کند.", en: "Evaluates supplied social sentiment with attention to freshness, source quality, and possible manipulation." },
  },
  {
    role: "tokenomics_analyst", icon: Coins, stage: "analysis", required: false, tools: true,
    name: { fa: "تحلیل‌گر توکنومیک", en: "Tokenomics analyst" },
    remit: { fa: "عرضه توکن، آزادسازی‌ها، کاربرد و شواهد درون‌زنجیره‌ای را می‌سنجد؛ معیارهای سهام را جعل نمی‌کند.", en: "Assesses token supply, unlocks, utility, and on-chain evidence without inventing equity metrics." },
  },
  {
    role: "bull_researcher", icon: TrendingUp, stage: "debate", required: true, tools: true,
    name: { fa: "پژوهشگر صعودی", en: "Bull researcher" },
    remit: { fa: "قوی‌ترین استدلال صعودی مبتنی بر شواهد را می‌سازد و به شواهد مخالف پاسخ می‌دهد.", en: "Builds the strongest evidence-grounded bullish case and addresses counterevidence." },
  },
  {
    role: "bear_researcher", icon: TrendingDown, stage: "debate", required: true, tools: true,
    name: { fa: "پژوهشگر نزولی", en: "Bear researcher" },
    remit: { fa: "تز صعودی را به چالش می‌کشد، ریسک نزولی را می‌سنجد و نقاط ضعف شواهد را روشن می‌کند.", en: "Challenges the thesis, examines downside risk, and identifies weak or missing evidence." },
  },
  {
    role: "research_manager", icon: ClipboardList, stage: "debate", required: true, tools: true,
    name: { fa: "مدیر پژوهش", en: "Research manager" },
    remit: { fa: "یافته‌های تحلیل‌گران و مناظره را ترکیب می‌کند و اختلاف یا عدم‌قطعیت بااهمیت را ثبت می‌کند.", en: "Synthesizes analyst and debate findings, preserving material disagreement and uncertainty." },
  },
  {
    role: "trader", icon: Activity, stage: "decision", required: true, tools: false,
    name: { fa: "معامله‌گر", en: "Trader" },
    remit: { fa: "پیشنهاد اولیه خرید، فروش یا نگه‌داری را می‌سازد؛ امکان ارسال سفارش ندارد.", en: "Creates an initial BUY, SELL, or HOLD proposal. It has no order-submission capability." },
  },
  {
    role: "aggressive_risk_analyst", icon: ShieldAlert, stage: "risk", required: true, tools: true,
    name: { fa: "تحلیل‌گر ریسک فرصت‌محور", en: "Opportunity-focused risk analyst" },
    remit: { fa: "منطق سود بالقوه را در کنار ریسک‌های دنباله‌ای و فرض‌های اجرایی بررسی می‌کند.", en: "Tests the upside thesis against tail risks and execution assumptions." },
  },
  {
    role: "conservative_risk_analyst", icon: ShieldCheck, stage: "risk", required: true, tools: true,
    name: { fa: "تحلیل‌گر ریسک محافظه‌کار", en: "Conservative risk analyst" },
    remit: { fa: "حفظ سرمایه، اندازه موقعیت، تمرکز و کیفیت داده را در اولویت قرار می‌دهد.", en: "Prioritizes capital preservation, position sizing, concentration, and data quality." },
  },
  {
    role: "neutral_risk_analyst", icon: Scale, stage: "risk", required: true, tools: true,
    name: { fa: "تحلیل‌گر ریسک بی‌طرف", en: "Neutral risk analyst" },
    remit: { fa: "نقدشوندگی، عدم‌قطعیت، تمرکز و ریسک اجرای سفارش را مستقل بررسی می‌کند.", en: "Independently reviews liquidity, uncertainty, concentration, and order-execution risk." },
  },
  {
    role: "portfolio_manager", icon: WalletCards, stage: "risk", required: true, tools: false,
    name: { fa: "مدیر پرتفوی", en: "Portfolio manager" },
    remit: { fa: "پس از بررسی همه یافته‌ها پیشنهاد نهایی می‌دهد؛ در تردید مهم HOLD را ترجیح می‌دهد.", en: "Makes the final portfolio proposal after reviewing all findings; prefers HOLD under material uncertainty." },
  },
  {
    role: "reflector", icon: Brain, stage: "memory", required: false, tools: false,
    name: { fa: "بازتاب‌گر حافظه", en: "Memory reflector" },
    remit: { fa: "پس از رسیدن موعد ارزیابی، نتیجه واقعی بازار را با معیار مقایسه می‌کند و یک درس کوتاه ذخیره می‌کند.", en: "After the holding period matures, compares measured market and benchmark outcomes and records a concise lesson." },
  },
];

export function agentTitle(role: string, locale: "fa" | "en"): string {
  return agentDefinitions.find((agent) => agent.role === role)?.name[locale] ?? role;
}

export const agentStages: AgentStage[] = ["analysis", "debate", "decision", "risk", "memory"];

export function agentStageTitle(stage: AgentStage, locale: "fa" | "en"): string {
  const labels: Record<AgentStage, { fa: string; en: string }> = {
    analysis: { fa: "تحلیل موازی", en: "Parallel analysis" },
    debate: { fa: "مناظره و جمع‌بندی پژوهش", en: "Debate & research synthesis" },
    decision: { fa: "پیشنهاد اولیه معامله", en: "Initial trade proposal" },
    risk: { fa: "بازبینی ریسک و تصمیم پرتفوی", en: "Risk review & portfolio decision" },
    memory: { fa: "حافظه پس از بلوغ دوره", en: "Post-holding-period memory" },
  };
  return labels[stage][locale];
}
