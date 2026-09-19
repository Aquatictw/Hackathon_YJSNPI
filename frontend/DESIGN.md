# RTDI test-analysis console

The dashboard is an engineering workspace. Its reading order is run scope, source summary, evidence, then investigation. The interface uses operational English labels; source descriptions, recommendations and raw records remain verbatim.

## Visual decisions

- A shared horizontal header links Replay analysis (`/`), Run workspace (`/workspace`) and Sandbox (`/sandbox`) on every page. `/replay` remains compatible. There are no promotional slogans.
- Neutral graphite surfaces and one steel-blue interaction color separate navigation from warning and chart colors. Light and dark modes use the existing semantic tokens. No new dependencies, remote fonts or downloaded skills are required.
- Explanatory text and text inputs are 16px; operational labels, metadata and rendered chart axes are at least 14px. Monospace is reserved for identifiers and numeric context. Replay totals wrap with explicit gaps.
- A compact illustrative silicon wafer rotates in CSS 3D and responds to pointer/scroll position. Pause/resume and top-view controls are keyboard accessible; motion stops offscreen, in hidden tabs and for reduced-motion preferences. It does not represent measured wafer geometry or defect locations.
- The Temperature tab gives predicted and actual measurements separate 26px columns, with a signed predicted-minus-actual difference. Device/request provenance, feature coverage and receipt status remain in expandable details. Units stay explicitly unconfirmed when absent; no tolerance or pass/fail interpretation is invented.
- The evidence index, selected record and investigation log have separate visual boundaries. Laptop layouts put the evidence index above the record when horizontal space is limited. Narrow layouts stack the investigation log; prediction tables scroll inside their panel.
- Chart viewBox width follows the rendered container using ResizeObserver, keeping axis type at a readable size rather than shrinking fixed-width chart text on phones.

## Functional decisions

Native anchors handle page routes after the orchestrator reproduced a Vinext Link failure on the deployed site. Dashboard lifecycle session storage restores the validated run scope and incident conversations across those navigations. Selecting a question template only fills the draft; Submit is the explicit model-request action. References absent from the current snapshot are disabled with an explanatory title rather than appearing to be working buttons.

The healthy investigation availability banner is removed; service failures remain visible. New investigations request English narrative using `gpt-5.6-sol` with medium reasoning. Rule-based sandbox narratives are also English. Historical saved answers and raw evidence remain verbatim; no automatic translation requests are made.

Unknown units, non-probability scores, threshold-scale uncertainty, absent receipts and replay time semantics remain visible. Source data determines results; this design does not promote the new W25 development candidate or alter accepted replay evidence.

## References and verification

The requested [TypeUI repository](https://github.com/bergside/typeui) README was retrieved from its main branch. It presents a design-resource and prompting platform; no repository age claim or installation recommendation follows from that read. A generic UI generator is not a substitute for a domain-specific reading order.

The requested [Kimi article](https://www.kimi.ai/resources/ui-ux-design-skills-for-agents) returned HTTP 403 during this task; the web tool also supplied no readable content. No article date, named recommendations or instructions are attributed to it.

Local verification includes 151 passing tests, TypeScript checking, and workspace/replay/sandbox browser checks for navigation, session restoration, controls, motion, readability and mobile overflow. Exact results are recorded in `results/frontend_readable_ui_20260919.json`. Browser AI responses are mocked and unmatched POST requests blocked. No paid model calls were made for this work.
