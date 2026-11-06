"use client";

import {
  closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type CSSProperties, type Ref } from "react";
import { reorderEntriesAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import type { DateStr } from "@/lib/time";
import { useToast } from "./toast";

/** What a draggable row needs from its list: the li ref and style, and the grip that starts a drag. */
export interface DragSlot {
  setNodeRef: Ref<HTMLLIElement>;
  style: CSSProperties;
  dragging: boolean;
  grip: React.ReactNode;
}

function Slot({ id, disabled, children }: { id: number; disabled?: boolean; children: (slot: DragSlot) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const grip = disabled ? null : (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder"
      title="Drag to reorder"
      // touch-none: a finger on the grip drags instead of scrolling the page
      className="flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-subtle/60 hover:bg-muted hover:text-fg active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  return (
    <>
      {children({
        setNodeRef,
        style: { transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 20 : undefined },
        dragging: isDragging,
        grip,
      })}
    </>
  );
}

/**
 * A vertical list the owner can reorder by dragging. The new order is saved to the day (`day_entries.sort`); while
 * the save is in flight the list already shows it. Rows that cannot move (`locked`) stay put.
 */
export function SortableEntries<T extends { id: number }>({
  date, items, locked, className, children,
}: {
  date: DateStr;
  items: T[];
  locked?: (item: T) => boolean;
  className?: string;
  children: (item: T, slot: DragSlot) => React.ReactNode;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [, start] = useTransition();
  const [order, setOrder] = useState<number[]>(() => items.map((i) => i.id));
  // follow the server whenever it sends a different set or order (after a refresh, or tasks added or removed)
  const serverKey = items.map((i) => i.id).join(",");
  useEffect(() => setOrder(items.map((i) => i.id)), [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(items.map((i) => [i.id, i]));
  const shown = order.map((id) => byId.get(id)).filter((i): i is T => !!i);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(Number(active.id));
    const to = order.indexOf(Number(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(order, from, to);
    const before = order;
    setOrder(next);
    start(async () => {
      const r = await reorderEntriesAction(date, next);
      if (!r.ok) {
        setOrder(before);
        toast(r.error ?? "Could not save the order.", "error");
      } else router.refresh();
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ul className={cn("space-y-1.5", className)}>
          {shown.map((item) => (
            <Slot key={item.id} id={item.id} disabled={locked?.(item)}>
              {(slot) => children(item, slot)}
            </Slot>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
