
const assert = require( "assert" )
const callmanager = require( "./lib/callmanager.js" )
const store = require( "./lib/store.js" )

const projectrtp = require( "@babblevoice/projectrtp" ).projectrtp

const default_options = {
  "preferedcodecs": "g722 ilbc pcmu pcma",
  "transcode": true,
  "uactimeout": 30000, /* timeout when calling a client */
  "seexpire": 120000, /* session expires timeout */
  "rfc2833": true,  /* Enable RFC 2833 - DTMF */
  "late": false,  /* Late negotiation */
  "registrar": false, /* our registrar object or falsey */
  "referauthrequired": true
}

/**
@param { object } options - see default_options
@returns { callmanager }
*/
module.exports.callmanager = ( options ) => {
  let ouroptions = { ...default_options, ...options }
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
