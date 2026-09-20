# RTDI test-analysis console

The dashboard is an engineering workspace. Its reading order is run scope, source summary, evidence, then investigation. The interface uses operational English or Taiwan Traditional Chinese labels; source descriptions, recommendations and raw records remain verbatim.

## Visual decisions

- A shared horizontal header links Wafer Analysis (`/replay`), Run workspace (`/workspace`) and Sandbox (`/sandbox`) on every page. `/` opens Run workspace. There are no promotional slogans.
- Neutral graphite surfaces and one steel-blue interaction color separate navigation from warning and chart colors. Light and dark modes use the existing semantic tokens. No new dependencies, remote fonts or downloaded skills are required.
- Explanatory text and text inputs are 16px; operational labels, metadata and rendered chart axes are at least 14px. Monospace is reserved for identifiers and numeric context. Replay totals wrap with explicit gaps.
- A large background silicon wafer rotates in CSS 3D, faces the mouse and rotates with document scrolling. Its 400 illustrative dies show the selected wafer's fail share, rounded to 0.25 percentage points. Positions are illustrative, not measured defect coordinates. Pause/resume and top-view controls are keyboard accessible; hidden tabs and reduced-motion preferences stop motion. A sparse dot pattern spans all three pages.
- The replay detail surface is 90% opaque while its text remains fully opaque. Clicking the selected wafer closes or reopens this panel without changing the selected wafer or its background illustration. Selecting another wafer opens its details.
- The Temperature tab gives predicted and actual measurements separate 26px columns, with a signed predicted-minus-actual difference. Device/request provenance, feature coverage and receipt status remain in expandable details. Units stay explicitly unconfirmed when absent; no tolerance or pass/fail interpretation is invented.
- The evidence index, selected record and investigation log have separate visual boundaries. Laptop layouts put the evidence index above the record when horizontal space is limited. Narrow layouts stack the investigation log; prediction tables scroll inside their panel.
- Chart viewBox width follows the rendered container using ResizeObserver, keeping axis type at a readable size rather than shrinking fixed-width chart text on phones.

## Functional decisions

Native anchors handle page routes after the orchestrator reproduced a Vinext Link failure on the deployed site. Dashboard lifecycle session storage restores the validated run scope and incident conversations across those navigations. Selecting a question template only fills the draft; Submit is the explicit model-request action. References absent from the current snapshot are disabled with an explanatory title rather than appearing to be working buttons.

The guided tour automatically opens a welcome on a browser's first visit, persists dismissal/completion, and can be reopened from Guide. Its 22 steps explain the three pages with spotlight highlighting and clearly labeled static examples. Large targets retain their full visible highlight; when outside space is insufficient the prompt overlaps the target. The guide supports keyboard focus containment, Escape, native cross-page continuation, denied storage and reduced motion. It never submits a model request or replaces local data; unfinished drafts and imported data block guide-initiated page changes.

The language selector beside the theme control switches application labels and the guide between English and Taiwan Traditional Chinese, with a browser-persisted preference. New Selected analysis and Semiconductor Q&A requests follow that language using `gpt-5.6-sol` with medium reasoning. Sandbox rule-based narratives use the same language without model calls. The healthy investigation availability banner is removed; service failures remain visible. Historical saved answers and raw evidence remain verbatim; translation uses bundled copy and makes no API requests.

Unknown units, non-probability scores, threshold-scale uncertainty, absent receipts and replay time semantics remain visible. Source data determines results; this design does not promote the new W25 development candidate or alter accepted replay evidence.

## References and verification

The requested [TypeUI repository](https://github.com/bergside/typeui) README was retrieved from its main branch. It presents a design-resource and prompting platform; no repository age claim or installation recommendation follows from that read. A generic UI generator is not a substitute for a domain-specific reading order.

The requested [Kimi article](https://www.kimi.ai/resources/ui-ux-design-skills-for-agents) returned HTTP 403 during this task; the web tool also supplied no readable content. No article date, named recommendations or instructions are attributed to it.

Local verification includes 165 passing tests and TypeScript checking. The 86 browser checks comprise workspace (20), secondary pages (38), wafer (7), final tour (17) and locale (4); earlier integration checks and final handoff checks are distinguished in `results/frontend_interactive_ui_20260919.json`. Additional visual checks cover centered English/Chinese sandbox labels and all three routes at 320px in both languages. Browser AI responses are mocked and unmatched POST requests blocked. No paid model calls were made for this work.
