# Working on Ask Kai

- Read README.md and docs/implementation-plan.md before changing scope.
- Keep synthetic replay visibly distinct from real provider connectivity.
- Never infer wire event names or provider guarantees from our internal contract.
- Never commit keys, raw provider traces or real learner transcripts/audio.
- Preserve response/turn ownership, late-event isolation and attempted-only evidence.
- Run npm run verify and npm run replay for runtime/contract changes.
- Keep identity, course and learning records behind authorized HSKai boundaries.
- Report synthetic, real-provider and browser audio checks separately.
