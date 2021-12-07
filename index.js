
const assert = require( "assert" )
const events = require( "events" )
const callmanager = require( "./lib/callmanager.js" )

const default_options = {
  "preferedcodecs": "g722 ilbc pcmu pcma",
  "transcode": true,
  "uactimeout": 30000, /* timeout when calling a client */
  "seexpire": 120000, /* session expires timeout */
  "rfc2833": true,  /* Enable RFC 2833 - DTMF */
  "late": false,  /* Late negotiation */
  "registrar": false /* our registrar object or falsey */
}

module.exports.callmanager = async( options ) => {
  Object.assign( default_options, options )
  return callmanager.callmanager( default_options )
}

module.exports.hangupcodes = callmanager.hangupcodes
