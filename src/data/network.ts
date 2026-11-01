import snapshot from "./network.json";
import type { TransitNetwork } from "../shared/types";

/** Pinned, offline normal-operation network. See docs/data-sources.md. */
export const network: TransitNetwork = snapshot as TransitNetwork;
