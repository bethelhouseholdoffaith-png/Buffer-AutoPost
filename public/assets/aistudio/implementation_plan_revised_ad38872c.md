# Buffer + Gemini Video Scheduler — Revised Implementation Plan

## 1. Product Goal

Build a polished, browser-based video scheduling app that connects to the user's own Buffer account and Gemini API key. The user uploads a video, Gemini watches and analyzes the actual video, the app generates a relevant title, and the user can schedule the video to a selected Buffer channel and time.

The product should feel like a carefully designed creative tool—not a generic AI dashboard. The visual direction is inspired by the restraint, typography, contrast, spacing, and interaction quality found on dark.design, with optional Apple-inspired motion and an opt-in Liquid Glass appearance.

### Core principles

- Use Buffer's current GraphQL API at `https://api.buffer.com`; do not use deprecated Buffer REST v1 endpoints.
- Route Buffer and Gemini requests through the Express backend. Never expose either API key to frontend JavaScript after it has been submitted.
- Make the user's Gemini key power real video understanding. Do not pretend that a few still frames are equivalent to analyzing the uploaded video.
- Minimize API calls, video re-uploads, unnecessary polling, and repeated analysis.
- Make every generated title editable and clearly tied to the uploaded video's actual content.
- Keep the interface clean, fast, accessible, and responsive.

---

## 2. First-Visit Onboarding

### 2.1 Sequential two-step setup

On the first visit, request the two API keys in this exact order:

1. **Buffer API key**
2. **Gemini API key**

Before opening onboarding, the frontend calls a backend key-status endpoint. The response contains readiness booleans only, such as `hasBufferKey` and `hasGeminiKey`; it must never include either key or a partial key.

If one or both keys are missing, open a focused welcome/setup screen. Do not show the normal app dashboard behind a cluttered form.

### 2.2 Step 1 — Buffer

- Heading: `Connect Buffer`.
- Explain briefly that the key lets the app load channels, schedules, and create scheduled posts.
- Provide a password-style API-key input with show/hide control.
- Include a direct link to Buffer's API settings: `https://publish.buffer.com/settings/api`.
- Primary action: `Connect Buffer`.
- Send the key to the backend over HTTPS. The backend validates it with a small, low-cost GraphQL request against `https://api.buffer.com` before saving it.
- On success, save it in the browser's HttpOnly cookie and continue to Step 2.
- On failure, remain on Step 1 and show a short, actionable error without exposing the submitted key.

### 2.3 Step 2 — Gemini

- Heading: `Connect Gemini`.
- Briefly explain that Gemini will inspect the uploaded video and generate a title based on what is actually shown and said.
- Provide a password-style API-key input with show/hide control.
- Include a link to Google AI Studio's API key page: `https://aistudio.google.com/app/apikey`.
- Send the key to a backend validation route. Validate with a lightweight supported Gemini request, not by uploading a video during onboarding.
- Save it in an HttpOnly cookie only after successful validation.
- On success, finish onboarding and transition into the app.
- If validation fails, remain on Step 2 and show a helpful error.

### 2.4 Slide transitions and interaction details

The onboarding must use directional slide transitions:

- Buffer Step 1 → Gemini Step 2: the Buffer panel exits to the left while the Gemini panel enters from the right.
- Gemini Step 2 → Buffer Step 1: the Gemini panel exits to the right while the Buffer panel enters from the left.
- Gemini success → app: gently fade and slide the setup panel away while the dashboard appears.
- Include a small `01 / 02` and `02 / 02` progress indicator. Update it with the panel transition.
- Keep the card position and dimensions stable so the content does not jump between steps.
- Disable the next action while a key is being validated and show a restrained loading state.
- Support keyboard focus, Enter to submit, Escape only when dismissal is safe, and reduced-motion preferences.
- Do not animate the inputs so aggressively that typing or password-manager autofill becomes unreliable.

### 2.5 Reconnect and settings

Both keys remain editable later from Settings and a compact connection-status area in the sidebar. Allow updating Buffer without re-entering Gemini, and vice versa. A successful key update refreshes only the data affected by that key.

Provide a `Disconnect` / `Clear key` action for each integration. Clearing a key removes its cookie and invalidates any cached connection state.

---

## 3. Credential Security and Backend Proxy

### 3.1 Credential handling

- API-key inputs may exist transiently in the form while the user is typing and while the HTTPS request is being submitted. Do not persist them in `localStorage`, IndexedDB, client-side app state after submission, analytics, telemetry, error reports, URLs, or logs.
- After the backend receives the key, validate it and set the corresponding HttpOnly cookie. Clear the input value from the frontend immediately after the request resolves or fails.
- The browser must only receive boolean readiness status and safe integration metadata—never raw API keys.
- The backend reads the cookie and attaches the credential to the upstream Buffer or Gemini request.
- Use TLS/HTTPS in production.
- Ensure request bodies, headers, cookies, and SDK exceptions containing keys are redacted from logs.

### 3.2 Cookie configuration

Prefer deploying the frontend and backend on the same origin, using a reverse proxy for `/api/*`. For that setup, use cookies with:

`HttpOnly; Secure; SameSite=Lax; Path=/`

Set an appropriate expiration and refresh behavior. Do not set `Partitioned` by default; it is a special-case attribute for partitioned third-party cookie contexts and is not necessary for a normal same-origin app.

If the frontend and backend must run on separate sites, configure `SameSite=None; Secure`, credentialed CORS for the exact frontend origin, and explicit CSRF protections. Do not use wildcard CORS with credentials. Verify the deployment's cookie behavior in the actual target browsers before release.

### 3.3 Backend protection

- Validate `Origin` and, where appropriate, `Host` on state-changing requests.
- Use CSRF protection for cookie-authenticated write routes.
- Apply request-size limits, upload-size limits, per-session throttling, and safe MIME-type validation.
- Never accept an arbitrary destination URL from the browser for server-side fetching; this avoids turning the proxy into an SSRF endpoint.
- Keep `.env*` files, local uploads, generated artifacts, and secrets out of Git. Commit only a placeholder `.env.example`.
- Keep temporary video files outside the public web root and delete them when no longer needed.

### 3.4 API routes

Suggested routes:

- `GET /api/keys/status` — return `{ hasBufferKey, hasGeminiKey }` only.
- `POST /api/keys/buffer` — validate and store Buffer key in HttpOnly cookie.
- `POST /api/keys/gemini` — validate and store Gemini key in HttpOnly cookie.
- `POST /api/keys/clear` — clear the named integration key.
- `GET /api/buffer/bootstrap` — return minimum required organization/channel data.
- `GET /api/buffer/channels` — return cached channel data when available.
- `GET /api/buffer/schedule` — return channel posting schedules and pause status.
- `POST /api/buffer/posts` — create/schedule a post using a supported Buffer GraphQL mutation.
- `PATCH /api/buffer/posts/:id` — edit or reschedule using a supported mutation, if the current Buffer schema supports the requested operation.
- `DELETE /api/buffer/posts/:id` — delete using a supported Buffer mutation.
- `POST /api/gemini/analyze-video` — accept an uploaded video, analyze it with the user's Gemini key, and return a structured title result.
- `GET /api/gemini/jobs/:id` — optional status route if video analysis is handled as a background job.

The browser should call the app's backend routes, never Buffer or Gemini directly with a user API key.

---

## 4. Gemini Video Analysis and Title Generation

### 4.1 Analyze the uploaded video itself

When a user uploads a video, Gemini must receive the video content as video input. Do not base the title only on the filename, a user-entered description, or an arbitrary handful of extracted screenshots.

Recommended implementation:

1. The frontend uploads the selected video to `POST /api/gemini/analyze-video` using a multipart or streaming upload.
2. The backend validates file size, MIME type, extension, and upload integrity.
3. The backend uses the Gemini API key from the HttpOnly cookie.
4. For normal uploads, use the Gemini Files API to upload the video. Google's current video guidance recommends the Files API for larger inputs, longer videos, or videos that may be reused across prompts. Inline video is appropriate only for small one-off requests within the documented request-size limits.
5. Check the uploaded Gemini file's processing state. Continue only when the state is `ACTIVE`; handle `FAILED` and timeouts explicitly. Use bounded polling with a sensible interval (the current examples use five-second checks) rather than tight polling.
6. Send the uploaded file URI and the title-generation prompt below in one generation request.
7. Validate and parse the response as structured JSON before returning it to the frontend.
8. Reuse the already-uploaded Gemini file for a retry or a deliberate re-generation while that file remains available; do not upload the same video again unnecessarily.
9. Delete temporary app-side video files after processing. Delete the remote Gemini file after the result is safely returned and no further regeneration is expected, using the supported Files API delete operation. If the product intentionally keeps the file briefly for a regenerate action, explain that in the UI and expire it on a short retention policy.

Set the model through a backend configuration value such as `GEMINI_VIDEO_MODEL`. Use a currently supported video-capable Gemini model available to the user's API key. The current official video-understanding examples demonstrate `gemini-4-hydrogen`; keep the model configurable so it can be changed if availability, pricing, or model IDs change. Prefer an efficient Flash-class model where it supports the required video understanding and output quality. Do not silently fall back to a text-only model.

### 4.2 Fixed Gemini title-generation prompt

Use this as the core instruction for every title-generation request. Keep the prompt on the backend so that the client cannot accidentally replace or weaken the content-grounding rules.

> You are an expert social-video editor. Watch and analyze the entire uploaded video, including the spoken dialogue, narration, on-screen text, important visual actions, people or objects shown, and the overall point of the clip.
>
> Your task is to write one clear, compelling title that accurately matches this specific video.
>
> Rules:
> - Base the title on the actual video content, not on its filename or assumptions.
> - Identify the main subject and the most interesting genuine moment, insight, question, result, or takeaway.
> - Be specific and natural. Make the title sound like a human creator wrote it.
> - Create curiosity when the video supports it, but do not use misleading clickbait.
> - Never invent people, facts, quotes, events, results, or claims that are not supported by the video.
> - Do not imply that the video contains something it does not show or say.
> - Avoid generic openings such as “You won't believe,” “This is crazy,” or “Watch until the end” unless those exact words are genuinely appropriate to the content.
> - Keep the main title concise and easy to understand at a glance. Aim for roughly 5–12 words and stay comfortably below 100 characters when possible.
> - Match the language of the video unless the user has selected another title language.
> - Do not add hashtags, emojis, quotation marks, a preamble, or explanations to the main title.
>
> Return valid JSON only, using this exact structure:
> {
>   "title": "One best title for this video",
>   "alternatives": ["Alternative title 1", "Alternative title 2"],
>   "content_summary": "One factual sentence describing what the video is about"
> }
>
> The alternatives must also be accurate and distinct. If the video is unclear, say so in `content_summary` and produce the most cautious accurate title possible. Never fabricate missing context.

The backend should enforce the expected JSON shape, trim whitespace, reject empty titles, and show a controlled retry/error state if the model returns invalid JSON. Do not display raw model reasoning or hidden chain-of-thought. The concise content summary is the user-facing explanation of what the title is grounded in.

### 4.3 Upload and analysis experience

- Show a real upload progress indicator while the video is sent to the backend.
- Show a separate `Analyzing video` state while Gemini processes the uploaded file.
- Use clear states: `Uploading`, `Preparing video`, `Analyzing`, `Title ready`, and `Something went wrong`.
- Once ready, show the suggested title in an editable text field, with the two alternatives available as simple selectable suggestions.
- Include `Generate another title` as an explicit user action. Do not re-run Gemini automatically when the user edits the title or navigates around the app.
- Preserve the user's manual edits if they change the selected alternative or edit the title themselves.
- If Gemini is not connected, show a direct `Connect Gemini` action. Never pretend that a title was AI-generated when no Gemini request succeeded.

### 4.4 Gemini API efficiency

- Upload each video to the Files API once per analysis session. Reuse its file URI for retry or additional prompt requests while valid.
- Run one focused generation call that returns the title, alternatives, and one-sentence factual summary together. Do not split these into separate Gemini calls.
- Do not regenerate on every render, state update, calendar refresh, or title keystroke.
- Cache successful title results by the app's upload ID plus a content fingerprint and prompt/model version. Invalidate the cache only when the video, model, prompt version, or explicit regenerate action changes.
- Keep output limits small and request only the fields used by the UI.
- Avoid repeatedly sending the same prompt or re-uploading the same media after transient errors.
- Use bounded retries with exponential backoff for retryable transient failures. Do not repeatedly retry invalid keys, invalid file formats, quota exhaustion, or permanent model errors.
- Surface quota/rate-limit errors clearly and let the user retry when appropriate.
- If a long video is too large or expensive for the configured model, show a clear limit/error message or ask the user to choose a shorter version; do not silently analyze only the first few seconds and claim the whole video was reviewed.
- Keep prompt and model version identifiers with cached results so an intentional prompt update triggers re-analysis.

---

## 5. Buffer GraphQL Integration

### 5.1 API migration

Remove all deprecated Buffer REST v1 calls, including `api.bufferapp.com/1/*`. Use Buffer's current GraphQL endpoint only:

`https://api.buffer.com`

All authenticated GraphQL requests must be made by the Express backend using the cookie-stored Buffer API key as a Bearer token.

### 5.2 Bootstrap and schedule data

Use the existing `GetChannelPostingSlots` query as the schedule source, with the minimum additional organization and channel fields the UI needs. Retrieve and expose:

- Organization identity and timezone where needed.
- Channel ID, channel name, service, and relevant status fields.
- Channel timezone.
- `postingSchedule { day, paused, times }`.
- Channel queue pause state such as `isQueuePaused`, when present in the supported schema.

Do not guess field names or mutation input shapes. Confirm every query and mutation against Buffer's current GraphQL schema and documentation during implementation.

### 5.3 Active and paused schedule slots

- Normalize weekdays (`monday`–`sunday`) to the app's internal weekday representation.
- Normalize slot times to `h:mm AM/PM` for display while preserving the source timezone.
- Display active recurring slots normally.
- A slot where `paused === true`, or a slot belonging to a channel with `isQueuePaused === true`, must be visually dimmed and carry an explicit `Paused` label. Do not rely on color alone.
- The next-open-slot calculator must skip paused slots.
- Clicking an active slot opens the upload/scheduling flow with the selected channel, date, and time pre-filled.
- Clicking a paused slot should explain that the queue is paused and should not offer it as a schedulable next spot.

### 5.4 Buffer API efficiency

Implement these rules as part of the API client, not as optional future enhancements:

- **Request only needed fields.** Keep GraphQL selections small. Do not fetch analytics, metrics, notes, assets, or author details unless the current screen uses them.
- **Combine related reads.** Where the schema permits, combine account, organization, channel, schedule, and daily-limit fields into one GraphQL request rather than making separate startup requests.
- **Use list inputs and aliases appropriately.** Fetch data for multiple channel IDs in one request where supported. Use GraphQL aliases for multiple calls to the same field with different filters when supported.
- **Paginate deliberately.** Use cursor pagination and request the next page only when the UI actually needs more results.
- **Cache stable data.** Cache organization/channel metadata and recurring schedule data in a short-lived per-session cache. Reuse it on navigation instead of re-fetching on every screen render. Refresh after an affected mutation, manual refresh, or cache expiry.
- **Deduplicate in-flight reads.** If multiple components request the same channel or schedule data at once, share the same pending backend request.
- **Avoid wasteful polling.** Do not poll Buffer continuously for schedule data. Refresh on app entry, explicit refresh, relevant mutation success, or a sensible cache expiry.
- **Read rate-limit headers.** Inspect `RateLimit` and `RateLimit-Policy` headers from authenticated responses and track the remaining quota for the 15-minute, 24-hour, and 30-day windows.
- **Respect 429 responses.** When Buffer returns `429`, honor `Retry-After`. Use bounded backoff and show a clear retry time when needed. Do not retry in a tight loop.
- **Avoid duplicate mutations.** Do not automatically retry a post-creation mutation after an ambiguous timeout unless the app can first establish whether the original post was created. Prevent double-click submissions and disable the submit action while a post is being created.
- **Handle GraphQL errors in the response body.** HTTP 200 does not guarantee a successful operation. Inspect the GraphQL `errors` array and typed mutation error results. Include a catch-all mutation error selection such as `... on MutationError { message }` where required by the schema.
- **Keep quota values configurable/current.** Do not hardcode example request quotas from documentation as permanent limits; use live response headers and current Buffer plan information.

### 5.5 Create and manage posts

Use only current supported GraphQL mutations for creating, editing, rescheduling, and deleting posts. Validate required fields, selected channel, scheduled time, and media references before sending the mutation. Show the actual mutation result to the user and refresh only the affected post/calendar data after success.

Do not claim a post is scheduled until Buffer confirms success. Surface actionable errors for unsupported channel types, invalid scheduling times, unavailable media, and API failures.

---

## 6. Visual Design — Dark, Editorial, and Deliberate

### 6.1 Overall direction

Use dark.design as a source of inspiration for the design language—not as a template to copy. The app should feel like a premium creative utility with a quiet, editorial interface.

- Default to a deep charcoal/near-black theme with carefully controlled contrast.
- Use a restrained neutral palette. Reserve one accent color for important actions and status, rather than filling the screen with gradients.
- Use strong typography, consistent spacing, crisp alignment, thin dividers, and purposeful negative space.
- Preserve the existing Manrope font if it is already loaded and working well. Use a clear type scale and tabular numerals for dates, times, and counters.
- Prefer flat surfaces, subtle borders, and restrained depth over stacks of floating cards.
- Do not use generic “AI” visual clichés: no glowing purple gradients, random neon glows, excessive glass panels, decorative stars, robot imagery, or unnecessary badges.
- Avoid excessive rounded pill controls. Use restrained corner radii and clear typographic hierarchy.
- Make the video preview and scheduling calendar the visual focus. AI should feel like a useful feature inside the product, not the entire visual identity.

### 6.2 Layout and components

- Use a consistent left sidebar for navigation, channel context, and connection status.
- Keep the primary content area wide and calm, with clear page headings and one obvious primary action.
- Use a compact upload wizard with clear progress and a focused video preview.
- Keep calendar cells, posting slots, and time labels aligned and easy to scan.
- Use consistent hover, focus, active, disabled, loading, success, and error states across all controls.
- Maintain strong color contrast in every theme and do not communicate state by color alone.

### 6.3 Themes

Provide three base themes:

1. `Minimal Black` — deep charcoal canvas, muted borders, bright text.
2. `Midnight` — slightly softer blue-black surfaces, still low saturation.
3. `Light Monochrome` — clean white canvas, dark text, subtle neutral dividers.

Theme choice is a normal appearance preference and may be stored locally. This is separate from credentials; never store API keys in local storage.

---

## 7. Apple-Inspired Motion and Microinteractions

The interface should feel smooth and intentional, inspired by the quality of Apple's motion design without copying proprietary interface elements.

### Motion rules

- Use a small shared motion system rather than independent, inconsistent animations.
- Use smooth ease-out/spring-like curves for panel transitions, menus, dialogs, and selection changes.
- Keep common transitions short and purposeful (roughly 180–400 ms depending on the interaction).
- Use subtle opacity and position changes for page and modal entry/exit.
- Give buttons a light press response, not a large bounce.
- Animate onboarding panels horizontally as defined in Section 2.
- Animate upload progress continuously only when actual progress data is available; use an indeterminate state when it is not.
- Use restrained calendar hover/selection transitions so the grid remains readable.
- Avoid animating large blurred filters or expensive full-screen effects during scrolling.
- Respect `prefers-reduced-motion`. When enabled, replace slide/spring animations with brief fades or immediate state changes.
- Ensure motion never delays input, blocks keyboard navigation, or hides important status information.

---

## 8. Optional Liquid Glass Appearance

Add an opt-in `Liquid Glass` toggle under Appearance settings. It must be optional, not the app's default visual mode. When disabled, use the clean monochrome surfaces described above.

### 8.1 Implementation framework

Use the user's supplied `.liquidglass` HTML/CSS/SVG as the starting reference for a reusable glass-surface component:

- Use a translucent surface, subtle inner highlights, restrained backdrop blur, and saturation.
- Where supported, use the supplied SVG filter approach with `feImage`, `feDisplacementMap`, `feColorMatrix`, `feBlend`, and a soft blur to create a mild refractive effect.
- Factor the SVG filter into one shared component or shared SVG definition. Do not duplicate the long base64 displacement-map payload in every component.
- Generate a unique SVG filter ID per mounted instance (or use one controlled shared definition) so multiple glass surfaces do not collide.
- Keep the filter and decorative overlay `pointer-events: none`; interactive controls and readable content must remain in a separate foreground layer.
- Treat the sample's fixed positioning and demo dimensions as demonstration-only. Glass surfaces in the actual app must follow the component's normal layout and responsive sizing.
- Use a CSS fallback such as translucent background plus `backdrop-filter: blur(...) saturate(...)` when SVG filter rendering is unsupported or too expensive.
- Add a reduced-effects fallback for low-power devices and `prefers-reduced-motion` / accessibility preferences.
- Keep text contrast high. Never put small or low-contrast text over a busy background just to show the glass effect.
- Use glass selectively for the onboarding panel, small settings overlays, or a few floating controls—not every card, calendar cell, and panel.

### 8.2 Liquid Glass quality and performance

- Make the toggle instant and reversible.
- Persist only the appearance preference, not credentials.
- Test in current Chrome, Safari, and Firefox. If the advanced SVG filter behaves inconsistently, retain the CSS fallback rather than breaking the interface.
- Limit simultaneous heavy filters and avoid applying displacement effects to large scrolling surfaces.
- Ensure the glass mode remains readable in all three base themes, or scope it to the dark themes if contrast cannot be guaranteed.

---

## 9. Application State and Data Flow

### Key state

- `hasBufferKey`: boolean from `/api/keys/status`.
- `hasGeminiKey`: boolean from `/api/keys/status`.
- Onboarding opens automatically if required keys are missing.
- The frontend does not retain the raw keys after submission.

### Buffer state

- Store organizations, channels, channel timezones, pause flags, and normalized weekly slots in a short-lived cache.
- Store only the current calendar range and post details required by visible screens.
- Invalidate only the relevant cache entries after a successful post mutation.

### Video-analysis state

- Track app upload ID, local upload status, Gemini file status, analysis status, prompt version, model ID, and the returned title result.
- Keep temporary file references on the backend. Return only the app's safe upload/result identifiers to the browser.
- Cache completed analysis by upload ID/content fingerprint plus prompt/model version.
- Never run analysis as a side effect of a React render.

### Appearance state

- Store selected base theme and `Liquid Glass` enabled/disabled state as non-sensitive UI preferences.
- Load preferences before rendering the main shell to avoid a visible theme flash.

---

## 10. Suggested Frontend Structure

Keep components focused and reusable. Suggested structure:

```text
src/
  app/
    App.tsx
    routes.tsx
  components/
    Sidebar.tsx
    ThemeProvider.tsx
    MotionConfig.tsx
    LiquidGlassSurface.tsx
    ConnectionStatus.tsx
    CalendarGrid.tsx
    ScheduleSlot.tsx
    VideoPreview.tsx
    UploadWizard.tsx
    TitleSuggestion.tsx
  features/
    onboarding/
      OnboardingFlow.tsx
      BufferKeyStep.tsx
      GeminiKeyStep.tsx
    buffer/
      bufferApi.ts
      scheduleTypes.ts
    gemini/
      geminiApi.ts
      titleTypes.ts
    settings/
      AppearanceSettings.tsx
      IntegrationSettings.tsx
  styles/
    tokens.css
    themes.css
    motion.css
    glass.css
```

The backend should keep Buffer and Gemini integrations in separate service modules so their authentication, validation, retries, caching, and error handling can be tested independently.

---

## 11. Error Handling and User Feedback

Use plain, specific language instead of exposing stack traces or raw upstream responses.

Examples:

- `Buffer key could not be verified. Check the key and try again.`
- `Gemini key could not be verified. Check the key and try again.`
- `This video could not be processed. Try a supported video file.`
- `Gemini is still preparing the video. This can take a little while.`
- `Gemini could not analyze the full video. No title was generated.`
- `Buffer is temporarily rate-limiting requests. Try again after the displayed wait.`
- `The post was not scheduled. Review the channel and time, then try again.`

Never silently substitute a generic title when Gemini fails. Provide a manual-title path, but label it clearly as user-entered rather than AI-generated.

---

## 12. Testing and Acceptance Criteria

### Onboarding and security

- [ ] A first-time visitor sees Buffer Step 1 before Gemini Step 2.
- [ ] Forward navigation slides left; backward navigation slides right.
- [ ] The second step cannot be reached until Buffer validation succeeds.
- [ ] The app can resume onboarding correctly when only one key is missing.
- [ ] Key-status responses contain booleans only.
- [ ] Raw API keys do not appear in browser storage, logs, analytics, URLs, or frontend state after submission.
- [ ] Cookies have the expected attributes for the actual deployment origin.
- [ ] Key update and key clear operations update connection status correctly.

### Gemini video analysis

- [ ] Uploading a video invokes the backend video-analysis route.
- [ ] Gemini receives the video file itself, not only the filename or a small set of screenshots.
- [ ] The backend waits for the Gemini file to become `ACTIVE` and handles `FAILED` and timeout states.
- [ ] The fixed prompt returns valid structured JSON with a grounded title, alternatives, and factual summary.
- [ ] The title is editable and is not overwritten by unrelated rerenders.
- [ ] No duplicate Gemini analysis is triggered by navigation or typing.
- [ ] A retry reuses the uploaded Gemini file when it is still valid.
- [ ] Temporary media is cleaned up according to the retention policy.
- [ ] Gemini failure is visible and never disguised as a successful AI title.

### Buffer integration and efficiency

- [ ] No deprecated Buffer REST v1 calls remain.
- [ ] Buffer reads are consolidated where the GraphQL schema permits.
- [ ] Queries request only fields used by the app.
- [ ] Channel and schedule data are cached and not fetched on every navigation/render.
- [ ] Rate-limit headers are read and `Retry-After` is respected after a 429.
- [ ] GraphQL errors and mutation errors are handled even when HTTP status is 200.
- [ ] A double-click or ambiguous retry cannot create duplicate scheduled posts.
- [ ] Paused slots are visibly labelled and excluded from next-open-slot selection.

### Visual design and accessibility

- [ ] The main interface follows the restrained dark.design-inspired visual direction.
- [ ] The app has Minimal Black, Midnight, and Light Monochrome themes.
- [ ] Liquid Glass is optional and can be toggled off.
- [ ] The interface has a graceful CSS fallback when SVG displacement filters are unavailable.
- [ ] Animations are consistent and respect `prefers-reduced-motion`.
- [ ] The UI is usable on desktop and mobile widths.
- [ ] Keyboard focus, visible focus states, contrast, and screen-reader labels are present.

---

## 13. Implementation Order

1. **Audit and stabilize the backend proxy.** Confirm same-origin deployment strategy, secure cookie behavior, CSRF protection, upload limits, and key-status endpoints.
2. **Finish Buffer GraphQL migration and caching.** Remove REST v1 calls, validate all query/mutation shapes against the current schema, add schedule caching, and implement rate-limit handling.
3. **Build the two-step onboarding.** Add sequential key validation, slide transitions, key editing, and disconnect flows.
4. **Implement real Gemini video analysis.** Add upload handling, Files API processing-state checks, the fixed title prompt, JSON validation, caching, and cleanup.
5. **Connect upload and scheduling.** Make the editable Gemini title flow into the Buffer post composer and confirm scheduling from Buffer's mutation response.
6. **Apply the visual system.** Refine typography, layout, calendar, uploader, and themes using the restrained editorial direction.
7. **Add motion and Liquid Glass.** Implement shared motion rules and the optional glass surface with performance and accessibility fallbacks.
8. **Run acceptance tests.** Verify API usage, security, duplicate prevention, error states, responsiveness, and reduced-motion behavior.

---

## 14. Official Technical References

Use the current official documentation as the source of truth when implementing and verify model IDs, SDK methods, API fields, and quotas at implementation time:

- [Buffer API — Introduction](https://developers.buffer.com/guides/introduction.html)
- [Buffer API — Quick Start](https://developers.buffer.com/guides/getting-started.html)
- [Buffer API — Authentication](https://developers.buffer.com/guides/authentication.html)
- [Buffer API — Efficient API Usage](https://developers.buffer.com/guides/efficient-api-usage.html)
- [Buffer API — Rate Limits](https://developers.buffer.com/guides/api-limits.html)
- [Gemini API — Video Understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
- [Gemini API — Files API](https://ai.google.dev/api/files)
- [Gemini API — Models](https://ai.google.dev/gemini-api/docs/models)
- [Google AI Studio — API Keys](https://aistudio.google.com/app/apikey)

---

## Final Product Requirement

The finished app should let a user connect Buffer first and Gemini second, upload a real video, have Gemini analyze what is actually in that video, receive a relevant and editable title, and schedule the post through Buffer. It should do this with as few API calls and repeated uploads as practical, protect both credentials behind backend-managed HttpOnly cookies, and present the workflow in a restrained, premium interface with smooth Apple-inspired motion and an optional Liquid Glass mode.
