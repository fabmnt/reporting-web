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
import {
  CONDITION_COLUMN_ITEMS,
  CONDITION_OPERATOR_ITEMS,
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
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-end gap-2">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel>Column</FieldLabel>
            <Select
              items={CONDITION_COLUMN_ITEMS}
              value={clause.column}
              onValueChange={(value) => onChange({ ...clause, column: value as ConditionColumn })}
              disabled={disabled}
            >
              <SelectTrigger aria-label="Column" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {CONDITION_COLUMN_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>Operator</FieldLabel>
            <Select
              items={CONDITION_OPERATOR_ITEMS}
              value={clause.operator}
              onValueChange={(value) =>
                onChange({ ...clause, operator: value as ConditionOperator })
              }
              disabled={disabled}
            >
              <SelectTrigger aria-label="Operator" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {CONDITION_OPERATOR_ITEMS.map((item) => (
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
          aria-label="Remove condition"
          title="Remove condition"
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      {operatorNeedsValues(clause.operator) ? (
        <MarkerListField
          label="Values"
          values={clause.values}
          onChange={(values) => onChange({ ...clause, values })}
          disabled={disabled}
          emptyHint={
            operatorIsNegated(clause.operator)
              ? "No values: this condition matches every row."
              : "No values: this condition matches nothing."
          }
        />
      ) : null}
    </div>
  );
}
