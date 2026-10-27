# 13. Launching Claude from the ticket page with Claude's deep links (verified on Windows)

- Status: Proposed
- Date: 2026-10-27

## Context

Delegate to agent v1 opens Claude Code through Claude's own URL handlers instead of a helper app of ours (epic TKT-25, [refinement](../product/04-delegate-to-agent-refinement.md) §6, [research](../research/delegate-to-agent.md)). The research left open how the handlers behave on Windows, our primary platform: quoting, newlines, non-ASCII text, the 5,000-character limit, folders with spaces or that don't exist, browser dialogs, and what the page can tell when nothing is installed. Spike TKT-26 checked this on the owner's machine so the Delegate button (TKT-29, "B4") can be built against measured behaviour.

**Environment:** Windows 11 Enterprise 10.0.26200, Claude Code 2.1.292 (winget), Claude Desktop 3.6556.2 (MSIX; it bundles its own Claude Code 2.1.308), Windows Terminal 1.24, Chrome 156.0.8078.47, Edge 156.0.4314.50, Firefox 154.0. No browser policy sets `AutoLaunchProtocolsFromOrigins` or `ExternalProtocolDialogShowAlwaysOpenCheckbox`.

**Method:** each link was built with `[uri]::EscapeDataString` (the same output as `encodeURIComponent` for these inputs) and opened with `Start-Process`, which, like Chrome and Firefox, hands the URL to `ShellExecuteEx`. The process tree was recorded with `Win32_Process`, the received prompt and folder were decoded from the launched process's arguments and compared byte for byte with the input, and the new terminal window was captured. Chrome was also driven with Playwright from `http://localhost:8126` to capture its dialog and the page's events. 31 link cases and 1 Desktop case in total.

## Findings

### How the handlers are registered

| Scheme | Registration | What it runs |
| --- | --- | --- |
| `claude-cli` | `HKCU\Software\Classes\claude-cli`, `(Default) = "URL:Claude Code URL Handler"` | `"…\WinGet\Packages\Anthropic.ClaudeCode_…\claude.exe" --handle-uri "%1"` |
| `claude` | MSIX package protocol (`uap3:Protocol Name="claude"`), user class `AppXaem4n1tckgw588q10avtdbzpbgt71c77` | `Claude.exe "%1"`, which forwards the URL to the running Desktop instance |

There is also an `HKCU\Software\Classes\claude` key with `URL Protocol` but no `shell\open\command`. It is left over and harmless: the package registration wins. Nothing is registered under HKLM.

### `claude-cli://open` (Claude Code in a terminal)

The handler validates the URL, then starts `wt.exe -d <cwd> -- claude.exe --deep-link-origin --deep-link-cwd-b64=<base64> --prefill-b64=<base64>` and exits. The prompt and folder reach Claude Code as **base64 arguments**, so no shell or Windows Terminal parser ever sees the text. `;`, `&`, `%`, quotes and backticks cannot inject anything.

| Case | Result |
| --- | --- |
| Quotes (`"`, `'`, `` ` ``, `\"`), `&` (including `&q=…&cwd=…` inside the prompt), `%` (`%PATH%`, a literal `%0A`, `%%`), `;` (`wt new-tab cmd /c calc; echo pwned`), shell metacharacters (`\| > < ^ $env: $() !x!`), `+` | Arrive intact, byte for byte. Nothing runs. |
| Newlines (`%0A`) | Arrive intact and show as separate lines in the prompt box. |
| CRLF (`%0D%0A`) | The CR is dropped; LF stays. Trailing whitespace is trimmed. |
| Non-ASCII: Polish, `日本語`, emoji, Hebrew | Arrive intact and render correctly in Windows Terminal. |
| Firefox style: non-ASCII left unescaped in the URL (Firefox's `UnEscapeNonAsciiURI` does this before `ShellExecute`) | Arrives intact. |
| Leading `/` or `!` | Prefilled as typed. (Whether Enter then runs it as a command was not tested.) |
| 4,900 characters | Intact. The warning reads `Prompt from an external link (4,900 chars) · scroll to review it all before pressing Enter`. |
| Exactly 5,000 (ASCII; with Polish; with an emoji at the end; 5,000 × `ż`, a 30,180-character URL) | Intact. |
| 5,001 (ASCII, 6,000, or 4,999 characters plus one emoji) | **Silently ignored.** The handler starts and exits; no window, no message. The limit counts UTF-16 code units, the same as JavaScript's `string.length`. |
| Empty `q` | Opens with an empty prompt box. |
| `cwd` with spaces, Polish characters, `;` and `&`, forward slashes, or a trailing `\` | Opens in that folder. |
| `cwd` does not exist | A Windows Terminal window opens with `[error 2147942667 (0x8007010b) when launching '…claude.exe …'] Could not access starting directory "<path>"`. Claude Code does not start. |
| Relative or UNC `cwd` | **Silently ignored**, as for an over-long prompt. |
| A folder Claude Code has not trusted yet | The usual trust prompt (`Quick safety check: Is this a project you created or one you trust?`, `No, exit` selected by default) comes before the prefilled prompt. |

Each launch opens a new Windows Terminal window. The prompt box always shows `Prompt from an external link · review before pressing Enter`, and the session starts in the user's default permission mode (auto mode on this machine).

### `claude://code/new` (Claude Desktop)

One combined case: the folder `…\projekt zażółć gęślą`, and a two-line prompt containing quotes, `&`, `;`, `%`, Polish characters and an emoji. Windows passed the URL to `Claude.exe` unchanged. Desktop switched to its **New session** page with the folder selected and both lines in the composer, intact. Nothing was sent. Within 10 s no folder confirmation dialog appeared, although the Help Center says Desktop always asks for one. Missing folders and the roughly 14,000-character limit were not tested, to avoid further disruption of the owner's running Desktop app.

### Browsers (Chrome 156 via Playwright, `http://localhost:8126`)

- Chrome shows a tab-modal dialog. Captured in the Polish UI: "Otworzyć Claude Code?" / "http://localhost:8126 chce otworzyć tę aplikację." / checkbox "Zawsze zezwalaj stronie http://localhost:8126 na otwieranie linków tego typu w powiązanej aplikacji" / **Otwórz Claude Code** · **Anuluj**, with Cancel focused. In English that is "Open Claude Code?", "… wants to open this application", "Always allow … to open links of this type in the associated app". The app name comes from the handler executable, not from our page.
- The page stays where it is. A click on a temporary `<a href="claude-cli://…">` fires `beforeunload` but does not navigate. Our CSP (`default-src 'self'`, no `frame-src`) **blocks a hidden-iframe launch** (`securitypolicyviolation: frame-src`, no dialog). A top-level navigation by anchor click works under the same CSP.
- **With no handler installed, the page sees nothing.** Chrome writes only a console message (`Failed to launch 'x://…' because the scheme does not have a registered handler.`), which page code cannot read. There is no exception, no `blur`, no `visibilitychange`, and `document.hasFocus()` stays true. While Chrome's dialog is open, the page's state is exactly the same, so "no handler" and "dialog waiting" look identical. The window loses focus only once the user confirms and the terminal opens.
- Current Chromium (`chrome/browser/platform_util_win.cc`) passes the quoted URL to `ShellExecuteA` with no length check. The old 2,048-character cap (crbug.com/727909) is gone. `ShellExecuteEx` handled a 30,180-character URL here. Firefox runs the URL through urlmon's `CreateUri` and then `ShellExecuteByExplorer`. Its long-URL behaviour was not measured.

### `claude --bg --name` on Windows

Available in 2.1.292. `claude --bg --name tkt26-bg-probe "<prompt>"` printed `Starting background service…` / `backgrounded · <id> · tkt26-bg-probe`. `claude agents --json` listed it as `kind: background` and it answered. `claude logs`, `claude stop` and `claude rm` worked. The background option (I-124) is not blocked on Windows. Whether a session survives closing the launching terminal, and sign-out, was not tested.

## Decision

TKT-29 builds the launch exactly like this:

1. **URL format.** `claude-cli://open?cwd=${encodeURIComponent(path)}&q=${encodeURIComponent(prompt)}` for Claude Code. `claude://code/new?folder=${encodeURIComponent(path)}&q=${encodeURIComponent(prompt)}` for Claude Desktop. Encode every value with `encodeURIComponent`, never `URLSearchParams`, which turns spaces into `+`. Never send `repo` (GitHub-only, R5).
2. **Normalise the prompt** before encoding: CRLF becomes LF, and trailing whitespace is trimmed, as the handler does anyway. The decoded prompt must satisfy `prompt.length <= 5000` (UTF-16 code units). Over the limit, the handler does nothing at all, so the button must not launch. It shows "This prompt is too long to open in Claude Code (N / 5,000 characters)" and offers **Copy prompt**. The server should reject templates that cannot fit (B2/B3), but the client check on the *resolved* prompt is the one that counts. Claude Desktop accepts about 14,000, but use the same 5,000 for both so a prompt never works in one target and fails in the other.
3. **Validate the folder** in the setup dialog: an absolute drive path (`^[A-Za-z]:[\\/]`), no `..` segments, not UNC (`\\server\…`), no control, bidirectional or invisible characters. Claude Code ignores such paths silently, so we must catch them first. Spaces, non-ASCII, `;`, `&` and forward slashes are fine. A path that no longer exists produces a visible Windows Terminal error ("Could not access starting directory"), so the toast's help text names that case. Store the path as typed, without adding a trailing separator.
4. **Launch by top-level navigation from the click handler,** synchronously, before any `await`: create an `<a href>`, call `click()` on it and remove it, or call `location.assign(url)`. Keep it in one small `core/` function (for example `launchExternalUrl(url)`) so Playwright can stub it and read the URL. A hidden iframe is blocked by our CSP, and `window.open` leaves an empty tab. Do not add `beforeunload` handlers on the ticket page, because they fire on this navigation.
5. **History call.** `POST /tickets/{key}/agent-delegations` runs alongside the launch. It must not delay the navigation (Chromium requires the user gesture).

**Fallback UX.** No detection. After every launch, show the same neutral toast for about 10 seconds: "Opening Claude Code… Didn't open? **Copy prompt** · **Help**" (the TKT-29 AC wording "Copy prompt · How to install Claude Code" fits). Help explains, in order:

- the browser asks first: choose *Open Claude Code*, and tick *Always allow* to skip the dialog next time;
- the link handler registers when you **send your first prompt in an interactive `claude` session**, so run `claude` once;
- the folder must exist: "Change local folder";
- your organisation may have disabled deep links (`disableDeepLinkRegistration`): copy the prompt and run `claude` in the folder yourself.

A "Copy command" item (`cd "<path>"` and `claude "<prompt>"` for PowerShell) is optional. If it is added, it must escape `` ` ``, `"` and `$` in the prompt with a backtick so that pasting runs nothing unintended. If a cheap hint is wanted later, a `blur` within the toast's lifetime can close the toast early. Its absence proves nothing, so it never triggers an error state.

## Manual checklist (needs a person at the browser; not verified)

Run from `https://<ticketing>` and from `http://localhost:8090`, with Claude Code registered, then once after deleting `HKCU\Software\Classes\claude-cli` (restore it by sending one prompt in `claude`):

1. **Chrome**, **Edge**, **Firefox**: click a `claude-cli://open?cwd=…&q=…` link. Record the dialog title, body, checkbox and button texts. Confirm that Claude Code opens in the folder with the prompt (multi-line, Polish characters) prefilled.
2. Tick "Always allow" (Chrome, Edge) or "Always use" (Firefox), launch again, and confirm there is no dialog. Then confirm the dialog **does** appear from a different origin (per-origin persistence) and after a browser restart.
3. Firefox with a 4,900-character prompt: does it launch? Firefox goes through `CreateUri` and `ShellExecuteByExplorer`, and its long-URL behaviour is unmeasured.
4. Firefox and Edge **without** a handler: does the page stay, or does an error page replace it? (Chrome stays.)
5. Claude Desktop: does a folder confirmation dialog appear, and when? Check a missing folder and a 6,000-character prompt.
6. Plain-HTTP intranet origin: confirm that Chrome and Edge do not offer "Always allow" (expected; not potentially trustworthy).

## Consequences

- TKT-29 has a fixed contract: the URL shape, the 5,000 `length` budget, the folder rules, the anchor launch and the toast. It does not depend on detecting the handler.
- Prompt text is safe in transit on Windows, because the handler passes it as base64. The remaining risks are the ones the research named: prompt injection through ticket content, and users learning to press Enter on any prompt (R1, R4).
- If the org disables the handler, or the silent failures (too-long prompt, bad folder) cause support load, the v2 helper (I-124) remains the escape hatch.
- The browser dialogs and Firefox's long-URL behaviour stay unverified until the manual checklist is run.
