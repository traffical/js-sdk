import type { Snippet } from "svelte";
import type { TrafficalProviderConfig } from "./types.js";
interface Props {
    /** Configuration for the Traffical client */
    config: TrafficalProviderConfig;
    /** Child content */
    children: Snippet;
}
declare const TrafficalProvider: import("svelte").Component<Props, {}, "">;
type TrafficalProvider = ReturnType<typeof TrafficalProvider>;
export default TrafficalProvider;
//# sourceMappingURL=TrafficalProvider.svelte.d.ts.map