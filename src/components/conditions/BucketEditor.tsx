"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  MAX_CLAUSES_PER_SECTION,
  MAX_GROUPS_PER_EXPRESSION,
  type ConditionBucket,
  type ConditionClause,
  type ConditionExpression,
  type ConditionGroup,
} from "../../../convex/model/reportConditions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n/context";
import { expressionHasNoClauses } from "@/lib/reportConditions";

import { ClauseEditor } from "./ClauseEditor";

const GROUP_MATCH_VALUES = ["all", "any"] as const;

function newClause(): ConditionClause {
  return { column: "L", operator: "contains", values: [] };
}

// Keys follow the item, not its position: removing a middle clause or group
// must not hand the editor state of the removed one to the next. An edit
// replaces the object at the same position, so that position keeps its key and
// the editor is not remounted while it is being used.
type KeyedItems<T> = { items: readonly T[]; keys: string[]; nextId: number };

function allocateItemKeys<T extends object>(
  items: readonly T[],
  previous: KeyedItems<T>
): KeyedItems<T> {
  const keysByIdentity = new Map<T, string>();
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
    return `item-${nextId}`;
  });
  return { items, keys, nextId };
}

// Allocation lives in state, not in a ref, so a render React discards cannot
// change the keys a later commit uses. The length check is the documented
// "adjust state when props change" pattern.
function useItemKeys<T extends object>(items: readonly T[]): string[] {
  const [state, setState] = useState<KeyedItems<T>>(() => ({
    items,
    keys: items.map((_, index) => `item-${index + 1}`),
    nextId: items.length,
  }));
  if (state.items !== items) {
    setState(allocateItemKeys(items, state));
  }
  return state.keys;
}

function ClauseList({
  clauses,
  onChange,
  onRemove,
  onAdd,
  disabled,
  addLabel,
}: {
  clauses: ConditionClause[];
  onChange: (index: number, clause: ConditionClause) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  disabled: boolean;
  addLabel: string;
}) {
  const { t } = useI18n();
  const keys = useItemKeys(clauses);
  const atLimit = clauses.length >= MAX_CLAUSES_PER_SECTION;
  return (
    <>
      {clauses.map((clause, index) => (
        <ClauseEditor
          key={keys[index]}
          clause={clause}
          onChange={(next) => onChange(index, next)}
          onRemove={() => onRemove(index)}
          disabled={disabled}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={onAdd}
        disabled={disabled || atLimit}
      >
        <Plus data-icon="inline-start" aria-hidden="true" />
        {addLabel}
      </Button>
      {atLimit ? (
        <p className="text-xs text-muted-foreground">
          {t.conditions.bucket.clauseLimit(MAX_CLAUSES_PER_SECTION)}
        </p>
      ) : null}
    </>
  );
}

function GroupEditor({
  index,
  group,
  onChange,
  onRemove,
  disabled,
}: {
  index: number;
  group: ConditionGroup;
  onChange: (group: ConditionGroup) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const groupMatchItems = GROUP_MATCH_VALUES.map((value) => ({
    value,
    label: value === "all" ? t.conditions.bucket.allConditions : t.conditions.bucket.anyCondition,
  }));
  const updateClause = (clauseIndex: number, clause: ConditionClause) =>
    onChange({
      ...group,
      clauses: group.clauses.map((item, position) => (position === clauseIndex ? clause : item)),
    });
  const removeClause = (clauseIndex: number) =>
    onChange({
      ...group,
      clauses: group.clauses.filter((_, position) => position !== clauseIndex),
    });
  const addClause = () => onChange({ ...group, clauses: [...group.clauses, newClause()] });

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
      <div className="flex items-end justify-between gap-2">
        <Field className="w-44">
          <FieldLabel>{t.conditions.editor.group(index)}</FieldLabel>
          <Select
            items={groupMatchItems}
            value={group.match}
            onValueChange={(value) =>
              onChange({ ...group, match: value as ConditionGroup["match"] })
            }
            disabled={disabled}
          >
            <SelectTrigger aria-label={t.conditions.bucket.groupMatch(index)} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {groupMatchItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          onClick={onRemove}
          disabled={disabled}
          aria-label={t.conditions.editor.removeGroup(index)}
          title={t.conditions.editor.removeGroup(index)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      <ClauseList
        clauses={group.clauses}
        onChange={updateClause}
        onRemove={removeClause}
        onAdd={addClause}
        disabled={disabled}
        addLabel={t.conditions.bucket.addCondition}
      />
    </div>
  );
}

/**
 * Rules of one row group: the conditions every row must pass, plus the groups
 * of which at least one must match. The catch all switch only appears when the
 * group can actually catch all rows no earlier group took.
 */
export function BucketEditor({
  bucket,
  canCatchAll,
  onChange,
  disabled,
}: {
  bucket: ConditionBucket;
  canCatchAll: boolean;
  onChange: (bucket: ConditionBucket) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const { expression } = bucket;

  const updateExpression = (patch: Partial<ConditionExpression>) =>
    onChange({ ...bucket, expression: { ...expression, ...patch } });

  const updateFilter = (index: number, clause: ConditionClause) =>
    updateExpression({
      filters: expression.filters.map((item, position) => (position === index ? clause : item)),
    });
  const removeFilter = (index: number) =>
    updateExpression({ filters: expression.filters.filter((_, position) => position !== index) });
  const addFilter = () => updateExpression({ filters: [...expression.filters, newClause()] });

  const updateGroup = (index: number, group: ConditionGroup) =>
    updateExpression({
      groups: expression.groups.map((item, position) => (position === index ? group : item)),
    });
  const removeGroup = (index: number) =>
    updateExpression({ groups: expression.groups.filter((_, position) => position !== index) });
  const addGroup = () =>
    updateExpression({ groups: [...expression.groups, { match: "all", clauses: [newClause()] }] });

  const noCriteria = !bucket.catchAll && expressionHasNoClauses(expression);
  const groupKeys = useItemKeys(expression.groups);
  const groupsAtLimit = expression.groups.length >= MAX_GROUPS_PER_EXPRESSION;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t.conditions.bucket.alwaysApply}</h3>
          <p className="text-xs text-muted-foreground">{t.conditions.bucket.alwaysApplyNote}</p>
        </div>
        <ClauseList
          clauses={expression.filters}
          onChange={updateFilter}
          onRemove={removeFilter}
          onAdd={addFilter}
          disabled={disabled}
          addLabel={t.conditions.bucket.addCondition}
        />
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t.conditions.bucket.matchAny}</h3>
          <p className="text-xs text-muted-foreground">{t.conditions.bucket.matchAnyNote}</p>
        </div>
        {expression.groups.map((group, index) => (
          <GroupEditor
            key={groupKeys[index]}
            index={index}
            group={group}
            onChange={(next) => updateGroup(index, next)}
            onRemove={() => removeGroup(index)}
            disabled={disabled}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={addGroup}
          disabled={disabled || groupsAtLimit}
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          {t.conditions.bucket.addGroup}
        </Button>
        {groupsAtLimit ? (
          <p className="text-xs text-muted-foreground">
            {t.conditions.bucket.groupLimit(MAX_GROUPS_PER_EXPRESSION)}
          </p>
        ) : null}
      </section>

      {canCatchAll ? (
        <>
          <Separator />
          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">{t.conditions.bucket.catchAllTitle}</h3>
              <p className="text-xs text-muted-foreground">{t.conditions.bucket.catchAllNote}</p>
            </div>
            <Switch
              checked={bucket.catchAll}
              onCheckedChange={(catchAll) => onChange({ ...bucket, catchAll })}
              disabled={disabled}
              aria-label={t.conditions.bucket.catchAllTitle}
            />
          </div>
        </>
      ) : null}

      {noCriteria ? (
        <Alert>
          <AlertTitle>{t.conditions.bucket.noConditionsTitle}</AlertTitle>
          <AlertDescription>{t.conditions.bucket.noConditionsNote}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
