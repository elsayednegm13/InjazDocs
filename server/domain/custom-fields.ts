import { errors } from "../http/errors";

export type CustomFieldDataType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";

export type CustomFieldDefinition = {
  id: string;
  target_entity: string;
  field_key: string;
  label_en: string;
  label_ar: string;
  data_type: CustomFieldDataType;
  required: number;
  options_json: string | null;
  sensitive: number;
  active: number;
  position: number;
};

export function normalizeCustomFieldOptions(definition: Pick<CustomFieldDefinition, "data_type" | "options_json">): string[] {
  if (definition.data_type !== "SELECT") return [];
  try {
    const options = JSON.parse(definition.options_json || "[]");
    if (!Array.isArray(options) || options.some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error("invalid options");
    }
    return options.map((item) => item.trim());
  } catch {
    throw errors.validation("Select field options are invalid.", undefined, "CUSTOM_FIELD_OPTIONS_INVALID");
  }
}

export function customFieldsRequiredNow(target: string, status?: string | null): boolean {
  if (target === "EXPORT_CASE") return Boolean(status) && status !== "DRAFT" && status !== "CANCELLED";
  if (target === "BOOKING") return Boolean(status) && status !== "DRAFT" && status !== "CANCELLED";
  if (target === "CONTAINER") return Boolean(status) && status !== "PLANNED" && status !== "CANCELLED";
  return target === "CUSTOMER" || target === "INVOICE";
}

export function serializeCustomFieldValue(
  definition: Pick<CustomFieldDefinition, "field_key" | "data_type" | "options_json">,
  value: unknown,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const field = definition.field_key;
  switch (definition.data_type) {
    case "TEXT":
      if (typeof value !== "string") throw errors.validation("Text custom field must be text.", { [field]: "CUSTOM_FIELD_TEXT" }, "CUSTOM_FIELD_TYPE_INVALID");
      return value.trim();
    case "NUMBER": {
      const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
      if (!Number.isFinite(numeric)) throw errors.validation("Number custom field is invalid.", { [field]: "CUSTOM_FIELD_NUMBER" }, "CUSTOM_FIELD_TYPE_INVALID");
      return String(numeric);
    }
    case "DATE": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
        throw errors.validation("Date custom field is invalid.", { [field]: "CUSTOM_FIELD_DATE" }, "CUSTOM_FIELD_TYPE_INVALID");
      }
      return value;
    }
    case "BOOLEAN":
      if (value !== true && value !== false && value !== "true" && value !== "false") {
        throw errors.validation("Boolean custom field is invalid.", { [field]: "CUSTOM_FIELD_BOOLEAN" }, "CUSTOM_FIELD_TYPE_INVALID");
      }
      return String(value === true || value === "true");
    case "SELECT": {
      const options = normalizeCustomFieldOptions(definition);
      if (typeof value !== "string" || !options.includes(value)) {
        throw errors.validation("Select custom field value is invalid.", { [field]: "CUSTOM_FIELD_SELECT" }, "CUSTOM_FIELD_OPTION_INVALID");
      }
      return value;
    }
  }
}

export function validateRequiredCustomFields(
  definitions: Array<Pick<CustomFieldDefinition, "field_key" | "required">>,
  values: Record<string, unknown> | undefined,
) {
  const missing = definitions
    .filter((definition) => definition.required === 1 && (values?.[definition.field_key] === undefined || values[definition.field_key] === null || values[definition.field_key] === ""))
    .map((definition) => definition.field_key);
  if (missing.length) {
    throw errors.validation("Required custom fields are missing.", Object.fromEntries(missing.map((key) => [key, "CUSTOM_FIELD_REQUIRED"])), "CUSTOM_FIELD_REQUIRED");
  }
}
