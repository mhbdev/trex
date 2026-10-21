import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, CircleHelp, RotateCcw, Search, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { api } from "./api";
import { agentDefinitions, agentStageTitle, agentStages, type AgentDefinition, type AgentStage } from "./agent-catalog";
import { AppSelect, FieldLabelInfo, InfoTooltip } from "./ui-primitives";

type Locale = "fa" | "en";
type AgentMap<T> = Record<string, T>;
type SettingField = { key: string; source: "profile" | "default"; writable: boolean };
type Props = {
  profileId: string;
  config: Record<string, any>;
  fields: SettingField[];
  locale: Locale;
  notify: (message: string) => void;
  onRefresh: () => void;
};

const providers = ["openai", "anthropic", "google", "compatible", "boxapi", "liara"];

function toRecord<T>(value: unknown): AgentMap<T> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AgentMap<T> : {};
}

function routeMap(value: unknown): AgentMap<string> {
  return Object.fromEntries(Object.entries(toRecord<unknown>(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function routeParts(route: string, fallbackProvider: string, fallbackModel: string) {
  const separator = route.indexOf(":");
  return separator > 0
    ? { provider: route.slice(0, separator), model: route.slice(separator + 1) }
    : { provider: fallbackProvider, model: fallbackModel };
}

function StagePill({ stage, locale }: { stage: AgentStage; locale: Locale }) {
  return <span className={`agent-stage-pill ${stage}`}><Workflow size={12} aria-hidden="true" />{agentStageTitle(stage, locale)}</span>;
}

function AgentCard({
  agent, locale, route, fallback, instructions, enabled, maxToolSteps,
  onRoute, onInstructions, onEnabled, onSteps, locked,
  onReset,
}: {
  agent: AgentDefinition; locale: Locale; route: { provider: string; model: string; override: boolean }; fallback: string;
  instructions: string; enabled: boolean; maxToolSteps: number; locked: Record<string, boolean>;
  onRoute: (provider: string, model: string) => void; onInstructions: (value: string) => void;
  onEnabled: (value: boolean) => void; onSteps: (value: number) => void;
  onReset: () => void;
}) {
  const fa = locale === "fa";
  const Icon = agent.icon;
  const routeLocked = locked.AI_ROLE_MODELS_JSON;
  const promptLocked = locked.AI_ROLE_INSTRUCTIONS_JSON;
  const enabledLocked = locked.AI_DISABLED_AGENTS_JSON;
  const stepsLocked = locked.AI_ROLE_MAX_TOOL_STEPS_JSON;
  const strings = fa ? {
    defaultRoute: "مدل پیش‌فرض پروفایل", customRoute: "مدل اختصاصی", required: "ضروری برای گردش‌کار",
    optional: "اختیاری", active: "فعال", inactive: "غیرفعال", provider: "ارائه‌دهنده", model: "شناسه دقیق مدل",
    remit: "مسئولیت پیش‌فرض", instructions: "دستور تکمیلی عامل", instructionsHelp: "این متن به مأموریت پیش‌فرض اضافه می‌شود و آن را جایگزین نمی‌کند. محدودیت‌های ایمنی موتور همچنان لازم‌الاجرا هستند. این دستور در تنظیمات اجرا ذخیره می‌شود؛ کلید API یا اطلاعات محرمانه را وارد نکنید.",
    instructionsPlaceholder: "مثال: فقط به شواهد دو ساعت اخیر وزن بده و اختلاف قیمت را صریح ذکر کن…",
    steps: "حداکثر گام ابزار", noTools: "این نقش از ابزار پژوهش استفاده نمی‌کند.", reset: "بازنشانی تنظیمات این عامل",
    enabledHelp: "با غیرفعال‌کردن، این نقش از چرخه‌های جدید حذف می‌شود. پژوهش تکنیکال، مناظره صعودی/نزولی، معامله‌گر، هیئت ریسک و مدیر پرتفوی برای حفظ ایمنی و انسجام گردش‌کار موتور قابل غیرفعال‌سازی نیستند.",
    routeHelp: "مدلی که این نقش در این پروفایل استفاده می‌کند. اگر مدل اختصاصی ثبت نشود، مدل پیش‌فرض پروفایل به کار می‌رود.",
    providerHelp: "ارائه‌دهنده‌ای که برای فراخوانی این عامل استفاده می‌شود. کلید معتبر همان ارائه‌دهنده باید در تنظیمات اعتبارنامه‌ها موجود باشد.",
    modelHelp: "شناسه دقیق مدل در همان ارائه‌دهنده؛ نام مدل میان ارائه‌دهندگان قابل جایگزینی خودکار نیست.",
    stepsHelp: "حداکثر دور فراخوانی ابزارهای فقط‌خواندنی برای این نقش، از ۱ تا ۸. گام بیشتر می‌تواند داده بیشتری بررسی کند و مصرف/زمان را افزایش دهد.",
  } : {
    defaultRoute: "Profile default model", customRoute: "Dedicated model", required: "Required by workflow",
    optional: "Optional", active: "Active", inactive: "Off", provider: "Provider", model: "Exact model ID",
    remit: "Default remit", instructions: "Additional agent instructions", instructionsHelp: "This text supplements the built-in remit; it does not replace it. Engine safety constraints still apply. Instructions are saved with run configuration snapshots, so do not enter API keys or other secrets.",
    instructionsPlaceholder: "Example: prioritize evidence from the last two hours and call out spread changes…",
    steps: "Maximum tool steps", noTools: "This role does not use research tools.", reset: "Reset this agent",
    enabledHelp: "Disabling removes this role from new runs. Technical analysis, bull/bear debate, trader, risk reviewers, and portfolio manager remain required for safety and workflow consistency.",
    routeHelp: "Model used by this role in this profile. If no dedicated route is saved, the profile default is used.",
    providerHelp: "Provider used for this agent call. A valid credential for the selected provider must be configured.",
    modelHelp: "Exact model identifier at that provider. Model names are provider-specific and are not translated automatically.",
    stepsHelp: "Maximum read-only tool calls for this role, from 1 to 8. More steps can inspect more data and may increase time and usage.",
  };
  const routeHelp = strings.routeHelp;
  return <details className={`agent-card ${enabled ? "" : "is-disabled"}`} open={agent.role === "market_technical_analyst"}>
    <summary className="agent-card-summary" aria-label={`${agent.name[locale]} · ${agentStageTitle(agent.stage, locale)} · ${route.provider}:${route.model}`}>
      <span className="agent-icon"><Icon size={18} strokeWidth={1.8} aria-hidden="true" /></span>
      <span className="agent-summary-copy"><b>{agent.name[locale]}</b><small>{agentStageTitle(agent.stage, locale)} · <span dir="ltr">{route.provider}:{route.model}</span></small></span>
      <span className={`status ${agent.required ? "status-pass" : enabled ? "status-running" : "status-neutral"}`}>{agent.required ? strings.required : enabled ? strings.active : strings.inactive}</span>
      <ChevronDown className="agent-card-chevron" size={16} aria-hidden="true" />
    </summary>
    <div className="agent-card-content">
    <div className="agent-card-top">
      <small className="technical-id" dir="ltr">{agent.role}</small>
      {agent.required
        ? <span className="agent-required-note"><ShieldCheck size={12} aria-hidden="true" />{strings.required}</span>
        : <label className="agent-enable-toggle">
          <input type="checkbox" role="switch" aria-checked={enabled} aria-label={`${agent.name[locale]} · ${enabled ? strings.active : strings.inactive}`} disabled={enabledLocked} checked={enabled} onChange={(event) => onEnabled(event.target.checked)} />
          <span>{enabled ? strings.active : strings.inactive}</span>
          <InfoTooltip label={agent.name[locale]} help={strings.enabledHelp} />
        </label>}
      <button type="button" className="icon-button tiny" title={strings.reset} aria-label={`${strings.reset}: ${agent.name[locale]}`} disabled={routeLocked && promptLocked && enabledLocked && stepsLocked} onClick={onReset}><RotateCcw size={14} aria-hidden="true" /></button>
    </div>
    <div className="agent-description"><StagePill stage={agent.stage} locale={locale} /><p>{agent.remit[locale]}</p></div>
    <div className="agent-route-grid">
      <div className="agent-field">
        <span className="agent-field-label"><FieldLabelInfo label={strings.provider} help={strings.providerHelp} /> <InfoTooltip label={strings.provider} help={routeHelp} /></span>
        <AppSelect ariaLabel={`${agent.name[locale]} · ${strings.provider}`} value={route.provider} locale={locale} disabled={routeLocked} onValueChange={(provider) => onRoute(provider, provider === route.provider ? route.model : "")} options={providers.map((provider) => ({ value: provider, label: provider }))} />
      </div>
      <label className="agent-field">
        <FieldLabelInfo label={strings.model} help={strings.modelHelp} />
        <input dir="ltr" value={route.model} disabled={routeLocked} required maxLength={160} placeholder={fallback.split(":")[1] ?? "model-id"} onChange={(event) => onRoute(route.provider, event.target.value)} />
      </label>
    </div>
    <div className="agent-route-status">
      <span className={`status ${route.override ? "status-running" : "status-neutral"}`}>{route.override ? strings.customRoute : strings.defaultRoute}</span>
      {agent.tools ? <label className="agent-steps"><FieldLabelInfo label={strings.steps} help={strings.stepsHelp} /><AppSelect ariaLabel={`${agent.name[locale]} · ${strings.steps}`} value={String(maxToolSteps)} locale={locale} disabled={stepsLocked} onValueChange={(value) => onSteps(Number(value))} options={Array.from({ length: 8 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} /></label> : <small className="muted">{strings.noTools}</small>}
    </div>
    <details className="agent-instructions">
      <summary><Sparkles size={14} aria-hidden="true" />{strings.instructions}<span className="count-pill">{instructions.length}/2000</span></summary>
      <label>
        <FieldLabelInfo label={strings.remit} help={strings.instructionsHelp} />
        <textarea rows={3} maxLength={2_000} value={instructions} disabled={promptLocked} placeholder={strings.instructionsPlaceholder} onChange={(event) => onInstructions(event.target.value)} />
      </label>
    </details>
    </div>
  </details>;
}

export function AgentWorkspace({ profileId, config, fields, locale, notify, onRefresh }: Props) {
  const fa = locale === "fa";
  const ai = config.ai ?? {};
  const fallbackProvider = String(ai.provider ?? "openai");
  const fallbackModel = String(ai.model ?? "gpt-4.1-mini");
  const fallback = `${fallbackProvider}:${fallbackModel}`;
  const [routes, setRoutes] = useState<AgentMap<string>>(() => routeMap(ai.roleModels));
  const [instructions, setInstructions] = useState<AgentMap<string>>(() => routeMap(ai.roleInstructions));
  const [steps, setSteps] = useState<AgentMap<number>>(() => toRecord<number>(ai.roleMaxToolSteps));
  const [disabledRoles, setDisabledRoles] = useState<string[]>(() => strings(ai.disabledRoles));
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRoutes(routeMap(ai.roleModels));
    setInstructions(routeMap(ai.roleInstructions));
    setSteps(toRecord<number>(ai.roleMaxToolSteps));
    setDisabledRoles(strings(ai.disabledRoles));
  }, [profileId, ai.roleModels, ai.roleInstructions, ai.roleMaxToolSteps, ai.disabledRoles]);

  const fieldState = (key: string): SettingField => fields.find((field) => field.key === key) ?? { key, source: "default", writable: true };
  const locked = useMemo(() => Object.fromEntries([
    "AI_ROLE_MODELS_JSON", "AI_ROLE_INSTRUCTIONS_JSON", "AI_ROLE_MAX_TOOL_STEPS_JSON", "AI_DISABLED_AGENTS_JSON",
  ].map((key) => [key, !fieldState(key).writable])), [fields]);
  const visible = agentDefinitions.filter((agent) => {
    const query = `${agent.role} ${agent.name.fa} ${agent.name.en} ${agent.remit.fa} ${agent.remit.en}`.toLocaleLowerCase();
    return (!stageFilter || agent.stage === stageFilter) && (!search || query.includes(search.toLocaleLowerCase()));
  });
  const grouped = agentStages.map((stage) => ({ stage, agents: visible.filter((agent) => agent.stage === stage) })).filter((group) => group.agents.length > 0);
  const selectedCount = agentDefinitions.length - disabledRoles.length;
  const initialRoutes = routeMap(ai.roleModels);
  const initialInstructions = routeMap(ai.roleInstructions);
  const initialSteps = toRecord<number>(ai.roleMaxToolSteps);
  const initialDisabled = strings(ai.disabledRoles);
  const dirty = JSON.stringify(routes) !== JSON.stringify(initialRoutes) || JSON.stringify(instructions) !== JSON.stringify(initialInstructions) || JSON.stringify(steps) !== JSON.stringify(initialSteps) || JSON.stringify([...disabledRoles].sort()) !== JSON.stringify([...initialDisabled].sort());
  const inputTexts = fa ? {
    summary: "ترکیب عامل‌ها", summaryDetail: "نقش‌های تحلیل، مناظره، ارزیابی ریسک و مدیریت پرتفوی را با مسیر مدل و دستورهای اختصاصی هر پروفایل تنظیم کنید.",
    flowTitle: "گردش‌کار عامل‌ها", flowDescription: "۷ مرحله برای تحلیل موازی، مناظره، بررسی ریسک و ثبت تصمیم؛ عامل‌ها سفارش صرافی ارسال نمی‌کنند.",
    flow: ["تحلیل موازی", "مناظره صعودی / نزولی", "مدیر پژوهش", "پیشنهاد معامله‌گر", "هیئت ریسک", "تصمیم مدیر پرتفوی", "بازتاب پس از بلوغ حافظه"],
    active: "فعال در هر اجرا", roles: "نقش عامل", search: "جست‌وجوی نقش یا تخصص", allStages: "همه مراحل", stage: "مرحله کاری",
    save: "ذخیره تیم عامل‌ها", saved: "تنظیمات تیم عامل‌ها ذخیره شد.", saveError: "ذخیره تنظیمات عامل‌ها ناموفق بود.", discard: "لغو تغییرات", dirty: "تغییرات ذخیره‌نشده", clean: "همگام با پروفایل",
    safetyTitle: "مرزهای ایمنی موتور حفظ می‌شوند", safetyBody: "دستور تکمیلی فقط نقش و اولویت‌های تحلیل را تنظیم می‌کند. سقف‌ها، کنترل ریسک، اعتبارسنجی بازار و مجوز ارسال سفارش مستقل و قطعی باقی می‌مانند.",
    envTitle: "برخی تنظیم‌ها برای این پروفایل قابل ویرایش نیستند", envBody: "برای تغییر آن‌ها، پروفایلی را انتخاب کنید که مالک تنظیمات باشد یا به صفحه پروفایل و تنظیمات بروید.",
    teamDefault: "مدل پیش‌فرض پروفایل", resetTitle: "تنظیمات هر عامل جداگانه قابل بازنشانی است.",
  } : {
    summary: "Agent team", summaryDetail: "Configure research, debate, risk review, and portfolio roles with per-profile model routes and role guidance.",
    flowTitle: "Agent workflow", flowDescription: "Seven stages for parallel research, debate, risk review, and recorded decisions. Agents cannot submit exchange orders.",
    flow: ["Parallel analysis", "Bull / bear debate", "Research manager", "Trader proposal", "Risk committee", "Portfolio decision", "Reflection after memory matures"],
    active: "active for new runs", roles: "roles", search: "Search role or remit", allStages: "All stages", stage: "Workflow stage",
    save: "Save agent team", saved: "Agent team settings saved.", saveError: "Could not save agent settings.", discard: "Discard changes", dirty: "Unsaved changes", clean: "In sync with profile",
    safetyTitle: "Engine safety boundaries remain in force", safetyBody: "Additional instructions tailor role focus. Position limits, deterministic risk gates, market validation, and order permissions remain independent and mandatory.",
    envTitle: "Some settings cannot be edited in this profile", envBody: "Select a profile that owns these settings or open Profiles & settings to review their source and access status.",
    teamDefault: "Profile default model", resetTitle: "Each agent can be reset to inherited defaults.",
  };

  const updateRoute = (role: string, provider: string, model: string) => {
    if (provider === fallbackProvider && model.trim() === fallbackModel) {
      setRoutes((current) => { const next = { ...current }; delete next[role]; return next; });
    } else {
      setRoutes((current) => ({ ...current, [role]: `${provider}:${model}` }));
    }
  };
  const resetRoute = (role: string) => updateRoute(role, fallbackProvider, fallbackModel);
  const resetAgent = (agent: AgentDefinition) => {
    if (!locked.AI_ROLE_MODELS_JSON) resetRoute(agent.role);
    if (!locked.AI_ROLE_INSTRUCTIONS_JSON) setInstructions((current) => { const next = { ...current }; delete next[agent.role]; return next; });
    if (!locked.AI_ROLE_MAX_TOOL_STEPS_JSON) setSteps((current) => { const next = { ...current }; delete next[agent.role]; return next; });
    if (!agent.required && !locked.AI_DISABLED_AGENTS_JSON) setDisabledRoles((current) => current.filter((role) => role !== agent.role));
  };
  const invalidRoutes = agentDefinitions.filter((agent) => {
    const configured = routes[agent.role];
    if (!configured) return false;
    const parts = routeParts(configured, fallbackProvider, fallbackModel);
    return !providers.includes(parts.provider) || !parts.model.trim() || /[\r\n]/.test(parts.model);
  });
  const routesValid = invalidRoutes.length === 0;
  const save = async () => {
    if (!routesValid) {
      notify(fa ? "ارائه‌دهنده و شناسه مدل هر مسیر اختصاصی را بررسی کنید." : "Check the provider and model ID for each dedicated route.");
      return;
    }
    const settings: Record<string, string> = {};
    if (!locked.AI_ROLE_MODELS_JSON) settings.AI_ROLE_MODELS_JSON = JSON.stringify(routes);
    if (!locked.AI_ROLE_INSTRUCTIONS_JSON) settings.AI_ROLE_INSTRUCTIONS_JSON = JSON.stringify(instructions);
    if (!locked.AI_ROLE_MAX_TOOL_STEPS_JSON) settings.AI_ROLE_MAX_TOOL_STEPS_JSON = JSON.stringify(steps);
    if (!locked.AI_DISABLED_AGENTS_JSON) settings.AI_DISABLED_AGENTS_JSON = JSON.stringify([...new Set(disabledRoles)].sort());
    if (Object.keys(settings).length === 0) {
      notify(fa ? "همه تنظیم‌های عامل در این پروفایل فقط‌خواندنی هستند." : "All agent settings are read-only for this profile.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ profileId, settings }) });
      onRefresh();
      notify(inputTexts.saved);
    } catch (error) {
      notify(error instanceof Error ? error.message : inputTexts.saveError);
    } finally { setSaving(false); }
  };
  const discard = () => {
    setRoutes(initialRoutes);
    setInstructions(initialInstructions);
    setSteps(initialSteps);
    setDisabledRoles(initialDisabled);
  };

  return <div className="agent-workspace">
    <section className="agent-overview" aria-label={inputTexts.summary}>
      <div className="agent-overview-mark"><Workflow size={20} aria-hidden="true" /></div>
      <div className="agent-overview-copy"><h2>{inputTexts.summary}</h2><p>{inputTexts.summaryDetail}</p></div>
      <div className="agent-overview-meta"><span className="count-pill">{selectedCount}/{agentDefinitions.length} {inputTexts.active}</span><span className="agent-default-model"><span>{inputTexts.teamDefault}</span><code dir="ltr">{fallback}</code></span></div>
    </section>

    <details className="agent-flow card" aria-labelledby="agent-flow-title">
      <summary className="agent-flow-summary"><div><h2 id="agent-flow-title">{inputTexts.flowTitle}</h2><p>{inputTexts.flowDescription}</p></div><ChevronDown size={16} aria-hidden="true" /></summary>
      <ol className="agent-flow-steps">{inputTexts.flow.map((step, index) => <li key={step}><span className="agent-flow-index">{String(index + 1).padStart(2, "0")}</span><span>{step}</span></li>)}</ol>
    </details>

    <div className="notice info agent-safety-note"><ShieldCheck size={17} aria-hidden="true" /><div><b>{inputTexts.safetyTitle}</b><p>{inputTexts.safetyBody}</p></div></div>
    {Object.values(locked).some(Boolean) && <div className="notice warning agent-safety-note"><CircleHelp size={17} aria-hidden="true" /><div><b>{inputTexts.envTitle}</b><p>{inputTexts.envBody}</p></div></div>}

    <div className="agent-toolbar">
      <div className="field-search"><Search size={15} aria-hidden="true" /><input aria-label={inputTexts.search} placeholder={inputTexts.search} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div className="agent-stage-filter"><FieldLabelInfo label={inputTexts.stage} help={fa ? "فهرست را بر اساس مرحله گردش‌کار عامل‌ها محدود می‌کند؛ هیچ نقشی حذف یا از اجرا غیرفعال نمی‌شود." : "Filters the visible roster by workflow stage. It does not disable or remove any role."} /><AppSelect ariaLabel={inputTexts.stage} value={stageFilter || "__trex_empty__"} locale={locale} onValueChange={setStageFilter} options={[{ value: "__trex_empty__", label: inputTexts.allStages }, ...agentStages.map((stage) => ({ value: stage, label: agentStageTitle(stage, locale) }))]} /></div>
      <span className={`agent-dirty-state ${dirty ? "dirty" : ""}`} role="status">{dirty ? inputTexts.dirty : inputTexts.clean}</span>
      {dirty && <button className="button secondary" type="button" onClick={discard} disabled={saving}>{inputTexts.discard}</button>}
      <button className="button primary" type="button" onClick={() => void save()} disabled={!dirty || saving || !routesValid}><Check size={15} aria-hidden="true" />{saving ? (fa ? "در حال ذخیره…" : "Saving…") : inputTexts.save}</button>
    </div>
    {!routesValid && <div className="notice warning agent-safety-note" role="alert"><CircleHelp size={17} aria-hidden="true" /><div><b>{fa ? "مسیر مدل نامعتبر است" : "A model route is incomplete"}</b><p>{fa ? `${invalidRoutes.map((agent) => agent.name.fa).join("، ")}: ارائه‌دهنده را انتخاب و شناسه مدل را بدون رفتن به خط بعد وارد کنید.` : `${invalidRoutes.map((agent) => agent.name.en).join(", ")}: select a provider and enter a model ID on a single line.`}</p></div></div>}

    {grouped.length === 0 ? <div className="empty"><span className="empty-mark"><Search size={18} aria-hidden="true" /></span><p>{fa ? "عاملی با این جست‌وجو پیدا نشد." : "No agents match your search."}</p></div> : grouped.map(({ stage, agents }) => <section className="agent-stage-group" key={stage} aria-labelledby={`agents-${stage}`}>
      <div className="agent-stage-heading"><h2 id={`agents-${stage}`}>{agentStageTitle(stage, locale)}</h2><span className="count-pill">{agents.length}</span><div /></div>
      <div className="agent-card-grid">{agents.map((agent) => {
        const configured = routes[agent.role];
        const parts = routeParts(configured ?? fallback, fallbackProvider, fallbackModel);
        return <AgentCard
          key={`${profileId}:${agent.role}`}
          agent={agent} locale={locale} route={{ ...parts, override: Boolean(configured) }} fallback={fallback}
          instructions={instructions[agent.role] ?? ""} enabled={!disabledRoles.includes(agent.role)} maxToolSteps={steps[agent.role] ?? 4} locked={locked}
          onRoute={(provider, model) => updateRoute(agent.role, provider, model)}
          onInstructions={(value) => setInstructions((current) => ({ ...current, [agent.role]: value }))}
          onEnabled={(enabled) => setDisabledRoles((current) => enabled ? current.filter((role) => role !== agent.role) : [...new Set([...current, agent.role])])}
          onSteps={(value) => setSteps((current) => ({ ...current, [agent.role]: value }))}
           onReset={() => resetAgent(agent)}
        />;
      })}</div>
    </section>)}
  </div>;
}
