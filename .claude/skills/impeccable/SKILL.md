---
name: impeccable
description: Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface. Covers websites, landing pages, dashboards, product UI, app shells, components, forms, settings, onboarding, and empty states. Handles UX review, visual hierarchy, information architecture, cognitive load, accessibility, performance, responsive behavior, theming, anti-patterns, typography, fonts, spacing, layout, alignment, color, motion, micro-interactions, UX copy, error states, edge cases, i18n, and reusable design systems or tokens. Also use for bland designs that need to become bolder or more delightful, loud designs that should become quieter, live browser iteration on UI elements, or ambitious visual effects that feel technically extraordinary. Not for backend-only or non-UI tasks.
version: 4.6.0
user-invocable: true
argument-hint: "[shape · audit|critique · animate|bolder|colorize|delight|layout|overdrive|quieter|typeset · adapt|clarify|distill · harden|onboard|optimize|polish · init|document|extract|live|generate] [target]"
license: Apache 2.0
---

# Impeccable — shim

**This file is not the skill.** It exists only so Claude Code finds a skill named
`impeccable` in the directory it scans.

The real skill is `.agent/skills/impeccable/SKILL.md`, shared with OpenCode and
version-controlled once. Read it in full and follow it from there — this shim
carries no instructions of its own.

Two things to carry over from it:

- Treat every `<skill-base-dir>` as `.agent/skills/impeccable`, **not** this
  directory. So `<skill-base-dir>/scripts/impeccable` resolves to
  `.agent/skills/impeccable/scripts/impeccable`.
- Its `[reference/…](reference/…)` links are relative to
  `.agent/skills/impeccable/`, so resolve them from there.

To change the skill, edit `.agent/skills/impeccable/` and bump `version` in both
its frontmatter and this one.
