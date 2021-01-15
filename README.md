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

## Example

```javascript

cm.on( "call", async ( c ) => {

  await call.auth()
  call.ring()
  await call.answer()

  call.audio().echo()
} )


```
