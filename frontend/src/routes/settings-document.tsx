import { type ReactNode, useEffect, useState } from "react";
import { useParams } from "react-router";
import { CanonicalSettingsSection } from "#/components/features/settings/canonical-settings-section";
import { ConfigurationOperationPicker } from "#/components/features/settings/configuration-operation-picker";
import { useSaveSettings } from "#/hooks/mutation/use-save-settings";
import { useMe } from "#/hooks/query/use-me";
import { useSettings } from "#/hooks/query/use-settings";
import { ConfigurationOperation, ConfigurationPolicy } from "#/types/settings";
import {
  displayErrorToast,
  displaySuccessToast,
} from "#/utils/custom-toast-handlers";
import { cn } from "#/utils/utils";

type PageScope = "organization" | "personal";

const COPY = {
  unknownSection: "Unknown settings section.",
  memberGuidance:
    "These are your effective settings: organization values plus any personal overrides allowed by the organization. Clear personal overrides to inherit organization values again.",
  organizationTab: "Organization values",
  personalTab: "My personal values",
};

function ScopeTab({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "border-b-2 px-4 py-2 text-sm font-medium",
        active
          ? "border-primary text-white"
          : "border-transparent text-[var(--oh-muted)] hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

export default function SettingsDocumentScreen() {
  const { sectionKey } = useParams();
  const { data: me } = useMe();
  const { data: orgSettings } = useSettings("org");
  const saveOrgSettings = useSaveSettings("org");
  const [scope, setScope] = useState<PageScope>("organization");
  const isAdmin = me?.role === "admin" || me?.role === "owner";
  const persistedOperation =
    orgSettings?.configuration_policy?.settings?.[sectionKey ?? ""]
      ?.operation ?? "extend";
  const [operation, setOperation] =
    useState<ConfigurationOperation>(persistedOperation);

  useEffect(() => {
    setOperation(persistedOperation);
  }, [persistedOperation, sectionKey]);

  if (!sectionKey) {
    return (
      <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-5 text-sm text-red-200">
        {COPY.unknownSection}
      </div>
    );
  }

  const updateOperation = async (next: ConfigurationOperation) => {
    const currentPolicy: ConfigurationPolicy =
      orgSettings?.configuration_policy ?? {
        llm: { operation: "extend" },
        settings: {},
      };
    setOperation(next);
    try {
      await saveOrgSettings.mutateAsync({
        configuration_policy: {
          ...currentPolicy,
          settings: {
            ...currentPolicy.settings,
            [sectionKey]: { operation: next },
          },
        },
      });
      displaySuccessToast("Member settings permissions updated");
    } catch (error) {
      setOperation(persistedOperation);
      displayErrorToast(
        error instanceof Error
          ? error.message
          : "Unable to update member settings permissions",
      );
    }
  };

  if (!isAdmin) {
    const isReadOnly = operation === "locked" || operation === "subset";
    return (
      <div className="flex flex-col gap-5">
        <div
          className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-tertiary-alt"
          role="note"
        >
          {COPY.memberGuidance}
        </div>
        <CanonicalSettingsSection
          sectionKey={sectionKey}
          operation={operation}
          isReadOnly={isReadOnly}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ConfigurationOperationPicker
        operation={operation}
        isPending={saveOrgSettings.isPending}
        onChange={updateOperation}
      />
      <div className="flex border-b border-white/10" role="tablist">
        <ScopeTab
          active={scope === "organization"}
          onClick={() => setScope("organization")}
        >
          {COPY.organizationTab}
        </ScopeTab>
        <ScopeTab
          active={scope === "personal"}
          onClick={() => setScope("personal")}
        >
          {COPY.personalTab}
        </ScopeTab>
      </div>
      <CanonicalSettingsSection
        sectionKey={sectionKey}
        operation={operation}
        scope={scope}
        isReadOnly={false}
      />
    </div>
  );
}
