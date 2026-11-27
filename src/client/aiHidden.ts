// "Hide from AI" on the client: a page is hidden when it, or any page above it, has the switch on.
// The server enforces it (src/worker/hidden.ts); this only hides AI buttons that would be refused anyway.
import type { TreeNode } from "./types";

export function aiHiddenIn(tree: TreeNode[], id: string | null | undefined): boolean {
  const byId = new Map(tree.map((n) => [n.id, n]));
  for (let n = id ? byId.get(id) : undefined, hops = 0; n && hops < 100; n = n.parent_id ? byId.get(n.parent_id) : undefined, hops++) {
    if (n.ai_hidden) return true;
  }
  return false;
}
