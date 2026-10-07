# AGENTS.md

<!-- rig:start -->
## Rig

This project uses [Rig](https://github.com/agent-rig/rig) skills, delivered as
standard Agent Skills under `.agents/skills/` — your agent discovers and
invokes them automatically from each skill's trigger description; nothing to
do here to use them.

Project config lives in `.rig/config.json` — read it for the test command,
base branch, tracker, and review-bot settings before running any skill.

**Roles/subagents:** personas live in `.pi/agents/`. The roles are rig-reviewer, rig-coder,
rig-architect, rig-qa, rig-debugger. If your agent supports subagents,
delegate to the named persona; otherwise adopt that persona's instructions
inline. Helper scripts are in `.rig/scripts/`; review patterns in
`.rig/REVIEWER.md` (set `review.patternsFile` accordingly).

**Writing style:** anything you write for a human — PR bodies, ticket
descriptions, review findings, plans, status hand-backs — follows
`.rig/STYLE.md` (set `style.guideFile` accordingly). It follows the Google
developer documentation style guide: answer first, one idea per sentence,
active voice, present tense, concrete nouns with `file:line` evidence, no
filler or jargon. Read it before writing prose.

**In pi:** run a skill with role delegation wired up via `/rig <skill> [args]`
(e.g. `/rig review find`). Delegation needs `npm:pi-subagents`, registered in
`.pi/settings.json`; without it the personas are adopted inline.
<!-- rig:end -->
