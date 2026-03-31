# Frontend Redesign Design

Date: 2026-03-31
Status: Approved for planning

## Summary

This document defines the next frontend direction for Conduit Wallet.

The redesign is intentionally product-led rather than marketing-led:

- primarily light
- calm and operational
- trustworthy for non-technical human operators
- explicit about wallet permissions without overwhelming detail
- reusable across the future homepage, provisioning flow, wallets hub, and wallet admin page

The selected direction is a `structured product` system with institutional restraint.

That means:

- navigation and workflow structure come first
- visual confidence comes from typography, spacing, and hierarchy rather than effects
- technical concepts are translated into plain language by default
- advanced blockchain detail remains available, but secondary

## Current Repo Findings

### Current Frontend Scope

Today the frontend is a single Vite/React application centered on one provisioning screen:

- `apps/frontend/src/App.tsx`
- `apps/frontend/src/styles.css`

The current screen already handles the core provisioning states:

- invalid link
- loading
- passkey creation
- funding required
- ready

### Current Interaction Model

The current page is functional and technically coherent, but it still behaves like a technical tool surface:

- the page is organized around implementation details rather than a guided operator journey
- chain, threshold, agent signer, backend signer, and minimum funding are all shown at once
- policy detail is present, but not yet translated into a simple "what this wallet can do" explanation
- the visual system is local to this screen rather than a reusable product system for future pages

### Product Constraint

The primary frontend user for the next iteration is not a crypto-native operator.

The user is:

- a human operator
- likely non-technical
- asked to provision or review a wallet for an autonomous agent
- sensitive to trust, clarity, and fear of making a dangerous mistake

The frontend must therefore optimize for reassurance and guidance rather than density or protocol transparency.

## Goals

- Redesign the frontend around a reusable product system instead of a one-off provisioning page.
- Make the UI feel reliable, secure, and quiet.
- Keep the primary experience understandable for a non-technical operator.
- Show wallet scope and permissions in plain language before showing technical detail.
- Establish a structure that scales to:
  - homepage
  - provisioning page
  - logged-in wallets hub
  - wallet administration page
- Reduce visual and cognitive noise.
- Make critical states and next actions obvious.

## Non-Goals

- Building a crypto-native trading or wallet dashboard aesthetic
- Dark-first design
- Decorative gradients, glow effects, or futuristic motifs
- Dense expert-facing blockchain inspection panels
- Hiding all technical truth from the user
- Designing every future screen in final fidelity during this phase

## Design Context

### Users

The primary user is a non-technical human operator finishing provisioning for an agent wallet.

This person needs to:

- understand what they are approving
- know what the wallet will be allowed to do
- feel that control remains with them
- complete the next step without ambiguity

### Brand Personality

The brand should feel:

- reliable
- secure
- "just works"

The tone should be calm and direct rather than impressive or futuristic.

### Anti-Direction

The redesign must avoid:

- overly dense interfaces
- futuristic crypto styling
- cheap gradients
- overused default startup fonts
- too much information at once
- technical details that are incomprehensible in the primary flow

## Recommended Visual Direction

### Chosen System

The chosen system is `structured product` with institutional restraint.

This combines:

- the product clarity of a modern operational app
- the visual discipline of infrastructure or financial software
- the plain-language guidance expected by a mainstream operator

### Visual Thesis

Conduit Wallet should look like a control surface for delegated wallet access, not like a crypto dashboard.

The interface should feel:

- light
- stable
- composed
- guided

### Core Principles

- One primary action per screen state.
- Explain permissions before exposing mechanics.
- Use layout and copy to create trust, not decorative UI.
- Keep advanced technical details available but collapsed or secondary.
- Reuse a small number of strong interface patterns consistently.

## Product Architecture

The redesign should establish one shared frontend system with four page families.

### 1. Homepage

Purpose:

- explain the product simply
- establish trust quickly
- direct the user toward provisioning or wallet management

Recommended structure:

1. product promise
2. short explanation of human control over agent wallets
3. concise three-step "how it works"
4. entry points into the product

The homepage should remain brief and avoid technical implementation language.

### 2. Provisioning Page

Purpose:

- guide a user through the current provisioning step
- show what the wallet will be allowed to do
- reduce fear at the moment of passkey creation or funding

Recommended structure:

1. status banner in plain language
2. main action area
3. wallet scope and permission summary
4. optional technical details area

This page should be treated as a guided workflow, not as a system status sheet.

### 3. Wallets Hub

Purpose:

- give the user a simple view of all agent wallets
- make each wallet understandable in a few seconds
- surface the correct next action

Each wallet row or tile should prioritize:

- human-readable label
- status
- permission scope summary
- latest meaningful update
- one primary action

### 4. Wallet Admin Page

Purpose:

- manage one wallet confidently
- clarify current limits and permissions
- expose passkey-backed administration controls

Recommended sections:

1. current state
2. allowed actions
3. funding and limits
4. admin controls
5. technical details, collapsed by default

## Shared Layout Model

The frontend should use one coherent shell pattern across connected surfaces.

### Connected Screens

For logged-in and administration surfaces:

- a calm, persistent left navigation or section rail
- a main content column with one dominant task
- a secondary context region for supporting information

The secondary region should never compete with the main action.

### Standalone Flow Screens

For provisioning and selected homepage sections:

- a dominant content zone
- a smaller supporting context area
- clear step or state framing

These screens should feel intentionally guided rather than dashboard-like.

## Information Hierarchy

The core information rule is:

`primary action first, explanation second, technical detail last`

### Primary Layer

Always visible:

- what this screen is for
- what the wallet can do
- what the user must do now
- whether control stays with the user

### Secondary Layer

Visible but quieter:

- funding status
- wallet readiness
- status progress
- permission summaries

### Advanced Layer

Collapsed, reduced, or moved to a detail panel:

- raw addresses
- threshold terminology
- signer implementation details
- validator initialization artifacts
- low-level chain metadata

The frontend should still tell the truth, but it should not require technical fluency for safe operation.

## Content Strategy

### Plain-Language Translation

The UI should translate protocol language into product language by default.

Examples:

- `2-of-2 weighted validator` becomes `This wallet needs both the agent and Conduit to approve runtime actions`
- `deny by default` becomes `Anything not explicitly allowed stays blocked`
- `owner bound` becomes `Passkey created`
- `counterfactual wallet address` becomes `Wallet address`

### Copy Style

Copy should be:

- direct
- calm
- concise
- instructional

Copy should not be:

- hype-driven
- alarmist
- dense with blockchain jargon

## Visual System

### Color

The product should be primarily light.

Recommended palette behavior:

- warm or lightly tinted neutral backgrounds instead of stark white
- one deep brand accent for action and emphasis
- restrained semantic colors for state
- no decorative rainbow or crypto-style neon accents

### Typography

Typography should feel chosen, not default.

Recommended behavior:

- one more distinctive face for headings
- one highly readable face for UI and body copy
- strong hierarchy through scale, spacing, and weight

Typography should support trust and clarity, not self-conscious stylistic novelty.

### Surface Treatment

The UI should avoid card-heavy composition by default.

Use:

- section separation
- light surface contrast
- disciplined borders
- spacing rhythm

Avoid:

- nested cards
- thick ornamental shadows
- decorative glass effects
- cheap gradients

### Motion

Motion should be minimal and purposeful.

Use motion for:

- state transitions
- step confirmation
- progressive disclosure
- subtle content entrance

Avoid motion that feels futuristic, playful, or ornamental.

## Screen Behavior By State

The redesign should be built around explicit, reusable state patterns.

### Loading

Loading states should always explain what the system is checking.

Examples:

- `Checking this wallet`
- `Verifying funding`
- `Preparing passkey setup`

### Action Required

When action is required:

- emphasize one next step
- remove competing calls to action
- explain why the step matters

### Ready

When the wallet is ready:

- confirm the result clearly
- explain what happens next
- surface the most likely follow-up action

### Pending Or Limited

When funding, approval, or another dependency is still missing:

- explain what is missing
- explain whether the user needs to do anything
- avoid treating normal waiting as an error

### Error

Errors should follow a two-layer model:

- first line: human-readable explanation
- second layer: optional technical detail

This preserves usability while still supporting debugging.

## Provisioning Page: Detailed Behavior

The provisioning page is the current implementation priority and should set the quality bar for the rest of the system.

### Primary Screen Order

1. current status
2. primary action
3. wallet permissions summary
4. reassurance copy about passkey ownership and control
5. funding guidance if needed
6. technical details area

### Key Questions The User Must Be Able To Answer

At any point in provisioning, the user should understand:

- what am I approving?
- what will this wallet be allowed to do?
- what do I need to do next?
- what stays under my control?

If any of those answers is not obvious, the page is still too technical.

### Permission Summary Design

The permission summary should be written in human language first.

Example categories:

- `This wallet can use USDC within a set limit`
- `Only approved contract actions are allowed`
- `Anything outside these rules stays blocked`
- `Your passkey remains the admin control`

Low-level contract selectors and signer addresses should not be the first explanation.

## Component Direction

The redesign should establish a reusable component set for future screens.

Recommended foundational components:

- page shell
- section header
- status banner
- primary action panel
- permission summary list
- step/progress panel
- wallet list item
- technical detail disclosure
- inline error block
- empty state

These components should be composable and visually consistent across the product.

## Data And State Flow Considerations

The frontend should preserve the current provisioning logic while changing how state is presented.

The UI should continue to model:

- invalid link versus valid provisioning query
- async request loading
- owner artifact publication
- funding refresh polling
- ready state transition

The redesign should make those transitions more understandable without changing the underlying provisioning semantics.

## Accessibility And Responsiveness

The redesign must treat accessibility as a product requirement rather than a polish pass.

Requirements:

- high contrast in all critical text and controls
- strong keyboard focus treatment
- large touch targets for primary actions
- reduced-motion support
- mobile layouts that preserve the same task clarity as desktop

On smaller screens, supporting context should move below the main task rather than competing beside it.

## Testing Guidance

The redesign should be verified with state-focused UI tests rather than only snapshot-like rendering checks.

Critical test scenarios:

- invalid provisioning link
- initial loading
- passkey creation state
- funding required state
- ready state
- recoverable backend error
- advanced technical details collapsed by default

Future page families should follow the same state-driven testing model.

## Planning Scope

This design defines the system direction for multiple future page families, but implementation planning should stay phased.

Recommended implementation scope for the next plan:

1. establish the shared visual tokens, typography, spacing, and shell rules
2. redesign the provisioning page as the reference implementation
3. extract reusable primitives from that implementation

Homepage, wallets hub, and wallet admin should be planned as follow-on surfaces unless the next planning session explicitly expands scope.

## Risks

### Risk: Too Generic

If the redesign leans too far into generic product patterns, it will lose trust-building distinctiveness.

Mitigation:

- use deliberate typography
- enforce strong information hierarchy
- keep the brand voice disciplined

### Risk: Too Technical

If the current implementation data model is surfaced too directly, the interface will remain intimidating.

Mitigation:

- translate first
- collapse advanced detail
- validate copy against non-technical comprehension

### Risk: Too Minimal To Explain Permission Boundaries

If the interface becomes too sparse, the operator may not understand wallet scope.

Mitigation:

- keep a dedicated permission summary section on critical screens
- always explain what remains blocked

## Recommended Next Step

The next step should be an implementation plan for:

1. establishing the shared visual tokens and shell
2. redesigning the provisioning page as the reference screen
3. extracting reusable components for future homepage and authenticated surfaces
