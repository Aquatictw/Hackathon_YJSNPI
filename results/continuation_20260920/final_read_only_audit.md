# Final read-only audit — September 20, 2026

Application revision checked: `e506baf3428a5aa7972e65f097471f852dfbd301`. Subsequent header/source-navigation edits require their own release checks.

## Current public checks

- Public snapshot/SSE checked at 00:54:02 UTC / 08:54:02 Taipei: 1,723 events, 480 predictions with 480 actuals, three incidents and three evidence records for `group-6 / 04dcb07358ee4f3da41e5cbc12cb9850`. Final supplied yield is 92.50% over 80 devices. SSE delivers ready, all 1,723 retained event frames and heartbeat. See [machine-readable observation](read_only_public_check_20260920.json). This is persisted-run verification, not new machine activity.
- Public Workspace browser successfully selected and loaded `summary.json`: 25 wafers, 2,000 devices and 14 alerts, explicitly offline with no backend stream/model request.
- VPS read-only check returned revision e506baf and `grp6-preview.service` active. Deployment and HTTP verification had already passed before this audit.
- Gemini dashboard displayed both named group-6 Host and Edge rows as Down. VNC showed a gateway timeout; SSH reconnect returned an error. Only dashboard navigation and the Host Details menu were used; no Start, Stop, Reboot or Delete action was selected. Cause of the power state is not established. After the user requested no more VM interaction, all Gemini access ceased. Prior runtime acceptance does not establish current readiness.

## Independent requirements review

Pascal reviewed the Question PDF, ONEAPI manual, Workshop materials, model/runtime source and historical evidence. Scenario fit (10%) and Gemini operation (25%) have supporting evidence for six prediction targets, set_message reporting, tester executions and the separately recorded complete host-relay run. Timing (25%) remains partial: stage eligibility independently excludes future/sensor features, but effective tester timeout and total callback/round-trip bounds are not established. Analysis method (15%) uses wafer-separated Ridge folds and inspectable anomaly rules; independent data lineage, physical units and operational accuracy tolerance remain unverified. Novel report presentation (25%) has implemented evidence views but is a judging decision. No numerical score or full-points guarantee follows.

Historical production-run-3 recomputation found 120 distinct successful tester action matches and 480 strict joins; MAE 0.216342, RMSE 0.313958 and maximum absolute error 1.902679 in unverified units. These are historical metrics, not newly measured metrics for the complete host-relay run. Its malformed sequence-319 reply remains historical evidence despite subsequent runtime fixes.

Wegener reviewed frontend/backend scope, persistence and Guide behavior. The review found archive switching could discard a saved import and Guide full-page navigation could reset Replay selection. These concrete frontend regressions were assigned for scoped correction. No additional backend scope-isolation or live-label blocker was found; 153 focused tests passed in the audit.

## Remaining acceptance limits

### User-authorized restart inspection, 09:00 Taipei

The user reopened VNC/SSH and explicitly authorized checking the restarted VM. Browser SSH confirmed hostname group-6, uptime four minutes, Nexus service active, control_smt8 and TCCT service processes present. No SmarTest/Eclipse application or host_relay process was present; VNC showed the desktop without the tester UI. The only Python process was ScreenRecorderSystemTray, not the relay. The old relay PID file remained and must not be treated as liveness.

SQLite opened with mode=ro returned quick_check=ok, 863 delivered records and 58 delivered batches; no pending state appeared in either grouped count. Private configuration exists with owner-only permissions; its contents were not printed. The saved complete capture SHA remains ffac0c5985b43f59032111f25dad1ea3df4a60d0c30ec6a2f3deee68b5ba683f and tester EDL SHA remains 7d29913212ad3d5280b9a483f704f5c2430ef8f5f69af47635078fd52150404f. The descriptor retains py-app tag 20260919T175744779996Z; this does not establish a running Edge container. The immutable relay release and SmarTest workspace remain on disk. Nexus journal access was denied to the user account; no privilege or restart action followed.

Result: no observed loss of retained evidence or ledger corruption, but the restart interrupted the demo runtime. New live data cannot flow until the relay and tester application are restored and their connection verified. No restart, deployment, tester execution or relay launch was performed in this read-only inspection.

Current VM readiness, actual Edge image digest, effective end-to-end deadline, final-boundary/later-poll receipt, earlier 119/120 gap cause, flags/scaling/retest/multihead/reconnect cases and complete native measurement coverage remain unverified. The native Edge exporter is disabled; the demonstrated path is the host log relay. Bounded idle relay restart does not prove automatic reboot recovery or outage recovery under active load. Public authentication/durable quotas/commands remain outside accepted deployment. W2/W25 remain deferred, with no model/detector promotion. No paid AI call or tester run was performed by this audit.


## Subsequent authorized recovery and device cycle

The user explicitly authorized restoring tester/relay, then requested a device batch. The retained workspace and stopped relay database/sidecars were backed up in `/home/user/grp6-recovery-20260920-Qf90Tu`. Existing SmarTest workspace was opened directly; the saved relay was restarted and AppDeployer start succeeded. No workspace recreation, VM reboot, Nexus restart, model change or native-exporter enablement occurred. VNC showed SMT8 Ready, ACS Edge Available and py-app running. Startup tp_info from run `4620bc260aef42329930bbf46d35b13f` reached the public backend.

The supplied four-site execution was resumed through the named Run → Resume action. The tester displayed six-stage predictions for four sites. Source execution created run `74c4e8ccd7f446d3bfcdf2ab7b668f6d`; IDs were preserved instead of moving records into the startup scope. At 09:25:24 Taipei the final source boundary was emitted. Public snapshot returned 99 events, 24 predictions/24 actuals, four completed devices, supplied yield 100% for B13456/02 and zero incidents/evidence. Browser showed the new run and connected backend SSE. Host ledger reported 915 delivered records in 65 batches; repeated unscoped startup records remain retained as issues. No paid model requests were made.

This demonstrates a fresh supplied ORE device cycle through tester/model/host relay/backend/frontend. It does not close independent-data, timing, native-exporter or full-load outage/reboot acceptance limits above. The earlier check-only restriction and stopped-process finding describe the earlier inspection, not the restored state.
