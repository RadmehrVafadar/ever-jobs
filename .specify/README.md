# `.specify/` — GitHub Spec Kit Workspace

This directory follows the [GitHub Spec Kit](https://github.com/github/spec-kit) layout.
Every meaningful change to Ever Jobs (new feature, refactor, source addition, infra
change) goes through the **Specify → Plan → Tasks → Implement** loop, with artefacts
stored here.

```
.specify/
├── README.md                # this file
├── memory/
│   └── constitution.md      # immutable design principles for the project
├── specs/
│   └── <NNN>-<slug>/
│       ├── spec.md          # functional spec (what & why)
│       ├── plan.md          # implementation plan (how)
│       ├── tasks.md         # ordered tasks with acceptance criteria
│       └── notes.md         # optional research/scratch
└── templates/
    ├── spec.template.md
    ├── plan.template.md
    └── tasks.template.md
```

## Numbering

Feature IDs are numeric, zero-padded to at least three digits, and allocated
inside the current fork's reserved band in `.specify/ranges.json`. Run
`npm run spec:next` from the repository root; do not infer a global maximum or
mint an ID from another fork's band. Slugs are kebab-case. Examples:

- `001-plugin-architecture-foundation`
- `002-source-pipeline-batching`
- `010-deduplication-engine`

## Workflow

1. **Specify.** Copy `templates/spec.template.md` → `specs/NNN-<slug>/spec.md`. Fill it out.
2. **Plan.** Copy `templates/plan.template.md` → same dir. Outline phases & risks.
3. **Tasks.** Copy `templates/tasks.template.md` → same dir. Break plan into ≤1-day tasks.
4. **Implement.** Pick the first unchecked task. Cross-reference `AGENTS.md` rules.
5. **Mirror.** Update `docs/index.md` and `docs/log.md`. Add a doc-mirror under
   `docs/specs/<NNN>-<slug>.md` if the spec is human-facing.

## Status Conventions

In `tasks.md`, tasks are checkboxes:

- `- [ ] T01 — Add Foo enum value` → pending
- `- [~] T02 — Implement scraper` → in-progress
- `- [x] T03 — Write unit tests` → done
- `- [-] T04 — Old approach` → dropped (keep, don't delete; explain why)

## Cross-Cutting Concerns

Specs that affect multiple subsystems should reference each other in `notes.md`
under a `## Related` heading.

## Constitution

Always re-read [`memory/constitution.md`](memory/constitution.md) before authoring a
new spec. It encodes non-negotiable design principles.
