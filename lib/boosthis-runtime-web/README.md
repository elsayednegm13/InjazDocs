
# Boosthis Web runtime

Current runtime version `1.0.0-alpha.170`.

Crash reports include closed mistake and code-owner words and, for missing names,
non-functions and reads from nothing, at most one code name the browser copied
from the site's code as source text, in the engine's own error class. That
identifier or dotted path must pass the code-name, route-label and PII screens;
a property key the browser evaluated (it can be a value) is never sent.
Otherwise only `withheld` or `not-printed` is sent. Error wording stays
on the visitor's device by default. `data-crash-details="on"` on the hosted tag
opts into the screened first line and trimmed frames, as does the project's
detailed crash switch. Inline page code is grouped across page addresses.

<!-- KIT_CHANGELOG
1.0.0-alpha.170 — An action on a website now starts at the visitor's click.
When a click or key press makes the page call its own server (or a host named
for tracing), the kit sends one more step for it, a press, and the calls it
caused join its trace: the timeline starts where the visitor's wait started
and runs to the next paint the browser timed after the press, where it timed
one. A call is placed under a press only when it started while the press was
being handled; a call started later, from a timer or after another call, keeps
its own action as before. The press step carries the page's route label and,
where the control census is on, the control's structural handle; never its
text, test id, anything typed or where the press landed. A press with no call
sends nothing, and presses are paid for from the same step budget, so a page
pressed quickly sends no more.

1.0.0-alpha.169 — Errors a website catches itself can now be named.
reportCaughtError hands the kit an error the site's own code caught (a React or
Next.js error boundary, Vue's errorHandler, SvelteKit's handleError, Angular's
ErrorHandler); the guide wires each in one step. It is sent as its own kind,
caught by the page, never as a crash, and is not counted again from the app's
console line. reportRenderError is the same call. An optional early line keeps
errors thrown before the kit starts, in memory only.

1.0.0-alpha.168 — The startup line now names the key a page passes in code. A
page that called enableTelemetry({ inviteKey }) before startWebVitals() was told
"no project key. Nothing will register." in the console while it registered and
reported normally, because the line looked only at the key given to
startWebVitals and the page's own settings. The line now names the key
enableTelemetry kept, by its last four characters, and says "no project key"
only when there is none. Nothing measured or sent has changed.

1.0.0-alpha.167 — The kit's own privacy check now covers the requests that leave
outside its upload path too: the entitlement check-in, the owner link questions,
the rule book and fix fetches, the AI connection's live reads, the registration
check and the rule lookups. It reads the address and, where there is one, the
body. A stopped request sends nothing and is read as no answer, so the cached
state stands; a stopped fix fetch and a stopped owner link each say that the
kit's own check stopped them. Nothing measured has changed.

1.0.0-alpha.166 — The version this kit reports is its own: registration, the
check-in, page readings, crash reports and every upload carry the kit's
built-in version, whatever the site passes. A value passed through the
packageVersion option now travels as the site's own release, declared beside
the kit's version. Before, it replaced the kit's version, so Boosthis could not
tell which kit release sent a reading.

1.0.0-alpha.165 — A retired rule now reads as retired, not as missing: the
kit's AI connection says why it was retired, names the rule that replaced it
and points at fetching that one. A rule Boosthis declines to hand over, or a
fix it holds back under the project's allowance, now comes with Boosthis's own
reason instead of reading as unknown. A list of approved rules cut at its limit
says how many it left out.

1.0.0-alpha.164 — A report from the developer's AI, about a problem Boosthis
did not recognise or about what fixed one of the site's crashes, now reaches
Boosthis's review queue while the project is active. Before, the AI helper that
runs on the developer's computer answered ok and sent nothing. It first asks
Boosthis whether the project is active; that question writes nothing, so the
helper never shows up as an install. The reply says sent only once Boosthis has
accepted the report; otherwise it says it was not sent, and why. Nothing is
sent while the project is locked. Nothing changes in visitors' browsers; the
helper changes when you update your copy of the kit.

1.0.0-alpha.163 — The setup guide now says how to make the site's install id:
run a command once and write its output into the code, never type one or copy
one from an example, and never make one in the page, where it would change on
every load. The server now refuses a new install on a well-known example id; a
site already registered keeps working. Guide text only: nothing measured or
sent has changed.

1.0.0-alpha.162 — The setup guide now says where the project key comes from
the way the AI connection hands it over: the key in the reply when it carries
one, otherwise the key message the developer saved when the key was made, with
the Setup page's lost-key advice if that is lost. An app without its key is
not called set up. The guide names the setting BOOSTHIS_PROJECT_KEY (with the
build tool's prefix, such as VITE_BOOSTHIS_PROJECT_KEY or
NG_BOOSTHIS_PROJECT_KEY), and the local rule tools now read it first; a site
already built with an older name keeps working. Nothing measured or sent has
changed.

1.0.0-alpha.161 — When a project is locked, the kit now stops completely: it
removes its listeners, drops held readings and everything Boosthis handed it,
stops sending, and its panel and rule tools show only the renew notice. If the
project stays locked until Boosthis says it has ended (never before the new
Terms take effect), the kit erases what it stored in the browser, nothing on
our server, and stays off until the next page load. A grace period is now at
most 7 days. forget() now also removes the panel sign-in, the owner pass and
kit settings. Sites loading our address get this within about 15 minutes of our
next publish; a copy in your own build when you update it.

1.0.0-alpha.160 — Crash causes are reduced on-device to closed words and one
screened code name. Reports name whose code failed, retain stackless locations,
group inline page code across pages, and accept the project's or hosted tag's
detailed-crash choice.

1.0.0-alpha.159 — Spans and samples recorded while the kit is starting now
wait until it is active, instead of being thrown away by the regular send. A
batch that the server refuses for good, or that the kit's own privacy check
refuses, is dropped and counted, so the next batch still goes out; one that
got no answer is kept within its limit. One problem report the server will not
take is set aside while the rest are sent, and a failed send is tried again.
Crash retries keep going while anything is unsent, and upload timers survive
one failed pass.

1.0.0-alpha.158 — Pages named in their own letters. A browser hands over an
Arabic or other non-Latin address escaped, six characters for each letter, so a
two-word Arabic address passed the 100-character limit and its page was
withheld, and a shorter one was shown as unreadable codes. Escaped letters and
digits are now turned back into letters before the name is measured and
screened. Escaped spaces, slashes and symbols stay exactly as they arrived,
Arabic-Indic digits count as digits, and every Latin address is named exactly
as before.

1.0.0-alpha.157 — A problem report now says what its measurements pointed at,
so a site owner can see why calls fail as well as that they do. A failing-call
or slow-call problem counts its calls by kind of destination (the site's own
address, a named service, store platforms such as Shopify included, or another
address), by how they failed (no answer, turned away by the other side, an
error on the other side, timed out, or still waiting long after a slow call
would have answered), and by the pages that started them, most first. The
worst burst keeps its destinations and its page. A reconnect storm or a
stalled live connection keeps the kind of service and the gaps seen. A slow
page view says what held it up: long scripts from the site's own code or from
other addresses, waiting on calls, and the rest, or that the visitor's browser
does not report it. Addresses, paths and response bodies stay on the visitor's
device: the report carries closed words and counts.

1.0.0-alpha.156 — Calls that wait on purpose. A long-poll that the server
holds open for 25 seconds was read as hung after 15, and its whole wait went
into the page's network readings. Name such calls in
startWebVitals({ waitsOnPurpose: [...] }) or the script tag's
data-waits-on-purpose: a path on the page's own site or a full address,
without the query, where :name stands for one segment; up to 10. A named call
is never counted as slow, stalled or hung, and its time stays out of the
network readings, the call groups and the typical time of the app's own back
end; it still appears in call traces, marked as waiting on purpose, and its
failures still count. The names and addresses never leave the page: the
network reading carries four counts (names held, names matched, calls kept
out, the longest wait), sent as zeros when nothing is named. A refused name is
reported on the console, by its position, with a one-line reason. Event
streams read through XMLHttpRequest are now timed to their headers, as fetch
already was, and are never counted as hung.

1.0.0-alpha.155 — A page now recovers when one call to Boosthis fails. A
registration answered by a page that is not ours (a Wi-Fi sign-in page, a
proxy) or with no credential no longer counts as done: the page asks again
after 15 s, 45 s, 2 and 5 minutes, then every 5 minutes, and after a 429 no
sooner than Boosthis asked. The first verdict is asked for until one arrives,
not only for 46 seconds. A credential renewal that got no answer is tried again
after about a minute instead of never, the owner's dashboard switches wait for
a real answer, and the owner's Reconnect reaches an open page at its next
check-in.

1.0.0-alpha.154 — Angular. The kit now builds inside a new Angular project
under its default settings. An Angular app that hands over its router with
registerRouter() has each screen named by its route pattern (/products/:id) in
every reading, and the router's completed navigations decide where one screen
ends, hash routing included. Its route list carries the Angular routes and says
it is incomplete while lazy sections are unloaded. Boosthis does not compare a
route across an app's switch to these names. The kit's own timers and listeners
run outside Angular's zone, so they never hold the app back from becoming
stable, and in a server render the kit does nothing. Matrix parameters
(;sort=price) are left out of every route name.

1.0.0-alpha.153 — A screen's reading is now filed under the screen it
measured. Earlier releases filed an outgoing screen's reading under the next
screen's route, because the view was closed after the address had changed; on
a visit that moved on, that was usually the reading carrying the page's own
load timing. Browser route history before this release therefore mixes the
two, and Boosthis does not judge comparisons that straddle the upgrade. A
flushPageSample() call just before an address change and the kit's own close
for it now count as one view, and a redirect at start-up keeps the load timing
on the screen the visitor saw.

1.0.0-alpha.152 — Eight new rules, each a lesson first met in our own Node.js
build history and written here for the browser: give records created together a
tiebreaker before listing them by time from IndexedDB; re-check the condition as
each record is deleted; reload into a known state after an uncaught error; write
owed work to IndexedDB before showing done; time a fetch when its body has been
read; start the page from flags it already has; do not trip a breaker on the
first call after the tab wakes; and do not read an aborted fetch or a hidden tab
as the user giving up. The AI connection's code matcher no longer counts an
everyday word such as return or false in a rule's name as a match, so two of
these rules are not offered for almost any code. Nothing new is measured and
nothing new is sent.

1.0.0-alpha.151 — Asked for a rule id this release does not carry, the kit's AI
connection and its local rule address now ask Boosthis, with the project key,
instead of answering unknown rule. A rule a person approved after this release
comes back with its fix, marked as not built into this release; an id Boosthis
has no live rule for gets the unknown-rule answer as before; and when Boosthis
cannot be asked, the answer says the rule may still exist. The rule list adds
the approved rules for this language once Boosthis lists them, and until then
says rules approved since this release may be missing.

1.0.0-alpha.150 — Four rules Boosthis already served as learned rules are now
in the kit's own rule book: make an image's error handler safe to run twice
and safe when what it reads is missing, so a fallback image cannot loop; keep
a route change responsive by painting a minimal screen first and deferring the
rest; catch uncaught errors and unhandled promise rejections at the boundary
that threw them and move the page to a defined safe state; and bound a slow
request with a timeout, cancellation once it goes stale, and capped retries
for idempotent requests only. The first and third came from browser crash
reports, the other two from findings that recurred across separate registered
projects. Rule book only: nothing new is measured and nothing new is sent.

1.0.0-alpha.149 — A page-load reading now counts only time a visitor waited.
A paint after the page was first hidden, after the first input, after a
restore from the back-forward cache or after a development hot update is no
longer part of the load, and a prerendered page is timed from the moment it
was opened. A kit that starts in a page that finished loading a while earlier
— a late script, or a hot reload — does not grade that page and says so once
on the console. Each reading now names its timing (largest paint or first
byte) and how the page was opened; Boosthis keeps both and shows the timing
beside each reading.

1.0.0-alpha.148 — A browser whose credential another copy of your site's
install replaced now renews it when Boosthis says so: it asks again without
the old one, keeps the new one for the next visit (script tag and module
alike) and sends the refused batch once more. This starts when Boosthis
begins sending that reason. A refused upload is said once per page load and
reason on the console, never with a key or credential. A revoked key waits
for the hourly retry instead of asking on every upload, a closing account has
its own sentence, and the guides say forget() clears this browser and asks
Boosthis to delete the data of the install every visitor's browser shares; its
owner erases an install from the dashboard.

1.0.0-alpha.147 — Four new security rules. Three are for a page that reads its
database directly, as with Supabase or Firebase: give every table the page
reads directly a row policy — never ship with it switched off; keep private
columns out of tables the page reads directly — a narrower query protects
nothing; and base every row rule on the verified user — never on a field the
user can edit. The fourth: put stored text into the page as text — never
through an HTML sink. Each names what to write instead. Rule book only:
nothing new is measured and nothing new is sent.

1.0.0-alpha.146 — Each upload and the registration now carry an anonymous
visit tag in one header, `X-Boosthis-Visit`: a random value kept in
`boosthis:visit-tag:v1` and replaced every UTC day, so Boosthis can estimate
how many browsers sent readings and how many were refused instead of showing
whichever one arrived last. It rides the requests the kit already makes, the
page-exit send included. Where the visitor's storage consent or the browser
keeps nothing, it lasts one page and is counted as a page load, never as a
browser. Boosthis never stores the value itself; `forget()` and switching
storage consent off erase it.

1.0.0-alpha.145 — Answers from Boosthis are now read under a size ceiling and
a time limit while they arrive: registration, uploads, live readings, fix
text, the rule book, the owner pass, the kill switch and the account panel's
sign-in and claim answers. An answer that is too large, too slow or not JSON
counts as a failed exchange: its body is dropped quietly, an upload's status
still decides whether it landed, and the kit asks again on its normal
schedule.

1.0.0-alpha.144 — Your pages now join the map of your project with no code.
A call a page makes to its own origin carries the trace headers
(`x-boosthis-trace`, `x-boosthis-parent`, `x-boosthis-trace-elapsed`) and is
recorded as one traced step under that page's name, so your server's step
for the call draws a line from the page to the route. Up to 20 calls are
joined at once, then one a second; a call past that is sent exactly as
written. A call to any other host carries nothing unless you name that host in `tracePropagateTo`; set
`traceSameOrigin: false` to send every call exactly as written. The page map
is now sent by default: page names and pairs of page names, each with a
count. Set `sendPageMap: false` to keep it on the device. Both ride the
consent and upload gates everything else the kit sends rides, and nothing
new is stored in the visitor's browser.

1.0.0-alpha.143 — Largest Contentful Paint is sent as its own reading,
`largestPaint`: the 75th percentile of each document's LCP across the
visit's page loads, with its sample count, graded on the published bands
(good up to 2.5 s, poor above 4 s). It settles the way paint readiness
does, and a browser that reports no LCP entry leaves the reading out.

1.0.0-alpha.142 — A page's start-up no longer decides a grade: the documents
of one visit share a settle clock, kept in `boosthis:settle.v1` when the
visitor's storage consent allows, and a meter that has not settled reads as
still settling (`settleRule: 1`). Event-loop lag, layout shift, font wait and
page weight measure what they are named for, and visitor hardware, protocol
mix, initiator balance and AI spend are reported without a grade. Rage-click
bursts are counted after the page settles.

1.0.0-alpha.141 — Rage clicks count only presses the page did not answer: 3
presses in one 64px square within 700ms, each with no page change, address
change or scroll within 700ms, or an answer at 300ms or slower. Bursts the
page answered are sent as `answeredBurstCount` and the tile says how many
were set aside; a double- or triple-click selecting text is not counted. Mark
an element `data-boosthis-rapid-press` (a canvas keypad, sound-only
feedback) and presses inside it never form a burst or count as dead clicks.
Readings from older kits lose their grade and keep their counts.

1.0.0-alpha.140 — The bubble needs the owner link now: a one-time link from
your project's page on Boosthis is exchanged for an owner pass and removed
from the address bar, and the bubble draws only while Boosthis confirms that
pass. Only localhost and loopback addresses show it to everyone now, and a
stored Boosthis sign-in alone no longer counts as the owner.

1.0.0-alpha.139 — Uploads are paced per browser, and a slow-down is a pause.
Every tab and reload of one browser shares one upload schedule, kept in
`boosthis:upload-pace:v1`: a reload continues the first-minute ramp instead of
restarting it, a quick run of reloads checks in once (an answer is reused for
15 seconds), and a closing page hands its samples to the next send. A 429
pauses every upload, check-in and registration in every tab until the stated
`Retry-After` (60 seconds when missing), then sending resumes by itself with
the held data first. The panel and the status page call it a pause and say
when it ends, never "Uploads lost". A busy site follows Boosthis's snapshot
timing, and above 5 visitors at once samples and spans come from a share of
visits. With storage held back, pacing stays per page. `forget()` erases it.

1.0.0-alpha.138 — After fixing a crash Boosthis recorded, your assistant can
hand back what worked: `report_unmatched_pattern` now also takes `crash`,
`fix_shape` and `rule_helped`. A person reviews the report; nothing is read
back.

1.0.0-alpha.137 — Errors that come only from browser extensions are set aside:
an error is not kept, sent or counted as a crash when its file and every stack
frame are extension addresses (Chrome/Edge, Firefox, Safari). One frame from
the page's own code keeps it, and so does an error with no stack. The
browser's ResizeObserver loop notices are set aside too, by exact wording with
no error object. Crash-free carries `setAsideExtension` and `setAsideNotice`
(0 included) and the panel says how many. A "Script error." stays counted and
says why its details are hidden. A development build or a page on localhost
reports as a separate development install of the same project; its crashes
stay out of the live site's crash-free and alerts. No extension id, name or
file leaves the page. See [PROBLEM-REPORTING.md](./PROBLEM-REPORTING.md).

1.0.0-alpha.136 — Crashes survive page loads. Uncaught `error` events and
`unhandledrejection` events are kept synchronously in localStorage, including
before activation. Boundary-caught `reportRenderError` errors are non-fatal:
they are never kept, uploaded or counted as crashes. Each sealed batch has one
delivery id reused on retries, so a late or repeated upload counts once.
The next load offers saved crashes first, and credential arrival offers them
again; retries follow 5s, 30s, 2m, 10m and 30m. Page exit uses a below-64-KB
keepalive request without an AbortSignal. Crashes older than 30 days are removed
with an explanation. Crash-free reads durable rolling 24-hour page-load history.
Storage keys: `boosthis:crash-pending:v2` and `boosthis:crash-history:v1`.
Blocked or full localStorage falls back to this page's memory and says once
that the crash will not survive. Withheld consent erases this state.
The browser kit has no native capture: it sends neither `nativeCrash` nor
`notResponding`. See [PROBLEM-REPORTING.md](./PROBLEM-REPORTING.md).

1.0.0-alpha.135 — The install guide's no-badge rule now says where a badge can
appear at all — a development host, or a browser the owner switched on with
?boosthis=on — so a live site's visitors seeing none is no longer read as a
kit that never started. This changelog's alpha.134 entry had repeated the
alpha.133 consent text under the wrong number; each of the two now describes
its own release.

1.0.0-alpha.134 — The bubble is for the site owner only. Visitors of a live
site never see it: it shows to everyone only on a development host
(localhost, *.local, *.replit.dev), and on a live site only in a browser the
owner switched on by opening any page with ?boosthis=on (?boosthis=off
forgets it) or where they signed in to Boosthis through the bubble. No
setting, attribute or code option shows it to every visitor any more; on a
live site the startup line says how to show it on your own browser.

1.0.0-alpha.133 — An end-user consent gate. enableTelemetry({ endUserConsent }),
setEndUserConsent() and getEndUserConsent() (and data-consent on the script
tag) let your cookie banner start the kit inert, switch it on, and switch it
off — switching off ERASES what the kit put in the visitor's localStorage
rather than merely stopping new writes. memory-only measures and uploads
while keeping nothing on the device; readings that need state across a load
go absent rather than being guessed. The default is granted, so an unchanged
install behaves exactly as before. respectDoNotTrack (off by default) starts
withheld when the browser sends DNT or GPC.

1.0.0-alpha.132 — The delivered package omits monorepo-only test dependencies
so a clean install needs no kit-file edits.

1.0.0-alpha.131 — The kit's generated NOTICE now travels beside its
licence in each download.

1.0.0-alpha.130 — An axis band with reversed good and poor constants, or a
non-finite endpoint, is now refused with a named error instead of being scored.

1.0.0-alpha.129 — The kit now times the whole wait a person sits through after
they click something: from the click until the view it opened produces its own
measurement, rather than stopping at the moment the address changed. Both
halves are reported beside it, the wait before anything appeared and the time
the new view then took. A click that never reached a timed view is counted and
named rather than dropped: one count for a view that opened too late to be
joined, one for a click no view followed, and one for a view that ended with no
measurement of its own. A view with no reading of its own is never given an
earlier view's number.

Making that work in a real browser fixed something older. A browser stops
reporting its main paint measurement at the first thing a person clicks — that
is the measurement's own rule — so a kit waiting for the next paint after a
click waits for one that never comes. That is what this kit was doing: on a
real Chrome its soft-navigation reading produced no number at all, and every
view opened by a click was filed as having no measurement. The browser does
measure those views, and reports the timing on the view-change record itself,
which is where the kit now reads it. Because that measurement begins at the
click, it is used as the whole click-to-screen wait rather than added on top of
the wait already counted, and the two halves still add up to it.

1.0.0-alpha.128 — The guide now names every place this kit reads inside the
tab, and the opt-in body-error check keeps to the limit we publish. The guide
named one read — the AI-call meter's prompt prefix — and called it the only
body the kit reads, which was wrong: the same meter reads the provider's
streamed reply for the token counts it states and takes its own copy of a
refusal to say which kind it was, and a fixed list of headers is looked up by
name for the content type and a hosting platform's cache verdict. The cookie
check other kits ship is not one of them: a tab cannot see the Set-Cookie
lines your server sends, so this kit never reads a cookie at all. None of it
is uploaded. The body-error check asked for
a declared length and then accepted a reply that declared none, because an
absent header reads as zero; it now requires a real declared length of 64 KB
or less before a copy is read, and still drops anything longer once it
arrives. The one behaviour change is that an answer whose length the server
never declared is no longer read, so it can no longer be counted as
error-shaped.

1.0.0-alpha.127 — The kit now says so when the dashboard is overriding the
sharing mode your code asked for. `issuesOnly` is your setting, but a
project's "Full telemetry" switch wins in both directions — on forces full
mode even where the code asked for reduced, off forces reduced even where
the code asked for full — and nothing said so, so a developer could read
their own source and believe something false. The kit now warns once, in
the browser console, naming BOTH what your code asked for and what is
actually in force — including when the switch is flipped mid-visit. It also
reports the mode your code asked for when it registers, so your dashboard
can show the two values side by side rather than leaving you to guess what
turning the switch off would leave behind.

1.0.0-alpha.126 — The guide and README now say plainly what this kit puts into
the app it is installed in, before you ship it rather than after. The floating
bubble is described as on by default, with the setting that hides it named in
the same breath, and no guide now calls it a mandatory setup step. Every
address the kit mounts on the host app is listed with who can reach it, what
it answers and, where it is open to the public, why it is open and what it
deliberately leaves out. Nothing about what the kit measures, sends or
displays changed.

1.0.0-alpha.125 — A crash now says which page it happened on. This kit
captured crashes from the beginning and recorded only a signature and two
correlation ids, so a developer was told the app crashes and left to find
where, while a slow interaction on the very same page arrived labelled. The
page is read at the moment of capture from the address the document is on,
never from the last page seen, and it travels under the same naming rule and
the same privacy screen an interaction's label already goes through. A failure
raised before any page was readable says so in its own word rather than
borrowing one. Recurring problems, swallowed errors, failed outbound calls and
leak findings carry the same field.

1.0.0-alpha.124 — One rule now decides what a page is called, shared with every
other Boosthis kit. This kit already ran its page map, inventory and timings
through one normaliser; what changed is the number and the behaviour. The limit
moves from 120 characters to 100 — the same bound the server enforces, so a
name is never quietly reshaped on the way in — and an over-long name is now
refused rather than truncated, because two pages agreeing for their first
hundred characters were being filed as one, and a truncated name is one nobody
can search their own codebase for.

1.0.0-alpha.123 — Adds separate readings for promise rejections and rejections
handled late, plus an honest view of background work the page can observe.
Worker and service-worker work whose task boundaries stay hidden is counted as
an unattached system instead of being reported as healthy.

1.0.0-alpha.122 — Adds passive scheduling readings for platform-observed long
tasks, slow callbacks seen by the existing timer wrappers, and p95 event-loop
lag sampled on the existing timer-health cadence. Unsupported and warming
sources remain absent rather than reporting zero.

1.0.0-alpha.121 — An expired access answer no longer silences a copy of the
kit that never registered. Registration is the only way back from an expired
answer, and the same check stood in front of it, so an install holding no
credentials could be left unable to register — and it reported that as the
Boosthis API being unreachable when nothing had been sent. An expired answer
now silences only the install that earned it, which can check in and recover.

1.0.0-alpha.120 — Storage Speed and Storage Failures now identify their
readings as belonging to this page's own storage area, so uploaded readings
cannot be mistaken for device- or machine-wide storage measurements.

1.0.0-alpha.119 — Two corrections to what this kit measures and what it says
about a page. First, a page address whose identifier carries a word in front
of it is now replaced before the label is kept. Until now a segment was only
treated as an identifier when it was nothing but digits, a UUID, or a long
run of hex on its own; an address like
/snapshot/mcp-2066268df023bf5e9dd7aeb0 therefore travelled verbatim, because
"mcp-" is not a hex character. A long hex run anywhere inside a segment now
collapses to :id, so two visits to the same page with different identifiers
land on one label instead of two — and the identifier stays on the device.
Second, this kit's own uploads to the Boosthis API are no longer counted as
outbound calls your app made. The browser records every request the page
issues, including ours, so on a site served from the same origin as this
kit's own endpoint our uploads were being measured as your app's network
work and then reported back to you. They are now skipped where the browser
hands them to us. Nothing else changes: page weight still counts the whole
page, this kit included.

1.0.0-alpha.118 — The README that ships beside this kit now states the version
you are actually running. It had been left at 1.0.0-alpha.104 while thirteen
releases went out under it, and the changelog inside it stopped there too, so
the one file that travels with the code described a kit nobody is running.
Nothing this kit measures, sends or shows has changed — the code is identical
to 1.0.0-alpha.117. It is a release rather than a quiet correction because a
corrected file only reaches an installed kit when the version moves; at an
unchanged version every consumer is told it is already current, and the fix
never arrives.

1.0.0-alpha.117 — The badge's count of page views measured can now go past
one. It was read off this page's own in-memory readings, so a full navigation
threw it away and a single-page app never produced a second one: on a live
site, two different pages each showed "1 page view measured". Three things
changed. The kit now closes a page view itself whenever the address changes,
so a single-page app is measured without your app calling flushPageSample() —
keep that call only for screens that change without the address (a drawer, a
wizard step); calling it for a route change the kit already handled is safe
and counts nothing twice. The count is kept in this browser's own storage, so
it spans page loads on this device, and the badge says underneath exactly what
it covers. And the page you are looking at is included once the browser has
measured it, instead of the count always being one page behind.
flushPageSample() also no longer clears this document's paint, layout-shift
and interaction meters, which previously deleted the paint-readiness reading
for the rest of a visit. Nothing new is uploaded: the count is local to your
device and never leaves the page. See PAGE-VIEW-READINGS.md in this kit.

1.0.0-alpha.116 — The kit now says when your app's own shape is why so little
is measured. A reading is taken when a page view ends, so a single-page app is
measured about once a visit however many screens a person moves through: on a
live shop, two storefronts completing the same number of orders produced
hundreds of readings and fewer than ten, and nothing said why. The kit now
reports whether this page was used in place, navigated, sat idle, or could not
be watched — on the badge, in printWebStatus(), and on your project's own
report. It also stops repeating the first page's timing for later screens it
never measured: those are counted as views it could not time, and an app used
in place now uploads on the strength of that activity instead of looking like
an empty page. See PAGE-VIEW-READINGS.md in this kit.

1.0.0-alpha.115 — Housekeeping only: nothing this kit measures, sends or draws
has changed. The shared no-PII vocabulary now carries the screen for
background-job names alongside the one for route labels, so the browser kit's
copy stays byte-identical to the Node kit's and the two can never drift apart
on what counts as a value. This browser kit does not report background jobs,
so nothing here calls it yet.

1.0.0-alpha.114 — The kit no longer says measuring has started just because
Boosthis confirmed the install. A confirmation is permission, not a reading:
on a live shop the kit announced that measuring had begun while our own server
correctly reported that same install as never having measured anything. The
confirmation line now says only what a confirmation proves, and says what
produces a reading: one is taken when a page view ends. If a confirmed install
then goes on measuring nothing, the kit notices by itself and says so, instead
of leaving the earlier claim standing, and it withdraws that line the moment
the first reading is taken.

1.0.0-alpha.113 — The in-page meter panel no longer promises meters this kit
cannot report. Two dozen readings that depend on a browser API, a server
header or page content the visitor never loaded were drawn as rows saying
"measuring…" even where the reading could never arrive, which made a permanent
silence look like a temporary one. Those rows are now drawn only once the
reading actually exists, which is how the meter page on the web dashboard has
always treated them — so the two surfaces list the same meters for the same
app. Nothing new is collected, and no reading changed its value.

1.0.0-alpha.112 — Four readings were saying something about how they were
built rather than about your page. Request Mix no longer counts requests your
page made AFTER it finished loading: a section that refreshes itself every few
seconds, a search box, an infinite list — none of those is how the page was
BUILT, and counting them rated a deliberate live-updating section as bad page
construction. Only resources loaded before the load event are judged now, and
the excluded count is published beside the percentages. Service Worker Control
stops marking every app that simply does not use service workers as needing
work: a page with no registration at all gets no verdict, and the orange one
is kept for the case that is really a finding — a worker registered but not
driving this page. Connection Quality is no longer graded: it describes the
VISITOR'S network, not anything you built, so the round trip and downlink stay
as context beside your results and the score goes. And when the back/forward
cache refuses your page, the kit now names more of the reasons — a request
still in flight, a held connection, a browser-side refusal — and when it
genuinely cannot name one it says so instead of saying "other". A dependency
reading also never publishes a "worst" backend setup while holding a slower
one it did not judge.

1.0.0-alpha.111 — The install guide now says what the AI-call meter reads out
of an outbound prompt, in the same words our public pages use: to tell
repeated prompts apart it reads up to the first 4,096 characters of the
request body — in a browser, inside the visitor's own tab — and folds it into
a single number, with no body text stored, uploaded or recoverable. It was
true before this release and it was stated only where we sell the product,
which left the person deciding whether to ship it reading it last. Nothing
measured changed: no reading was added, removed or reworded.

1.0.0-alpha.110 — Two new readings about your page's own saved data — how long
localStorage and sessionStorage operations take, and what share of them fail.
A browser app has no database to wait on, so a slow or refusing local store is
the nearest honest answer to “what about my data access?”, and a store that
answers instantly and throws on every write looks perfectly healthy if only
its speed is shown. Both are OFF unless you switch them on: set
BOOSTHIS_STORAGE_METER, because this watches your own data path. The kit wraps
get/set/remove, calls your original through it, and re-throws exactly what it
threw — a full quota still reaches your own handler unchanged. Only durations
and outcomes are recorded: never a key, a value or a size. IndexedDB is
deliberately not watched, and the tile says which store it is about. With the
switch off, storage walled off, or too few operations, both readings stay
absent rather than reporting a zero nobody measured. Neither feeds your Speed
score.

1.0.0-alpha.109 — Your project page can now say WHICH control was pressed and
did nothing. This kit has counted dead presses for a whole page since it
shipped — “seven presses did nothing yesterday” — which you could neither find
nor act on. That count is unchanged, and beside it each control now carries
three tallies: presses that changed something, presses that changed nothing,
and presses the kit could not judge either way. It reuses the dead-click
verdict already being computed, so no new listener, no new request and no
extra work on the page. A control that changed something is reported as having
RESPONDED, never as correct — the kit sees that something changed, never
whether it was the right thing. Nothing about the press travels: no
coordinate, no time of day, no order, and still no label, text or value of any
kind. `setControlCensusEnabled(false)` or `BOOSTHIS_CONTROL_CENSUS=0` switches
it off with the rest of the census.

1.0.0-alpha.108 — The floating panel this kit serves inside your app now fits
a phone. It is capped against the screen width instead of a flat 300px, and
shades its top and bottom edge when there is more to scroll — a phone draws a
scrollbar only once you are already swiping, so there was previously nothing
to say the panel continued past the edge. Nothing measured changed: no reading
was added, removed or reworded.

1.0.0-alpha.107 — A registration that is still being retried no longer reads
as one that failed. The kit decides within about half a minute, but it keeps
asking for minutes afterwards — and a real app that registered three minutes
in had already been written up as broken. The status readout now separates
“not registered on this page yet, still trying” from “it never registered, and
here is what stopped it”, the waiting line says how long the kit keeps trying,
and a later success plainly withdraws the earlier line instead of standing
beside it. Registration is durable, so after a reload the readout also says
when this browser last watched Boosthis accept this install — marked as the
browser’s own record, never as Boosthis’s answer. The kit no longer says what
your dashboard has or has not received: it reports what THIS page sent, and
points at your project’s connection check to settle the rest.

1.0.0-alpha.106 — Your project page can now show how many controls a page HAS,
not just the ones somebody happened to press. The kit asks the rendered page
what controls it has — the same trick as reading your router’s route table,
one level down — so a button that exists and has never once been pressed is
visible, and so is one that leads nowhere. A control travels as a HASH OF ITS
POSITION in the page and nothing else: no label, no text, no value, no id,
nothing anyone typed. It is bounded (at most 300 listed, and it says so when a
page is bigger), it rides the readings you already upload, it adds no listener
and no new request, and `setControlCensusEnabled(false)` or
`BOOSTHIS_CONTROL_CENSUS=0` switches it off.

1.0.0-alpha.105 — A page that calls a model this kit does not recognise — a
model you host, a private gateway, a regional endpoint — no longer looks like
a page with no AI in it. A POST whose path is an inference shape is counted,
and the AI Wait row appears saying it cannot be measured, carrying that count
and nothing else: no address, no path, never timed, scored or priced. Naming
the endpoint in `startWebVitals({ aiEndpoints: […] })` still turns those calls
into a full reading.

1.0.0-alpha.104 — A page that calls a model this kit does not recognise —
a model you host, a private gateway, a regional endpoint — no longer looks
like a page with no AI in it. A POST whose path is an inference shape is
counted, and the AI Wait row appears saying it cannot be measured, carrying
that count and nothing else: no address, no path, never timed, scored or
priced. Naming the endpoint in `startWebVitals({ aiEndpoints: […] })` still
turns those calls into a full reading.

1.0.0-alpha.103 — Guide only; nothing this kit measures, sends or decides
changed. A page can already have its own model endpoint measured — a model you
host, a private gateway — by naming it in `startWebVitals({ aiEndpoints: [...]
})`, but the setup guide never mentioned it, so the only place that fact
appeared was a release note nobody reads twice. The settings reference now
carries the option, what happens without it (the AI rows are absent, which
looks exactly like a page with no AI in it), and why there is no environment
flag for it: browser code cannot read a server-side setting.

1.0.0-alpha.102 — The map of your pages can now reach your project page,
but only if you ask for it. Set `sendPageMap: true` and the map the kit
already draws in this browser rides the readings you already upload, so the
paths between your pages appear in the map section of your project page. It
is off by default and nothing we send back can turn it on. Only page names
and pairs of page names travel, each with a count, capped on the device and
screened exactly like the page labels you already send — the control that was
pressed and the gesture that moved someone never leave the browser, and there
is no field on the wire that could carry them. It obeys every gate the upload
it rides obeys: with telemetry off or the kill switch set, no map is sent, and
in issues-only mode it travels only if you have also switched on meter
sharing.

1.0.0-alpha.101 — Hand the kit your router with `registerRouter()` and its
whole route table is read when a report is taken, so the app map can show
pages nobody has visited — marked “not seen”, never “dead” or “unused”. Vue
Router and React Router answer; an unfamiliar shape reports nothing rather
than a guess, and no source file is ever read. Route patterns only.
`setRouteListEnabled(false)` switches it off.
1.0.0-alpha.99 — A correction to the failure counts added in the previous
release. A browser can end one request more than once — an error after a
partial load, a timeout racing a cancel — and older code reuses one request
object for several calls. Either could add a second answer to an address’s
count, or file a new answer against the address of the call before it. Each
send is now counted exactly once, and only against the address it was actually
sent to. Nothing new is watched and nothing new is sent.

1.0.0-alpha.98 — The calls your page makes can now say which ones FAILED, not
only how slow they were. The kit already decided whether a response counted as
a failure and already knew how to build a route label for it; it now keeps the
two together as a count of answers seen and answers failed. A call you
cancelled or that timed out is your page's own doing and is counted as neither.
The labels themselves never leave the browser — only four numbers do — and
nothing new is watched, so the page does no extra work. A route nobody called
reports nothing rather than a zero.

1.0.0-alpha.97 — A page you open for the first time now reaches your
dashboard in seconds instead of waiting out the fifteen-second upload timer.
The kit keeps a small in-memory note of the parts and calls it has already
seen in this page session; the first sight of a new one sends the batch
early, a burst of new pages is coalesced into one send, and it will not fire
more than once every five seconds. Repeat traffic never triggers it, so a
busy production page falls straight back to the ordinary timer. Nothing
extra is sent and no new address is called — the same upload, earlier.

1.0.0-alpha.96 — The map of your site now draws itself as pages get opened.
The kit already watched every page change; it now keeps the paths between
pages as a counted list beside the pages themselves, saves that map in this
browser, and adds to it on every reload — so the picture fills in as the site
gets used, with no code on any page and no router setup. The panel says how
many pages have been seen and how many routes you registered have not been
reached yet, and says when the map is a subset because it hit its cap. Nothing
new is sent: page names and paths stay in the browser exactly as before, and
no map is written while you are navigating — it is saved when the page is
hidden or closed.

1.0.0-alpha.95 — the panel and the status readout now answer “press this, it
opens that”. The click watch that already ran keeps which control was
pressed and joins it to the page that followed, so both surfaces draw the
pairs themselves — WHICH control opened WHICH page — and a control pressed
twice with nothing happening is shown as a dead end. A control is named only
by a code-defined test id (data-testid and friends); its text, accessibility
label, value and position are never read, and a control without one still
draws its arrow, counted as unnamed rather than dropped. An arrow is an
in-page navigation, and a press overtaken by a later one inside the same
window is counted but joined to nothing. All of it stays on the device;
nothing about a control is uploaded.

1.0.0-alpha.94 — Wording only; nothing the kit measures, sends or decides
changed. A comment in the kit's own source named a number of kits that was
two releases out of date. It now says “every kit”, which cannot go stale.

1.0.0-alpha.93 — A row with no score now says which silence it is. A reading
this browser cannot take reads “not available here”, a row that is
deliberately never graded reads “no score by design”, and only a row still
gathering data reads “pending” — which used to be the one word for all three.
Nothing measured changed.

1.0.0-alpha.92 — A fast route can no longer be reported as steady. Requests
are timed in whole milliseconds, so a handler that finishes in under half a
millisecond records as 0ms, and a route whose earlier window is all zeros
leaves the baseline axis nothing to divide by. Those routes were counted as
examined and then dropped in silence, so an app whose sub-millisecond route
suddenly took 100ms still scored 100 and read “steady”. A route that cannot be
divided by is now reported as too fast to compare, the steady count names only
the routes actually compared, and an app where every route was too fast says
it cannot judge rather than scoring full marks. Routes slow enough to compare
are judged exactly as before.

1.0.0-alpha.91 — build age no longer mistakes a server-rendered page's response
time for its build timestamp and calls it good. `document.lastModified` is used
only when distinguishable from navigation; otherwise `patchLag` reports build
age as unknown.

1.0.0-alpha.90 — the machine-wide rule cache is now published atomically —
written beside the target and renamed into place. Every Boosthis process on a
machine writes that cache, and a half-written file read back as no cache at
all, costing everyone a refetch until one process won a complete write.
Nothing about what is measured or sent changes.

1.0.0-alpha.89 — a page with NO build step can now be installed from this kit
alone. The files here are TypeScript modules that need a bundler, and a
project without one — a single index.html, a page written in a chat, a hosted
site builder — used to find nothing in the kit naming the pre-built script
that exists for exactly that case, because that address was only in the
written install guide. QUICKSTART.md now ships beside these files and names
it, this readme leads with it, and both are built from the one place the
address is written down, so no copy can name a different one. Nothing the kit
measures, sends or shows changes.

1.0.0-alpha.88 — a slow page can now name the hop that caused it. A measured
page interaction carries its own identity, and a fetch it makes sends that
identity alongside the trace id it already sent, so the backend hop is
recorded as a child of the page rather than merely alongside it. The dashboard
waterfall nests accordingly and names the hop responsible for the end-to-end
time. Both fields are optional, so a backend running an older kit still
produces a valid, readable trace. The ids are random 16-character tags —
nothing about them is derived from your data.

1.0.0-alpha.87 — this kit no longer announces a registration and then goes
quiet. After the startup line it holds itself to a deadline: if the
registration never happened — refused before anything was sent, thrown away
by an error on the page, or never even scheduled — it says so in one line
naming the cause, keeps trying in the background, and says once when it
finally goes through. A registration that was never actually sent, because
this project is locked or switched off, is no longer reported as registered
on any surface, and the status readout separates "announced, never
registered" from "registered and measuring". A batch of measurements that
never left the page, for that same reason, is no longer counted as delivered
either, and it never clears a real upload failure the page had already
reported. Measurements are held either way, exactly as before.

1.0.0-alpha.86 — a page that calls a model provider itself now gets the same
three AI readings the server kits report: how long the person waited for each
answer, what the answers cost, and how much of the provider's ceiling is left.
Streamed answers report their time to first words and any stall without the
answer ever being held. Where the browser is not allowed to read the
provider's rate-limit headers, the headroom reading says so instead of showing
a comfortable zero, and a provider call made through something the kit does
not wrap is counted as a blind spot. Numbers only: no prompt text, no answer
text, no key.

1.0.0-alpha.85 — a per-hour or per-minute figure is now published only when
the page watched long enough to earn it: at least a twelfth of the unit, so
five minutes for an hourly rate. Below that the count and the window are
still reported — a crash or a rage burst still shows the moment it happens —
but the projection and the rating drawn from it wait. Every published rate
now says how long it watched.

1.0.0-alpha.84 — Six new rules cover browser AI calls: bound `fetch` with
`AbortSignal.timeout`, honor `Retry-After`, start independent generations with
`Promise.all`, share one request-scoped Promise per logical prompt, keep
reusable prompt prefixes byte-stable for provider caching, and request then
consume streamed usage with `stream_options.include_usage`. Rule book only:
nothing new is measured and nothing new is sent.

1.0.0-alpha.83 — A deliberately cut project credential now makes the installed
kit stop and report the server's non-active status immediately. An ordinary
unauthorized response or an unreachable server still preserves the cached
entitlement, so recoverable installs are not stranded.

1.0.0-alpha.82 — Five new rules about calling an outside service from the
page: a fetch with no deadline (sign-in first), retries with no cap,
independent calls made one after another instead of together, a call the
visitor waits on but never sees, and a background-sync retry that never gives
up. Each names the fix, and is written against the browser's own mechanisms —
`AbortSignal.timeout`, a capped retry, `Promise.all`, `sendBeacon` and an
attempt ceiling. Rule book only: nothing new is measured and nothing new is
sent.

1.0.0-alpha.81 — a call the kit cannot honestly place on its trace is now left
out instead of drawn at the start of the action. The kit remembers where each
trace began in a table of fifty; a page with more calls in flight than that
could lose its own trace's start and report the next call at zero — a bar at the
left edge that can out-rank the layer the action really began on. Those calls
are now withheld and counted instead of reported in the wrong place.

1.0.0-alpha.80 — shows how much of what a page loads is reused instead of
fetched: the share served from the browser's own cache, what the rest cost in
bytes and time over the network, and this site's own hosting cache verdict
where a reply declares one. Replies from other origins are left alone —
somebody else's cache is not yours. Sizes, durations and verdict words only,
never an address. Additive: no change to your speed score.

1.0.0-alpha.79 — reports the problems it keeps seeing in real visitors'
browsers: a slow page view, a call that is slow or keeps failing, a burst of
identical calls at once, a live connection that keeps reconnecting or has gone
quiet. Fix outcomes are reported too, so a change that worked can be
recommended to someone else. Nothing new is measured — each report is read back
from a reading this kit already takes. Only a hashed signature travels (kind,
severity band, rough count); never a page address, URL, value or code. Reports
ride the same terms as the kit's other uploads, including surviving the page
being closed.

1.0.0-alpha.78 — the kit's own readme now travels with the code. This kit is
written straight into your project, with no package page or repository link
beside it, so until now the web kit arrived as source files with nothing next
to them saying what it is or what each version changed — the only runtime that
shipped without one. Nothing this kit measures, sends or shows has changed.

1.0.0-alpha.77 — says how far this app is from its own backend, measured on
connection setup alone — opening and securing a new connection, before any
request bytes — so a backend that is merely slow to answer is never called
distant. Own backend only: a browser hides these phases for other services
unless they opt in, so this kit stays silent about them rather than showing a
zero. Reused connections are skipped and several genuinely new ones are needed
before it speaks at all. Only timings leave the page. Pro plans and above.

1.0.0-alpha.76 — connections a page holds open (chat, live dashboards,
presence, notifications, streamed answers) are now measured: how many are open,
how long they last, how they end and how often they come back. A connection
silent far past its own rhythm is reported as likely dead; an ordinary pause is
left alone; where there is no rhythm to judge by the kit says so. Reconnect
storms and reconnect-on-every-screen are named separately. Counts only, never
message content. A page that holds nothing open reports nothing here.


1.0.0-alpha.75 — keeps this kit's privacy guard in step with the new AI-call
reading: three token-count field names are now allowed through by exact name.
Only the Node and Python kits ever send those fields, so nothing this kit
measures, sends or shows changes.

1.0.0-alpha.74 — outbound calls are now watched where they START, so a call that
hangs and never comes back is counted instead of vanishing, and hung, timed out,
aborted and failed calls are told apart. Each call is also filed under a safe
group drawn from a closed vocabulary (never its address), so a project page can
name which backend is slow. Apps where wrapping is impossible keep exactly the
completion-based readings they had.

1.0.0-alpha.73 — startup now names browser capabilities that are unavailable,
so readings omitted for an unsupported browser API no longer disappear without
an explanation.
-->

## Install

There are two installs, and which one you need is decided by one question:
**does this project have a bundler?**

### No build step — a single `index.html`, a page written in a chat, a no-code site

Nothing to download, nothing to compile. Paste one line into every page's
`<head>`:

```html
<script defer src="https://www.boosthis.com/kit.js" data-key="<the project key>" data-install="<a UUID v4 you generate ONCE>" data-project="<friendly name>" onerror="console.error('[boosthis] Boosthis did not load: '+this.src+' never arrived, so nothing is measuring. Check the address, the network, and any Content-Security-Policy.')"></script>
```

`https://www.boosthis.com/kit.js` is the only address there is — the same
runtime as the modules below, served pre-built. Keep the `onerror` handler: it
is the only piece of Boosthis that lives in your own page, so it is the only
thing that can speak if the file never arrives. Make `data-install` once — the
project's Setup page gives this line with it filled in; otherwise run
`crypto.randomUUID()` in any browser console — and use that same UUID on every
page. Never type one or copy one from an example.

Full detail — what a working install looks like in the console, the
Content-Security-Policy line, and the attributes that hide the badge or reduce
what is reported — is in `QUICKSTART.md`, which ships beside this file.

<!-- The address above is checked against src/hostedScript.ts, the one place it
     is written down, by artifacts/api-server/src/routes/__tests__/kitTag.test.ts
     and by the kit packer. Change it there, never here. -->

### With a bundler — the module install

`@workspace/boosthis-runtime-web` is this folder's own package name. It is
**not on any registry**, so point your project at the folder you unpacked
before importing it:

```jsonc
// package.json — plain app
"dependencies": {
  "@workspace/boosthis-runtime-web": "file:./lib/boosthis-runtime-web"
}
// …or, inside a pnpm/npm workspace repo:
"dependencies": {
  "@workspace/boosthis-runtime-web": "workspace:*"
}
```

Then mount the floating bubble when wiring Web Vitals, in your app entry
module:

```ts
import { startWebVitals } from "@workspace/boosthis-runtime-web";

startWebVitals({ bubble: true });
```

The floating bubble is for the site owner only: visitors of a live site
never see it, whatever is set. It shows on the developer's own machine
(`localhost` and loopback addresses), and on a live site only in a browser
switched on with the owner link from the project's page on Boosthis, while
Boosthis confirms that browser's pass. `?boosthis=on` does nothing on a live
site. `?boosthis=off`, or the switch-off control in the bubble, switches
that browser off. `BOOSTHIS_BUBBLE` set to 0 hides it everywhere and the kit
carries on measuring; `BOOSTHIS_DISABLED` stops the kit altogether. Each
name is read from the environment where this runtime has one, and otherwise
from a value of the same name on the host.

The full visibility precedence is: `BOOSTHIS_DISABLED`
(fail-closed kill switch), then the trimmed, case-insensitive
`BOOSTHIS_BUBBLE` directive (`1`/`true`/`yes`/`on` shows;
`0`/`false`/`no`/`off` hides), then legacy `BOOSTHIS_NO_BUBBLE` (hide), legacy
`BOOSTHIS_FORCE_BUBBLE` (show), the `bubble` code option, and finally wanted.
"Show" and "wanted" decide whether the bubble is wanted at all; who sees a
wanted bubble is decided after them, as above, and no setting widens it to a
live site's visitors.
A settings entry may be added as an extra; it does not replace mounting the
bubble.

### Angular (standalone or NgModule apps)

Angular takes the same calls in three places, placed so the app stays stable
and its first download stays small.

**1. `src/main.ts`: start the kit before bootstrap, hand it the router after.**
The kit loads with `import()`, so it is not in the app's first download.

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Put in by the build command (ng build --define), never typed here.
declare const NG_BOOSTHIS_PROJECT_KEY: string | undefined;

const boosthis = import('@workspace/boosthis-runtime-web').then((kit) => {
  kit.startWebVitals({ bubble: true });
  kit.enableTelemetry({
    installId: '<the install id made once for this site>',
    inviteKey: typeof NG_BOOSTHIS_PROJECT_KEY === 'string' ? NG_BOOSTHIS_PROJECT_KEY : undefined,
    endpoint: 'https://www.boosthis.com/api',
    appName: '<a friendly name for this site>',
  });
  return kit;
});

bootstrapApplication(App, appConfig)
  .then((appRef) => boosthis.then((kit) => kit.registerRouter(appRef.injector.get(Router))))
  .catch((err) => console.error(err));
```

An NgModule app keeps its own imports and the kit lines above, and its
bootstrap call hands over the module's injector instead:

```ts
platformBrowser().bootstrapModule(AppModule)
  .then((moduleRef) => boosthis.then((kit) => kit.registerRouter(moduleRef.injector.get(Router))))
  .catch((err) => console.error(err));
```

`main.ts` runs in the browser only, never in a server render. Started or
handed the router inside a server render, the kit does nothing and schedules
nothing, so the render is not held up. In the browser its own timers and
listeners run outside Angular's zone: they never keep the app from becoming
stable and never trigger change detection, with zone.js or zoneless.

**2. An ErrorHandler.** Angular catches the app's errors before the page sees
them, so without one the kit sees only the console line Angular logs.

```ts
import { ErrorHandler, Injectable } from '@angular/core';

@Injectable()
export class BoosthisErrorHandler extends ErrorHandler {
  override handleError(error: unknown): void {
    import('@workspace/boosthis-runtime-web').then(
      (kit) => kit.reportRenderError(error),
      () => undefined,
    );
    super.handleError(error);
  }
}
```

Provide it in `app.config.ts` as `{ provide: ErrorHandler, useClass: BoosthisErrorHandler }`
(an NgModule app: in AppModule's `providers`). The kit sends each error as one
the page caught — its own kind, never a crash — and counts it once: the
console line Angular logs next is the same error, not a second one.

**3. The project key, at build time.** The Angular CLI inlines no environment
variable, so the key goes in through the build's own define flag:

```sh
ng build --define "NG_BOOSTHIS_PROJECT_KEY='$NG_BOOSTHIS_PROJECT_KEY'"
```

The same flag works on `ng serve`. `NG_BOOSTHIS_PROJECT_KEY` comes from a CI secret,
or from an untracked local file such as `.env.local` loaded first
(`set -a; . ./.env.local; set +a`). Never a committed file: a committed key
stays in the repository's history and every clone, so it counts as leaked.

**What it adds to the download.** Loaded with `import()`, the kit is not in
the first download: it arrives as its own chunk just after, about the
bundled-module size in the cost section of the served install guide. A plain
top-of-file import puts all of it in the first download, where it counts
against Angular's initial size budget.

With the router handed over, readings, presses and crash places are filed
under the matched route's pattern (`/products/:id`), never under the address,
under either location strategy, hash routing included. The route list takes
the routes in the router configuration; a lazy section's routes join it once
that section has loaded, and until then the list is marked incomplete.

### Errors your framework catches (React, Next.js, Vue, Svelte, SvelteKit)

React, Next.js, Vue, Svelte and SvelteKit catch many of a page's errors
before the window sees them: the page shows a fallback, or logs the error and
carries on, and the kit never learns the error's name. One line in the
framework's own error hook hands each one to the kit. It is sent as an error
the page caught — its own kind, never a crash — so crash-free figures and
crash alerts do not move, and it is counted once: the console line the app
logs for it is not counted again. What the app does with the error, and what
the visitor sees, stay exactly as they were. (Angular's ErrorHandler above is
the same hand-over.)

**React** — in the error boundary's componentDidCatch, beside whatever it already does (with react-error-boundary, the same line goes in its onError):

```tsx
componentDidCatch(error: Error) {
  import('@workspace/boosthis-runtime-web').then((kit) => kit.reportCaughtError(error), () => undefined);
}
```

**Next.js** — in app/error.tsx and app/global-error.tsx (client components), inside the component, beside any effect already there (useEffect comes from 'react'):

```tsx
useEffect(() => {
  import('@workspace/boosthis-runtime-web').then((kit) => kit.reportCaughtError(error), () => undefined);
}, [error]);
```

**Vue** — in src/main.ts, after createApp and after any errorHandler the app sets itself; with no handler of its own, the app's errors are logged exactly as Vue logs them in production:

```ts
const previousErrorHandler = app.config.errorHandler;
app.config.errorHandler = (error, instance, info) => {
  import('@workspace/boosthis-runtime-web').then((kit) => kit.reportCaughtError(error), () => undefined);
  if (previousErrorHandler) previousErrorHandler(error, instance, info);
  else console.error(error);
};
```

**SvelteKit** — in src/hooks.client.ts; an app that already has a handleError adds the import line at its top instead:

```ts
import type { HandleClientError } from '@sveltejs/kit';

export const handleError: HandleClientError = ({ error }) => {
  import('@workspace/boosthis-runtime-web').then((kit) => kit.reportCaughtError(error), () => undefined);
  console.error(error);
};
```

**Svelte** — on each <svelte:boundary> that has a failed snippet (Svelte 5); a boundary with an onerror of its own adds the import line inside it instead:

```svelte
<svelte:boundary onerror={(error) => import('@workspace/boosthis-runtime-web').then((kit) => kit.reportCaughtError(error), () => undefined)}>
```

### Errors thrown before the kit starts (optional)

The kit starts after the page's own code, so an error thrown before it loads
is missed. This line, pasted FIRST in the page's `<head>` (`index.html` for a
Vite or Angular app, `src/app.html` for SvelteKit, the root layout's `<head>`
for Next.js), keeps up to 50 of those errors in memory and hands them to the
kit when it starts, where they are judged exactly like the ones it sees
itself. It stores nothing on the visitor's device and sends nothing by
itself.

```html
<script>(function(w){if(w.__boosthisEarly)return;var q=[],k=function(t){return function(e){if(q.length<50)q.push([t,Date.now(),t==='r'?e.reason:e.error,e.message,e.filename,e.lineno,e.colno])}},a=k('e'),b=k('r');w.addEventListener('error',a);w.addEventListener('unhandledrejection',b);w.__boosthisEarly={q:q,stop:function(){w.removeEventListener('error',a);w.removeEventListener('unhandledrejection',b)}}})(window)</script>
```

A page whose Content-Security-Policy blocks inline scripts can allow exactly
this line by its hash, `script-src 'sha256-9UdX4xPciW2jk3+vDWSk6J+9fM7mn1C9yTgUOfZp9Ik='`; the
hash is of these exact bytes, so the line is pasted unchanged. A page that
skips the line, or whose policy blocks it, works exactly as before.

In Next.js the same script goes in the root layout's `<head>` as
`<script dangerouslySetInnerHTML={{ __html: "…" }} />`, with this body in
place of the dots, unchanged (it holds single quotes only, so the double
quotes around it are safe):

```text
(function(w){if(w.__boosthisEarly)return;var q=[],k=function(t){return function(e){if(q.length<50)q.push([t,Date.now(),t==='r'?e.reason:e.error,e.message,e.filename,e.lineno,e.colno])}},a=k('e'),b=k('r');w.addEventListener('error',a);w.addEventListener('unhandledrejection',b);w.__boosthisEarly={q:q,stop:function(){w.removeEventListener('error',a);w.removeEventListener('unhandledrejection',b)}}})(window)
```

## One codebase can hold more than one project

Set `globalThis.__BOOSTHIS_PROJECT_KEY_WEB__ = "<YOUR_PROJECT_KEY>"` before
starting the kit when this browser app must report to a different project from
another runtime in the same repository. The host global wins over the key
passed to `enableTelemetry` (including a bundler-provided value or the script
tag's `data-key`). `getActiveProjectKeyStatus()` reports the masked key and its
source; it never returns the key itself.

## Your own machine reports as a separate install

A page running a development build (the bundler sets `NODE_ENV` to exactly
`development`) or served from `localhost`, `127.0.0.1`, `::1` or a name ending
in `.localhost` never uses the live site's install. The kit reports under a
development install id derived from the one you passed — the same one for
every developer on the project — with the same project key, and declares it as
`development`. Its crashes stay out of the live site's crash-free reading and
crash alerts, and it never replaces the live site's snapshot; its readings
still reach the dashboard and your AI, labelled as development. Only the word
`development` leaves the page, never the address or port. Any other address —
a local-network address included, which may be a shop's till — keeps the id
you passed.

## Keypads and other widgets that expect rapid presses

Two readings judge presses. **Rage clicks** count a burst — three presses
inside one 64px square within 700ms — only when the page did not answer: no
change on the page, no change of address and no scroll within 700ms of a press,
or an answer that took 300ms or longer. A keypad that answers every press is
not rage; the tile counts those bursts as answered and sets them aside, and a
double- or triple-click that selects text is not counted at all. **Dead
clicks** count a press on a control when nothing on the page changed afterwards.

Some widgets answer in a way the kit cannot see: a keypad drawn on a
`<canvas>`, or a button whose only feedback is a sound. Mark the element with
`data-boosthis-rapid-press` and presses on it, or on anything inside it,
never form a rage burst and are never counted as dead clicks:

```html
<div class="keypad" data-boosthis-rapid-press>
  <canvas id="pin-pad"></canvas>
</div>
```

Any value works, an empty one included; only the attribute's presence is read,
in the visitor's browser, and nothing about the marker leaves the page — no
coordinate, no element and no separate count of marked presses. A marked
control is still recorded as pressed in the control census, with no verdict on
whether it answered. Do not mark a Pay or Charge button that answers on
screen: a button that stops answering while someone keeps pressing it is
exactly what the rage reading exists to show you.

## Calls that wait on purpose

A long-poll asks the server to hold the call open until it has news — 25
seconds, say — and then answers. Timed like any other call it reads as hung
after 15 seconds, and its whole wait lands in the page's slowest calls. Name
such calls and the kit leaves their time out:

```ts
startWebVitals({ waitsOnPurpose: ["/api/updates/poll", "/api/rooms/:room/wait"] });
```

With the script tag, add the same names to the tag, separated by spaces:
`data-waits-on-purpose="/api/updates/poll /api/rooms/:room/wait"`.

A name is the call's address without the query: a path on this site or a full
address. Text written as `:name` stands for the text of one segment. Up to 10
names; a longer list is refused whole, and a wildcard, a prefix, a pattern, a
host on its own or the kit's own routes are refused one by one, with a console
line naming the entry by its position. A named call is never counted as slow,
stalled or hung, and its time stays out of the network readings, the call
groups and the typical time of your own back end; it still appears in call
traces, marked as waiting on purpose, and its failures still count. The names
and addresses are compared inside the page and never leave it: the network
reading carries four counts — names held, names matched, calls kept out and
the longest wait.

Event streams need no name: a response sent as `text/event-stream` or
`multipart/x-mixed-replace` is timed to its headers, whether `fetch` or
`XMLHttpRequest` made it.

## What is this install actually doing?

`printWebStatus()` prints the kit's status readout — the browser equivalent of
the `/_boosthis/status` page a back-end kit serves: kit version, install id,
the masked project key and where that value came from, and whether Boosthis
says this app is registered (`yes`, `Can't tell right now`, or a `no` that says
whose no it is — Boosthis has no such install on file, or Boosthis never
started on this page), plus the reason sentence when something was refused.
`webStatusLines()` returns the same lines as an array. Neither returns the
project key, a token, or any server text.

The `Announced registering` row below it is about THIS page load, and it keeps
two states apart that used to read as one: `not registered on this page yet,
still trying` (the kit is still asking on its own — a page that registers three
or four minutes in is normal, so give it about ten minutes) and `but it never
registered on this page` (nothing will change until somebody changes it, and
the sentence below says what). A registration is durable, so after a reload the
readout also shows `Registered before in this browser` when this browser has
watched Boosthis accept this install id before — that is this browser's own
record, not Boosthis's answer. Where the local rows cannot be conclusive, the
project's connection check on your Boosthis dashboard is what settles it; the
kit never claims what Boosthis has or has not received.

## Local removal and project locks

`client.forget()` clears this client's install identity and tokens, its upload,
crash and span queues, candidate/baseline records, visit tag, pacing and page-view
tally, and removes its delivery hooks. It then sweeps every `boosthis:`-prefixed
localStorage record and the storage module's memory fallback, so account
sign-in, owner pass, terms, project settings, page map and settle state go too,
and nothing of the site's own. It also asks Boosthis to erase the install's
server data.

A visitor's switch-off runs the same sweep. End-user consent
is memory-only; a withheld choice stays withheld in this page.

A `dissolved` answer uses that prefix sweep locally, without requesting server
erasure. The sweep removes install and rotation records, all stored tokens,
account sign-in and owner pass, registration/consent records and directives,
entitlement cache, queues, crash history, page maps, tallies, pacing,
settle/baseline records, terms, project records and kit settings. Only a new
dissolved marker is written afterwards. Host records are untouched. The kit
does not persist records in cookies, sessionStorage or IndexedDB.

A page measures nothing until Boosthis has answered that the project is active.
A visitor's first page asks a moment after it opens and starts measuring when
the answer arrives; the visitor's later pages start from the stored answer.

Sites loading the kit from our address receive changes within about 15 minutes
of our next publish. A copy inside a site's build changes only when the site
updates that build. Fixed-version addresses are closed.
