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
  "passwordLookup": passwordLookup
} )


const cm = new CallManager( {
  "srf": srf,
  "registrar": r,
  "passwordLookup": passwordLookup
} )

cm.on( "call", async ( c ) => {

} )
```

When call manager presents a new call it passes a call object as part of it. The original req and res from Drachtio are members of this object. The call object also has the following methods.

CallManager takes an options object as part of its construction. srf and a passwordLookup function are required. Options for codecs and transcoding can also be supplied:

```json
{
  "srf": srf,
  "passwordLookup": passwordLookup,
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

# Examples

Authorise the call, sending ringing then answer. Once answered, echo RTP data back to the client.

```javascript
cm.on( "call", async ( c ) => {

  await call.auth()
  call.ring()
  await call.answer()

  call.audio().echo()
} )
```

An example for prompting and waiting for DTMF (auto attendant).

No auth or need to send ringing, we answer and when answered, we play a file then wait for caller to enter input.
```javascript
cm.on( "call", async ( c ) => {

  await call.answer()

  call.audio.play( { "files": [ { "wav": "pleasedialoneforsalesandtwofortech.wav" } ] } )

  var e = await call.waitforevents( /[0-1]/ )
  console.log( "waited and got " + e )
} )
```


# References

* SIP: Session Initiation Protocol [RFC 3261](https://tools.ietf.org/html/rfc3261)
* The Session Initiation Protocol (SIP) Refer Method [RFC 3515](https://tools.ietf.org/html/rfc3515)
* Session Initiation Protocol (SIP) Call Control - Transfer [RFC 5589](https://tools.ietf.org/html/rfc5589)
* Session Timers in the Session Initiation Protocol (SIP) [RFC 4028](https://tools.ietf.org/html/rfc4028)
* Session Initiation Protocol Service Examples [RFC 5359](https://tools.ietf.org/html/rfc5359)

Need to look at

* A Framework for Conferencing with the Session Initiation Protocol (SIP) [RFC 4353](https://tools.ietf.org/html/rfc4353)
