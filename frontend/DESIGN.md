# RTDI test-analysis console

The dashboard is an engineering workspace. Its reading order is run scope, source summary, evidence, then investigation. The interface uses operational English labels; source descriptions, recommendations and raw records remain verbatim.

## Visual decisions

- A horizontal application header leaves space for records. The previous promotional hero, decorative sidebar, motto, orbit and provider branding are removed.
- Neutral graphite surfaces and one steel-blue interaction color separate navigation from warning and chart colors. Light and dark modes use the existing semantic tokens. No new dependencies, remote fonts or downloaded skills are required.
- Explanatory text is 14px, operational labels 13px, and secondary metadata at least 12px. Monospace is reserved for identifiers and numeric context. Record borders replace shadows and oversized statistic cards.
- The evidence index, selected record and investigation log have separate visual boundaries. Laptop layouts put the evidence index above the record when horizontal space is limited. Narrow layouts stack the investigation log; prediction tables scroll inside their panel.
- Chart viewBox width follows the rendered container using ResizeObserver, keeping axis type at a readable size rather than shrinking fixed-width chart text on phones.

## Functional decisions

Native anchors handle page routes after the orchestrator reproduced a Vinext Link failure on the deployed site. Dashboard lifecycle session storage restores the validated run scope and incident conversations across those navigations. Selecting a question template only fills the draft; Submit is the explicit model-request action. References absent from the current snapshot are disabled with an explanatory title rather than appearing to be working buttons.

Unknown units, non-probability scores, threshold-scale uncertainty, absent receipts and replay time semantics remain visible. Source data determines results; this design does not promote the new W25 development candidate or alter accepted replay evidence.

## References and verification

The requested [TypeUI repository](https://github.com/bergside/typeui) README was retrieved from its main branch. It presents a design-resource and prompting platform; no repository age claim or installation recommendation follows from that read. A generic UI generator is not a substitute for a domain-specific reading order.

The requested [Kimi article](https://www.kimi.ai/resources/ui-ux-design-skills-for-agents) returned HTTP 403 during this task; the web tool also supplied no readable content. No article date, named recommendations or instructions are attributed to it.

Local TypeScript checking passed. The six presentation tests passed, including light/dark text, input, warning and chart-token contrast. Desktop/mobile visual review, route navigation and end-to-end session restoration are the orchestrator's integration checks. No paid model calls were made for this work.
