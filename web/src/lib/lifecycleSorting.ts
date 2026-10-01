export type LifecycleSortField =
  | "createdAt"
  | "dueDate"
  | "completedAt"
  | "archivedAt"
  | "deletedAt"
  | "priority";

export type LifecycleSort = `${LifecycleSortField}:${"asc" | "desc"}`;
export type LifecycleView = "active" | "completed" | "archived" | "bin";

export interface LifecycleSortable {
  createdAt: string;
  dueDate?: string | null;
  completedAt?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  priority: "low" | "medium" | "high";
  name?: string;
}

const sortOptions: Record<
  LifecycleView,
  { value: LifecycleSort; label: string }[]
> = {
  active: [
    { value: "createdAt:desc", label: "Created: Newest First" },
    { value: "createdAt:asc", label: "Created: Oldest First" },
    { value: "dueDate:asc", label: "Due Date: Soonest First" },
    { value: "dueDate:desc", label: "Due Date: Latest First" },
    { value: "priority:desc", label: "Priority: High → Low" },
    { value: "priority:asc", label: "Priority: Low → High" },
  ],
  completed: [
    { value: "createdAt:desc", label: "Created: Newest First" },
    { value: "createdAt:asc", label: "Created: Oldest First" },
    { value: "completedAt:desc", label: "Completed: Newest First" },
    { value: "completedAt:asc", label: "Completed: Oldest First" },
    { value: "dueDate:asc", label: "Due Date: Soonest First" },
    { value: "dueDate:desc", label: "Due Date: Latest First" },
    { value: "priority:desc", label: "Priority: High → Low" },
    { value: "priority:asc", label: "Priority: Low → High" },
  ],
  archived: [
    { value: "archivedAt:desc", label: "Archived: Newest First" },
    { value: "archivedAt:asc", label: "Archived: Oldest First" },
    { value: "createdAt:desc", label: "Created: Newest First" },
    { value: "createdAt:asc", label: "Created: Oldest First" },
    { value: "dueDate:asc", label: "Due Date: Soonest First" },
    { value: "dueDate:desc", label: "Due Date: Latest First" },
    { value: "priority:desc", label: "Priority: High → Low" },
    { value: "priority:asc", label: "Priority: Low → High" },
  ],
  bin: [
    { value: "deletedAt:desc", label: "Deleted: Newest First" },
    { value: "deletedAt:asc", label: "Deleted: Oldest First" },
    { value: "createdAt:desc", label: "Created: Newest First" },
    { value: "createdAt:asc", label: "Created: Oldest First" },
    { value: "dueDate:asc", label: "Due Date: Soonest First" },
    { value: "dueDate:desc", label: "Due Date: Latest First" },
    { value: "priority:desc", label: "Priority: High → Low" },
    { value: "priority:asc", label: "Priority: Low → High" },
  ],
};

export function getLifecycleSortOptions(view: LifecycleView) {
  return sortOptions[view];
}

export function defaultLifecycleSort(view: LifecycleView): LifecycleSort {
  if (view === "active") return "dueDate:desc";
  if (view === "completed") return "completedAt:desc";
  if (view === "archived") return "archivedAt:desc";
  return "deletedAt:desc";
}

export function compareLifecycleItems<T extends LifecycleSortable>(
  left: T,
  right: T,
  sort: LifecycleSort,
): number {
  const [field, direction] = sort.split(":") as [
    LifecycleSortField,
    "asc" | "desc",
  ];
  const priorityRanks = { high: 0, medium: 1, low: 2 };

  if (field === "priority") {
    const result = priorityRanks[left.priority] - priorityRanks[right.priority];
    return direction === "desc" ? result : -result;
  }

  const leftValue = left[field];
  const rightValue = right[field];
  if (!leftValue || !rightValue) {
    if (!leftValue && !rightValue) return 0;
    return leftValue ? -1 : 1;
  }

  const dateOrder =
    (new Date(leftValue).getTime() - new Date(rightValue).getTime()) *
    (direction === "asc" ? 1 : -1);
  return (
    dateOrder ||
    priorityRanks[left.priority] - priorityRanks[right.priority] ||
    (left.name ?? "").localeCompare(right.name ?? "")
  );
}
