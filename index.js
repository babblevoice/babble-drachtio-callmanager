
const callmanager = require( "./lib/callmanager.js" )
const store = require( "./lib/store.js" )

const projectrtp = require( "@babblevoice/projectrtp" ).projectrtp

const default_options = {
  "preferedcodecs": "g722 ilbc pcmu pcma",
  //"transcode": true, - this never made it into the software - TODO
  "uactimeout": 32000, /* timeout when calling a client: Default: 64 × T1 = 32 seconds */
  "seexpire": 1800*1000, /* session expires timeout mS recomended in RFC 4028 - 30 minutes */
  "rfc2833": true,  /* Enable RFC 2833 - DTMF */
  "late": false,  /* Late negotiation */
  "registrar": false, /* our registrar object or falsey */
  "referauthrequired": true,
  "ignoreipv6candidates": true, /* ipv6 does not work in projectrtp */
  "privacy": false,
  "hangupchildrenonhangup": true,
  "hangupparentonhangup": false,
  "continueonotherhangup": false
}

/**
@param { object } options - see default_options
@returns { callmanager }
*/
module.exports.callmanager = ( options ) => {
  const ouroptions = { ...default_options, ...options }
  return callmanager.callmanager( ouroptions )
}

/**
Expose our RTP interface
*/
module.exports.projectrtp = projectrtp

/**
 * Hangup Codes
 */
module.exports.hangupcodes = callmanager.hangupcodes

/**
 * Call store
 */
module.exports.store = store

/**
 * Call
 */
module.exports.call = callmanager.call
