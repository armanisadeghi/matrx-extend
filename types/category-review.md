# Category review — matrx-extend tools

> The 79 tools we own, with their **current category** and a **proposed**
> destination under the new "user mental model" taxonomy. Annotate the
> `notes` column with: `OK`, a different category, "rename to X", or
> "delete (replaced by Y)" and hand it back — I'll execute the moves
> against `tool_def.category` in one batch. (Table renamed from `tl_def`
> in the 2026-05-27 tool refactor.)
>
> Reminder: categories are pure UX (Tools tab grouping, discovery-helper
> grouping). They do not affect routing or the LLM's behavior.

## Proposed categories (14 total, down from 17)

| Category | Mental model |
|---|---|
| `read-page` | "I want to know what's on the page" |
| `use-page` | "I want to do something on the page" |
| `tabs-windows` | "I want to manage browser windows" |
| `files-capture` | "I want to save or capture something" |
| `chrome-data` | "I want the user's personal Chrome data" |
| `talk-to-user` | "I want a human in the loop" |
| `agent-memory` | "I want to remember something" |
| `browser-ai` | "On-device AI capabilities" |
| `demos` | "Record-and-replay workflows" |
| `guidance` | "User-saved hints for the agent" |
| `devtools` | "I need to dig into how the page is built (CDP)" |
| `page-tools` | "Page-registered tools (WebMCP)" |
| `desktop-bridge` | "Call out to matrx-local" |
| `core` | "Always-on discovery + batching" |

## Tool-by-tool

| # | name | current category | proposed category | your notes |
|---|---|---|---|---|
| 1 | `ai` | advanced | `browser-ai` |  |
| 2 | `browser_batch` | core | `core` |  |
| 3 | `cdp_a11y_tree` | debug | `devtools` |  |
| 4 | `cdp_emulate` | advanced | `devtools` |  |
| 5 | `cdp_full_page_screenshot` | debug | `devtools` |  |
| 6 | `cdp_input_click_xy` | debug | `devtools` |  |
| 7 | `cdp_input_type` | debug | `devtools` |  |
| 8 | `cdp_network_capture_drain` | debug | `devtools` |  |
| 9 | `cdp_network_capture_start` | debug | `devtools` |  |
| 10 | `cdp_network_capture_stop` | debug | `devtools` |  |
| 11 | `cdp_network_get_body` | debug | `devtools` |  |
| 12 | `cdp_perf_metrics` | debug | `devtools` |  |
| 13 | `cdp_print_pdf` | debug | `devtools` |  |
| 14 | `cdp_session` | advanced | `devtools` |  |
| 15 | `chrome_bookmarks` | advanced | `chrome-data` |  |
| 16 | `chrome_cookies` | advanced | `chrome-data` |  |
| 17 | `chrome_history` | advanced | `chrome-data` |  |
| 18 | `chrome_recently_closed` | advanced | `chrome-data` |  |
| 19 | `chrome_record_gif` | advanced | `files-capture` |  |
| 20 | `chrome_record_tab_video` | advanced | `files-capture` |  |
| 21 | `chrome_save_page_as_mhtml` | files | `files-capture` |  |
| 22 | `chrome_tab_audio_inspect` | tabs | `tabs-windows` |  |
| 23 | `chrome_webmcp` | advanced | `page-tools` |  |
| 24 | `clipboard` | files | `use-page` |  |
| 25 | `computer` | core | `use-page` |  |
| 26 | `delete_demo` | demos | `demos` |  |
| 27 | `delete_guidance_item` | guidance | `guidance` |  |
| 28 | `describe_demo` | demos | `demos` |  |
| 29 | `desktop_run_command` | advanced | `desktop-bridge` |  |
| 30 | `downloads` | files | `files-capture` |  |
| 31 | `drop_file` | files | `use-page` |  |
| 32 | `evaluate_javascript` | advanced | `use-page` |  |
| 33 | `extract_microdata` | page | `read-page` |  |
| 34 | `extract_table` | page | `read-page` |  |
| 35 | `fetch_url_as_markdown` | page | `read-page` |  |
| 36 | `find` | core | `read-page` |  |
| 37 | `find_text_on_page` | page | `read-page` |  |
| 38 | `form_input` | forms | `use-page` |  |
| 39 | `get_computed_style` | page | `read-page` |  |
| 40 | `get_element_at_point` | page | `read-page` |  |
| 41 | `get_element_details` | page | `read-page` |  |
| 42 | `get_form_fields` | page | `read-page` |  |
| 43 | `get_guidance_item` | guidance | `guidance` |  |
| 44 | `get_page_links` | page | `read-page` |  |
| 45 | `get_page_selection` | page | `read-page` |  |
| 46 | `get_page_text` | page | `read-page` |  |
| 47 | `get_request_body` | debug | `devtools` |  |
| 48 | `inspect_element` | page | `read-page` |  |
| 49 | `list_browser_tools` | (null) | `core` |  |
| 50 | `list_demos` | demos | `demos` |  |
| 51 | `list_guidance` | guidance | `guidance` |  |
| 52 | `mutation_watch` | page | `read-page` |  |
| 53 | `navigate` | core | `use-page` |  |
| 54 | `query_elements` | page | `read-page` |  |
| 55 | `read_active_page` | page | `read-page` |  |
| 56 | `read_console_messages` | debug | `devtools` |  |
| 57 | `read_network_requests` | debug | `devtools` |  |
| 58 | `read_page` | core | `read-page` |  |
| 59 | `read_pdf` | files | `read-page` |  |
| 60 | `record_demo` | demos | `demos` |  |
| 61 | `remember_for_domain` | memory | `agent-memory` |  |
| 62 | `replay_demo` | demos | `demos` |  |
| 63 | `request_user_takeover` | ask | `talk-to-user` |  |
| 64 | `resize_window` | tabs | `tabs-windows` |  |
| 65 | `save_guidance_note` | guidance | `guidance` |  |
| 66 | `scratchpad` | memory | `agent-memory` |  |
| 67 | `screenshot_region` | page | `files-capture` | could go either way (capture vs read) |
| 68 | `sleep` | interact | `use-page` |  |
| 69 | `storage` | advanced | `agent-memory` |  |
| 70 | `stylesheet` | advanced | `use-page` |  |
| 71 | `submit_form` | forms | `use-page` |  |
| 72 | `tab_groups` | advanced | `tabs-windows` |  |
| 73 | `tabs` | tabs | `tabs-windows` |  |
| 74 | `tasks` | plan | `talk-to-user` |  |
| 75 | `update_plan` | ask | `talk-to-user` |  |
| 76 | `upload_file` | files | `use-page` |  |
| 77 | `user` | core | `talk-to-user` |  |
| 78 | `user_todos` | plan | `talk-to-user` |  |
| 79 | `wait_for` | interact | `use-page` |  |

## Counts by proposed category

| category | count |
|---|---|
| `read-page` | 19 |
| `use-page` | 13 |
| `devtools` | 14 |
| `chrome-data` | 4 |
| `files-capture` | 5 |
| `talk-to-user` | 6 |
| `tabs-windows` | 4 |
| `demos` | 5 |
| `guidance` | 4 |
| `agent-memory` | 3 |
| `browser-ai` | 1 |
| `page-tools` | 1 |
| `desktop-bridge` | 1 |
| `core` | 2 |
| **total** | **79** |

## Notes on the proposal

- `browser-ai` has just 1 tool (`ai`). Reasonable since "use the browser's
  built-in AI" is a discrete concept users might search for, but if you
  prefer, fold it into `read-page` or `core`.
- `page-tools` and `desktop-bridge` are also 1-each. Both are conceptually
  distinct enough that I think they earn their own category — but call it
  if you want to fold them into `use-page` and `desktop-bridge → core`
  respectively.
- `screenshot_region` could be in either `read-page` (vision input) or
  `files-capture` (image artifact). Marked it `files-capture` because the
  primary use case is "save this part of the page"; flag if you'd rather
  go the other way.
- `clipboard` could be `files-capture` instead of `use-page`. Put in
  `use-page` because reading from clipboard is also action-style.
- The `core` category now has only `browser_batch` + `list_browser_tools`
  — the discovery utilities. Every other tool lives in a domain category.
- If you want to merge `talk-to-user` + `agent-memory` into "Agent state
  & UX", that drops to 13 categories.
