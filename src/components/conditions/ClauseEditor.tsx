"use client";

import { X } from "lucide-react";

import type {
  ConditionClause,
  ConditionColumn,
  ConditionOperator,
} from "../../../convex/model/reportConditions";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/context";
import {
  CONDITION_COLUMNS,
  CONDITION_OPERATORS,
  operatorIsNegated,
  operatorNeedsValues,
} from "@/lib/reportConditions";

import { MarkerListField } from "./MarkerListField";

/**
 * One "column / operator / values" condition. The values field is hidden for
 * the empty operators, but the values are kept so switching back restores them.
 */
export function ClauseEditor({
  clause,
  onChange,
  onRemove,
  disabled,
}: {
  clause: ConditionClause;
  onChange: (clause: ConditionClause) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const columnItems = CONDITION_COLUMNS.map((value) => ({
    value,
    label: t.conditions.columns[value],
  }));
  const operatorItems = CONDITION_OPERATORS.map((value) => ({
    value,
    label: t.conditions.operators[value],
  }));

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-end gap-2">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel>{t.conditions.clause.column}</FieldLabel>
            <Select
              items={columnItems}
              value={clause.column}
              onValueChange={(value) => onChange({ ...clause, column: value as ConditionColumn })}
              disabled={disabled}
            >
              <SelectTrigger aria-label={t.conditions.clause.column} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {columnItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>{t.conditions.clause.operator}</FieldLabel>
            <Select
              items={operatorItems}
              value={clause.operator}
              onValueChange={(value) =>
                onChange({ ...clause, operator: value as ConditionOperator })
              }
              disabled={disabled}
            >
              <SelectTrigger aria-label={t.conditions.clause.operator} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {operatorItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          onClick={onRemove}
          disabled={disabled}
          aria-label={t.conditions.clause.remove}
          title={t.conditions.clause.remove}
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      {operatorNeedsValues(clause.operator) ? (
        <MarkerListField
          label={t.conditions.clause.values}
          values={clause.values}
          onChange={(values) => onChange({ ...clause, values })}
          disabled={disabled}
          emptyHint={
            operatorIsNegated(clause.operator)
              ? t.conditions.clause.emptyNegated
              : t.conditions.clause.emptyPositive
          }
        />
      ) : null}
    </div>
  );
}
