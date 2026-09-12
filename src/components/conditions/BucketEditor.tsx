"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRef } from "react";

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
import { expressionHasNoClauses } from "@/lib/reportConditions";

import { ClauseEditor } from "./ClauseEditor";

const GROUP_MATCH_ITEMS = [
  { value: "all", label: "All conditions" },
  { value: "any", label: "Any condition" },
];

function newClause(): ConditionClause {
  return { column: "L", operator: "contains", values: [] };
}

// Keys follow the item, not its position: removing a middle clause or group
// must not hand the editor state of the removed one to the next. An edit
// replaces the object at the same position, so that position keeps its key and
// the editor is not remounted while it is being used. Ids live in a WeakMap so
// they never reach the persisted condition shape.
function useStableItemKeys<T extends object>(items: readonly T[]): string[] {
  const idsRef = useRef(new WeakMap<T, string>());
  const counterRef = useRef(0);
  const previousRef = useRef<{ items: readonly T[]; keys: string[] }>({ items: [], keys: [] });

  const keys = items.map((item, index) => {
    const existing = idsRef.current.get(item);
    if (existing !== undefined) return existing;

    const previous = previousRef.current;
    let id = previous.items.length === items.length ? previous.keys[index] : undefined;
    if (id === undefined) {
      counterRef.current += 1;
      id = `item-${counterRef.current}`;
    }
    idsRef.current.set(item, id);
    return id;
  });

  previousRef.current = { items, keys };
  return keys;
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
  const keys = useStableItemKeys(clauses);
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
          This list already has the maximum of {MAX_CLAUSES_PER_SECTION} conditions. Remove one to
          add another.
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
          <FieldLabel>Group {index + 1}</FieldLabel>
          <Select
            items={GROUP_MATCH_ITEMS}
            value={group.match}
            onValueChange={(value) =>
              onChange({ ...group, match: value as ConditionGroup["match"] })
            }
            disabled={disabled}
          >
            <SelectTrigger aria-label={`Group ${index + 1} match`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {GROUP_MATCH_ITEMS.map((item) => (
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
          aria-label={`Remove group ${index + 1}`}
          title={`Remove group ${index + 1}`}
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
        addLabel="Add condition"
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
  const groupKeys = useStableItemKeys(expression.groups);
  const groupsAtLimit = expression.groups.length >= MAX_GROUPS_PER_EXPRESSION;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Always apply</h3>
          <p className="text-xs text-muted-foreground">
            Every condition here must match before a row can land in this group.
          </p>
        </div>
        <ClauseList
          clauses={expression.filters}
          onChange={updateFilter}
          onRemove={removeFilter}
          onAdd={addFilter}
          disabled={disabled}
          addLabel="Add condition"
        />
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Match any of these groups</h3>
          <p className="text-xs text-muted-foreground">
            At least one group must match. Leave the list empty to ignore groups.
          </p>
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
          Add group
        </Button>
        {groupsAtLimit ? (
          <p className="text-xs text-muted-foreground">
            This group list already has the maximum of {MAX_GROUPS_PER_EXPRESSION} entries. Remove
            one to add another.
          </p>
        ) : null}
      </section>

      {canCatchAll ? (
        <>
          <Separator />
          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">Catch all remaining rows</h3>
              <p className="text-xs text-muted-foreground">
                Every row that no earlier group took lands here. The conditions above are ignored.
              </p>
            </div>
            <Switch
              checked={bucket.catchAll}
              onCheckedChange={(catchAll) => onChange({ ...bucket, catchAll })}
              disabled={disabled}
              aria-label="Catch all remaining rows"
            />
          </div>
        </>
      ) : null}

      {noCriteria ? (
        <Alert>
          <AlertTitle>This group has no conditions</AlertTitle>
          <AlertDescription>
            Every row that reaches this group lands here. Add a condition if it should be narrower.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
