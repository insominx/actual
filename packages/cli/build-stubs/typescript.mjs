// Build-time stand-in for the `typescript` package inside the CLI bundle.
// cosmiconfig can transpile `.ts` config files with it, but the CLI only ever
// searches for package.json, .actualrc* and actual.config.{json,yaml,yml}, so
// the 8 MB compiler was loaded and never used.
export const ModuleKind = undefined;
