# Boosthis Edge


## Outside-call failures and recognised services

Every outside-services group sends six additional counts, including zeros:
`couldNotConnect`, `noAnswer`, `turnedAway`, `tooManyRequests`, `serverError`
and `cancelled`. A non-429 4xx is turned away, not failed. Only a deadline (a
TimeoutError) is timed out: a call the app aborted itself (an AbortError) is
failed and cancelled, as in the Node kit. Before this release it counted as
timed out; the failure share adds both, so scores are unchanged.
Recognised services send only their closed shared-table name, calls, failures
and timeouts: at most four per kind, busiest first, ties by name. Only the
first eight services per kind are remembered; other calls still count unnamed.

On a measured database reading, HTTP database failures also carry `dbFailed`,
`dbCouldNotConnect`, `dbNoAnswer`, `dbTurnedAway`, `dbTooManyRequests`,
`dbServerError`, `dbTimedOut` and `dbCancelled`, all together. The kit sees
HTTP status and fetch errors, not SQLSTATE or driver errors. A non-429 4xx
database reply is not a failed round trip. It reads no database body.

No host, address, path, query, body, HTTP status code, exception text or
exception class name is sent by these readings. A service's fixed name from
the shared table does leave; its address never does.

Boosthis Edge measures request reliability, captures privacy-safe unhandled
handler crashes, access pressure, cookie exposure, cross-origin exposure,
(where the host clock permits it) cold starts, and — by watching the one way
out of an isolate, the platform's `fetch` — the model-provider calls and the
HTTP-reached database work a request does, inside V8 isolate back ends.
It also records one span per request, continuing a trace the caller started so
that your worker takes its place in that trace rather than opening a rival one.
A back end that receives the caller's trace headers joins the same trace; a
request the worker builds for itself does not yet carry them onward.
It uses only web standards and supports Cloudflare Workers, Deno, Deno Deploy,
Supabase Edge Functions, and Deno-based hosted functions.

The kit wraps the function you already have. It does not add a route, page, or
panel. Measurements appear on the Boosthis dashboard.

See `INSTALL.md` for complete platform-specific installation recipes.

Current version: `1.0.0-alpha.41`.

## Crash reporting

When a wrapped handler throws, the kit reports the screened route of that
request, the occurrence time and a delivery id for the in-memory batch. The
original error is rethrown. A refused route name is marked `part-refused`.
An edge isolate cannot retain the crash after eviction (`durable-local-disk`),
cannot infer an abrupt ending without a visible lifetime
(`process-lifetime-visible`), and cannot capture errors before the wrapper
runs (`code-before-kit-loaded`). A hard kill executes no kit code
(`code-at-hard-kill`).

## Background jobs

A cron handler marked with `boosthisEntryPoint("scheduled", …)` is filed as a
background job, so each run appears in the project's list of jobs and on the
back half of the map. Give the marked handler the same `appName`, `installId`
and `slot` options you give `withBoosthis`, so its runs are filed on the same
install as the requests.

The job's name is the `job` option when you give one, written as you want it
read. Otherwise it is the cron pattern that fired the run (`controller.cron` on
Cloudflare, such as `0 3 * * *`), which is what tells two triggers on one
Worker apart. Deno hands a cron handler no pattern, so a Deno cron is filed
only when it is named:

```ts
Deno.cron("nightly rebuild", "0 3 * * *",
  boosthisEntryPoint("scheduled", rebuild, { job: "nightly-rebuild" }));
```

Each run sends four facts and nothing more: the name, how long ago it finished,
how long it took and whether it worked. A name with an email address, a token,
a UUID or a run of six or more digits in it, or one longer than 80 characters,
is refused, counted and said once in the log, never printed and never
shortened. The function's own name is never read. A cron pattern is never
turned into a rhythm: a job is judged against a rhythm only when one is set on
the job's page. Any other marked handler is filed as a job only when it is
given a `job` name.

## Changelog

### 1.0.0-alpha.41 — recommended

A cron run is now also filed as a background job, so it appears in the
project's list of jobs and on the back half of the map. A scheduled handler
marked with boosthisEntryPoint is filed under the cron pattern that fired it,
or under the name given in the new job option; a Deno cron, which is handed no
pattern, needs that option. Each run sends four facts and nothing more: the
name, how long ago it finished, how long it took and whether it worked. The
name is screened in the isolate as the server screens it; a refused or missing
name is counted and said once in the log, never printed, and the run is not
filed. Any other marked handler is filed as a job only when it is given a name.
Runs leave with the run's other readings, in an upload of their own. Nothing
else measured has changed.

### 1.0.0-alpha.40 — recommended

A request path written in Arabic or another non-Latin script is now named by its
letters. The isolate sees the path with each such letter escaped, six characters
for one Arabic letter, so a two-word Arabic path ran past the 100-character name
limit and its readings were refused. The kit now turns escaped letters and
digits back into characters before it measures and screens the name; escaped
spaces, slashes and symbols stay as they arrived. A Latin path is named as
before.

### 1.0.0-alpha.39 — recommended

The kit's own privacy check now reads the address of each upload as well as its
body. An address whose query carries something shaped like personal data is
stopped in the isolate under the same named cause as a refused body, and nothing
is sent. Nothing measured has changed.

### 1.0.0-alpha.38 — recommended

The setup guide now says where the project key comes from the way the AI
connection hands it over: the key in the reply when it carries one, otherwise
the key message the developer saved when the key was made, with the Setup
page's lost-key advice if that is lost. An app without its key is not called
set up. The guide and the kit's startup lines name the setting
BOOSTHIS_PROJECT_KEY; the older name BOOSTHIS_KEY is still read, so a working
Worker needs no change. Nothing measured or sent has changed.

### 1.0.0-alpha.37 — recommended

A refused kit now really stops. Any answer other than active (unpaid, revoked
or paused, for example), an upload refused with 401, 402 or 403, or an active
answer whose grace has run out stops measuring in that isolate at once: the kit
takes its watch off the function's outgoing calls and error log, throws away
what the isolate held, including what waited for the first answer, and sends
nothing but its next ask. Before, it said measuring had stopped and carried on,
and an ordinary reply set it running again; now only an active answer brings it
back, and an active answer's grace is capped at seven days. A dissolved
project's kit forgets the install, which lives only in the isolate's memory,
and asks nothing more in that isolate; nothing is erased on Boosthis. Copies
already installed keep their old behaviour until updated.

### 1.0.0-alpha.36 — recommended

Outside calls now say how they failed. Each kind of service the app calls
carries counts of calls that could not connect, got no answer, were told too
many requests, met an error on the other side or were cancelled, beside the
timeouts it already counted. A call turned away with another 4xx answer is
counted on its own and is not a failure. A well-known service from the kit's
fixed list is named by its word, at most four per kind, and failed database
round trips carry the same words. Calls made with fetch are sorted
automatically. Every word is decided inside the app: no host, address, status
code or error text leaves it. An abort the app makes itself now counts as a
cancelled failure, not a timeout, as in the Node kit; scores are unchanged.

### 1.0.0-alpha.35 — important

A span or sample batch that the server refuses for good (400, 413 or 422), or
that the kit's own privacy or size check refuses, is now dropped and counted
instead of going back to the front, so later rows still go out. Rows recorded
before registration answers wait for it. One refused crash no longer holds
back the others, and crash retries keep going on later requests while anything
is unsent.

### 1.0.0-alpha.34 — important

A 404 from registration no longer silences the kit for the life of the
isolate. Our registration route never answers 404, so one comes from routing
in front of us and passes; it is now retried like no answer, a timeout or a
server error. A failed registration is retried on the schedule every server
kit now shares: after about 15 seconds, 45 seconds, 2 minutes and 5 minutes,
then every 5 minutes, each wait spread a little, with the first send after the
wait making the attempt. After a 429 the next attempt waits at least as long
as Retry-After asks. Every attempt presents the same install id, so one that
Boosthis stored but answered too late adds no second install. A refused key
still stops the kit, as before.

### 1.0.0-alpha.33 — recommended

A request the function answers, or a fetch call it makes, can now be declared
as waiting on purpose, such as a long-poll, with the declaredWaits option of
withBoosthis or boosthisHandler. A declared route's time stays out of every
reading built on request times, and a declared call's time stays out of the
outside-service reading and the traces. Errors and failures still count.
Names are matched exactly, ten at most per list, and a refused name is logged
with its reason. Call addresses are compared inside the isolate and never
sent: each declared route goes with how many calls it kept out and the
longest wait, and calls send four counts. Nothing declared sends an empty
list.

### 1.0.0-alpha.32 — recommended

Each outside call made inside a request, a hosted database reached over fetch
included, is now sent as a step linked to that request, so the project map can
draw a line from the route to its Database box and to each outside service.
Calls made inside a queue, cron or email run wrapped with boosthisEntryPoint
hang from that run's own step. One isolate serves many requests at once, so a
call is linked only while exactly one request is in flight. A linked step
carries only its kind, its timing, whether it failed and one fixed word such
as "database" or "payments" — never a query, a host, a path or a value. Calls
that share a word fold into one step per request, seven at most, and travel
only beside the request's own step.

### 1.0.0-alpha.31 — recommended

A new reading, Cross-Origin Exposure, counts the cross-origin answer on your
app's own replies, read from the same finished replies as the cookie check:
how many answered any origin (`Access-Control-Allow-Origin: *`), how many
repeated back the Origin the request carried, and how many paired that
wildcard with credentials. Only counts leave the isolate — never an origin, a
header value, a host, a URL or a route. It is never scored: a correct
allowlist repeats an allowed origin back in exactly the same way, so the count
is the shape of the answer, not a verdict on your cross-origin rules.

### 1.0.0-alpha.30 — recommended

The answer to each send is now read under a size ceiling and a time limit
while it arrives. An answer that is too large, too slow or not JSON reads like
no answer: its body is dropped at the ceiling, and the send's status still
says whether the batch landed.

### 1.0.0-alpha.29 — recommended

Meters no longer grade an isolate's start-up: tails, peaks and rates wait for
it to settle, skip each route's cold first request and read "still settling"
until then. Swallowed errors count caught exceptions only, repeated work and
database identity include the call's query and body (hashed in the isolate,
never sent), and share meters gained absolute floors.

### 1.0.0-alpha.28 — recommended

Handler crashes now carry their request's screened route or an explicit
unknown part, occurrence time, and a stable delivery id while the isolate
remains alive. The isolate's no-disk boundary remains unchanged.

### 1.0.0-alpha.27 — recommended

The generated NOTICE now travels beside the kit's licence.

### 1.0.0-alpha.26 — recommended

An axis band with reversed good and poor constants, or a non-finite endpoint,
is now refused with a named error instead of being scored.

### 1.0.0-alpha.25 — recommended

The cookie check now reads only the ATTRIBUTE tail of a Set-Cookie line your
app sends — at most 20 lines per response, and at most 2,048 characters of
attributes on each. It used to lower-case the whole line, cookie name and
value included, with no limit on how many lines or how long. What it reports
is unchanged: counts of how many cookies lacked Secure, HttpOnly or SameSite,
and never a cookie name or value. What changed is that the name and the value
are now cut off before anything is matched at all, which is what the Privacy
Policy says every Boosthis kit's cookie check does.

### 1.0.0-alpha.24 — recommended

The README now says plainly what this kit adds to the worker it is installed
in, before you ship it rather than after. This kit adds nothing your users can
see, and every address it answers on your own hostname is listed with who can
reach it, what it returns and, where a stranger can reach it, why it is open
and what it deliberately leaves out. The same statement for every Boosthis
runtime is published in one place, so you can read it before installing.
Nothing about what the kit measures or sends changed.

### 1.0.0-alpha.23 — recommended

One rule now decides what a route is called, and every Boosthis kit takes it
from the same source instead of carrying its own copy of the idea. This kit
had no length rule at all, and its own comment recorded that its label code
was copied from the Node kit rather than taken from a contract. The contract
now exists and this kit takes it: the limit is 100 characters, the same
bound the server enforces, so the kit never sends a name the wire would
quietly reshape. A longer name is REFUSED rather than shortened, because two
routes whose names differ only past that point used to be stored as one row
with a pooled timing, under a name neither developer wrote. A refused name
is counted, and where you wrote it by hand the kit says so once through the
warning channel it already uses, with the reason and an acceptable form —
never echoing the rejected text back.

### 1.0.0-alpha.22 — recommended

Request-path, error, and timer-family readings now describe work the isolate
can finish before returning its response: route failures, invocation crashes
and unhandled throws, swallowed error logs, containment, repeated outbound
work, upstream cache verdicts, load deflection, latency windows, and resilience.
Unavailable host limits, socket lifetimes, and promise-rejection lifecycle
events are named rather than guessed. Every rate uses completed invocation time;
no poller, post-response timer, or assumed isolate lifetime was added.

### 1.0.0-alpha.21 — recommended

Eleven readings this kit does not take are now named, each with its reason,
instead of being left off the list. An isolate exposes no resident-memory
figure, no heap statistic, no allocation counter and no collection counter on
any host this kit runs on, so peak memory, resident-memory growth, memory and
allocation per request, heap fragmentation, the collection tax, generation
balance, the finalizer queue and the code cache can never be reported from
here. The two phone readings the dashboard asks every kit about — the
operating system's memory warnings and screens whose work outlives them — have
nothing to attach to in an isolate either. Nothing measured changed: no
reading was added, removed or reworded. What changed is that the project page
can now say why each of those rows is empty, in this kit's own words, instead
of leaving a hole beside the memory tiles a Node project shows.


### 1.0.0-alpha.20 — cosmetic

Nothing this kit measures changed, and nothing it sends changed. The privacy
guard is a byte-identical copy of the Node kit's, and the Node kit gained a
screen for background-job names — a name written by hand beside a schedule is
not a code-defined route label, so a space in one is ordinary rather than a
sign that a value got pasted in. This kit reports no background jobs, so the
new screen is unreachable from here; it is carried so the copy stays identical
and the next kit that does report a job inherits it already checked.


### 1.0.0-alpha.19 — recommended

`INSTALL.md` said no prompt text is read or sent. The second half was true and
the first was not: to tell repeated prompts apart, the AI-call meter reads up
to the first 4,096 characters of an outbound request body inside the isolate
and reduces it immediately to a single number — no body text is stored,
uploaded or recoverable. The guide now says so in the same words as our public
pages, because the person who decides whether that trade is acceptable is the
developer shipping the worker. Nothing measured changed.


### 1.0.0-alpha.18 — optional

Nothing measured changed: no reading was added, removed or reworded. This
release only records why there is no connection-pool reading for an isolate —
it holds no database connection of its own, and whatever connection reuse
happens belongs to the platform, outside anything the kit can see or count.


### 1.0.0-alpha.17 — recommended

Two different prompts that began with the same long preamble were read as one
prompt sent twice, so the repeated-prompt reading over-reported repeats on
exactly the traffic it exists to judge: a fixed system preamble followed by a
short varying question. The isolate now folds the request body's full length in
with the prefix it hashes, as the Node, browser and Python kits already do.


### 1.0.0-alpha.16 — recommended

The count added in the previous version now requires a POST to an
inference-shaped path, so a health check or a probe of the same path does not
raise it. This keeps the isolate's answer identical to the Node kit's for the
same traffic.


### 1.0.0-alpha.15 — recommended

A worker whose model endpoint is its own — a self-hosted model, a private
gateway, a regional endpoint — showed no AI rows at all, which looks exactly
like a worker with no AI in it. The kit now counts calls whose request path is
an inference shape while their destination matched neither the maintained
provider list nor anything you declared, and the AI reading appears saying so
instead of staying silent. One number leaves the isolate: no hostname, no path.
Naming the endpoint in `aiEndpoints` measures those calls properly and takes
the count back to zero.


### 1.0.0-alpha.14 — recommended

Outside Services is now measured from ordinary outbound `fetch` calls, grouped
into privacy-safe service kinds and scored on wait time and failures over the
requests that made those calls. Nothing new is asked of you.

### 1.0.0-alpha.13 — recommended

A model you host yourself can now be measured. Name your endpoints with
`aiEndpoints: ["llm.internal"]` in the handler options, or in a
`BOOSTHIS_AI_ENDPOINTS` binding, and those calls are timed and counted like any
other. The address is compared inside your isolate and never sent, and the
money is deliberately left blank for an endpoint that has no list price.
