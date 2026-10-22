import React from "react";
import { BrandButton } from "#/components/features/settings/brand-button";
import { SchemaField } from "#/components/features/settings/sdk-settings/schema-field";
import {
  usePatchSettingsDocument,
  useSettingsDocument,
  useSettingsDocumentSchema,
} from "#/hooks/query/use-settings-document";
import { SettingsFieldSchema, SettingsValue } from "#/types/settings";
import {
  displayErrorToast,
  displaySuccessToast,
} from "#/utils/custom-toast-handlers";

export type CanonicalSettingsScope = "personal" | "organization";
type FormValue = string | boolean;

const COPY = {
  loading: "Loading shared SDK settings…",
  loadError: "Unable to load this SDK settings section.",
  schemaDescription: "Rendered from the same SDK schema as Agent Canvas.",
  organizationSource: "Organization values",
  managedSource: "Effective values · managed by your organization",
  personalSource: "Effective values · personal overrides take priority",
  clearOrganization: "Clear organization values",
  clearPersonal: "Clear personal overrides",
  save: "Save changes",
};

const getSourceLabel = (
  scope: CanonicalSettingsScope,
  isReadOnly: boolean,
): string => {
  if (scope === "organization") return COPY.organizationSource;
  if (isReadOnly) return COPY.managedSource;
  return COPY.personalSource;
};

const getDotted = (value: unknown, path: string): unknown => {
  let current = value;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const setDotted = (
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) => {
  const parts = path.split(".");
  let current = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      current[part] = value;
      return;
    }
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  });
};

const formValue = (
  field: SettingsFieldSchema,
  document: unknown,
): FormValue => {
  const value = getDotted(document, field.key) ?? field.default ?? "";
  if (field.value_type === "boolean") return Boolean(value);
  if (field.value_type === "array" || field.value_type === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
};

const patchValue = (
  field: SettingsFieldSchema,
  value: FormValue,
): SettingsValue => {
  if (field.value_type === "boolean") return Boolean(value);
  if (field.value_type === "integer") return Number.parseInt(String(value), 10);
  if (field.value_type === "number") return Number(String(value));
  if (field.value_type === "array" || field.value_type === "object") {
    return JSON.parse(String(value)) as SettingsValue;
  }
  return String(value);
};

export function CanonicalSettingsSection({
  sectionKey,
  isReadOnly,
  operation,
  scope = "personal",
}: {
  sectionKey: string;
  isReadOnly: boolean;
  operation: string;
  scope?: CanonicalSettingsScope;
}) {
  const readScope = scope === "organization" ? "organization" : "effective";
  const documentQuery = useSettingsDocument(readScope);
  const schemaQuery = useSettingsDocumentSchema();
  const patchMutation = usePatchSettingsDocument(scope, readScope);
  const [values, setValues] = React.useState<Record<string, FormValue>>({});
  const [dirty, setDirty] = React.useState<Set<string>>(new Set());

  const section = schemaQuery.data?.sections.find(
    (candidate) => candidate.key === sectionKey,
  );

  React.useEffect(() => {
    if (!section || !documentQuery.data) return;
    setValues(
      Object.fromEntries(
        section.fields.map((field) => [
          field.key,
          formValue(field, documentQuery.data),
        ]),
      ),
    );
    setDirty(new Set());
  }, [documentQuery.data, section]);

  if (schemaQuery.isLoading || documentQuery.isLoading) {
    return (
      <section className="rounded-xl border border-white/15 bg-white/[0.03] p-5 text-sm text-tertiary-alt">
        {COPY.loading}
      </section>
    );
  }
  if (schemaQuery.isError || documentQuery.isError || !section) {
    return (
      <section className="rounded-xl border border-red-400/40 bg-red-500/10 p-5 text-sm text-red-200">
        {COPY.loadError}
      </section>
    );
  }
  if (!section.fields.length) return null;

  const save = async () => {
    try {
      const patch: Record<string, unknown> = {};
      section.fields
        .filter((field) => dirty.has(field.key))
        .forEach((field) =>
          setDotted(patch, field.key, patchValue(field, values[field.key])),
        );
      await patchMutation.mutateAsync(patch);
      setDirty(new Set());
      displaySuccessToast(`${section.label} saved`);
    } catch (error) {
      displayErrorToast(
        error instanceof Error
          ? error.message
          : `Unable to save ${section.label}`,
      );
    }
  };

  const clearOverrides = async () => {
    try {
      const patch: Record<string, unknown> = {};
      section.fields.forEach((field) => setDotted(patch, field.key, null));
      await patchMutation.mutateAsync(patch);
      setDirty(new Set());
      displaySuccessToast(`${section.label} overrides cleared`);
    } catch (error) {
      displayErrorToast(
        error instanceof Error
          ? error.message
          : `Unable to clear ${section.label}`,
      );
    }
  };

  const sourceLabel = getSourceLabel(scope, isReadOnly);

  return (
    <section
      className="flex flex-col gap-5 rounded-xl border border-white/15 bg-white/[0.03] p-5"
      data-testid="canonical-settings-section"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-tertiary-alt">{COPY.schemaDescription}</p>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-tertiary-alt">
            {sourceLabel}
          </span>
          <span className="rounded-full border border-blue-400/50 bg-blue-500/10 px-3 py-1 text-xs text-blue-200">
            {operation}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {section.fields.map((field) => (
          <SchemaField
            key={field.key}
            field={field}
            value={values[field.key] ?? formValue(field, {})}
            isDisabled={isReadOnly || patchMutation.isPending}
            onChange={(value) => {
              setValues((current) => ({ ...current, [field.key]: value }));
              setDirty((current) => new Set(current).add(field.key));
            }}
          />
        ))}
      </div>

      {!isReadOnly ? (
        <div className="flex justify-start gap-3">
          <BrandButton
            testId="clear-canonical-settings-section"
            type="button"
            variant="secondary"
            isDisabled={patchMutation.isPending}
            onClick={clearOverrides}
          >
            {scope === "organization"
              ? COPY.clearOrganization
              : COPY.clearPersonal}
          </BrandButton>
          <BrandButton
            testId="save-canonical-settings-section"
            type="button"
            variant="primary"
            isDisabled={dirty.size === 0 || patchMutation.isPending}
            onClick={save}
          >
            {COPY.save}
          </BrandButton>
        </div>
      ) : null}
    </section>
  );
}
