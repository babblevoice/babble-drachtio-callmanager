# babble-drachtio-callmanager

Provide simplified interface to handle calls with drachtio. This project pulls together all of the required components for a scalable PBX. A registrar, RTP engine.

This project interfaces with babble-projectrtp.

```javascript

const Srf = require( "drachtio-srf" )
const Registrar = require( "babble-drachtio-registrar" )
const CallManager = require( "babble-drachtio-callmanager" )
const config = require( "config" )

const srf = new Srf()
srf.connect( config.drachtio )

srf.on( "connect", ( err, hostport ) => {
  console.log( `Connected to a drachtio server listening on: ${hostport}` )
} )

/* A simple example of looking up a password in our config */
function passwordLookup( username, realm, callback ) {
  realm = realm.split( "." ).reverse().join( "." )
  let key = "directory." + realm + "." + username
  if( !config.has( key ) ) {
    return callback( null, false )
  }

  key += ".secret"
  return callback( null, config.get( key ) )
}

const r = new Registrar( {
  "srf": srf,
  //"optionsping": 30, /* Seconds between our OPTIONs packet to registered client - controls the stale flag */
  "regping": 30, /* Number of seconds we force the client to reregister without requiring reauth - controls the stale flag */
  "staletime": 180, /* number of seconds we consider a client stale if we don't hear a response from an OPTIONS or REGISTER ping */
  "expires": 3600, /* default expires */
  "minexpires": 3600, /* Force the client with 423 to extend expires to this amount - conflicts with regping */
  "userlookup": passwordLookup,
  "forcerport": true /* when sending invite - request rport */
} )


const cm = new CallManager( {
  "srf": srf,
  "registrar": r,
  "userlookup": passwordLookup
} )

cm.on( "call", async ( c ) => {

} )
```

When call manager presents a new call it passes a call object as part of it. The original req and res from Drachtio are members of this object. The call object also has the following methods.

CallManager takes an options object as part of its construction. srf and a passwordLookup function are required. Options for codecs and transcoding can also be supplied:

```json
{
  "srf": srf,
  "userlookup": passwordLookup,
  "preferedcodecs": "pcmu pcma 2833",
  "transcode": true
}
```


## auth

Forces the client to authenticate. Returns a promise.

## ring

Sends back 180 (ringing).

## busy

Ends the call with busy.

## answer

Answers the call (creates a dialog) and opens the required channel. Returns a promise.

## audio

Returns the audio channel.

## hangup( cause )

Ends the call (or cancels).

## waitforevents( regex, timeout = 30000mS )

Waits for telephone events (DTMF). We pass a regular expression in to match the entered digits. In the example below, 2 digits (any in the DTMF range) are required followed by the hash key.

If the user dials 123456 = it will not trigger as there is no '#' at the end. If they dial 1234567# then it will return with e = 67#

```javascript
var e = await call.waitforevents( /[0-9A-D\*#]{2}#/ )
console.log( "waited and got " + e )
```

## waitforhangup

Returns a promise which is resolved when the call object is hungup. Useful if you wish to further actions when a child call has hung up.

## Events

Events are published to either a global event emitter and a call specific one. This allows us to pass events back to a presences system (global) or for a call script to handle an event for that call.

To subscribe to call specific events:

```javascript
cm.on( "call", async ( c ) => {
  c.on( "call.destroyed", ( call ) => {
    /* clean up */
  } )
} )
```

The call events are: `call.new`, `call.ringing`, `call.early`, `call.answered`, `call.updated`, `call.mix`, `call.auth.start`, `call.authed`, `call.authed.failed`, `call.hold`, `call.unhold`, `call.pick`, `call.destroyed`, `call.reporting`, `call.video.nomedia` and `call.video.media`.

### Video no-media monitoring

While a call is established with a video relay leg (projectrtp relay mode), its `livestats()` is polled for authenticated inbound video (`in.accepted + in.rtcp`). If that has not moved for `nomedia` mS the call emits `call.video.nomedia`; when video moves again it emits `call.video.media`. Both go to the call's emitter and the global one, with the call as the argument. Nothing is raised while the call is on hold, and a node without `livestats()` is never polled. An older relay build that reports only `in.count` is judged on that.

`call.videomonitor` holds the latest stats (`stats`, sampled at `at`), the current state (`nomedia`) and a `history` of the events. The timing defaults to `{ interval: 2000, nomedia: 8000 }`. Override it with the `videomonitor` option, globally or per call. Keep `nomedia` under projectrtp's 20S relay idle timeout, which closes a dead leg.

### Video limits

The `videolimits` option (globally or per call) says how much video a relay leg lets its far end send. It is the one source of these numbers for two jobs: every video relay leg is opened with them as projectrtp's `relaylimits` - projectrtp enforces them and drops what exceeds them - and every video m-line we write - offers, answers, re-offers, re-answers and holds, to staff and guest alike - advertises them.

```javascript
{
  "videolimits": {
    "bitrate": 2000000,  /* bits/s */
    "burst": 0,          /* bytes - 0 = one second of bitrate (250000 here) */
    "packetrate": 1000,  /* packets/s */
    "framerate": 30,     /* frames/s */
    "maxfs": 3600        /* frame size in 16x16 macroblocks - 3600 = 1280x720, either orientation */
  }
}
```

The global and per-call options are merged field by field over these defaults (defaults, then global, then per call): a call that sets only `framerate` keeps the global `bitrate`. A field that is absent, negative, not a number, or a fraction that rounds down to 0 (`0.5`) falls through to the layer beneath. An explicit `0` means unlimited (and is then not advertised) for `bitrate`, `packetrate`, `framerate` and `maxfs`. `burst` is different: `0` (or absent) is one second of the final `bitrate`, which is what projectrtp enforces for 0, and we pass the resolved number (0 only when `bitrate` is unlimited). A `maxfs` of 1-98 is raised to 99 (QCIF, H.264 level 1's MaxFS): no H.264 level declares a smaller frame, so a smaller limit could not be advertised to an H.264 sender while the relay enforced it - the relay and the SDP both use 99.

What the SDP says, per video m-line:

- `b=AS` at 90% and `b=TIAS` at 85% of `bitrate` (the defaults give `b=AS:1800` and `b=TIAS:1700000`). TIAS is the media bitrate a browser feeds its encoder; the 15% left under the relay's cap covers RTP/SRTP headers, NACK retransmissions and encoder overshoot. AS counts headers, so it sits 5 points higher, for endpoints that only read AS. TIAS is written last, as libwebrtc keeps the last `b=` line.
- `a=framerate:<framerate>`.
- VP8: `a=fmtp:<pt> max-fs=<maxfs>;max-fr=<framerate>` (RFC 7741).
- H.264: the level is lowered to the highest one whose MaxFS and MaxMBPS fit `maxfs` and `maxfs * framerate` (RFC 6184 `max-fs`/`max-mbps` may only raise a receiver's level, never lower it), then `max-fs`/`max-mbps` raise it back to the limits. The defaults are exactly level 3.1, our registry's level, so they change nothing; raising the limits never lifts H.264 above 3.1, nor above the level the other leg decodes.

Only the bitrate lines reliably limit a browser: libwebrtc (Chrome, Safari) and Firefox cap their send bitrate to `b=TIAS`/`b=AS`. The resolution and frame-rate lines are advisory - valid SDP that some SIP endpoints honour, but libwebrtc ignores VP8 `max-fs`/`max-fr` when sending and never parses `a=framerate`. The relay is the enforcement: a browser client must cap its own capture/encoder (resolution and frame rate) to stay under the limits, or the relay drops frames (over `framerate`, with 1.5x tolerance) or the whole stream until a keyframe that fits (over `maxfs`).

An incoming re-offer that moves the video payload type re-points the relay leg's codec at the new one (without restarting DTLS), so the stream is not dropped as `ptdropped`.

A mirrored answer still drops the offerer's own receive capabilities (its `max-fs`, `max-fr`, `max-mbps` ...); ours are added after.

### Video codec negotiation and known limits

The relay forwards video untouched - it never transcodes - so both legs of a bridged call must carry the same codec. When staff call a guest, the guest's offer lists only the video codecs staff offered, and whatever the guest answers is pinned on both legs; staff's answer is then mirrored with only that codec.

- **Queues and ring groups.** When a call is adopted and mixed after both legs have already negotiated independently, nothing can pin them to one codec any more. If they chose the same codec, video is bridged. If not (one VP8, one H.264), the call carries audio only rather than relaying undecodable video. Video through a queue therefore depends on both endpoints preferring the same codec.
- **Extra m-lines.** An offer with an m-line we do not bridge (a SIP phone offering video on a call without `video: true`, T.38, BFCP ...) is answered with that m-line at port 0 and `a=inactive`, as RFC 3264 requires, where older releases left it out of the answer. An endpoint that relied on the omission may behave differently.

# Examples

Authorise the call, sending ringing then answer. Once answered, echo RTP data back to the client.

```javascript
cm.on( "call", async ( c ) => {

  await call.auth()
  call.ring()
  await call.answer()

  call.channels.audio.echo()
} )
```

An example for prompting and waiting for DTMF (auto attendant).

No auth or need to send ringing, we answer and when answered, we play a file then wait for caller to enter input.
```javascript
cm.on( "call", async ( c ) => {

  await call.answer()

  call.channels.audio.play( { "files": [ { "wav": "pleasedialoneforsalesandtwofortech.wav" } ] } )

  var e = await call.waitforevents( /[0-1]/ )
  console.log( "waited and got " + e )
} )
```

# JSDoc

jsdoc -r -p lib/

# Development

I use to develop locally other modules against this module

npm link projectrtp
npm link babble-drachtio-registrar
npm link babble-drachtio-auth

# Building and testing

The interface tests boot a **real** projectrtp engine (`projectrtp.run()`) rather
than mocking it. `@babblevoice/projectrtp` 3.x is a Rust napi addon published as
source (`rust/` + `libilbc/`) with no install hook, so the native `.so` has to be
compiled and dropped into `node_modules/@babblevoice/projectrtp/build/Release/projectrtp.node`
before the suite can run. The `Dockerfile` does this in a `rust-builder` stage
(mirroring babble-rtp) so you don't need a local Rust/cmake toolchain.

Run the whole suite:

```bash
docker build --target test -t callmanager:test .
docker run --rm callmanager:test
```

Run a single test (override the default `npm test` command):

```bash
docker run --rm callmanager:test \
  npx mocha --recursive --check-leaks --grep 'Create call and send 183 - early - SAVPF'
```

To iterate on test code without rebuilding the image each time, mount your working
tree over the source (the built engine in the image's `node_modules` is reused):

```bash
docker run --rm -it \
  -v "$(pwd)/lib":/usr/src/callmanager/lib:Z \
  -v "$(pwd)/test":/usr/src/callmanager/test:Z \
  -v "$(pwd)/index.js":/usr/src/callmanager/index.js:Z \
  callmanager:test
```

### Building the engine locally (no Docker)

If you have Rust + cmake installed you can build the addon straight into the
installed package and run the tests on the host:

```bash
( cd node_modules/@babblevoice/projectrtp && npm run build )   # cargo build → build/Release/projectrtp.node
npm test
```

# References

* SIP: Session Initiation Protocol [RFC 3261](https://tools.ietf.org/html/rfc3261)
* The Session Initiation Protocol (SIP) Refer Method [RFC 3515](https://tools.ietf.org/html/rfc3515)
* Session Initiation Protocol (SIP) Call Control - Transfer [RFC 5589](https://tools.ietf.org/html/rfc5589)
* Session Timers in the Session Initiation Protocol (SIP) [RFC 4028](https://tools.ietf.org/html/rfc4028)
* Session Initiation Protocol Service Examples [RFC 5359](https://tools.ietf.org/html/rfc5359)
* HTTP Authentication: Basic and Digest Access Authentication [RFC 2617](https://tools.ietf.org/html/rfc2617)
* SIP Digest examples [draft-smith-sipping-auth-examples-01](https://datatracker.ietf.org/doc/html/draft-smith-sipping-auth-examples-01)
* Extended Secure RTP Profile for Real-time Transport Control Protocol (RTCP)-Based Feedback (RTP/SAVPF) [RFC 5124](https://tools.ietf.org/html/rfc5124)
* Source-Specific Media Attributes in the Session Description Protocol (SDP)[RFC 5576](https://tools.ietf.org/html/rfc5576)
* Cross Session Stream Identification in the Session Description Protocol (msid in SDP) [draft-ietf-mmusic-msid-00](https://datatracker.ietf.org/doc/html/draft-ietf-mmusic-msid-00)

Need to look at

* A Framework for Conferencing with the Session Initiation Protocol (SIP) [RFC 4353](https://tools.ietf.org/html/rfc4353)
