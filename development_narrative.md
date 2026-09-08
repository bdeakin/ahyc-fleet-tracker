# Development narrative

## 2026-09-08 — Empty paper at the scale of a continent

The report was that scrolling out far enough made the map disappear: clusters still numbered in the hundreds, NOAA still claimed the attribution, and the page behind them was a flat grey-green. That is exactly what the Maritime Chart Service returns when you ask it for a continent. I fetched GetMap for the eastern US at Leaflet zoom 4, 6, 7 and 8. The first three are 363-byte blank PNGs. Zoom 8 is a real chart of Long Island Sound. The kiosk's minimum zoom is 3, so anyone pinching out past the coast was looking at empty tiles the service is honest enough to serve, and `transparent: false` made those tiles an opaque nothing.

The ENC cells NOAA publishes simply do not exist at that scale. Forcing them to, or pretending the blank is a bug in our code, would be the wrong fix. The paper chart is for harbour and coastal work; a world view wants bathymetry and coastlines, which Esri Ocean already has. Both NOAA layers now sit on that basemap and only paint from zoom 8, the first scale that actually has cells. Pinch out and the ocean is still there. Pinch back in and the soundings cover it the way they always did.

## 2026-09-07 — The antenna is not the station

The club has an antenna on the building, and the natural assumption is that the hard part is done. It isn't: an antenna receives RF, and AISHub wants decoded NMEA sentences over UDP from a station that stays up. Between those two facts sit a receiver, a host that runs all night, and an application process with quality gates on it. `deploy/AISHUB.md` writes that path down, because the alternative is buying an SDR to find out the receiver was already there, or applying before there is a feed to point at.

Writing it turned into a useful audit of what the app actually does, since a guide that describes intentions rather than code is worse than nothing. Two claims in our own documentation were wrong: `architecture.md` and `prompts.md` both said the poller rotates two regions, "Atlantic NE" and Great Lakes, when it has rotated three since someone discovered that one large rectangle comes back empty from AISHub and split home waters into their own smaller box. The guide now names what the code names, and both docs were corrected to match.

The other thing worth stating plainly in the guide is that the two feeds are complements. The cooperative API buys coverage a minute at a time across the whole Northeast, which is what matters when a club boat is off Block Island. The local radio path buys seconds of latency inside the harbor, filtered to the NYC box. People reasonably assume one supersedes the other and turn one off.

## 2026-09-07 — Two ways to lose the boat you were following

The instruction was that scrubbing should show positions, and a highlighted vessel should show its track *and its position at that time*. The first two thirds were already in; the last clause turned out to be the interesting one, because there were two separate ways the chart could draw a vessel's track with no vessel on it.

The first was the replay query. It asked for six hundred distinct MMSIs with no ordering at all, which SQLite answers in rowid order — so the cap was spent on whichever vessels appeared in the table earliest, boats that in many cases had been silent for a day, while the ones under way at the playhead were never reached. On a database with more than six hundred vessels in it, the boat you selected might simply not be in the answer. That the cap existed for memory reasons was right; that it chose arbitrarily was not. It now takes each vessel's newest fix in the hour before the playhead, which is exactly the hour the kiosk is willing to draw, ordered by recency — and the endpoint accepts the selected MMSI, answered from full history, so the one vessel that must be there always is.

The second was my own fade rule from two days ago. A vessel quiet for more than an hour leaves the chart, which is the right default and precisely wrong for the boat someone is following: you highlight it, scrub to a stretch where it wasn't transmitting, and get a track with nothing on it. The selection is now exempt, drawn at the opacity the fade bottoms out at — faint enough to say "this is where it last was" rather than "this is where it is", which is the distinction the fade exists to make in the first place.

Both fixes were invisible in live mode at first, and the reason is worth writing down. Marker drawing read the selection straight from component state, but the live refresh runs from an interval created in an effect that only re-runs when the mode changes, so it was calling a version of the draw function captured before anything was selected. The file already had the answer to this in four places — filters, the watch list, the alert set all read through refs for exactly this reason — so the selection now does too.

While verifying, the highlighted vessel got a ring. Once its track is the only one drawn, the question becomes *where on it* the boat is, and a coloured arrow among three hundred other coloured arrows is not an answer. The pulsing red halo was already spoken for by collision risk, so this one is a steady pale ring.

## 2026-09-07 — Replay is for following one boat

Cutting replay's flat teal mat down to fifty coloured trails fixed the look and still missed the point. The report back was that scrubbing showed all of them "rather than just a selected vessel," which is a better description of what replay is for than the one I had been working from. I had reasoned that replay should mirror live mode — same shapes, different clock — and live mode draws short trails for everyone in view, so replay did too. But the two modes are answering different questions. Live is ambient: you glance at it and want to know what the harbour is doing. Scrubbing is deliberate; nobody drags a slider back six hours to survey traffic in general. They do it to see where one boat went.

So replay now draws positions for everything and a track for exactly one vessel, the one you picked. What made this worth more than deleting a block of code is that the feature it implies was unreachable. The timeline's slider cleared the selection on every change, and clicking a vessel while scrubbed snapped the chart back to live — so in the state where "just the selected vessel" matters, there was never a selection to draw. Both behaviours make sense for a mode that only ever showed everything at once, and both had to go: the selection now follows you back through the day, and you can pick a boat mid-replay without losing your place in it.

Verifying it turned up something that looked like a bug and wasn't. Scrubbing far enough left emptied the chart completely. The timeline covers 48 hours; traffic is kept for 24. Past that line there is genuinely nothing to draw, and the chart was being honest — it just had no way to say so, which is indistinguishable from being broken. The ribbon now says "nothing stored this far back," and while scrubbed with nothing selected it says "pick a vessel for its track," so both empty states explain themselves.

## 2026-09-06 — The green tracks were always there

A screenshot arrived of the East River buried under teal lines, with a fair question attached: what happened? The honest answer is that nothing new was written — the code that draws those lines has been in the file since the first commit. What changed is that it started working.

Replay asked for every vessel's entire window and painted each one as a flat teal line. On a phone, against a harbour database, that request returned hundreds of thousands of points after fifteen seconds, and it simply never arrived in a state the map could use. Last week's memory work capped and thinned that query, so it now returns in about two seconds — and the layer it feeds did exactly what it had always been written to do, for 293 vessels at once. A feature nobody had seen was hiding behind a query nobody could complete.

Which raised the more useful question: what *should* replay draw? Live mode had already answered it. It draws positions now, short trails behind the ships in view, capped at fifty, coloured by type, and no trails at all when zoomed out far enough that they would be noise. Replay wants the same thing with one word changed — "now" becomes "then". So it draws positions at the playhead and a ten-minute trail behind each, and the flat teal is gone because colour already means something on this chart.

Reproducing it first was worth the detour. Three hundred synthetic vessels working the bay produced the screenshot almost exactly, and the numbers said more than the picture: 300 tracks in a single colour, and zero vessel icons. That second number was a bug I had shipped the day before. Icons fade with the age of their fix, and age was being measured against the current time — which is correct when the chart is showing now, and nonsense when it is showing four in the morning. Scrub back more than an hour and every marker on the chart judged itself stale and vanished, which is why the user's screenshot has lines and no ships.

The fix is to stop assuming there is one clock. Age is measured against whatever moment the chart is displaying, held in a ref so that a redraw arriving from somewhere else — a filter toggle, a pan — cannot quietly fall back to the wall clock and empty the chart again. That last part was not hypothetical: the first version passed the playhead only at the call site I had changed, and a filter redraw racing behind it wiped all 281 markers. The fade ticker sits out replay entirely, since a historical position does not get older while you look at it. And the "last report" counter on the cards reads from the same clock as the chart, so the card no longer says sixteen hours next to an icon the map is presenting as current.

## 2026-09-06 — A position is only as good as its age

Every icon on the chart was drawn as though it were current, whether the report behind it arrived four seconds ago or four hours ago. On a harbour feed that stitches together a radio receiver, AISHub and AISStream, plenty of vessels stop reporting while their last known position sits there looking authoritative — a ghost fleet that never moves and never leaves.

So icons now carry their own age: full strength for ten minutes, then a steady fade, and off the chart entirely an hour after the last report. The thresholds come from how AIS actually behaves — class A transmits every few seconds under way, class B every thirty — so ten minutes of silence already makes the position a guess, and an hour makes it a note that something was once there.

The part worth getting right was what "keeps fading" means. Tying opacity to the live refresh would have looked fine in testing and failed in exactly the case that matters: when the feed drops, refreshes stop, and every ghost would have frozen at whatever opacity it had when the connection died — the chart's most confident-looking moment being the one where it knows least. The fade runs on its own thirty-second clock instead, adjusting markers in place and only rebuilding the layer when a vessel is old enough to leave. I tested it by blocking the live endpoint in the browser: with no server contact at all, the markers kept fading and the one sitting just under the hour mark disappeared on schedule.

Disappearing from the chart is not the same as being forgotten. The vessel stays in search, keeps its tray card, and its "last report" counter goes on climbing, which is the honest arrangement: the chart shows where traffic is, and the lists remember what was there.

## 2026-09-06 — Where the rest of the memory was hiding

The first pass fixed the two requests that could not possibly fit. Asked to go further, I stopped guessing and hammered one endpoint at a time while reading the process's own memory. That immediately corrected an assumption: under sustained load the resident set sat around 220 MB while V8's heap held 16 MB of live data and 77 MB of committed space. Two thirds of the footprint was not the JavaScript heap at all. It was SQLite — its page cache, its sort scratch, and its habit of keeping what it has allocated.

Four pragmas — a 4 MB page cache, sort scratch spilled to the volume, a soft heap limit, and a WAL checkpoint threshold — took it from 221 MB to 186 MB, and repeated timings showed no change in query speed at all, because the kernel is caching the database file anyway. The page cache was buying nothing.

The satisfying one was smaller and more obvious in hindsight: track responses were serialising full double precision. `40.579851226806641` is seventeen digits describing a position AIS knows to a few metres; five decimals is about a metre and costs seven characters. Rounding in SQL took the largest response from 3.67 MB to 2.58 MB with no visible difference on the chart.

I also stopped picking the heap cap by hand. V8 cannot see a container's memory limit, so the whole failure mode is a process sizing its heap against a host it does not own — and the number I had chosen was right only for the instance size I had assumed. The container's limit is readable from its cgroup, so the start script reads it and gives V8 a little under half, which is correct whether the platform hands over 256 MB or 8 GB.

The rest was ceilings rather than usage: the photo cache was bounded by entry count at a size that permitted 96 MB of ship pictures, the noteworthy bundle cache could hold one bundle per hour value the route accepts (seventy-two), and rebuilds could run concurrently, each with its own array of tens of thousands of fixes. None of those had happened yet. All of them were reachable from a browser.

## 2026-09-06 — Two queries that were never going to fit

"Ran out of memory" was the platform's phrasing, and the temptation with a memory report is to go looking for leaks. There wasn't one. There were two requests that each allocated more than the container was ever allowed to hold, and the only reason the app had survived this long is that it had not yet collected enough traffic for them to matter.

Rather than reason about it, I built a database the size a busy harbour day produces — 2.5 million fixes, about three times what the 60 s ingest cadence can put down in 24 h — and watched the process while I asked it for things the kiosk asks for. `GET /api/tracks` over a 24 h window returned every stored point of every vessel: fifteen seconds, half a gigabyte of JSON, and a resident set of 2.3 GB. `GET /api/noteworthy` never came back at all; I killed it after ten minutes with the process at 930 MB. Neither number depends on anything unusual happening. They are what those endpoints do, on a normal day, once there is enough history behind them.

The track fix is the one I like: instead of a cap that truncates the window, each query groups fixes into time buckets and takes one per vessel per bucket, with the bucket sized from the span asked for. A ten-minute trail is untouched, a day of one vessel is untouched, and only the month-long view and the all-traffic scrub coarsen — which are exactly the views where nobody can see a 12-second fix interval anyway.

The noteworthy side was a straightforward algorithmic sin. `detectEvasiveManeuvers` attached nearby vessels to each turn it found, and it found them by walking every other vessel's entire track, once per turn: 133 seconds and 700 MB on its own. Bucketing the fixes by minute and grid cell first turns that into a handful of map lookups — 73 ms — and building the track and nearby list only for the strongest turns, rather than all of them, keeps the allocation flat no matter how eventful the day. `detectInterceptions` had a milder version of the same problem: it already prefiltered pairs spatially, then searched the whole day for each pair it found, instead of the few minutes they were near each other.

Two smaller things paid for themselves. The container was cutting historical chart pyramids at runtime — a few hundred megabytes of libvips working set on a machine that is also serving a map — so the pyramids are now cut during the Docker build and shipped in the image; sharp is loaded lazily, and in production it is never loaded at all, which is 30 MB of resident memory that used to be present just in case. And V8 had no heap cap, so it was sizing its old space against the host's memory rather than the container's limit: it grew toward a number it was not allowed to reach and got killed instead of collecting. Capped at 384 MB, twelve of the heavy requests at once now peak at 216 MB. `/api/health` reports RSS and heap, so the next one is visible before the email arrives.

## 2026-09-06 — Adding a boat to a list you cannot reach

Adding AMERICAN PRINCESS to the watch list sounds like a one-line database write, and it would be, on a database this side of the internet. The list lives in SQLite on the deployment's volume, so the change had to travel as code: a seed in the boot path that adds her once. "Once" is the important part — a seed that runs every boot would quietly resurrect a boat somebody had deliberately removed, so each entry writes a marker into the `settings` table and skips itself thereafter. Verified both directions: she appears on a fresh boot, and after deleting her the list stays empty across a restart.

The more interesting find was why this was asked of me at all. The detail pane has an "Add to watch list" button; changing the list requires an admin session, and without one the request is rejected with a 401 that the click handler caught and discarded. So the button did nothing, said nothing, and left the impression it was broken. It now explains that the watch list needs an admin sign-in and links to the page where you do it.

## 2026-09-06 — The button that was never wearing its own clothes

Making the locate button bigger on phones turned up the same CSS trap as the location read-out: the rule was written as `.kiosk-locate-btn`, but the header styles it against are `.kiosk-actions button`, which is the more specific selector and wins no matter which comes later in the file. So the round shape, the accent colour, and the fill it asked for had never rendered — only the size, which nothing else was setting. Scoped as `.kiosk-actions .kiosk-locate-btn` it applies, and on a phone it becomes a 44 px accent-blue circle: a full thumb target, and the only control in the header that does not look like a quiet link. That is the right emphasis, because on a phone it is the one thing you press underway.

## 2026-09-06 — Reading a crash that was mostly a shutdown

The deploy log ended with `npm error signal SIGTERM`, `npm error command failed`, and `Stopping Container`. That is not a stack trace, it is npm complaining about being killed — and that turned out to be the useful part. The entrypoint was `npm run start`, which spawns a shell, which spawns npm again, which spawns node. SIGTERM lands on npm, node never hears it, and npm exits non-zero. To a platform with an ON_FAILURE restart policy, every ordinary stop therefore looks like a crash. The container now runs `node apps/server/dist/index.js` directly and handles SIGTERM itself: stop the AIS workers, close Fastify, close SQLite so the write-ahead log is checkpointed onto the volume rather than recovered on the next boot, and exit zero, with a timer to guarantee the process is gone inside the grace period regardless.

That explains the log but not necessarily every restart, so the rest of the work was removing the ways a boot could fail quietly. The health check was the worst offender: it called `trackHistorySpan`, which groups every row in `track_points` to report how much history is stored. On a laptop that is milliseconds; on a volume holding months of a club boat's positions it is a full index scan on every check, and a missed check is a restart. The diagnostics are worth keeping — they are how we confirmed the volume was actually being written to — so they moved off the request path into a snapshot refreshed at most once a minute. The endpoint now answers in about a millisecond and reports the last known numbers.

Boot failures were the other silent case. Opening SQLite on a misconfigured volume threw before the server ever listened, so the only evidence was a log line scrolling past between restarts, and on a phone that is close to invisible. The boot work is wrapped now: the server listens regardless, and `/api/health` returns 503 with the exact error. A broken deploy still fails its check and is never promoted, but you can read what went wrong from the same page you were already looking at. Pointing `DATA_DIR` at an unwritable directory locally returns `EACCES: permission denied, mkdir` in the body, which is precisely the message that used to be lost.

Finally the tile warmup, which was starting five seconds after process start — before the first health check, and pegging every core it could reach. Timed locally, five pyramids take twenty seconds on four idle cores; on a shared vCPU that is minutes of contention right when the platform is deciding whether the deploy is alive. It now starts forty-five seconds after the server is listening, holds sharp to a single thread and a small cache, and pauses between charts. Measured over a full cut: health responses steady at a millisecond, peak resident memory 233 MB.

## 2026-09-06 — Putting the viewer on the chart

The kiosk has always centred on the club, which is right for the screen on the wall and wrong for the phone in your pocket at the end of the dock. A crosshair button now takes one GPS fix per press and flies the chart to it, marking the spot with a blue dot inside a circle the size of the reported accuracy — worth drawing, because a 300-metre fix and a 5-metre fix mean very different things and a bare dot claims the latter. The fly-to takes the greater of the current zoom and fifteen, so pressing it while studying a berth does not throw the view back out to bay scale.

A single fix rather than a running watch: a live watch is a battery drain on a phone that spends the afternoon in a pocket, and someone standing on the dock needs to be put on the map once. Every failure mode says what happened — permission blocked, no fix yet, an insecure connection, or a browser with no location service at all — because a button that silently does nothing is worse than no button.

Placing the read-out took two tries. It first sat under the header on the right, where the vessel search panel already lives, so it landed behind it. Centred under the tagline is clear on a desktop, and on a phone it moves to just above the status ribbon. The mobile override also had to move: it was written into the phone media query, which sits earlier in the stylesheet than the rule it was overriding, so the desktop `top` and the phone `bottom` both applied and stretched the little toast into a slab covering half the screen.

## 2026-09-06 — Club colours on the club boats

The burgee identifies a club boat, but it flies above the marker and at bay-wide zoom the marker is what the eye lands on first. So the marker itself now wears the flag's colours banded out from the centre: red core, white around it, blue outside. Both marker shapes are built the same way, by drawing the shape three times and scaling each copy about its own centre — a roundel when the boat is stopped, the same course arrow in three nested bands when it is moving — which keeps the bands parallel to the outline without hand-drawing an inner chevron.

Once the marker itself carried the club's colours, the flag above it was saying the same thing twice and cluttering the chart while doing it, so it came off the map. It lives on the vessel cards now — the tray card, the detail pane heading, the search results — where there is room for it to be a flag rather than a smudge, and where the eye is reading rather than scanning. The legend went back to showing only the roundel, because a legend should describe what the chart actually draws.

The outer band is edged with the same near-black used to case the tracks. The first attempt edged it in white, which was a mistake: the white stroke is drawn centred on the outline, so half of it ate into the blue band and left the marker reading as mostly white. A thin dark edge keeps all three bands their full width and separates the blue from pale water. Hull colour still drives each boat's track, so two club boats on the same screen stay distinguishable even though their markers now match.

## 2026-09-06 — A hairline of black under every track

Sailing vessels are drawn white, which is right on open water and useless the moment a trail crosses land, a shoal, or the pale paper of the NOAA chart — the line simply vanishes. Cartographers solved this long ago with a casing: draw the line twice, a slightly wider dark one underneath and the coloured one on top, so the colour keeps its meaning and the edge does the work of separating it from whatever is behind it.

Every track now goes through one `drawTrack` helper that lays a casing 1.6 px wider than the line beneath it, which covers live trails, the selected vessel's history, replay tracks, and noteworthy events alike. Runs that are coloured by speed are the exception: they are drawn as many short segments, so a per-segment casing would be both wasteful and visibly seamed, and they get a single casing under the whole run instead. The short trails were dimmed to 0.55 opacity back when nothing separated them from the chart and faintness was the only way to keep a crowded harbour from turning to soup; with an edge on them they can go back up to 0.75 and actually show their hull colour.

## 2026-09-06 — Flying the burgee

The gold star over club boats was always a placeholder for the thing a club actually uses, so it is now the AHYC burgee. It is drawn rather than loaded: the flag reduces to a blue pennant, a white wedge opening from the middle of the hoist, and two stars at the hoist, which is a handful of SVG paths and stays crisp at any zoom or pixel density, with the club letters in red across the wedge. Geometry came from measuring the flag itself: sampling the artwork row by row put the wedge's apex at the middle of the hoist and showed its edges converging with the pennant's own edges at the fly, which is what makes the blue read as two tapering borders rather than a field with a triangle cut out of it. The same measurements explained the lettering, which is not set in one size: the letters share a width but each is taller than the last, so the word grows with the wedge and never spills onto the blue.

The first pass left the letters off as unreadable, which they were at thirteen pixels. Rendering the glyph at a range of sizes against a plain background settled it: at twenty-two pixels the red is a legible word on an ordinary screen and unmistakable on a retina one, and a flag that size still sits comfortably above a twenty-eight-pixel course arrow.

Leaflet's `divIcon` takes an HTML string and React does not, so the markup is built by one function and the kiosk wraps it for the legend, the search list, and the pane heading. The marker offset is computed per marker rather than fixed, since a moving club boat is a 28-pixel arrow and a stopped one is an 18-pixel circle, and the flag should clear both.

## 2026-09-06 — A phone is not a kiosk

Everything on this map was laid out for a wall-mounted screen: a legend in one corner, filters in another, chart pickers along the bottom, a status ribbon under those. On a phone the panels covered the chart almost completely — the map was a few visible pixels between boxes. The fix is the usual one for small screens, two drawers that slide in from the edges with tabs at the bottom to open them, but the implementation detail worth recording is that the drawers wrap the existing panels and are `display: contents` above the breakpoint. The desktop kiosk therefore renders exactly the markup it always did, with the wrappers contributing nothing, and only inside the media query do they become fixed, scrolling panels that pull their children out of the corners and stack them in flow.

Two behaviours needed thought. Tapping a ship on the chart should show its card, but picking a ship from the search list — which lives *inside* a drawer — should close the drawer, because the point of that tap is to watch the map fly. Both go through the same selection state, so the search path sets a flag that suppresses the auto-open once. And the status ribbon, four lines of diagnostics that are genuinely useful on a kiosk, now folds to one line; on a phone it starts folded, which turned out to be pleasant on the desktop too.

## 2026-09-06 — Charts that were a mile out

With the sheets finally rendering at every zoom, it became obvious that several were in the wrong place. The 1845 survey was the worst: sail up to the club and you were looking at the engraved coastal profile printed in the sheet's bottom margin. The bounds had been estimated from what the charts covered rather than measured, which is fine for a thumbnail and hopeless for an overlay.

Old survey sheets carry their own answer in the margin. Each has a minute ruler along the neat line with labelled ticks every five minutes, so reading two labels gives both the scale in pixels per minute and an absolute anchor, and the rest is arithmetic. The 1910 sheet gave up 40°45' at row 1446 and 74°00' at column 1945; the 1845 sheet, whose margin carries two longitude scales (Greenwich and New York City Hall) and is ambiguous, gave its latitude the same way and took its longitude anchor from Sandy Hook Light, which has not moved since 1764. The 1895 scan is a low-resolution derivative with no legible ruler, so it was fitted to two features instead — the light again, and Governors Island. Every fit was checked by predicting where a known landmark should fall and cropping the scan there to look.

Since a pyramid is only valid for the bounding box it was cut against, the manifest now records that box, and a corrected georeference quietly re-cuts the tiles on the next boot.

## 2026-09-06 — Old charts that survive a zoom

Picking a historical sheet worked until you zoomed, at which point the chart turned into a flat tan rectangle — that rectangle being the paper underlay drawn behind it, suddenly with nothing on top. The scans are 12–20 megapixels, and Leaflet's imageOverlay scales one `<img>` to whatever the zoom demands; past roughly ten thousand pixels across, Chrome gives up on painting it. Nothing about the element changes — it stays loaded, correctly sized and positioned — so the only symptom is bare paper, and the flash of chart during the zoom animation is the old texture still on screen.

The fix is to stop asking the browser to do something it will not do, and cut the scans into ordinary XYZ tiles. Each chart is reprojected once from its linear lat/lon georeference into Web Mercator — one tile row at a time, so a 20-megapixel scan never has to sit in memory whole — and the shallower levels are built by merging four tiles into one, which is cheap and lands exactly on the tile grid. Pyramids are cached on the data volume (roughly 20 MB for all five sheets) and cut in the background at boot, so nobody waits for them. One surprise at the end: with the chart living in the tile pane, the paper underlay in the overlay pane now sat on top of it and hid it completely, which needed its own pane below the tiles.

## 2026-09-06 — Watching the event instead of reading it

A noteworthy event drew as a static line, which tells you where something happened but not how. Every event already carries the fixes it was built from, so the kiosk can replay them: a scrubber under the event detail, transponders interpolated to the playhead with their speed at that moment, and a trail growing behind each one. The whole window compresses into about fourteen seconds regardless of real duration, and dragging the slider pauses playback and moves the ships. Watching the Ambrose pilot transfer, the two arrows converge and merge — which is the point.

## 2026-09-06 — A photo for the ship you tapped

Asked whether a vessel photo could be scraped by MMSI, the answer turned out to be yes, but only from a few places. MarineTraffic's photo endpoint sits behind Cloudflare (522s), ShipSpotting returns 403 to anything without a browser session, and Wikidata's MMSI property has almost no coverage. What does work is VesselFinder's ship page, which embeds a `main-photo` image keyed on the MMSI and falls back to a stock illustration under `/images/` when nobody has contributed one — that placeholder is easy to detect and reject. Behind it, Wikidata by IMO leads to a Commons file with a real licence and author, and a Commons full-text search on the vessel name is the last resort. Name search is genuinely unreliable: searching "PILOT AMERICA" surfaces a 19th-century pilot schooner, "Queen Mary 2" first offers a museum model, and "SEA LARK" produced a Christie's lithograph of an 1843 Royal Navy brig. Title text alone does not separate those from photographs, but Commons metadata does — the artwork carries `PD-Art` and `Paintings` categories and a date of "19th century", where a usable photo has a modern capture year. A name match therefore has to appear verbatim in the file title, avoid artwork categories, and carry a capture year of 1970 or later; anything that survives that is flagged in the UI as a likely match rather than presented as fact.

Nothing is persisted, per the request. Lookups are memoised in process memory (12h for hits, 2h for misses) and the last two dozen images are cached the same way, so a redeploy just looks them up again. The kiosk loads the image from our own server rather than the upstream URL: one origin, no mixed content, and the referer and user-agent are ours to set.

Two bugs surfaced while testing this against real clicks. Pinning two vessels in the tray and then flying to one of them emptied the tray, because the live feed is viewport-scoped and cards only render for vessels in that response; `/api/live` now takes a `pinned` list that ignores the bounding box. And with a vessel pane open, the search result list underneath it was unclickable, which made a second card impossible to add.

## 2026-09-06 — Charts that look like charts

The kiosk wanted the look of a NOAA paper chart: soundings, depth tints, magenta aids, buff land. NOAA cancelled its raster charts, so the closest live source is the ENC data rendered through NOAA's Maritime Chart Service, which accepts S-52 mariner settings per request. Comparing renders against a paper sheet of Sandy Hook, two settings did most of the work: dropping the `OTHER` display category (that is where the hatching, data-quality boxes and AIO overlays come from) and asking for paper-chart point symbols with plain area boundaries. Four depth shades at 12 / 30 / 60 ft in feet finish it, matching the New York Harbor sheets. The layer is now the default; the full ECDIS display is still selectable.

OpenSeaMap seamarks were the other source of clutter — their labels are baked into the tiles, so at bay zoom every buoy name overlapped. They now start at zoom 14.

## 2026-09-06 — Noteworthy traffic

The detectors in `packages/shared/src/noteworthyTraffic.ts` had no route and no UI. They now sit behind `GET /api/noteworthy`, which walks the stored AIS window once every few minutes and caches the result, and a picker on the map draws whichever event you select.

Three detectors are new:

- **Interceptions** — pairs whose tracks close from over half a mile to alongside (within ~220 m). Around Ambrose this is mostly Sandy Hook pilots boarding or landing a pilot: the event is marked as a pilot transfer when either vessel is a pilot boat by AIS type or name and the two either matched course or met inside a known boarding area.
- **Suspected groundings** — a vessel that goes from making way to stopped in one report and stays put somewhere no other traffic stops. Our AIS feeds do not carry static draught, so draught is estimated from ship type and length, and depth comes from NOAA NCEI's DEM mosaic (cached per ~100 m cell in `depth_samples`). Under-keel clearance decides between *possible* and *likely*; comfortable water drops the event entirely.
- **Need for speed** — sustained runs over 30 kn. Speeds at or above 70 kn are dropped as decode errors rather than reported, which also covers the AIS 102.3 kn "not available" sentinel.

Detecting no-wake speeding used to treat any cell with enough stopped fixes as a no-wake pocket, so an aground boat manufactured a pocket and then "sped" through it on the way in. A pocket now needs stopped fixes from more than one vessel.

## 2026-09-06 — CPA on stacked cards, and a tray that stops eating drags

Stacking two vessel cards already showed range, bearings and courses; it now also shows CPA and TCPA, computed from both fixes assuming each holds course and speed, with the row highlighted when the pair closes inside 0.15 nm within 15 minutes. Vessels without usable COG/SOG count as stationary, so a mover against a moored boat still yields a useful answer.

The tray row spans the width between the filter panels and the zoom control so the app can measure how many cards fit. That whole row was capturing mouse events, which is why the map would not drag to the right of the cards. Only the card stacks take pointer events now.

## 2026-09-06 — Historical charts on the kiosk

Operators can switch the basemap to period charts when the viewport intersects coverage. A **Historical chart** control offers Robert Dudley’s **1646** eastern-seaboard general chart (regional zoom), plus **1776** Entrance of Hudson’s River and **1845 / 1895 / 1910** NY Bay sheets. Selecting one swaps modern tiles for a georeferenced image overlay; assets live under `/historical-charts/`.

## 2026-09-06 — Make Railway track storage survive redeploys

Production only had ~30 minutes of AIS history after a redeploy even though a Railway volume existed. Volumes are durable; the wipe happens when SQLite writes to the container filesystem instead of the mount. The server now prefers `RAILWAY_VOLUME_MOUNT_PATH`, logs a warning when storage is ephemeral, and exposes `durableStorage` on `/api/health`.

## 2026-09-06 — Carto API key for harbor Voyager tiles

Carto’s public Voyager CDN is fine for light local use but production needs an authenticated basemap URL. The harbor layer now reads `CARTO_API_KEY` and serves `…/voyager/{z}/{x}/{y}.png?key=…` (no subdomain host) when set; otherwise it keeps the public `{s}.basemaps.cartocdn.com` template.

## 2026-09-06 — Live last-report age on vessel cards

A static “Updated” clock on the detail pane was hard to read at a glance on the kiosk. It is now a **Last report** field that counts up every second from the vessel’s latest AIS timestamp (tray cards show the same age). Absolute time remains available on hover.

## 2026-09-06 — Drag cards to compare + in-app help

Operators wanted a quick way to reason about two contacts without leaving the kiosk. Tray cards are now draggable: drop one on another to stack them and read distance, mutual true bearings, each COG, and relative bearings in the own-ship frame (ahead / beam / quarter). A **?** control opens a short help panel covering filters, watch list, stacking, and track tools.

## 2026-09-06 — Season adventures dropdown + SQLite-first docs

Season adventures should not require hunting for a vessel and then a year. The kiosk and adventures page now share one dropdown fed by club registry boats crossed with calendar years that already have AIS points in SQLite (`Vessel name - year`). README/architecture were updated so operators are not steered into thinking Supabase is the registry — local SQLite always is; Supabase remains an optional login/sync layer.

## 2026-09-06 — AIS shapes, tray along the ribbon, tighter CPA

Markers now read like other AIS apps: circles when stopped, heading arrows when moving, with a pulsing red ring for CPA risk. Alerts fire when tracks pass within 0.1 nm in the next 12 minutes — including a mover closing on a stopped boat, but never two stopped vessels.

The selection tray lives in the bottom filter row to the right of AIS source / Show, grows left-to-right, and sheds rightmost cards when there is not enough width. Zoom controls moved to the bottom-right above the status ribbon; the “local sailing grounds” line sits top-center so the type legend no longer covers it. Esri Ocean caps native zoom and overzooms instead of blank tiles, with an optional OpenSeaMap seamark overlay for buoys and lights without full NOAA clutter.

## 2026-09-06 — Watch list + tray + AISHub empty Atlantic region

Operators needed long-lived tracks for boats that are not club registry members. The right-hand vessel pane can now add/remove a watch list entry; prune keeps those MMSIs forever alongside club boats. Filters next to AIS source let the kiosk show club / watch / other traffic independently.

The bottom tray keeps the last few clicked vessels with distance from the Ocean Blvd station and a named waterway, and CPA logic draws a red ring on collision-risk contacts. The ribbon reports AISHub refresh timing, how many club boats are outside the Northeast box, and how deep SQLite history goes for traffic vs club.

Production AISHub looked “stuck” because the Atlantic NE bbox was still too large and returned 0 vessels while Great Lakes succeeded — so New York harbor never got AISHub updates. Regions are smaller now, and empty replies rotate after ~65s instead of waiting the full 5 minutes.

## 2026-09-06 — Track range buttons on the vessel pane

Operators wanted more than the default 24h track when inspecting a boat. The detail pane now offers 24h / 7d / 30d buttons under the vessel name and plots whatever history SQLite still has for that MMSI (club boats keep longer history; harbor traffic may only retain ~24h).


## 2026-09-06 — Source filter vs Live banner; less clustering

The AIS source panel sat under the Live status/timeline strip. Moved it above that banner. Clustering was still on at bay-overview zoom (~10), which hid individual ships behind large counts — disable clustering from zoom 9 up and tighten cluster radius when still zoomed further out.


## 2026-09-06 — Blank page after clustering deploy

Production HTML and `/assets/*.js` loaded, but React left `#root` empty. Playwright caught `Map has no maxZoom specified` from leaflet.markercluster when `disableClusteringAtZoom` was used without a map `maxZoom`. Fixed by setting `maxZoom: 18` on map init and adding a small ErrorBoundary so future map failures show a message instead of a white screen. AISStream `1006` reconnects are separate (API key / upstream) and no longer hide the UI.


## 2026-09-06 — Blank kiosk + AISStream 1006 + slow radio ingest

Railway logs showed AISStream sockets dying with code 1006 and `POST /api/ais/ingest` taking 6–8 seconds. Large radio batches were writing SQLite without a transaction and broadcasting one websocket event per vessel, which starved the server and could leave the map looking blank. Ingest is now one transaction + one notify; the kiosk refreshes live AIS every 5 seconds for harbor radio traffic; AISStream reconnect backs off instead of hammering the upstream.


## 2026-09-06 — Viewport AIS + clustering (and source tags)

AISHub’s wider coverage made the kiosk sluggish: every vessel on the Northeast seaboard and Great Lakes was drawn at once, and short trails fetched the entire track table. Live AIS now loads for the padded map viewport (`/api/live?minLat…`), traffic markers cluster until zoom 13 (club boats stay individual), and 10-minute trails only request nearby MMSIs when zoomed in. The same release tags each fix with its feed (radio / AISHub / AISStream), splits AISHub into rotating Atlantic + Great Lakes regions so the API returns data again, and adds source checkboxes on the kiosk.


## 2026-09-05 — AISHub for Northeast coverage and offshore club boats

AISStream and the Pi Dispatcher cover the harbor well, but club boats leaving for races (Bermuda, etc.) fall off those feeds. AISHub gives a Northeast bbox (default every 5 minutes) (Chesapeake through Maine and the Great Lakes) plus an MMSI endpoint. When a registered boat approaches the perimeter of that box it joins a watchlist; we poll those MMSIs on the remaining once-per-minute AISHub budget until the boat is safely back inside. Empty AISHub responses are treated as rate-limit/no-data so we never hammer the API.


## 2026-09-05 — Simplified chart + sailing white / pleasure pink

The full NOAA Chart Display WMS is accurate but too busy for a clubhouse kiosk — depth contours and regional labels are what people need first. Default basemap is now Esri’s Ocean Base (bathymetry) plus Ocean Reference (place names); operators can still switch to the full NOAA WMS. Sailing vessels are white and pleasure craft pink to match common AIS apps; white markers get a dark outline so they stay visible on pale water tiles.

## 2026-09-05 — Type colors were all gray; club vessels need stars

Production `/api/live` returned `shipType: null` for every traffic vessel, so every marker used the “other” gray. Two gaps: the Pi forwarder often learned names from Class B static messages without reliably attaching ship type to later positions, and scraped vessel-class text was not used for coloring. Live state now maps scraped class labels to ITU type codes when AIS type is absent, the forwarder stamps learned type onto queued positions (and no longer treats message id as ship type), and AHYC club boats get a gold star behind their pin.

## 2026-09-05 — MMSI profile scrape with local cache

AIS gives position and type, but the kiosk pane still lacked registry-style particulars (flag, dimensions, call sign). Added a one-time scrape per newly seen MMSI against VesselFinder (MyShipTracking fallback), stored in SQLite `vessel_profiles`. The background worker drains a pending queue politely; successful and not-found results stay cached, errors retry after six hours. Selecting a vessel loads `/api/vessels/profile/:mmsi` and fills the side pane as the scrape completes.

## 2026-09-05 — Ship-type colors, short trails, and vessel search

Harbor traffic was hard to read when every marker shared one gray. Live state now carries ITU AIS ship type (from Dispatcher static messages via the Pi forwarder) and maps it to a fixed palette (sailing, pleasure, tug, cargo, tanker, etc.). Club vessels still use their registry color. The kiosk shows a type legend and draws a 10-minute trail for every vessel by default; selecting a vessel still expands that track to 24 hours. A find-vessel search zooms the map and opens a side pane with MMSI, type, speed, and course.

## 2026-08-21 — AIS ingest diagnostics on Railway

Production showed LIFE AT SEA registered but `/api/live` empty. VesselFinder also reported the last AIS fix ~19 hours old. Hardened AIS ingest for Class B extended reports, removed narrow message-type filters, and exposed `/api/ais/status` plus a kiosk hint when no positions arrive or the API key is missing.

## 2026-08-21 — AISStream key + wider subscription bbox

Configured local `.env` with an AISStream API key (gitignored). Expanded `DEFAULT_BBOX` to cover NY Harbor through Long Island Sound so club vessels remain visible when cruising away from Sandy Hook.

## 2026-08-21 — Railway phone deploy

Added Docker + Railway config so the same app can be deployed from a phone browser without a Pi. Documented in `deploy/CLOUD.md`: AISStream required, Supabase optional, volume at `/data` for SQLite. First boot bootstraps LIFE AT SEA when the registry is empty.

## 2026-08-21 — Supabase registry sync

Implemented Supabase-backed admin auth and vessel registry sync as specified in the product plan. The Pi (or local server) keeps SQLite for AIS tracks; when `SUPABASE_URL` + keys are set it pulls the cloud `vessels` table every 5 minutes and pushes local admin creates/updates/deletes upstream. Admin UI supports Supabase email/password login or the local admin token fallback. Schema lives in `deploy/supabase/schema.sql`.

## 2026-08-21 — First club vessel registered

Registered **LIFE AT SEA** (MMSI `338357109`) as the primary club vessel for AIS tracking. Seed script now creates this vessel as active and keeps synthetic season tracks on an inactive demo vessel only. Adventure titles use the registered name as-is (e.g. “The 2026 Adventures of the LIFE AT SEA”). Vessel delete now cascades trips/tracks so registry cleanup works.

## 2026-08-21 — Project inception

Greenfield AHYC map kiosk monorepo created after product planning. Scope locked to **club vessels only** (no general AIS traffic layer). Core deliverables: NOAA chart kiosk with timeline replay, vessel registration, local track storage, and a seasonal **Adventures** page with scroll title, narrative summary, and stylized nautical trip art.

Stack chosen for Raspberry Pi friendliness: React + Leaflet frontend, Fastify + SQLite backend, AISStream for legal real-time AIS, optional Supabase later for cloud registry.

Synthetic demo tracks live on an inactive “SV Season Preview” vessel so Adventures UI can be exercised offline. Live AIS tracking targets registered club boats only — first vessel: **LIFE AT SEA** (MMSI 338357109).

## Harbor traffic via AIS Dispatcher (2026-09)

AISStream alone was unreliable for club-wide harbor context. With a dAISy HAT + AIS Dispatcher on the Pi, we added a Railway HTTPS ingest path: Dispatcher UDP → local Python forwarder → `POST /api/ais/ingest`. The app stores all vessels in the NYC traffic bbox for 24 hours (kiosk click-to-track) while registered club boats keep indefinite history for Adventures.
