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
    name: { fa: "تحلیل‌گر فنی بازار", en: "Market & technical analyst" },
    remit: { fa: "قیمت والکس، بازه‌های یک‌دقیقه‌ای کامل‌شده و شاخص‌های محاسبه‌شده را بررسی می‌کند؛ اطلاعاتی را که دریافت نکرده حدس نمی‌زند.", en: "Reads Wallex prices, completed one-minute candles, and computed indicators. It must not infer unseen market data." },
  },
  {
    role: "news_analyst", icon: Newspaper, stage: "analysis", required: false, tools: true,
    name: { fa: "تحلیل‌گر خبر", en: "News analyst" },
    remit: { fa: "خبرهای رمزارز و بازار را از منابع تنظیم‌شده بررسی می‌کند و واقعیت گزارش‌شده را از برداشت جدا نگه می‌دارد.", en: "Reviews configured crypto and market news sources, separating reported facts from interpretation." },
  },
  {
    role: "sentiment_analyst", icon: MessageCircle, stage: "analysis", required: false, tools: true,
    name: { fa: "تحلیل‌گر جو بازار", en: "Sentiment analyst" },
    remit: { fa: "دیدگاه کاربران در شبکه‌های اجتماعی را از نظر تازگی، اعتبار منبع و احتمال دست‌کاری می‌سنجد.", en: "Evaluates supplied social sentiment with attention to freshness, source quality, and possible manipulation." },
  },
  {
    role: "tokenomics_analyst", icon: Coins, stage: "analysis", required: false, tools: true,
    name: { fa: "تحلیل‌گر عرضه و کاربرد رمزارز", en: "Tokenomics analyst" },
    remit: { fa: "میزان عرضه، زمان آزادسازی رمزارزها، کاربرد آن‌ها و داده‌های ثبت‌شده در شبکه را بررسی می‌کند.", en: "Assesses token supply, unlocks, utility, and on-chain evidence without inventing equity metrics." },
  },
  {
    role: "bull_researcher", icon: TrendingUp, stage: "debate", required: true, tools: true,
    name: { fa: "تحلیل‌گر سناریوی صعودی", en: "Bull researcher" },
    remit: { fa: "قوی‌ترین دلیل‌های مبتنی بر شواهد برای رشد قیمت را گردآوری می‌کند و به نشانه‌های مخالف پاسخ می‌دهد.", en: "Builds the strongest evidence-grounded bullish case and addresses counterevidence." },
  },
  {
    role: "bear_researcher", icon: TrendingDown, stage: "debate", required: true, tools: true,
    name: { fa: "تحلیل‌گر سناریوی نزولی", en: "Bear researcher" },
    remit: { fa: "احتمال افت قیمت و ریسک‌های آن را بررسی می‌کند و ضعف یا کمبود شواهد را نشان می‌دهد.", en: "Challenges the thesis, examines downside risk, and identifies weak or missing evidence." },
  },
  {
    role: "research_manager", icon: ClipboardList, stage: "debate", required: true, tools: true,
    name: { fa: "مدیر پژوهش", en: "Research manager" },
    remit: { fa: "یافته‌های تحلیل‌گران را کنار هم می‌گذارد، تفاوت دیدگاه‌ها را می‌سنجد و ابهام‌های مهم را ثبت می‌کند.", en: "Synthesizes analyst and debate findings, preserving material disagreement and uncertainty." },
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
    name: { fa: "مدیر سبد دارایی", en: "Portfolio manager" },
    remit: { fa: "پس از بررسی همهٔ یافته‌ها پیشنهاد نهایی می‌دهد؛ اگر ابهام مهمی باقی بماند، پیشنهاد می‌کند فعلاً معامله‌ای انجام نشود.", en: "Makes the final portfolio proposal after reviewing all findings; prefers HOLD under material uncertainty." },
  },
  {
    role: "reflector", icon: Brain, stage: "memory", required: false, tools: false,
    name: { fa: "ارزیاب نتیجهٔ تصمیم‌ها", en: "Memory reflector" },
    remit: { fa: "پس از گذشت زمان تعیین‌شده، نتیجهٔ بازار را با معیار مقایسه می‌کند و نکته‌ای برای تصمیم‌های بعدی ثبت می‌کند.", en: "After the holding period matures, compares measured market and benchmark outcomes and records a concise lesson." },
  },
];

export function agentTitle(role: string, locale: "fa" | "en"): string {
  return agentDefinitions.find((agent) => agent.role === role)?.name[locale] ?? role;
}

export const agentStages: AgentStage[] = ["analysis", "debate", "decision", "risk", "memory"];

export function agentStageTitle(stage: AgentStage, locale: "fa" | "en"): string {
  const labels: Record<AgentStage, { fa: string; en: string }> = {
    analysis: { fa: "تحلیل موازی", en: "Parallel analysis" },
    debate: { fa: "بررسی دیدگاه‌های متفاوت", en: "Debate & research synthesis" },
    decision: { fa: "آماده‌سازی پیشنهاد معامله", en: "Initial trade proposal" },
    risk: { fa: "بازبینی ریسک و تصمیم سبد دارایی", en: "Risk review & portfolio decision" },
    memory: { fa: "ارزیابی نتیجه پس از گذشت زمان", en: "Post-holding-period memory" },
  };
  return labels[stage][locale];
}
