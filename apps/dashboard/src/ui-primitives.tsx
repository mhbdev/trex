import * as SelectPrimitive from "@radix-ui/react-select";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Check, ChevronDown, CircleHelp } from "lucide-react";
import { useState, type ReactNode } from "react";

export type SelectOption = {
  value: string;
  label: string;
  detail?: string;
  disabled?: boolean;
};

export function AppSelect({
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder,
  locale,
  disabled,
  className = "",
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel: string;
  placeholder?: string;
  locale: "fa" | "en";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root
      value={value || undefined}
      onValueChange={(next) => onValueChange(next === "__trex_empty__" ? "" : next)}
      dir={locale === "fa" ? "rtl" : "ltr"}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger className={`app-select-trigger ${className}`} aria-label={ariaLabel}>
        <SelectPrimitive.Value placeholder={placeholder ?? (locale === "fa" ? "انتخاب کنید" : "Select an option")} />
        <SelectPrimitive.Icon className="app-select-icon"><ChevronDown size={15} /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="app-select-content" position="popper" sideOffset={5} collisionPadding={10}>
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item className="app-select-item" key={option.value} value={option.value} disabled={option.disabled}>
                <span className="app-select-check"><SelectPrimitive.ItemIndicator><Check size={14} /></SelectPrimitive.ItemIndicator></span>
                <span className="app-select-copy">
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  {option.detail && <small>{option.detail}</small>}
                </span>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function FieldLabelInfo({
  label,
  help,
  htmlFor,
  className = "",
}: {
  label: string;
  help: string;
  htmlFor?: string;
  className?: string;
}) {
  const text: ReactNode = <span className="field-label-copy">{label}</span>;
  return (
    <span className={`field-label-info ${className}`}>
      {htmlFor ? <label htmlFor={htmlFor}>{text}</label> : text}
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <button className="help-trigger" type="button" aria-label={`${label}: ${help}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
            <CircleHelp size={14} aria-hidden="true" />
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className="help-tooltip" sideOffset={7} collisionPadding={10}>
            {help}
            <TooltipPrimitive.Arrow className="help-tooltip-arrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </span>
  );
}

export function InfoTooltip({ label, help, className = "" }: { label: string; help: string; className?: string }) {
  return <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>
      <button className={`help-trigger ${className}`} type="button" aria-label={`${label}: ${help}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        <CircleHelp size={14} aria-hidden="true" />
      </button>
    </TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content className="help-tooltip" sideOffset={7} collisionPadding={10}>
        {help}<TooltipPrimitive.Arrow className="help-tooltip-arrow" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>;
}

export function SegmentedTabs({ id, label, value, locale, options, onValueChange }: {
  id: string;
  label: string;
  value: string;
  locale: "fa" | "en";
  options: Array<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
}) {
  const baseId = id;
  const currentIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const move = (currentTarget: HTMLButtonElement, delta: number) => {
    const next = (currentIndex + delta + options.length) % options.length;
    const option = options[next]!;
    onValueChange(option.value);
    currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-tab-index="${next}"]`)?.focus();
  };
  return <div className="segmented-scroll dashboard-segmented-tabs" role="tablist" aria-label={label} dir={locale === "fa" ? "rtl" : "ltr"}>
    {options.map((option, index) => <button
      key={option.value}
      id={`${baseId}-tab-${option.value}`}
      data-tab-index={index}
      type="button"
      role="tab"
      aria-selected={value === option.value}
      aria-controls={`${baseId}-panel`}
      tabIndex={value === option.value ? 0 : -1}
      className={value === option.value ? "selected" : ""}
      onClick={() => onValueChange(option.value)}
      onKeyDown={(event) => {
        if (event.key === "Home") { event.preventDefault(); move(event.currentTarget, -currentIndex); }
        else if (event.key === "End") { event.preventDefault(); move(event.currentTarget, options.length - currentIndex - 1); }
        else if (event.key === "ArrowRight") { event.preventDefault(); move(event.currentTarget, locale === "fa" ? -1 : 1); }
        else if (event.key === "ArrowLeft") { event.preventDefault(); move(event.currentTarget, locale === "fa" ? 1 : -1); }
      }}
    >{option.label}</button>)}
  </div>;
}

function currencyMark(value: string): string {
  const symbol = value.toUpperCase();
  if (symbol === "BTC") return "₿";
  if (symbol === "ETH") return "◆";
  if (symbol === "USDT") return "T";
  if (symbol === "TMN" || symbol === "IRT") return "ت";
  return symbol.length <= 3 ? symbol : symbol.slice(0, 2);
}

function splitMarketSymbol(symbol: string, quoteCurrency?: string): [string, string] {
  const normalized = symbol.toUpperCase().replaceAll("/", "").trim();
  const suffixes = [...new Set([quoteCurrency?.toUpperCase(), "USDT", "TMN", "IRT", "BTC", "ETH"].filter(Boolean) as string[])]
    .sort((left, right) => right.length - left.length);
  const quote = suffixes.find((suffix) => normalized.endsWith(suffix) && normalized.length > suffix.length);
  return quote ? [normalized.slice(0, -quote.length), quote] : [normalized, quoteCurrency?.toUpperCase() ?? "?"];
}

function CurrencyAvatar({ asset, iconUrl, side }: { asset: string; iconUrl?: string; side: "base" | "quote" }) {
  const [failed, setFailed] = useState(false);
  const safeIconUrl = iconUrl?.startsWith("https://") ? iconUrl : undefined;
  return <span className={`currency-avatar currency-${side} currency-${asset.toLowerCase().replace(/[^a-z0-9]/g, "")}`} title={asset}>
    {safeIconUrl && !failed ? <img src={safeIconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : currencyMark(asset)}
  </span>;
}

export function CurrencyPairAvatar({ symbol, quoteCurrency, assetIcons = {} }: { symbol: string; quoteCurrency?: string; assetIcons?: Record<string, string> }) {
  const [base, quote] = splitMarketSymbol(symbol, quoteCurrency);
  return (
    <span className="currency-stack" role="img" aria-label={`${base} base currency and ${quote} quote currency`}>
      <CurrencyAvatar asset={base} iconUrl={assetIcons[base]} side="base" />
      <CurrencyAvatar asset={quote} iconUrl={assetIcons[quote]} side="quote" />
    </span>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={120}>{children}</TooltipPrimitive.Provider>;
}
