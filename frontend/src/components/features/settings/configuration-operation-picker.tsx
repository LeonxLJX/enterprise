import { ConfigurationOperation } from "#/types/settings";
import { cn } from "#/utils/utils";

const PICKER_TITLE = "Member access";
const PICKER_DESCRIPTION =
  "Choose how organization values compose with personal settings. Access can only narrow below this organization.";

const OPERATION_OPTIONS: Array<{
  value: ConfigurationOperation;
  label: string;
  description: string;
}> = [
  {
    value: "locked",
    label: "Locked",
    description: "Use organization values and prevent personal changes.",
  },
  {
    value: "replace",
    label: "Replace",
    description: "Allow personal values to replace organization values.",
  },
  {
    value: "subset",
    label: "Subset",
    description: "Restrict personal choices to organization-managed values.",
  },
  {
    value: "extend",
    label: "Extend",
    description: "Inherit organization values and allow personal additions.",
  },
];

export function ConfigurationOperationPicker({
  operation,
  isPending,
  onChange,
}: {
  operation: ConfigurationOperation;
  isPending: boolean;
  onChange: (operation: ConfigurationOperation) => void;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="text-base font-semibold text-white">{PICKER_TITLE}</h2>
      <p className="mt-1 text-sm text-[var(--oh-muted)]">
        {PICKER_DESCRIPTION}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {OPERATION_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={isPending}
            aria-pressed={operation === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors",
              operation === option.value
                ? "border-primary bg-primary/10"
                : "border-white/10 hover:border-white/30",
            )}
          >
            <span className="block text-sm font-semibold text-white">
              {option.label}
            </span>
            <span className="mt-1 block text-xs text-[var(--oh-muted)]">
              {option.description}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
