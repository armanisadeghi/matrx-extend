-- Retire the remote-code-execution tool from the chrome-extension surface (CWS review).
-- APPLIED 2026-07-11 via the Supabase MCP; recorded as
-- `retire_remote_js_and_admin_diag_tools`. Tracked copy for the shared ledger.
--
-- The CLIENT handlers (execute_javascript + evaluate_javascript, the
-- new Function(remoteString) RCE) were deleted in the same commit. This is the DB
-- half: stop OFFERING a tool with no implementation, and keep the drift gate truthful.
-- Only evaluate_javascript was ever bound/advertised. Restore (via chrome.userScripts
-- or the Debugger API — NEVER new Function(remoteString)): re-activate the binding +
-- re-add to surface_defaults. See docs/REMOVED_FOR_CWS_SUBMISSION.md §1.

UPDATE tool.binding b
SET is_active = false
FROM tool.definition d
WHERE b.tool_id = d.id
  AND b.executor_name = 'chrome-extension'
  AND d.name = 'evaluate_javascript';

UPDATE tool.surface_defaults
SET always_include_tools = array_remove(always_include_tools, 'evaluate_javascript')
WHERE 'evaluate_javascript' = ANY(always_include_tools);
