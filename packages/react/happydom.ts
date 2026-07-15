// Registers a happy-dom global environment for @testing-library/react under
// `bun test`. Preloaded via bunfig.toml so `document`/`window` exist before the
// React DOM renderer loads.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
