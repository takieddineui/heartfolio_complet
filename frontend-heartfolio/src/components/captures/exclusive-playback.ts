import { useEffect, useId, useSyncExternalStore } from "react";

/**
 * ONE LOOP AT A TIME within a group (27 Oct 2026; the guides). Each loop
 * that WANTS to play (on screen, not paused by the reader) joins its group's
 * queue; only the most recent one plays. When it stops wanting (scrolled
 * away, paused), the previous one still on screen takes over, so a reader
 * scrolling back never finds a frozen phone. A loop outside any group is
 * unaffected.
 */
const queues = new Map<string, string[]>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function setWanting(group: string, id: string, wanting: boolean) {
  const queue = (queues.get(group) ?? []).filter((member) => member !== id);
  if (wanting) queue.push(id);
  queues.set(group, queue);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when this loop may play: always outside a group, and inside one only
 *  while it is the most recent loop wanting to. */
export function useExclusivePlayback(group: string | undefined, wanting: boolean): boolean {
  const id = useId();
  useEffect(() => {
    if (!group) return;
    setWanting(group, id, wanting);
    return () => setWanting(group, id, false);
  }, [group, id, wanting]);
  const active = useSyncExternalStore(
    subscribe,
    () => (group ? queues.get(group)?.at(-1) === id : true),
    () => !group
  );
  return !group || active;
}
