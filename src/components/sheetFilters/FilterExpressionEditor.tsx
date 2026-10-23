"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import {
  MAX_CLAUSES_PER_SECTION,
  type ConditionClause,
  type ConditionExpression,
} from "../../../convex/model/reportConditions";
import { ClauseEditor } from "@/components/conditions/ClauseEditor";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";

function newClause(): ConditionClause {
  return { column: "L", operator: "contains", values: [] };
}

// Keys follow the clause object, not its position. Removing a middle condition
// must not hand the editor state of the removed one to the next.
type KeyedItems = { items: readonly ConditionClause[]; keys: string[]; nextId: number };

function allocateItemKeys(items: readonly ConditionClause[], previous: KeyedItems): KeyedItems {
  const keysByIdentity = new Map<ConditionClause, string>();
  previous.items.forEach((item, index) => {
    const key = previous.keys[index];
    if (key !== undefined) keysByIdentity.set(item, key);
  });

  let nextId = previous.nextId;
  const keys = items.map((item, index) => {
    const byIdentity = keysByIdentity.get(item);
    if (byIdentity !== undefined) return byIdentity;
    const byPosition = previous.items.length === items.length ? previous.keys[index] : undefined;
    if (byPosition !== undefined) return byPosition;
    nextId += 1;
    return `clause-${nextId}`;
  });
  return { items, keys, nextId };
}

function useClauseKeys(items: readonly ConditionClause[]): string[] {
  const [state, setState] = useState<KeyedItems>(() => ({
    items,
    keys: items.map((_, index) => `clause-${index + 1}`),
    nextId: items.length,
  }));
  if (state.items !== items) setState(allocateItemKeys(items, state));
  return state.keys;
}

/**
 * The conditions of one sheet filter. A row stays when every condition matches.
 * Group rules from the report-type editor are not shown: saving this editor
 * stores only this list.
 */
export function FilterExpressionEditor({
  expression,
  onChange,
  disabled,
}: {
  expression: ConditionExpression;
  onChange: (expression: ConditionExpression) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const filters = expression.filters;
  const keys = useClauseKeys(filters);
  const atLimit = filters.length >= MAX_CLAUSES_PER_SECTION;

  function emit(nextFilters: ConditionClause[]) {
    onChange({ filters: nextFilters, groups: [] });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{t.sheetFilters.admin.conditionsTitle}</h3>
        <p className="text-xs text-muted-foreground">{t.sheetFilters.admin.conditionsNote}</p>
      </div>
      {filters.map((clause, index) => (
        <ClauseEditor
          key={keys[index]}
          clause={clause}
          disabled={disabled}
          onChange={(next) =>
            emit(filters.map((item, position) => (position === index ? next : item)))
          }
          onRemove={() => emit(filters.filter((_, position) => position !== index))}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={() => emit([...filters, newClause()])}
        disabled={disabled || atLimit}
      >
        <Plus data-icon="inline-start" aria-hidden="true" />
        {t.sheetFilters.admin.addCondition}
      </Button>
      {atLimit ? (
        <p className="text-xs text-muted-foreground">
          {t.conditions.bucket.clauseLimit(MAX_CLAUSES_PER_SECTION)}
        </p>
      ) : null}
      {filters.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.sheetFilters.admin.noConditions}</p>
      ) : null}
    </section>
  );
}
